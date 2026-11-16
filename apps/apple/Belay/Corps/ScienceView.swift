import BelayCore
import SwiftUI

/// « Comment c’est calculé »: an entry of the shared science catalogue, word for word as the web
/// shows it, in the app's language: in short, what to keep in mind, the formula, the sources and
/// their limits.
struct ScienceView: View {
    let id: String

    private var entry: ScienceEntry? {
        Science.entry(id, language: Bundle.main.preferredLocalizations.first ?? "fr")
    }

    var body: some View {
        List {
            if let entry {
                Section {
                    Self.label(entry.label)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.ink)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 32)
                        .background(Color.track, in: .capsule)
                        .accessibilityIdentifier("science-label")
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 0, leading: 10, bottom: 0, trailing: 4))
                }
                section(Text("En bref", tableName: "Trend")) {
                    Text(entry.brief).accessibilityIdentifier("science-brief")
                }
                section(Text("À retenir", tableName: "Trend")) {
                    ForEach(Array(entry.keep.enumerated()), id: \.offset) { _, line in Text(line) }
                    if let heuristic = entry.heuristic { Text(heuristic).foregroundStyle(.muted) }
                }
                section(Text("La formule", tableName: "Trend")) {
                    ForEach(Array(entry.formula.enumerated()), id: \.offset) { index, line in
                        Text(line).monospacedDigit().accessibilityIdentifier("science-formula-\(index)")
                    }
                }
                section(Text("Les sources", tableName: "Trend")) {
                    ForEach(Array(entry.sources.enumerated()), id: \.offset) { index, source in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(verbatim: "\(source.cite). \(source.title). \(source.venue)")
                                .accessibilityIdentifier("science-source-\(index)")
                            ForEach(source.links, id: \.label) { link in
                                if let address = link.url.flatMap(URL.init(string:)) {
                                    Link(link.label, destination: address)
                                        .font(.subheadline.weight(.medium))
                                        .frame(minHeight: 44, alignment: .leading)
                                } else {
                                    Text(link.label).font(.subheadline).foregroundStyle(.muted)
                                }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
                section(Text("Les limites", tableName: "Trend")) {
                    ForEach(Array(entry.limits.enumerated()), id: \.offset) { index, line in
                        Text(line).accessibilityIdentifier("science-limit-\(index)")
                    }
                }
            }
        }
        .font(.body)
        .foregroundStyle(.ink)
        .textSelection(.enabled)
        .belayList()
        .navigationTitle(Text("Comment c’est calculé", tableName: "Trend"))
        .largeTitleOnly()
    }

    /// The entry's chip, as the web names it: from a source, Belay's own, or both.
    private static func label(_ kind: String) -> Text {
        switch kind {
        case "heuristic": Text("Heuristique Belay", tableName: "Trend")
        case "mixed": Text("Source et heuristique Belay", tableName: "Trend")
        default: Text("Source scientifique", tableName: "Trend")
        }
    }

    private func section<Content: View>(_ title: Text, @ViewBuilder _ content: () -> Content)
        -> some View
    {
        Section {
            content()
        } header: {
            title.textCase(nil).foregroundStyle(.ink)
        }
        .headerProminence(.increased)
        .listRowBackground(Color.surface)
    }
}
