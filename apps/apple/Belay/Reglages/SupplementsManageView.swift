import BelayCore
import SwiftUI

/// Mes compléments, from Réglages › Suivi and from Corps › Compléments: the list itself. A tap
/// renames a supplement, a swipe renames or removes it; a removed one keeps its ticked days.
/// « + » adds one in the entry sheets' way.
struct SupplementsManageView: View {
    let corps: CorpsModel
    @State private var adding = false
    @State private var renaming: SupplementRow?
    @State private var newName = ""

    var body: some View {
        List {
            if corps.supplementList.isEmpty {
                Section {
                    VStack(spacing: 14) {
                        Image(systemName: "pills.fill")
                            .font(.system(size: 34, weight: .semibold))
                            .foregroundStyle(Domain.intake.shade)
                            .frame(width: 72, height: 72)
                            .background(Domain.intake.tint, in: .circle)
                            .accessibilityHidden(true)
                        Text("Aucun complément dans ta liste pour l’instant.", tableName: "Reglages")
                            .font(.headline)
                            .foregroundStyle(.ink)
                            .multilineTextAlignment(.center)
                        PrimaryButton(title: "Ajouter un complément", tableName: "Reglages") { adding = true }
                            .accessibilityIdentifier("manage-add-first")
                    }
                    .padding(.vertical, 16)
                    .frame(maxWidth: .infinity)
                } footer: {
                    note
                }
                .listRowBackground(Color.surface)
            } else {
                Section {
                    ForEach(Array(corps.supplementList.enumerated()), id: \.element.id) { index, supplement in
                        row(supplement).accessibilityIdentifier("manage-\(index)")
                    }
                } header: {
                    Text("Ta liste", tableName: "Reglages").textCase(nil).foregroundStyle(.ink)
                } footer: {
                    note
                }
                .headerProminence(.increased)
                .listRowBackground(Color.surface)
            }
        }
        .belayList()
        .navigationTitle(Text("Mes compléments", tableName: "Reglages"))
        .largeTitleOnly()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { adding = true } label: {
                    Image(systemName: "plus").fontWeight(.semibold)
                }
                .accessibilityLabel(Text("Ajouter un complément", tableName: "Reglages"))
                .accessibilityIdentifier("manage-add")
            }
        }
        .sheet(isPresented: $adding) {
            AddSupplementSheet(names: corps.supplementList.map(\.name)) { corps.addSupplement(name: $0) }
        }
        .alert(
            Text("Renommer", tableName: "Reglages"),
            isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } }),
            presenting: renaming
        ) { supplement in
            TextField(text: $newName) { Text("Nom du complément", tableName: "Reglages") }
            Button(role: .cancel) {} label: { Text("Annuler", tableName: "Reglages") }
            Button {
                if canRename(supplement) { corps.renameSupplement(id: supplement.id, name: newName) }
            } label: {
                Text("Enregistrer", tableName: "Reglages")
            }
        } message: { supplement in
            Text("Nouveau nom pour \(supplement.name)", tableName: "Reglages")
        }
    }

    private var note: some View {
        Text(
            "Belay note ce que tu prends, sans conseil de dose. Les rappels quotidiens arriveront avec les notifications.",
            tableName: "Reglages"
        )
        .foregroundStyle(.muted)
    }

    /// A valid name that no other supplement on the list holds.
    private func canRename(_ supplement: SupplementRow) -> Bool {
        isSupplementName(newName)
            && !corps.supplementList.contains { $0.id != supplement.id && sameSupplementName($0.name, newName) }
    }

    private func rename(_ supplement: SupplementRow) {
        newName = supplement.name
        renaming = supplement
    }

    private func row(_ supplement: SupplementRow) -> some View {
        Button { rename(supplement) } label: {
            HStack(spacing: 14) {
                DomainTile(domain: .intake, symbol: "pills.fill")
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: supplement.name).font(.body.weight(.semibold)).foregroundStyle(.ink)
                    Text("\(corps.daysMarked(supplementId: supplement.id)) jours marqués", tableName: "Reglages")
                        .font(.subheadline)
                        .foregroundStyle(.muted)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint(Text("Renommer", tableName: "Reglages"))
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(role: .destructive) { corps.removeSupplement(id: supplement.id) } label: {
                Label { Text("Retirer", tableName: "Reglages") } icon: { Image(systemName: "trash") }
            }
            Button { rename(supplement) } label: {
                Label { Text("Renommer", tableName: "Reglages") } icon: { Image(systemName: "pencil") }
            }
        }
    }
}

