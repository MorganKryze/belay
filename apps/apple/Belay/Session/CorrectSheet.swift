import BelayCore
import SwiftUI
import os

/// What the correction sheet writes through: the open session's model on the cover, a past
/// session's in the history. Each call is one change, queued for the next sync.
protocol SetCorrecting {
    func correct(setId: String, weightKg: Double, count: Int, rir: Int?) throws
    func remove(setId: String) throws
}

/// A done set, to correct or remove: the load, the count and the reserve, as Health enters a
/// number. ✓ turns blue once a value changes and writes one change.
struct CorrectSheet: View {
    let set: DoneSet
    /// The exercise's name, under the set's.
    let exercise: String
    let correcting: any SetCorrecting
    /// Under the removal's question: what becomes of the set once removed.
    let removal: Text
    /// Told when a write fails, so the screen under the sheet can say it.
    let failed: () -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var type
    @Environment(\.accessibilityReduceMotion) private var systemReduce
    @State private var kg = ""
    @State private var count = ""
    @State private var rir: Int?
    @State private var asking = false
    @FocusState private var focus: String?

    /// The values typed, when they are within the contract's bounds.
    private var typed: (kg: Double, count: Int)? {
        guard let kg = SetText.parseKg(kg), (Bounds.setKgMin...Bounds.setKgMax).contains(kg),
              let count = Int(count.trimmingCharacters(in: .whitespaces)),
              (0...(set.timed ? Bounds.secondsMax : Bounds.repsMax)).contains(count)
        else { return nil }
        return (kg, count)
    }

    private var changed: Bool {
        guard let typed else { return false }
        return typed.kg != set.weightKg || typed.count != set.count || rir != set.rir
    }

    var body: some View {
        NavigationStack {
            List {
                SheetTitle(
                    title: Text(verbatim: SetName.of(set)),
                    subtitle: Text(verbatim: exercise))
                Section {
                    field(Text("kg", tableName: "Session"), $kg, keyboard: .decimalPad, id: "correct-kg")
                    field(
                        set.timed ? Text("secondes", tableName: "SessionTools") : Text("reps", tableName: "SessionTools"),
                        $count, keyboard: .numberPad, id: "correct-count")
                }
                if !set.warmup && !set.timed {
                    Section {
                        reserve
                    } header: {
                        Text("Réserve", tableName: "SessionTools").textCase(nil).foregroundStyle(.muted)
                    }
                }
                Section {
                    Button(role: .destructive) { asking = true } label: {
                        Label { Text("Supprimer la série", tableName: "SessionTools") } icon: { Image(systemName: "trash") }
                            .frame(minHeight: 44)
                    }
                    .accessibilityIdentifier("correct-remove")
                    .removalQuestion(set, isPresented: $asking, message: removal) {
                        dismiss()
                        run { try correcting.remove(setId: set.id) }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .sheetWithoutBar()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close) { dismiss() }.accessibilityIdentifier("correct-close")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(role: .confirm) { save() }
                        .disabled(!changed)
                        .tint(.mark)
                        .accessibilityIdentifier("correct-save")
                }
            }
        }
        .presentationDetents([.large])
        .onAppear {
            kg = SetText.kg(set.weightKg)
            count = String(set.count)
            rir = set.rir
        }
    }

