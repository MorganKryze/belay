import SwiftUI

/// The Outils tab: the eight tools in Force, Énergie and Corps, each a 56 pt row with its domain
/// tile, its name and its hint. The last footer speaks for every tool.
struct OutilsView: View {
    var body: some View {
        List {
            ForEach(ToolId.groups, id: \.tools) { group in
                Section {
                    ForEach(group.tools, id: \.self) { tool in
                        NavigationLink(value: Route.tool(tool)) { row(tool) }
                            .accessibilityIdentifier("tool-row-\(tool.rawValue)")
                    }
                } header: {
                    Text(group.title, tableName: "Outils").textCase(nil).foregroundStyle(.ink)
                } footer: {
                    if group.tools == ToolId.groups.last?.tools {
                        Text("Tout est calculé sur ton appareil. Rien n’est envoyé.", tableName: "Outils")
                            .foregroundStyle(.muted)
                    }
                }
                .headerProminence(.increased)
                .listRowBackground(Color.surface)
            }
        }
        .belayList()
        .navigationTitle(Text("Outils"))
        .largeTitleOnly()
    }

    private func row(_ tool: ToolId) -> some View {
        HStack(spacing: 14) {
            DomainTile(domain: tool.domain, symbol: tool.symbol)
            VStack(alignment: .leading, spacing: 2) {
                Text(tool.name, tableName: "Outils").font(.body.weight(.medium)).foregroundStyle(.ink)
                Text(tool.hint, tableName: "Outils").font(.subheadline).foregroundStyle(.muted)
            }
            Spacer(minLength: 0)
        }
        .frame(minHeight: 56)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }
}
