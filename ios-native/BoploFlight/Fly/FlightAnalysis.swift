import Foundation

/// Works out a logbook entry from a recorded GPS track: when the aircraft took off and landed (full stops and
/// touch-and-goes), the departure and arrival airfields, night time, how far it went, and a score for each
/// landing. Phone GPS is approximate, so the pilot checks and edits everything before saving.
struct RecordedFlight {
    var points: [TrackPoint]           // thinned to what the logbook keeps
    var minutes: Int
    var departure: String?
    var arrival: String?
    var takeoffs: Int
    var landingTimes: [Double]         // seconds since the recording started
    var nightLandings: Int
    var nightMinutes: Int
    var xcNM: Double
    var scores: [LandingScore]
    var date: Date
}

enum FlightAnalysis {
    /// Air and ground are told apart by groundspeed, with some hysteresis so a slow taxi or a fast roll doesn't flicker.
    static let airborneKt = 45.0, groundKt = 35.0

    @MainActor
    static func analyse(_ raw: [TrackPoint], startedAt: Date, endedAt: Date, country: String) async -> RecordedFlight {
        let pts = raw.filter { $0.t != nil }
        let minutes = max(1, Int((endedAt.timeIntervalSince(startedAt) / 60).rounded()))
        var out = RecordedFlight(points: thin(raw, keepAround: []), minutes: minutes, departure: nil, arrival: nil, takeoffs: 0,
                                 landingTimes: [], nightLandings: 0, nightMinutes: 0, xcNM: 0, scores: [], date: startedAt)
        guard pts.count >= 10 else { return out }
        let kt = smoothSpeeds(pts)

        // ---- air and ground runs ----
        var airborne = false, runStart = 0
        var airRuns: [(Int, Int)] = []
        var i = 0
        while i < pts.count {
            if !airborne, kt[i] >= airborneKt, sustained(pts, kt, from: i, seconds: 5, { $0 >= airborneKt }) { airborne = true; runStart = i }
            else if airborne, kt[i] <= groundKt, sustained(pts, kt, from: i, seconds: 8, { $0 <= groundKt }) { airborne = false; airRuns.append((runStart, i)) }
            i += 1
        }
        if airborne { airRuns.append((runStart, pts.count - 1)) }
        guard !airRuns.isEmpty else { return out }

        // ---- airfields ----
        let lats = pts.map(\.lat), lngs = pts.map(\.lng)
        let (la0, la1, lo0, lo1) = (lats.min()! - 0.1, lats.max()! + 0.1, lngs.min()! - 0.15, lngs.max()! + 0.15)
        let fields = await AirfieldStore.shared.airfields(country).filter { $0.lat > la0 && $0.lat < la1 && $0.lng > lo0 && $0.lng < lo1 }
        func nearest(_ p: TrackPoint) -> Airfield? {
            fields.filter { abs($0.lat - p.lat) < 0.1 && abs($0.lng - p.lng) < 0.15 }.min { Geo.nm($0.point, p) < Geo.nm($1.point, p) }
                .flatMap { Geo.nm($0.point, p) < 3 ? $0 : nil }
        }
        let depPoint = pts[max(0, airRuns[0].0 - 1)]
        let depField = nearest(depPoint)
        out.departure = depField?.code

        // ground level for an airfield: GPS altitude while taxiing there, else its published elevation
        var groundCache: [String: Double?] = [:]
        func groundAlt(near p: TrackPoint, field: Airfield?) -> Double? {
            let key = field?.code ?? String(format: "%.3f,%.3f", p.lat, p.lng)
            if let hit = groundCache[key] { return hit }
            let v = groundAltUncached(near: p, field: field)
            groundCache[key] = v
            return v
        }
        func groundAltUncached(near p: TrackPoint, field: Airfield?) -> Double? {
            let taxi = pts.enumerated().filter { kt[$0.offset] < 20 && $0.element.alt != nil && Geo.nm($0.element, p) < 1 }.compactMap(\.element.alt)
            if taxi.count >= 5 { return median(taxi) }
            return field?.elevationFt
        }

        // ---- landings: every full stop, plus touch-and-goes found in the air runs ----
        var landings: [(index: Int, field: Airfield?)] = []
        var takeoffs = 0
        for (k, run) in airRuns.enumerated() {
            takeoffs += 1
            let endsOnGround = !(k == airRuns.count - 1 && run.1 == pts.count - 1)
            // touch-and-goes: dips to the ground followed by a climb, inside one air run
            var j = run.0 + 20
            while j < run.1 - 20 {
                let p = pts[j]
                guard let alt = p.alt, let f = nearest(p), let g = groundAlt(near: f.point, field: f), alt - g < 60 else { j += 1; continue }
                // lowest point of this dip
                var low = j
                var m = j
                while m < min(run.1, j + 40) { if let a = pts[m].alt, a < (pts[low].alt ?? .infinity) { low = m }; m += 1 }
                let before = (max(run.0, low - 120)...low).compactMap { pts[$0].alt }.max() ?? 0
                let after = (low...min(run.1, low + 120)).compactMap { pts[$0].alt }.max() ?? 0
                let lowAlt = pts[low].alt ?? 0
                if before - lowAlt > 250 && after - lowAlt > 250 && (pts[low].kt ?? kt[low]) < 90 {
                    landings.append((index: low, field: f)); takeoffs += 1
                    j = low + 90
                } else { j += 1 }
            }
            if endsOnGround {
                // the touchdown: the first point near the ground in the last minute before the roll-out
                let stop = run.1
                let f = nearest(pts[stop])
                let g = groundAlt(near: pts[stop], field: f)
                var td = max(run.0, stop - 6)
                if let g {
                    for q in max(run.0, stop - 60)...stop { if let a = pts[q].alt, a - g < 20 { td = q; break } }
                }
                landings.append((index: td, field: f))
            }
        }
        landings.sort { $0.index < $1.index }
        out.takeoffs = takeoffs
        out.landingTimes = landings.compactMap { pts[$0.index].t }
        out.arrival = (landings.last?.field ?? nearest(pts[airRuns.last!.1]))?.code ?? out.departure

        // ---- night (sun more than 6° below the horizon, the logbook definition) and cross-country ----
        var night = 0.0
        for k in 1..<pts.count {
            guard let t0 = pts[k - 1].t, let t1 = pts[k].t, t1 > t0, t1 - t0 < 300 else { continue }
            if Sun.elevation(lat: pts[k].lat, lng: pts[k].lng, date: startedAt.addingTimeInterval(t1)) < -6 { night += t1 - t0 }
        }
        out.nightMinutes = Int((night / 60).rounded())
        out.nightLandings = landings.filter { l in
            Sun.elevation(lat: pts[l.index].lat, lng: pts[l.index].lng, date: startedAt.addingTimeInterval(pts[l.index].t ?? 0)) < -6
        }.count
        out.xcNM = (pts.map { Geo.nm(depPoint, $0) }.max() ?? 0).rounded(toPlaces: 1)

        // ---- landing scores ----
        for l in landings {
            if let s = await score(pts, kt: kt, at: l.index, field: l.field, groundAlt: l.field.flatMap { groundAlt(near: $0.point, field: $0) }) {
                out.scores.append(s)
            }
        }
        out.points = thin(raw, keepAround: out.landingTimes + airRuns.compactMap { pts[$0.0].t })
        return out
    }

