import Foundation
#if canImport(ActivityKit)
import ActivityKit

/// The Live Activity shown on the Lock Screen and in the Dynamic Island while a flight is recording.
struct RecordingAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var speedKt: Int
        var altitudeFt: Int
        var distanceNm: Double
    }
    var startedAt: Date
}
#endif
