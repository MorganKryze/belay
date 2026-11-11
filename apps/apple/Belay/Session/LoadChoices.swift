import BelayCore
import SwiftUI

/// The loads offered for the set: one increment of the exercise below, the load, one and two
/// above, then « Autre charge… » for any other on a decimal keypad.
struct LoadChoices: View {
    let weightKg: Double
    let incrementKg: Double
    let choose: (Double) -> Void
    let other: () -> Void

    private var loads: [Double] {
        [-1.0, 0, 1, 2].map { weightKg + $0 * incrementKg }.filter { (Bounds.setKgMin...Bounds.setKgMax).contains($0) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(loads, id: \.self) { kg in
                Button { choose(kg) } label: {
                    HStack {
                        Image(systemName: "checkmark").opacity(kg == weightKg ? 1 : 0).accessibilityHidden(true)
                        Text("\(SetText.kg(kg))\u{202F}kg", tableName: "Session").monospacedDigit()
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
