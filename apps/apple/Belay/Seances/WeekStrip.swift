import BelayCore
import SwiftUI

/// The program's week on fixed days, Monday first: a session day is its letter on the session
/// tint, a rest day the moon on the rest tint, today a ring. Shape and word say it, never the
/// colour alone, and VoiceOver reads each day whole.
struct WeekStrip: View {
    let week: [WeekDay]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(week) { day in
                VStack(spacing: 6) {
                    Text(Self.initial(day.weekday))
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(day.isToday ? .ink : .muted)
                    mark(day)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Self.label(day))
                .accessibilityIdentifier("week.\(day.weekday)")
            }
        }
        // Seven marks share the width: past the largest standard size they would no longer fit.
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }

    private func mark(_ day: WeekDay) -> some View {
        let domain: Domain = day.session == nil ? .rest : .session
        return ZStack {
            Circle().fill(domain.tint)
            if let session = day.session {
                Text(session.code)
                    .font(.custom(Font.archivoName, size: 15, relativeTo: .body))
                    .foregroundStyle(domain.shade)
            } else {
                Image(systemName: "moon.zzz.fill")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(domain.shade)
            }
        }
        .frame(width: 38, height: 38)
        .padding(3)
        .overlay {
            if day.isToday { Circle().stroke(Color.ink, lineWidth: 2) }
        }
    }

    /// The calendar's weekday index, Sunday 1, of a week day stored Monday 0.
    private static func calendarIndex(_ weekday: Int) -> Int { (weekday + 1) % 7 }

    /// « L », « M », « M »… in the person's language.
    private static func initial(_ weekday: Int) -> String {
        Calendar.current.veryShortStandaloneWeekdaySymbols[calendarIndex(weekday)]
    }

    /// « Lundi, séance C », « Mardi, repos », with « aujourd’hui » after today's name.
    private static func label(_ day: WeekDay) -> String {
        let symbol = Calendar.current.standaloneWeekdaySymbols[calendarIndex(day.weekday)]
        let name = symbol.prefix(1).localizedUppercase + symbol.dropFirst()
        let named = day.isToday ? String(localized: "\(name), aujourd’hui", table: "Seances") : name
        guard let session = day.session else { return String(localized: "\(named), repos", table: "Seances") }
        return String(localized: "\(named), séance \(session.code)", table: "Seances")
    }
}
