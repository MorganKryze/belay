import BelayCore
import SwiftUI

/// A tool as a pushed page. The header sits in the page: the domain disc, the name on up to two
/// lines, the web's lead; « Dépense énergétique » does not hold on one large-title line in the
/// wide face. The bar keeps only the back button. Then the result first, the fields under the
/// thumb, and « Comment c’est calculé » last, with the tool's note under it.
struct ToolPage<Result: View, Fields: View>: View {
    let tool: ToolId
    var note: Text? = nil
    @ViewBuilder let result: Result
    /// The fields' sections, and any row the tool adds after them.
    @ViewBuilder let fields: Fields
    /// The field the keypad types into, one for the whole page. Its links clear it before they
    /// push: a field still focused under a pushed page brings the keypad back on return.
    @FocusState private var focus: String?

    var body: some View {
        List {
            Section {
                ToolHeader(tool: tool)
            }
            Section {
                result
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("tool-result")
            }
            .listRowBackground(Color.surface)
            fields
            Section {
                ToolLink(route: .science(id: tool.rawValue)) {
                    Label {
                        Text("Comment c’est calculé", tableName: "Trend").foregroundStyle(.ink)
                    } icon: {
                        Image(systemName: "function").foregroundStyle(.muted)
                    }
                    .frame(minHeight: 44)
                }
                .accessibilityIdentifier("tool-method")
            } footer: {
                if let note { note.foregroundStyle(.muted) }
            }
            .listRowBackground(Color.surface)
        }
        .belayList()
        .environment(\.toolFocus, $focus)
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle(Text(tool.name, tableName: "Outils"))
        .navigationBarTitleDisplayMode(.inline)
        .largeTitleOnly()
    }
}

/// A tool page's row that opens another page, with the list's chevron. It puts the keypad away,
/// then pushes on the next turn of the run loop, so no field is focused when the page goes under.
struct ToolLink<Content: View>: View {
    let route: Route
    @ViewBuilder let content: Content
    @Environment(\.toolFocus) private var focus
    @Environment(\.push) private var push

    var body: some View {
        Button {
            focus?.wrappedValue = nil
            DispatchQueue.main.async { push(route) }
        } label: {
            HStack(spacing: 8) {
                content.frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.forward")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .contentShape(.rect)
        }
    }
}

extension EnvironmentValues {
    /// The tool page's focus, which its keypad fields share.
    @Entry var toolFocus: FocusState<String?>.Binding? = nil
    /// Pushes a page on the tab in front.
    @Entry var push = PushAction { _ in }
}

/// Pushes a route, as `dismiss` pops: called as a function.
struct PushAction {
    let run: (Route) -> Void

    func callAsFunction(_ route: Route) { run(route) }
}

/// The tool's disc, its name and the web's lead, on the wall above the cards.
struct ToolHeader: View {
    let tool: ToolId
    @ScaledMetric(relativeTo: .title) private var side: CGFloat = 44

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: tool.symbol)
                .font(.system(size: side * 0.45, weight: .semibold))
                .foregroundStyle(tool.domain.shade)
                .frame(width: side, height: side)
                .background(tool.domain.tint, in: .circle)
                .accessibilityHidden(true)
            Text(tool.name, tableName: "Outils")
                .font(.custom(Font.archivoName, size: 30, relativeTo: .largeTitle))
                .foregroundStyle(.ink)
                .lineLimit(2)
                .minimumScaleFactor(0.7)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("tool-header")
            if let lead = tool.lead {
                Text(lead, tableName: "Outils")
                    .font(.subheadline)
                    .foregroundStyle(.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 0, leading: 10, bottom: 0, trailing: 4))
    }
}

/// The name over a tool's result.
struct ResultLabel: View {
    let text: LocalizedStringKey

    var body: some View {
        Text(text, tableName: "Outils").font(.subheadline.weight(.semibold)).foregroundStyle(.muted)
    }
}

/// The result while a field is missing or out of range: a dash where the figure goes, and in
/// words what to enter.
struct ResultWaiting: View {
    let label: LocalizedStringKey
    let line: Text

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ResultLabel(text: label)
            Text(verbatim: "—").font(.displayFigure).foregroundStyle(.muted).accessibilityHidden(true)
            line.font(.subheadline).foregroundStyle(.ink).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 6)
    }
}

/// What a tool says under a load it cannot take, or none typed: the bounds in the unit shown, as
/// `TypedLoad.bounds` gives them for the field's step.
enum LoadLine {
    static func missing(_ typed: TypedLoad, _ empty: LocalizedStringKey, step: Double, cap: Double = .infinity) -> Text {
        guard typed != .empty else { return Text(empty, tableName: "Outils") }
        let bounds = TypedLoad.bounds(step: step, cap: cap)
        let low = bounds.lowerBound.upToHundredths
        let high = bounds.upperBound.upToHundredths
        return Text("Une charge va de \(low) à \(high)\u{202F}\(SetText.symbol).", tableName: "Outils")
    }
}