    // MARK: Landing score

    /// Scores one landing from the last two minutes before touchdown. Each part is 0–100; parts that can't be
    /// measured (no runway data, no GPS altitude) are left out rather than guessed.
    @MainActor
    static func score(_ pts: [TrackPoint], kt: [Double], at td: Int, field: Airfield?, groundAlt: Double?) async -> LandingScore? {
        guard let tdT = pts[td].t else { return nil }
        let window = pts.indices.filter { i in (pts[i].t ?? -1) >= tdT - 120 && i <= td }
        guard window.count >= 15 else { return nil }
        var parts: [(Double, Double)] = []   // (score, weight)
        var out = LandingScore(s: 0, t: tdT, ap: field?.code)

        // approach speed: how steady the groundspeed was over the last minute (ignoring the flare)
        let speeds = window.filter { (pts[$0].t ?? 0) >= tdT - 65 && (pts[$0].t ?? 0) <= tdT - 5 }.map { kt[$0] }
        if speeds.count >= 10 {
            let sd = stddev(speeds)
            out.spd = sd.rounded(toPlaces: 1)
            parts.append((lin(sd, good: 3, bad: 10), 1))
        }

        // runway: the end whose direction matches the final approach and whose threshold is nearest the touchdown
        var runway: (id: String, thr: TrackPoint, hdg: Double)?
        if let field {
            let ends = await AirfieldStore.shared.runwayThresholds(field)
            let a = pts[window[max(0, window.count - 30)]], b = pts[td]
            let trk = Geo.bearing(a, b)
            runway = ends.filter { abs(angle($0.hdg - trk)) < 35 }.min { Geo.nm($0.thr, b) < Geo.nm($1.thr, b) }.map { (id: $0.id, thr: $0.thr, hdg: $0.hdg) }
        }
        let tdPt = pts[td]
        if let rw = runway {
            out.rw = rw.id
            // along-runway and sideways offsets from the threshold, in metres
            func offsets(_ p: TrackPoint) -> (along: Double, side: Double) {
                let d = Geo.nm(rw.thr, p) * 1852, b = Geo.bearing(rw.thr, p) - rw.hdg
                return (d * cos(b * .pi / 180), d * sin(b * .pi / 180))
            }
            // touchdown zone: the first 1,000 ft past the threshold is the target
            let along = offsets(tdPt).along
            out.tz = (along * 3.28084).rounded()
            parts.append((along < 0 ? 0 : along <= 300 ? 100 : lin(along, good: 300, bad: 700), 1))
            // centreline: average sideways offset on short final and at touchdown
            let side = window.filter { let o = offsets(pts[$0]); return o.along > -900 }.map { abs(offsets(pts[$0]).side) }
            if !side.isEmpty {
                let m = side.reduce(0, +) / Double(side.count)
                out.cl = m.rounded(toPlaces: 1)
                parts.append((lin(m, good: 8, bad: 35), 1))
            }
            // glidepath: height above the threshold against a 3° path from 50 ft over it, between 1.5 and 0.3 NM out
            if let g = groundAlt {
                let errs = window.compactMap { i -> Double? in
                    guard let alt = pts[i].alt else { return nil }
                    let o = offsets(pts[i]); let dist = -o.along
                    guard dist > 550, dist < 2800 else { return nil }
                    return (alt - g) - (dist * 3.28084 * tan(3 * .pi / 180) + 50)
                }
                if errs.count >= 8 {
                    let rms = sqrt(errs.map { $0 * $0 }.reduce(0, +) / Double(errs.count))
                    out.gp = rms.rounded()
                    parts.append((lin(rms, good: 60, bad: 250), 1))
                }
            }
        }
        guard !parts.isEmpty else { return nil }
        out.s = (parts.map { $0.0 * $0.1 }.reduce(0, +) / parts.map(\.1).reduce(0, +)).rounded()
        return out
    }

