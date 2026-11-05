import ActivityKit
import WidgetKit
import SwiftUI

/// Lock Screen and Dynamic Island while a flight is recording: elapsed time, ground speed,
/// GPS altitude and distance flown.
struct RecordingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RecordingAttributes.self) { context in
            HStack(alignment: .center, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Circle().fill(Color.red).frame(width: 8, height: 8)
                        Text("Recording flight").font(W.text(13, true)).foregroundStyle(W.ice)
                    }
                    Text(context.attributes.startedAt, style: .timer)
                        .font(.system(size: 34, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.white)
                        .monospacedDigit()
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 3) {
                    readout("\(context.state.speedKt)", "kt")
                    readout("\(context.state.altitudeFt)", "ft")
                    readout(String(format: "%.1f", context.state.distanceNm), "NM")
                }
            }
            .padding(18)
            .activityBackgroundTint(W.night)
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        Circle().fill(Color.red).frame(width: 8, height: 8)
                        Text(context.attributes.startedAt, style: .timer).font(.system(.title3, design: .monospaced)).monospacedDigit()
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("\(context.state.speedKt) kt").font(.system(.title3, design: .monospaced))
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Label("\(context.state.altitudeFt) ft", systemImage: "arrow.up.to.line")
                        Spacer()
                        Label(String(format: "%.1f NM", context.state.distanceNm), systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            } compactLeading: {
                HStack(spacing: 4) {
                    Circle().fill(Color.red).frame(width: 7, height: 7)
                    Image(systemName: "airplane")
                }
            } compactTrailing: {
                Text(context.attributes.startedAt, style: .timer)
                    .monospacedDigit()
                    .frame(maxWidth: 52)
            } minimal: {
                Image(systemName: "airplane").foregroundStyle(.red)
            }
            .keylineTint(.red)
        }
    }

    private func readout(_ value: String, _ unit: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
            Text(value).font(.system(size: 16, weight: .semibold, design: .monospaced)).foregroundStyle(.white)
            Text(unit).font(W.text(11)).foregroundStyle(W.mist)
        }
    }
}
