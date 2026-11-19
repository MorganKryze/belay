// Calendar days as `YYYY-MM-DD`, the person's local date, as the body rules count them. The
// arithmetic runs on UTC midnights (see `Day`), so no daylight-saving change can shift a day.

/// `date` moved by `days` calendar days, back when negative.
public func addDays(_ date: String, _ days: Int) -> String { Day.add(date, days) }

/// The Monday of the ISO week that holds `date`; weeks run Monday to Sunday.
public func isoWeekStart(_ date: String) -> String { Day.weekOf(date).start }
