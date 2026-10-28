package cloud.libresoftware.belay

private const val HOUR = 3_600_000L

// The clock the notification runs by itself: counting down to `base`, or up from it.
data class Chrono(val base: Long, val countDown: Boolean)

// What the ongoing notification shows at a given moment. `chip` is the status bar's word when no
// clock runs; `redrawAt` is when it must be drawn again with no word from the page.
data class SessionContent(
    val title: String,
    val text: String,
    val subText: String?,
    val chrono: Chrono?,
    val chip: String?,
    val timeoutAt: Long,
    val redrawAt: Long?,
)

// The description as it reads at `now`. Past the stale date the page has said nothing more: a rest
// still running then has just ended, anything else has gone quiet past the forgotten mark.
fun contentOf(p: ActivityPayload, now: Long): SessionContent {
    val restEnd = p.restEnd
    val restRuns = restEnd != null && !p.restFrozen
    val stale = now >= p.staleAt
    // The session's time stands still during a pause; only a rest the pause lets go on keeps running.
    val sessionClock = if (p.pausedAt == null) Chrono(p.startedAt, countDown = false) else null
    // The page's stale date is the rest's end while one runs, else six hours after the last set. The
    // description carries no last-set time, so the twelve hours after it are counted from there.
    val timeoutAt = if (restRuns) restEnd!! + 12 * HOUR else p.staleAt + 6 * HOUR
    val redrawAt = p.staleAt.takeIf { it > now }

    if (stale && !restRuns) {
        return SessionContent(p.title, p.staleLine, null, null, null, timeoutAt, redrawAt)
    }
    val restOver = stale
    val chrono =
        when {
            restOver -> sessionClock
            restRuns -> Chrono(restEnd!!, countDown = true)
            else -> sessionClock
        }
    return SessionContent(
        title = if (restOver) p.restOverTitle else p.title,
        text = if (restOver) p.restOverDetail else p.detail,
        subText = if (restOver) null else p.statusLabel,
        chrono = chrono,
        chip = if (chrono == null) p.statusLabel else null,
        timeoutAt = timeoutAt,
        redrawAt = redrawAt,
    )
}

// Nothing is posted while notifications are off, nor again for a session swiped away.
fun shouldPost(enabled: Boolean, dismissed: Set<String>, workoutId: String): Boolean =
    enabled && workoutId !in dismissed
