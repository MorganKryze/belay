import BelayCore
import SwiftUI

/// An annotation, in the weigh-in sheet's pattern (R3): its start date, its kind, and a label of
/// 80 characters at most. Opened on an annotation, it edits or removes it.
struct AnnotationSheet: View {
    enum Target: Identifiable {
        case add
        case edit(AnnotationRow)

        var id: String {
            switch self {
            case .add: "add"
            case .edit(let row): row.id
            }
        }
    }

    let corps: CorpsModel
    let target: Target
    @State private var date: Date
    @State private var kind: AnnotationKind
    @State private var label: String

    init(corps: CorpsModel, target: Target) {
        self.corps = corps
        self.target = target
        let row: AnnotationRow? = if case .edit(let row) = target { row } else { nil }
        _date = State(initialValue: row.flatMap { BodyText.date($0.date) } ?? .now)
        _kind = State(initialValue: row?.type ?? .deload)
        _label = State(initialValue: row?.label ?? "")
    }

    /// The label as saved: nil when only spaces were typed.
    private var saved: String? {
        let words = label.trimmingCharacters(in: .whitespacesAndNewlines)
        return words.isEmpty ? nil : words
    }

    private var editing: AnnotationRow? {
        if case .edit(let row) = target { row } else { nil }
    }

    var body: some View {
        EntrySheet(
            title: Text("Annotation", tableName: "Trend"), symbol: kind.symbol, domain: .rest, date: $date,
            canSave: isAnnotationLabel(saved), id: "annotation",
            save: {
                corps.annotate(
                    AnnotationInput(
                        id: editing?.id ?? UUIDv7.make(at: .now), date: toISODate(date, timeZone: .current), type: kind,
                        label: saved))
            },
            deletion: editing.map { row in
                (Text("Supprimer l’annotation", tableName: "Trend"), { corps.removeAnnotation(id: row.id) })
            },
            footer: Text("Un libellé de 80 caractères au plus, si tu veux.", tableName: "Trend")
        ) {
            Picker(selection: $kind) {
                ForEach(AnnotationKind.chosen, id: \.self) { kind in
                    Text(kind.name).tag(kind)
                }
            } label: {
                Text("Type", tableName: "Trend")
            }
            .pickerStyle(.menu)
            .frame(minHeight: 44)
            .accessibilityIdentifier("annotation-kind")
            TextField(
                String(localized: "Libellé", table: "Trend"), text: $label,
                prompt: Text("Libellé (option)", tableName: "Trend"))
                .multilineTextAlignment(.trailing)
                .frame(minHeight: 44)
                .accessibilityIdentifier("annotation-label")
        }
    }
}
