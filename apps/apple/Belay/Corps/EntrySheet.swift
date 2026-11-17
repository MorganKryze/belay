import SwiftUI

/// A body entry's sheet, Santé's way: ✕ and ✓ in glass, the domain's icon and the title in the
/// display face, « Date » as a pill, then the sheet's rows with their values on the right, typed on
/// the keypad. A day that holds the entry adds its deletion, asked first.
struct EntrySheet<Rows: View>: View {
    let title: Text
    let symbol: String
    var domain = Domain.body
    @Binding var date: Date
    /// Now by the model's clock: the latest day the picker offers.
    let latest: Date
    /// Whether ✓ writes: the rows hold a value within the bounds.
    let canSave: Bool
    /// The identifiers' stem, « weighin » for `weighin-save`.
    let id: String
    let save: () -> Void
    /// The deletion's words and its action, when the day holds the entry.
    var deletion: (label: Text, run: () -> Void)? = nil
    /// The line under the rows.
    var footer: Text? = nil
    @ViewBuilder let rows: Rows
    @Environment(\.dismiss) private var dismiss
    @State private var asking = false

    /// Never in the future, never before 1900.
    private var days: ClosedRange<Date> {
        let earliest = Calendar.current.date(from: DateComponents(year: 1900, month: 1, day: 1)) ?? .distantPast
        return earliest...latest
    }

    var body: some View {
        NavigationStack {
            List {
                SheetHead(title: title, symbol: symbol, domain: domain)
                Section {
                    DatePicker(selection: $date, in: days, displayedComponents: .date) {
                        Text("Date", tableName: "Corps")
                    }
                    .frame(minHeight: 44)
                    rows
                } footer: {
                    if let footer { footer.foregroundStyle(.muted) }
                }
                .listRowBackground(Color.surface)
                if let deletion {
                    Section {
                        Button(role: .destructive) { asking = true } label: {
                            deletion.label.frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .accessibilityIdentifier("\(id)-delete")
                        .confirmationDialog(deletion.label, isPresented: $asking, titleVisibility: .hidden) {
                            Button(role: .destructive) {
                                deletion.run()
                                dismiss()
                            } label: {
                                Text("Supprimer", tableName: "Corps")
                            }
                        }
                    }
                    .listRowBackground(Color.surface)
                }
            }
            .belayList()
            .sheetWithoutBar()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close) { dismiss() }.accessibilityIdentifier("\(id)-close")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(role: .confirm) {
                        save()
                        dismiss()
                    }
                    .tint(.mark)
                    .disabled(!canSave)
                    .accessibilityIdentifier("\(id)-save")
                }
            }
        }
        .presentationDetents([.large])
    }
}

/// A sheet's head: the domain's icon in a round tile, the title under it. At the largest sizes the
/// title alone heads the sheet, so the field stays above the keypad.
struct SheetHead: View {
    let title: Text
    let symbol: String
    let domain: Domain
    @ScaledMetric(relativeTo: .largeTitle) private var side: CGFloat = 64
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Section {
            VStack(spacing: 10) {
                if !typeSize.isAccessibilitySize {
                    Image(systemName: symbol)
                        .font(.system(size: side * 0.42, weight: .semibold))
                        .foregroundStyle(domain.shade)
                        .frame(width: side, height: side)
                        .background(domain.tint, in: .circle)
                        .accessibilityHidden(true)
                }
                title
                    .font(.custom(Font.archivoName, size: 34, relativeTo: .largeTitle))
                    .foregroundStyle(.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("sheet-title")
            }
            .frame(maxWidth: .infinity)
            .listRowBackground(Color.clear)
        }
    }
}
