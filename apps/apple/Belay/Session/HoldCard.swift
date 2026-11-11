import BelayCore
import SwiftUI

/// A timed set: its target before the hold, the ring while it runs, the seconds held after.
struct HoldCard: View {
    let state: SessionState
    let training: TrainingModel
    let actions: CoverActions
    let openProgramme: () -> Void
    @Environment(\.accessibilityReduceMotion) private var systemReduce

    private var due: DueSet? {
        switch state.phase {
        case .due(let due): due
        case .holding(let hold): hold.due
        case .held(let held): held.due
        default: nil
        }
    }

    var body: some View {
        SessionCard {
            if let due {
                CardHeading(state: state, exerciseId: due.exerciseId, training: training, actions: actions, open: openProgramme)
                Rectangle().fill(Color.line).frame(height: 0.5).padding(.vertical, 16)
                Text(title(due))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.muted)
                    .accessibilityIdentifier("set-title")
                switch state.phase {
                case .holding(let hold): ring(hold)
                case .held(let held): figure(held.seconds, unit: Text("s tenues", tableName: "SessionTools"))
                default: figure(due.count, unit: Text(verbatim: "s"))
                }
                HStack(spacing: 8) {
                    Image(systemName: "arrow.up.right").font(.subheadline.weight(.bold)).accessibilityHidden(true)
                    Text(SetText.progression(due.progression, timed: true))
                        .font(.headline)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .foregroundStyle(.ink)
                .frame(minHeight: 44)
            }
        }
    }

    private func title(_ due: DueSet) -> String {
        due.added
            ? String(localized: "Série \(due.number) · tenue", table: "SessionTools")
            : String(localized: "Série \(due.number) sur \(due.of) · tenue", table: "SessionTools")
    }

    private func figure(_ seconds: Int, unit: Text) -> some View {
        HStack(alignment: .lastTextBaseline, spacing: 8) {
            Text(verbatim: String(seconds))
                .font(.custom(Font.archivoName, size: 72, relativeTo: .largeTitle))
                .monospacedDigit()
                .foregroundStyle(.ink)
                .contentTransition(.numericText(value: Double(seconds)))
                .lineLimit(1)
            unit.font(.title2.weight(.semibold)).foregroundStyle(.muted)
        }
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("hold-figure")
    }

    /// The ring empties around the seconds left, read each second from the hold's absolute end,
    /// so a relaunch or a locked phone shows the right time.
    private func ring(_ hold: Hold) -> some View {
        let reduce = Motion.reduced(systemReduce)
        let total = max(1, hold.due.count)
        return TimelineView(.periodic(from: .now, by: 1)) { context in
            let left = max(0, Int(hold.endsAt.timeIntervalSince(context.date).rounded(.up)))
            ZStack {
                Circle().stroke(Color.line, lineWidth: 14)
                Circle()
                    .trim(from: 0, to: CGFloat(min(left, total)) / CGFloat(total))
                    .stroke(Color.ink, style: StrokeStyle(lineWidth: 14, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(reduce ? nil : .linear(duration: 1), value: left)
                Text(verbatim: Self.clock(left))
                    .font(.custom(Font.archivoName, size: 56, relativeTo: .largeTitle))
                    .monospacedDigit()
                    .foregroundStyle(.ink)
                    .contentTransition(reduce ? .opacity : .numericText(countsDown: true))
                    .animation(reduce ? nil : Motion.spring, value: left)
            }
            .dynamicTypeSize(...DynamicTypeSize.xxLarge)
            .frame(width: 220, height: 220)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Tenue en cours", tableName: "SessionTools"))
            .accessibilityValue(Text("\(left) secondes restantes", tableName: "SessionTools"))
            .accessibilityIdentifier("hold-ring")
        }
    }

    /// « 45 », or « 1:05 » past a minute.
    private static func clock(_ seconds: Int) -> String {
        seconds < 60 ? String(seconds) : "\(seconds / 60):\(String(format: "%02d", seconds % 60))"
    }
}
