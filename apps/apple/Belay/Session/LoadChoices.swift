import BelayCore
import SwiftUI

/// The loads offered for the set: one step of the exercise below, the load, one and two above,
/// stepped in the unit shown, then « Autre charge… » for any other on a decimal keypad.
struct LoadChoices: View {
    let weightKg: Double
    /// The exercise's step in the unit shown: its increment in kg, a pound gym's step in lb.
    let step: Double
    /// A heading over the loads, when they are not the set in hand's.
    var title: Text? = nil
    let choose: (Double) -> Void
    let other: () -> Void

    private var loads: [Double] { loadChoices(weightKg: weightKg, stepInUnit: step, SetText.unit) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let title {
                title.font(.footnote.weight(.semibold)).foregroundStyle(.muted)
                    .frame(minHeight: 32, alignment: .leading)
                    .accessibilityAddTraits(.isHeader)
            }
            ForEach(loads, id: \.self) { kg in
                Button { choose(kg) } label: {
                    HStack {
                        Image(systemName: "checkmark").opacity(kg == weightKg ? 1 : 0).accessibilityHidden(true)
                        Text("\(SetText.weight(kg))\u{202F}\(SetText.symbol)", tableName: "Session").monospacedDigit()
                        Spacer()
                    }
                    .font(.body)
                    .foregroundStyle(.ink)
                    .frame(minHeight: 44)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(kg == weightKg ? .isSelected : [])
                Rectangle().fill(Color.line).frame(height: 0.5)
            }
            Button(action: other) {
                HStack {
                    Image(systemName: "keyboard").accessibilityHidden(true)
                    Text("Autre charge…", tableName: "Session")
                    Spacer()
                }
                .font(.body)
                .foregroundStyle(.ink)
                .frame(minHeight: 44)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .frame(width: 230)
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
    }
}
