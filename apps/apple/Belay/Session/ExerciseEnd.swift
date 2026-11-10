import BelayCore
import SwiftUI

/// An exercise just finished (its recap, then the next one announced) and « Tout est noté ».
/// The card keeps its place in the cover; its content comes with the exercise's end.
struct ExerciseEndCard: View {
    let state: SessionState
    let training: TrainingModel
    let reduce: Bool

    var body: some View {
        switch state.phase {
        case .recap(let recap):
            RecapCard(recap: recap, training: training)
        case .announce(let announce):
            AnnounceCard(announce: announce, training: training, reduce: reduce)
        case .allDone(let sets, let title):
            AllDoneCard(sets: sets, session: training.open.map { SessionText.short($0.code) } ?? title)
        default:
            EmptyView()
        }
    }
}

/// ✓, the exercise, one plain line of what was done and its sets with their RIR. A tap turns it
/// at once; it turns by itself only once its RIR is answered, and never under VoiceOver.
private struct RecapCard: View {
    let recap: Recap
    let training: TrainingModel
    @Environment(\.dynamicTypeSize) private var type

    private var work: [DoneSet] { recap.sets.filter { !$0.warmup } }

    var body: some View {
        let name = training.exerciseName(recap.exerciseId)
        let line = Self.line(work)
        Button { training.mark { $0.recapTapped = true } } label: {
            SessionCard {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 52))
                    .foregroundStyle(.ink)
                    .symbolEffect(.bounce, value: recap.exerciseId)
                Text(verbatim: name)
                    .font(.title2.weight(.bold))
                    .foregroundStyle(.ink)
                    .padding(.top, 10)
                Text(verbatim: line)
                    .font(.subheadline)
                    .monospacedDigit()
                    .foregroundStyle(.muted)
                Rectangle().fill(Color.line).frame(height: 0.5).padding(.vertical, 12)
                ForEach(Array(work.enumerated()), id: \.element.id) { i, set in
                    if i > 0 { Rectangle().fill(Color.line).frame(height: 0.5) }
                    row(set, number: i + 1)
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        // One element: the button that turns the recap, read as what was done.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("\(name) terminé, \(line)", tableName: "SessionEnd"))
        .accessibilityHint(Text("Passer à la suite", tableName: "SessionEnd"))
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("exercise-recap")
    }

    private func row(_ set: DoneSet, number: Int) -> some View {
        let layout = type.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
            : AnyLayout(HStackLayout(spacing: 12))
        return layout {
            Text("Série \(number)", tableName: "SessionEnd")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.ink)
            if !type.isAccessibilitySize { Spacer(minLength: 8) }
            HStack(spacing: 10) {
                Text(verbatim: SetText.load(set.weightKg, String(set.count), timed: set.timed))
                    .font(.body.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.ink)
                if let rir = set.rir {
                    Text(verbatim: String(localized: "RIR \(rir == Bounds.rirMax ? "\(rir)+" : String(rir))", table: "Session"))
                        .font(.subheadline)
                        .monospacedDigit()
                        .foregroundStyle(.muted)
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
    }

    /// « 4 × 8 à 60 kg » when every set was alike, else the loads one after the other:
    /// « 62,5 kg × 8, 8, 7, 6 ».
    static func line(_ sets: [DoneSet]) -> String {
        guard let first = sets.first else { return "" }
        let timed = first.timed
        if sets.count > 1, sets.allSatisfy({ $0.weightKg == first.weightKg && $0.count == first.count }) {
            let count = timed ? "\(first.count)\u{202F}s" : String(first.count)
            if first.weightKg == 0 { return "\(sets.count) × \(count)" }
            return String(
                localized: "\(sets.count) × \(count) à \(SetText.kg(first.weightKg))\u{202F}kg", table: "SessionEnd")
        }
        var groups: [LoadGroup] = []
        for set in sets {
            if let last = groups.last, last.weightKg == set.weightKg {
                groups[groups.count - 1] = LoadGroup(weightKg: last.weightKg, counts: last.counts + [set.count])
            } else {
                groups.append(LoadGroup(weightKg: set.weightKg, counts: [set.count]))
            }
        }
        return SetText.groups(groups, timed: timed)
    }
}

/// One thing big: the next exercise and its first load, the rest's clock small above it. A tap
/// on the clock brings back the rest card with its +30 s.
private struct AnnounceCard: View {
    let announce: Announce
    let training: TrainingModel
    let reduce: Bool

    var body: some View {
        let next = announce.next
        VStack(alignment: .leading, spacing: 12) {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let left = max(0, Int(announce.restEndsAt.timeIntervalSince(context.date).rounded(.up)))
                Button { training.mark { $0.restCardAsked = true } } label: {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Repos", tableName: "SessionEnd").font(.headline).foregroundStyle(.muted)
                        Spacer()
                        Text(verbatim: RestCard.clock(left))
                            .font(.custom(Font.archivoName, size: 34, relativeTo: .title))
                            .monospacedDigit()
                            .foregroundStyle(.ink)
                            .contentTransition(reduce ? .opacity : .numericText(countsDown: true))
                            .dynamicTypeSize(...DynamicTypeSize.xxLarge)
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 14)
                    .frame(minHeight: 54)
                    .background(Color.surface, in: .rect(cornerRadius: 22))
                    .contentShape(.rect(cornerRadius: 22))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Repos, \(RestCard.clock(left))", tableName: "SessionEnd"))
                .accessibilityHint(Text("Afficher le repos", tableName: "SessionEnd"))
                .accessibilityIdentifier("announce-clock")
            }
            SessionCard {
                Text("Ensuite", tableName: "SessionEnd").font(.headline).foregroundStyle(.muted)
                Text(verbatim: training.exerciseName(next.exerciseId))
                    .font(.custom(Font.archivoName, size: 30, relativeTo: .title))
                    .foregroundStyle(.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 6)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("announce-name")
                Text(verbatim: SetText.load(next.weightKg, String(next.count), timed: next.timed))
                    .font(.custom(Font.archivoName, size: 56, relativeTo: .largeTitle))
                    .monospacedDigit()
                    .foregroundStyle(.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .dynamicTypeSize(...DynamicTypeSize.xxLarge)
                    .padding(.top, 18)
                    .accessibilityIdentifier("announce-load")
                Group {
                    if next.warmup {
                        Text("Montée", tableName: "SessionEnd")
                    } else {
                        Text("Série \(next.number)", tableName: "SessionEnd")
                    }
                }
                .font(.title3)
                .foregroundStyle(.muted)
                .accessibilityIdentifier("set-kind")
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("exercise-announce")
        }
    }
}

/// Everything planned is noted: the finish flag at the foot ends the session without a question.
private struct AllDoneCard: View {
    let sets: Int
    let session: String

    var body: some View {
        SessionCard {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 52))
                .foregroundStyle(.ink)
                .accessibilityHidden(true)
            Text("Tout est noté", tableName: "SessionEnd")
                .font(.custom(Font.archivoName, size: 34, relativeTo: .largeTitle))
                .foregroundStyle(.ink)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 10)
                .accessibilityAddTraits(.isHeader)
            Text("\(sets) séries · \(session)", tableName: "SessionEnd")
                .font(.headline)
                .foregroundStyle(.muted)
        }
    }
}
