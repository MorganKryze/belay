import BelayCore
import SwiftUI

/// Corps: the 7-day average first, its curve under it, then the day's entries in their domain
/// colours. The body's accent tints the band, the chip and the line, the same for a loss and a gain.
struct CorpsView: View {
    let corps: CorpsModel
    /// Pushes one of Corps's screens.
    let open: (Route) -> Void
    @State private var scrolled: CGFloat = 0
    @State private var weighing = false

    var body: some View {
        @Bindable var corps = corps
        List {
            if corps.offersImport {
                HealthCard(
                    refused: corps.importRefused, accept: { Task { await corps.importWeighIns() } },
                    decline: corps.answerImport)
            }
            Section {
                TrendCard(state: corps.state, series: corps.series, place: .corps, span: $corps.span) { weighing = true }
                if case .usual = corps.state {
                    Button { open(.trend) } label: {
                        HStack(spacing: 14) {
                            DomainTile(domain: .body, symbol: "calendar")
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Tes semaines", tableName: "Corps").font(.body.weight(.medium)).foregroundStyle(.ink)
                                Text("perte par semaine, annotations", tableName: "Corps")
                                    .font(.subheadline)
                                    .foregroundStyle(.muted)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(.muted)
                                .accessibilityHidden(true)
                        }
                        .frame(minHeight: 52)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("corps-weeks")
                }
            }
            .listRowBackground(Color.surface)
            TodayRowsView(rows: corps.rows, today: corps.today) { entry in
                switch entry {
                case .weighIn: weighing = true
                case .screen(let route): open(route)
                // Corps lists no « Activité » row: it is Accueil's.
                case .activity: break
                }
            }
        }
        .background(alignment: .top) { AccueilBand(domain: .body, scrolled: scrolled) }
        .belayList()
        .onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.y + $0.contentInsets.top } action: { _, y in
            scrolled = y
        }
        .navigationTitle(Text("Corps", tableName: "Corps"))
        .largeTitleOnly()
        .belaySubtitle(WeekdayText.day(corps.readAt).capitalizedFirst)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { weighing = true } label: {
                    Image(systemName: "plus").fontWeight(.semibold)
                }
                .accessibilityLabel(Text("Ajouter une pesée", tableName: "Corps"))
                .accessibilityIdentifier("corps-add")
            }
        }
        .sheet(isPresented: $weighing) { WeighInSheet(corps: corps) }
    }
}