/// Two names compared as the web compares them: case, accents and the spaces around aside, so
/// « oméga-3 » is « Oméga-3 ».
func sameSupplementName(_ a: String, _ b: String) -> Bool {
    let plain = { (name: String) in
        name.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
    return plain(a) == plain(b)
}

/// A supplement added the entry sheets' way: ✕ and ✓ in glass, the name, the web's suggestions as
/// chips. A name already on the list is refused in words; a suggestion leaves once on the list.
struct AddSupplementSheet: View {
    /// The names on the list now.
    let names: [String]
    let add: (String) -> Void
    @State private var name = ""
    @FocusState private var typing: Bool
    @Environment(\.dismiss) private var dismiss

    private var duplicate: Bool { names.contains { sameSupplementName($0, name) } }
    private var valid: Bool { isSupplementName(name) && !duplicate }

    var body: some View {
        NavigationStack {
            List {
                SheetHead(title: Text("Complément", tableName: "Reglages"), symbol: "pills.fill", domain: .intake)
                Section {
                    TextField(text: $name, prompt: Text("Créatine, magnésium…", tableName: "Reglages")) {
                        Text("Nom du complément", tableName: "Reglages")
                    }
                    .font(.title3.weight(.semibold))
                    .focused($typing)
                    .submitLabel(.done)
                    .frame(minHeight: 52)
                    .accessibilityLabel(Text("Nom du complément", tableName: "Reglages"))
                    .accessibilityIdentifier("supplement-name")
                } footer: {
                    if duplicate {
                        Text("Ce complément est déjà dans ta liste.", tableName: "Reglages").foregroundStyle(.ink)
                    } else if !name.isEmpty && !isSupplementName(name) {
                        Text("De 1 à 40 caractères, sur une ligne.", tableName: "Reglages").foregroundStyle(.ink)
                    }
                }
                .listRowBackground(Color.surface)
                if !suggestions.isEmpty {
                    Section {
                        ChipFlow {
                            ForEach(suggestions, id: \.key) { suggestion in
                                chip(suggestion.label, key: suggestion.key)
                            }
                        }
                        .padding(.vertical, 6)
                    } header: {
                        Text("Suggestions", tableName: "Reglages").textCase(nil).foregroundStyle(.ink)
                    }
                    .listRowBackground(Color.surface)
                }
            }
            .belayList()
            .sheetWithoutBar()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close) { dismiss() }.accessibilityIdentifier("supplement-close")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(role: .confirm) {
                        add(name)
                        dismiss()
                    }
                    .tint(.mark)
                    .disabled(!valid)
                    .accessibilityIdentifier("supplement-save")
                }
            }
        }
        .presentationDetents([.large])
        .tint(.ink)
    }

    /// The web's suggestions not yet on the list; creatine by its own rule, as the chart's band.
    private var suggestions: [(key: String, label: String)] {
        supplementSuggestions.compactMap { key in
            let label = Self.label(key)
            let held = names.contains { key == "creatine" ? isCreatineName($0) : sameSupplementName($0, label) }
            return held ? nil : (key, label)
        }
    }

    private func chip(_ label: String, key: String) -> some View {
        let chosen = name == label
        return Button { name = label } label: {
            Text(verbatim: label)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(chosen ? Color.surface : Color.ink)
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .background(chosen ? Color.ink : Color.track, in: .capsule)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(chosen ? .isSelected : [])
        .accessibilityIdentifier("suggestion-\(key)")
    }

    private static func label(_ key: String) -> String {
        switch key {
        case "creatine": String(localized: "Créatine", table: "Reglages")
        case "vitaminD": String(localized: "Vitamine D", table: "Reglages")
        case "omega3": String(localized: "Oméga-3", table: "Reglages")
        case "magnesium": String(localized: "Magnésium", table: "Reglages")
        case "iron": String(localized: "Fer", table: "Reglages")
        case "zinc": String(localized: "Zinc", table: "Reglages")
        case "caffeine": String(localized: "Caféine", table: "Reglages")
        case "melatonin": String(localized: "Mélatonine", table: "Reglages")
        default: key
        }
    }
}
