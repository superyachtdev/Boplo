import Foundation
import CoreLocation
import Observation

/// Records a GPS track for the logbook: position, GPS altitude, groundspeed and time, about once a second.
/// Starts only when the pilot taps Start, keeps going with the screen locked (the blue location pill stays
/// visible), and stops on Stop. Works with no phone signal. The recording is saved to the phone as it goes,
/// so it survives the app closing, and stays there until the flight is safely in the logbook.
@MainActor
@Observable
final class FlightRecorder: NSObject, CLLocationManagerDelegate {
    private(set) var isRecording = false
    private(set) var points: [TrackPoint] = []
    private(set) var startedAt: Date?
    private(set) var endedAt: Date?
    private(set) var speedKnots: Double = 0
    private(set) var altitudeFeet: Double = 0
    private(set) var distanceNM: Double = 0
    /// A finished recording that hasn't been saved to the logbook yet (no signal, form closed, app closed).
    private(set) var unsaved: Bool = false
    var message: String?

    /// About 11 hours at one point a second: far beyond any training flight.
    private static let maxPoints = 40_000
    private let manager = CLLocationManager()
    private var lastWrite = Date.distantPast

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = kCLDistanceFilterNone
        manager.activityType = .airborne
        manager.pausesLocationUpdatesAutomatically = false
        restore()
    }

    var elapsedMinutes: Int {
        guard let startedAt else { return 0 }
        return max(1, Int(((endedAt ?? Date()).timeIntervalSince(startedAt) / 60).rounded()))
    }

    func start() {
        message = nil
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            message = "Location is off for Boplo. Turn it on in Settings › Boplo › Location to record a flight."
            return
        default:
            break
        }
        points = []
        distanceNM = 0
        startedAt = Date()
        endedAt = nil
        unsaved = false
        isRecording = true
        RecordingActivity.start(at: startedAt ?? Date())
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.startUpdatingLocation()
        persist()
    }

    func stop() {
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        isRecording = false
        endedAt = Date()
        unsaved = !points.isEmpty
        RecordingActivity.end()
        persist()
    }

    /// The flight is in the logbook: forget the recording.
    func saved() {
        reset()
        try? FileManager.default.removeItem(at: Self.file)
    }

    /// Throw the recording away (the pilot chose Discard).
    func discard() { saved() }

    func reset() {
        points = []
        startedAt = nil
        endedAt = nil
        speedKnots = 0
        altitudeFeet = 0
        distanceNM = 0
        unsaved = false
    }

    // MARK: Saving to the phone

    private struct Stored: Codable {
        var startedAt: Date
        var endedAt: Date?
        var recording: Bool
        var points: [TrackPoint]
        var distanceNM: Double
    }

    private static var file: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("boplo-recording.json")
    }

    private func persist() {
        guard let startedAt else { return }
        lastWrite = Date()
        let s = Stored(startedAt: startedAt, endedAt: endedAt, recording: isRecording, points: points, distanceNM: distanceNM)
        let url = Self.file
        Task.detached(priority: .utility) {
            if let data = try? JSONEncoder().encode(s) { try? data.write(to: url, options: .atomic) }
        }
    }

    /// Picks up a recording the app was closed during, or one that was never saved to the logbook.
    private func restore() {
        guard let data = try? Data(contentsOf: Self.file), let s = try? JSONDecoder().decode(Stored.self, from: data), !s.points.isEmpty else { return }
        startedAt = s.startedAt
        points = s.points
        distanceNM = s.distanceNM
        // a recording cut short by the app closing ends at its last point
        endedAt = s.endedAt ?? s.points.last?.t.map { s.startedAt.addingTimeInterval($0) } ?? Date()
        unsaved = true
    }

    // MARK: CLLocationManagerDelegate

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let good = locations.filter { $0.horizontalAccuracy >= 0 && $0.horizontalAccuracy < 65 }
        Task { @MainActor in
            guard self.isRecording, let start = self.startedAt else { return }
            for l in good where self.points.count < Self.maxPoints {
                let t = l.timestamp.timeIntervalSince(start)
                if let last = self.points.last?.t, t < last + 0.8 { continue }
                let kt = l.speed >= 0 ? l.speed * 1.943844 : nil
                let pt = TrackPoint(lat: l.coordinate.latitude, lng: l.coordinate.longitude,
                                    alt: l.verticalAccuracy > 0 && l.verticalAccuracy < 60 ? l.altitude * 3.28084 : nil,
                                    t: max(0, t), kt: kt)
                if let prev = self.points.last {
                    self.distanceNM += Geo.nm(prev, pt)
                }
                self.points.append(pt)
            }
            if let last = good.last {
                self.speedKnots = max(0, last.speed) * 1.943844
                self.altitudeFeet = last.altitude * 3.28084
                RecordingActivity.update(speedKt: self.speedKnots, altitudeFt: self.altitudeFeet, distanceNm: self.distanceNM)
            }
            if self.points.count >= Self.maxPoints {
                self.message = "That’s the longest recording Boplo can hold, so it has stopped. Your flight so far is kept."
                self.stop()
            } else if Date().timeIntervalSince(self.lastWrite) > 15 {
                self.persist()
            }
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            if status == .denied || status == .restricted, self.isRecording {
                self.stop()
                self.message = "Location is off for Boplo. Turn it on in Settings to record a flight."
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.message = "GPS isn’t available right now." }
    }
}
