import Foundation
import CoreLocation
import Observation

/// Records a GPS track for the logbook. Starts only when the pilot taps Start, keeps going with the
/// screen locked (the blue location pill stays visible), and stops on Stop.
@MainActor
@Observable
final class FlightRecorder: NSObject, CLLocationManagerDelegate {
    private(set) var isRecording = false
    private(set) var points: [TrackPoint] = []
    private(set) var startedAt: Date?
    private(set) var speedKnots: Double = 0
    private(set) var altitudeFeet: Double = 0
    private(set) var distanceNM: Double = 0
    var message: String?

    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = 15
        manager.activityType = .airborne
        manager.pausesLocationUpdatesAutomatically = false
    }

    var elapsedMinutes: Int {
        guard let startedAt else { return 0 }
        return max(1, Int((Date().timeIntervalSince(startedAt) / 60).rounded()))
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
        isRecording = true
        RecordingActivity.start(at: startedAt ?? Date())
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.startUpdatingLocation()
    }

    func stop() {
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        isRecording = false
        RecordingActivity.end()
    }

    func reset() {
        points = []
        startedAt = nil
        speedKnots = 0
        altitudeFeet = 0
        distanceNM = 0
    }

    // MARK: CLLocationManagerDelegate

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let good = locations.filter { $0.horizontalAccuracy >= 0 && $0.horizontalAccuracy < 100 }
        Task { @MainActor in
            guard self.isRecording else { return }
            for location in good where self.points.count < 2000 {
                let pt = TrackPoint(lat: location.coordinate.latitude, lng: location.coordinate.longitude)
                if let prev = self.points.last {
                    let a = CLLocation(latitude: prev.lat, longitude: prev.lng), b = CLLocation(latitude: pt.lat, longitude: pt.lng)
                    self.distanceNM += b.distance(from: a) / 1852
                }
                self.points.append(pt)
            }
            if let last = good.last {
                self.speedKnots = max(0, last.speed) * 1.943844
                self.altitudeFeet = last.altitude * 3.28084
                RecordingActivity.update(speedKt: self.speedKnots, altitudeFt: self.altitudeFeet, distanceNm: self.distanceNM)
            }
            if self.points.count >= 2000 {
                self.message = "That’s the most points one flight can hold, so recording has stopped."
                self.stop()
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
