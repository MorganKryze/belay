import BelayCore
import SwiftUI

/// Mon matériel: Compétition, Salle or Sur mesure, then the bar and the plates as 44 pt chips
/// that wrap. The presets read only; « Modifier ce matériel » copies the chosen one into Sur
/// mesure, whose chips a tap adds or takes out. Disques and Montée en charge load with it. In
/// pounds it shows the pound gym those tools load instead, read only, and leaves the kilo set as
/// it was for the way back to kilos.
struct EquipmentView: View {
    @Bindable var outils: OutilsModel
    /// The preset the custom set was last copied from, said in the footer once.
    @State private var copiedFrom: EquipmentChoice.Preset?
    /// « Autre » tapped in Sur mesure: the bar's weight on − and +, as the web's.
    @State private var otherBar = false

    private var custom: Bool { outils.equipment.preset == .custom }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Mon matériel", tableName: "Outils")
                        .font(.custom(Font.archivoName, size: 30, relativeTo: .largeTitle))
                        .foregroundStyle(.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text("Enregistré sur cet appareil.", tableName: "Outils").font(.subheadline).foregroundStyle(.muted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: 10, bottom: 0, trailing: 4))
            }
            if SetText.unit == .lb { poundSet } else { kiloSet }
        }
        .belayList()
        .navigationTitle(Text("Mon matériel", tableName: "Outils"))
        .navigationBarTitleDisplayMode(.inline)
        .largeTitleOnly()
    }

    @ViewBuilder private var kiloSet: some View {
        let plates = outils.equipment.plates
        Section {
            VStack(alignment: .leading, spacing: 8) {
                Text("Point de départ", tableName: "Outils").foregroundStyle(.ink)
                Picker(selection: $outils.equipment.preset) {
                    ForEach(EquipmentChoice.Preset.allCases, id: \.self) { Text($0.name).tag($0) }
                } label: {
                    Text("Point de départ", tableName: "Outils")
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("equipment-preset")
                .sensoryFeedback(.selection, trigger: outils.equipment.preset)
            }
            .padding(.vertical, 6)
        }
        .listRowBackground(Color.surface)
        Section {
            let other = otherBar || !standardBarsKg.contains(plates.barKg)
            ChipFlow {
                ForEach(standardBarsKg, id: \.self) { kg in
                    chip(
                        Text(verbatim: Self.weight(kg, .kg)), spoken: Self.spoken(kg), selected: !other && plates.barKg == kg,
                        id: "bar-\(kg)"
                    ) {
                        otherBar = false
                        setBar(kg)
                    }
                }
                chip(Text("Autre", tableName: "Outils"), spoken: nil, selected: other, id: "bar-other") { otherBar = true }
            }
            .padding(.vertical, 6)
            if custom, other {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Poids de la barre", tableName: "Outils").foregroundStyle(.ink)
                        Text(verbatim: Self.weight(plates.barKg, .kg))
                            .font(.title3.weight(.semibold)).monospacedDigit().foregroundStyle(.ink)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("bar-weight")
                    Spacer(minLength: 8)
                    Nudge(
                        value: Binding(get: { plates.barKg }, set: setBar), range: 1...50, step: 0.5,
                        what: Self.weight(0.5, .kg), id: "bar-weight")
                }
                .frame(minHeight: 52)
            }
        } header: {
            Text("Barre", tableName: "Outils").textCase(nil).foregroundStyle(.ink)
        }
        .listRowBackground(Color.surface)
        Section {
            ChipFlow {
                ForEach(standardPlatesKg, id: \.self) { kg in
                    // Bare numbers, as the section is in kilos; VoiceOver still hears the unit.
                    chip(
                        Text(verbatim: kg.upToHundredths), spoken: Self.spoken(kg),
                        selected: plates.platesKg.contains(kg), id: "plate-\(kg)"
                    ) { toggle(kg) }
                }
            }
            .padding(.vertical, 6)
        } header: {
            Text("Disques", tableName: "Outils").textCase(nil).foregroundStyle(.ink)
        } footer: {
            footer.foregroundStyle(.muted)
        }
        .listRowBackground(Color.surface)
        if !custom {
            Section {
                Button {
                    copiedFrom = outils.equipment.preset
                    outils.equipment.custom = plates
                    outils.equipment.preset = .custom
                } label: {
                    Text("Modifier ce matériel", tableName: "Outils").foregroundStyle(.ink).frame(minHeight: 44)
                }
            }
            .listRowBackground(Color.surface)
        }
    }

    /// The 45 lb bar and the standard pound plates, as the web's: every chip in, none to tap.
    @ViewBuilder private var poundSet: some View {
        Section {
            ChipFlow {
                chip(
                    Text(verbatim: Self.weight(poundPlates.barLb, .lb)), spoken: Self.spoken(poundPlates.barLb),
                    selected: true, id: "bar-lb-\(poundPlates.barLb)", readOnly: true
                ) {}
            }
            .padding(.vertical, 6)
        } header: {
            Text("Barre", tableName: "Outils").textCase(nil).foregroundStyle(.ink)
        }
        .listRowBackground(Color.surface)
        Section {
            ChipFlow {
                ForEach(poundPlates.platesLb, id: \.self) { lb in
                    chip(
                        Text(verbatim: lb.upToHundredths), spoken: Self.spoken(lb), selected: true, id: "plate-lb-\(lb)",
                        readOnly: true
                    ) {}
                }
            }
            .padding(.vertical, 6)
        } header: {
            Text("Disques", tableName: "Outils").textCase(nil).foregroundStyle(.ink)
        } footer: {
            Text("En livres, Belay prend la barre de 45\u{202F}lb et les disques standard.", tableName: "Outils")
                .foregroundStyle(.muted)
        }
        .listRowBackground(Color.surface)
    }

    /// « 20 kg », « 45 lb »: the symbol after a narrow no-break space, never translated.
    private static func weight(_ value: Double, _ unit: WeightUnit) -> String {
        "\(value.upToHundredths)\u{202F}\(unit.rawValue)"
    }

    /// « 20 kilos », « 45 livres »: a chip as VoiceOver says it, the unit shown as a word.
    private static func spoken(_ value: Double) -> Text {
        Text(verbatim: "\(value.upToHundredths) \(SetText.unitWord)")
    }

    private var footer: Text {
        if let copiedFrom, custom {
            let preset = String(localized: copiedFrom.name)
            return Text(
                verbatim: String(
                    localized: "Copié depuis «\u{202F}\(preset)\u{202F}». Touche un disque pour l’ajouter ou le retirer.",
                    table: "Outils"))
        }
        return custom
            ? Text("Touche un disque pour l’ajouter ou le retirer.", tableName: "Outils")
            : Text(
                "«\u{202F}Modifier\u{202F}» copie ce préréglage dans «\u{202F}Sur mesure\u{202F}»\u{202F}: les préréglages ne changent jamais.",
                tableName: "Outils")
    }

    /// A chip for one weight, or « Autre »: filled while chosen. A preset's chips read only, at full
    /// contrast: `readOnly` ones only show what Belay loads, a plain element without a button trait,
    /// and a tap does nothing. `spoken` replaces the words for VoiceOver.
    @ViewBuilder private func chip(
        _ words: Text, spoken: Text?, selected: Bool, id: String, readOnly: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        if readOnly {
            chipFace(words, selected: selected)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(spoken ?? words)
                .accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityIdentifier(id)
        } else {
            Button {
                if custom { action() }
            } label: {
                chipFace(words, selected: selected)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(spoken ?? words)
            .accessibilityAddTraits(selected ? .isSelected : [])
            .accessibilityIdentifier(id)
        }
    }

    private func chipFace(_ words: Text, selected: Bool) -> some View {
        HStack(spacing: 4) {
            if selected {
                Image(systemName: "checkmark").font(.caption.weight(.bold)).accessibilityHidden(true)
            }
            words.monospacedDigit()
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(selected ? Color.surface : Color.ink)
        .padding(.horizontal, 14)
        .frame(minHeight: 44)
        .background(selected ? Color.ink : Color.track, in: .capsule)
    }

    private func setBar(_ kg: Double) {
        outils.equipment.custom = Plates(barKg: kg, platesKg: outils.equipment.custom.platesKg)
    }

    private func toggle(_ kg: Double) {
        var plates = outils.equipment.custom.platesKg
        if let index = plates.firstIndex(of: kg) { plates.remove(at: index) } else { plates.append(kg) }
        outils.equipment.custom = Plates(barKg: outils.equipment.custom.barKg, platesKg: plates.sorted(by: >))
    }
}

/// Chips side by side, wrapping onto a new line when the next one does not fit.
struct ChipFlow: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = rows(width: proposal.width ?? .infinity, subviews: subviews)
        let width = rows.map { $0.reduce(0) { $0 + $1.width } + spacing * CGFloat(max(0, $0.count - 1)) }.max() ?? 0
        let height = rows.map { $0.map(\.height).max() ?? 0 }.reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var index = 0
        var y = bounds.minY
        for row in rows(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for size in row {
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
                index += 1
            }
            y += (row.map(\.height).max() ?? 0) + spacing
        }
    }

    /// The subviews' sizes, line by line.
    private func rows(width: CGFloat, subviews: Subviews) -> [[CGSize]] {
        var rows: [[CGSize]] = [[]]
        var used: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(ProposedViewSize(width: width, height: nil))
            if !rows[rows.count - 1].isEmpty, used + spacing + size.width > width {
                rows.append([])
                used = 0
            }
            used += (rows[rows.count - 1].isEmpty ? 0 : spacing) + size.width
            rows[rows.count - 1].append(size)
        }
        return rows
    }
}