    // MARK: Thinning

    /// The logbook keeps up to 2,000 points a flight. Every point near a takeoff or landing is kept (that's what
    /// the replay and scores look at closely); the rest of the flight is spread evenly over what's left.
    static func thin(_ raw: [TrackPoint], keepAround events: [Double], limit: Int = 2000) -> [TrackPoint] {
        guard raw.count > limit else { return raw }
        var keep = Set<Int>([0, raw.count - 1])
        var important = raw.indices.filter { i in
            guard let t = raw[i].t else { return false }
            return events.contains { abs($0 - t) <= 75 }
        }
        if important.count > limit * 6 / 10 {
            let step = Double(important.count) / Double(limit * 6 / 10)
            important = stride(from: 0.0, to: Double(important.count), by: step).map { important[Int($0)] }
        }
        keep.formUnion(important)
        let rest = raw.indices.filter { !keep.contains($0) }
        let room = max(0, limit - keep.count)
        if room > 0, !rest.isEmpty {
            let step = max(1.0, Double(rest.count) / Double(room))
            for x in stride(from: 0.0, to: Double(rest.count), by: step) { keep.insert(rest[Int(x)]) }
        }
        return keep.sorted().prefix(limit).map { raw[$0] }
    }

    // MARK: Helpers

    private static func smoothSpeeds(_ pts: [TrackPoint]) -> [Double] {
        let k: [Double] = pts.indices.map { i in
            if let v = pts[i].kt { return v }
            let a = max(0, i - 1), b = min(pts.count - 1, i + 1)
            let dt = (pts[b].t ?? 0) - (pts[a].t ?? 0)
            return dt > 0 ? Geo.nm(pts[a], pts[b]) / dt * 3600 : 0
        }
        return k.indices.map { i in median(Array(k[max(0, i - 2)...min(k.count - 1, i + 2)])) }
    }