    /// The unit on the left, the value on the right; at the largest sizes, on two lines.
    private func field(_ unit: Text, _ text: Binding<String>, keyboard: UIKeyboardType, id: String) -> some View {
        let layout = type.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
            : AnyLayout(HStackLayout(spacing: 12))
        return layout {
            unit.foregroundStyle(.muted).accessibilityHidden(true)
            // The whole band focuses the field, not only the line of text it draws.
            TextField(text: text) { unit }
                .keyboardType(keyboard)
                .multilineTextAlignment(type.isAccessibilitySize ? .leading : .trailing)
                .font(.title3.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(.ink)
                .focused($focus, equals: id)
                .frame(maxWidth: .infinity, minHeight: Self.fieldHeight)
                .contentShape(.rect)
                .onTapGesture { focus = id }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier(id)
        }
    }

    /// Apple's smallest target, so a field is easy to hit with a chalked finger.
    static let fieldHeight: CGFloat = 44

    private var reserve: some View {
        HStack(spacing: 0) {
            ForEach(0...Bounds.rirMax, id: \.self) { value in
                if value > 0 { Spacer(minLength: 4) }
                Button {
                    withAnimation(Motion.change(reduce: Motion.reduced(systemReduce))) { rir = value }
                } label: {
                    Text(verbatim: value == Bounds.rirMax ? "\(value)+" : String(value))
                        .font(.custom(Font.archivoName, size: 20, relativeTo: .title3))
                        .foregroundStyle(rir == value ? Color.surface : Color.ink)
                        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
                        .frame(width: 52, height: 52)
                        .background(rir == value ? Color.ink : Color.track, in: .circle)
                        .contentShape(.circle)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    value == Bounds.rirMax
                        ? Text("\(value) ou plus en réserve", tableName: "SessionTools")
                        : Text("\(value) en réserve", tableName: "SessionTools"))
                .accessibilityAddTraits(rir == value ? .isSelected : [])
                .accessibilityIdentifier("correct-rir-\(value)")
            }
        }
        .padding(.vertical, 4)
    }

    private func save() {
        guard let typed else { return }
        guard run({ try correcting.correct(setId: set.id, weightKg: typed.kg, count: typed.count, rir: rir) })
        else { return }
        dismiss()
    }

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "session")

    @discardableResult
    private func run(_ write: () throws -> Void) -> Bool {
        do {
            try write()
            return true
        } catch {
            Self.log.error("set not corrected: \(AccountStore.logLabel(error), privacy: .public)")
            failed()
            return false
        }
    }
}

/// « Série 2 » or « Montée 1 », from the set's place.
enum SetName {
    static func of(_ set: DoneSet) -> String {
        set.warmup
            ? String(localized: "Montée \(set.place.position + 1)", table: "SessionTools")
            : String(localized: "Série \(set.place.position - Bounds.maxWarmups + 1)", table: "SessionTools")
    }
}

extension View {
    /// A done row that a swipe removes, where the system offers it.
    @ViewBuilder func removableSet(_ set: DoneSet, actions: CoverActions) -> some View {
        if #available(iOS 27, *) {
            modifier(SwipeToRemove(set: set, actions: actions))
        } else {
            self
        }
    }

    /// The question before a set goes, in a bubble anchored to the control that asked it.
    func removalQuestion(
        _ set: DoneSet, isPresented: Binding<Bool>,
        message: Text = Text("Elle redevient la prochaine à noter.", tableName: "SessionTools"),
        remove: @escaping () -> Void
    ) -> some View {
        confirmationDialog(
            set.warmup
                ? Text("Supprimer la montée \(set.place.position + 1)\u{202F}?", tableName: "SessionTools")
                : Text("Supprimer la série \(set.place.position - Bounds.maxWarmups + 1)\u{202F}?", tableName: "SessionTools"),
            isPresented: isPresented, titleVisibility: .visible
        ) {
            Button(role: .destructive, action: remove) { Text("Supprimer", tableName: "SessionTools") }
        } message: {
            message
        }
    }
}

/// The swipe of iOS 27 outside a list: one red action that asks first.
@available(iOS 27, *)
private struct SwipeToRemove: ViewModifier {
    let set: DoneSet
    let actions: CoverActions
    @State private var asking = false

    func body(content: Content) -> some View {
        content
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                Button(role: .destructive) { asking = true } label: {
                    Label { Text("Supprimer", tableName: "SessionTools") } icon: { Image(systemName: "trash") }
                }
            }
            .swipeActionsContainer()
            .removalQuestion(set, isPresented: $asking) { actions.run { try $0.remove(setId: set.id) } }
    }
}