    private static func sustained(_ pts: [TrackPoint], _ kt: [Double], from i: Int, seconds: Double, _ ok: (Double) -> Bool) -> Bool {
        guard let t0 = pts[i].t else { return false }
        var j = i
        while j < pts.count, let t = pts[j].t, t - t0 <= seconds { if !ok(kt[j]) { return false }; j += 1 }
        return j < pts.count || (pts.last?.t ?? 0) - t0 >= seconds * 0.6
    }

    static func median(_ a: [Double]) -> Double { let s = a.sorted(); return s.isEmpty ? 0 : s[s.count / 2] }
    private static func stddev(_ a: [Double]) -> Double { let m = a.reduce(0, +) / Double(a.count); return sqrt(a.map { ($0 - m) * ($0 - m) }.reduce(0, +) / Double(a.count)) }
    /// 100 at or below `good`, 0 at or beyond `bad`, straight line between.
    private static func lin(_ v: Double, good: Double, bad: Double) -> Double { max(0, min(100, 100 * (bad - v) / (bad - good))) }
    private static func angle(_ d: Double) -> Double { ((d.truncatingRemainder(dividingBy: 360)) + 540).truncatingRemainder(dividingBy: 360) - 180 }
}

extension Double {
    func rounded(toPlaces n: Int) -> Double { let p = pow(10, Double(n)); return (self * p).rounded() / p }
}

/// Where the sun is, for logging night time (NOAA's simplified solar position).
enum Sun {
    static func elevation(lat: Double, lng: Double, date: Date) -> Double {
        let r = Double.pi / 180
        let jd = date.timeIntervalSince1970 / 86400 + 2440587.5, n = jd - 2451545.0
        let L = (280.460 + 0.9856474 * n).truncatingRemainder(dividingBy: 360)
        let g = (357.528 + 0.9856003 * n).truncatingRemainder(dividingBy: 360) * r
        let lambda = (L + 1.915 * sin(g) + 0.020 * sin(2 * g)) * r
        let eps = (23.439 - 0.0000004 * n) * r
        let dec = asin(sin(eps) * sin(lambda))
        let ra = atan2(cos(eps) * sin(lambda), cos(lambda))
        let gmst = (18.697374558 + 24.06570982441908 * n).truncatingRemainder(dividingBy: 24) * 15 * r
        let ha = gmst + lng * r - ra
        let el = asin(sin(lat * r) * sin(dec) + cos(lat * r) * cos(dec) * cos(ha))
        return el / r
    }
}
