package cloud.libresoftware.belay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private const val NOW = 1_761_674_400_000L
private const val HOUR = 3_600_000L
private const val STARTED = NOW - 600_000
private const val LAST_SET = NOW - 30_000

// The page's forgotten-session mark: six hours after the last set.
private const val FORGOTTEN = LAST_SET + 6 * HOUR

// A set due, as the page describes it; each test changes what its state needs.
private val due =
    ActivityPayload(
        workoutId = "0192c3a0-0000-7000-8000-000000000001",
        staleAt = FORGOTTEN,
        status = "due",
        title = "Squat",
        detail = "Série 2 sur 4 · Séance A",
        statusLabel = "En cours",
        restOverTitle = "Repos terminé",
        restOverDetail = "C’est reparti",
        staleLine = "Ouvre Belay pour continuer",
        startedAt = STARTED,
        pausedAt = null,
        restStart = null,
        restEnd = null,
        restFrozen = false,
    )

private const val REST_END = NOW + 120_000
private val rest = due.copy(status = "rest", statusLabel = "Repos", staleAt = REST_END, restStart = LAST_SET, restEnd = REST_END)

private val pausedFrozen =
    due.copy(status = "paused", statusLabel = "En pause", pausedAt = NOW - 60_000, restStart = LAST_SET, restEnd = REST_END, restFrozen = true)

private val pausedRestRuns = pausedFrozen.copy(staleAt = REST_END, restFrozen = false)

private val done = due.copy(status = "done", title = "Toutes les séries faites", detail = "Séance A")

class SessionContentTest {
    @Test
    fun `a set due shows the exercise, its set and the session time counting up`() {
        val content = contentOf(due, NOW)
        assertEquals("Squat", content.title)
        assertEquals("Série 2 sur 4 · Séance A", content.text)
        assertEquals("En cours", content.subText)
        assertEquals(Chrono(STARTED, countDown = false), content.chrono)
        assertNull(content.chip)
    }

    @Test
    fun `a running rest counts its time left down to its end`() {
        val content = contentOf(rest, NOW)
        assertEquals("Squat", content.title)
        assertEquals("Série 2 sur 4 · Séance A", content.text)
        assertEquals("Repos", content.subText)
        assertEquals(Chrono(REST_END, countDown = true), content.chrono)
        assertNull(content.chip)
    }

    @Test
    fun `rest over after the end with no page`() {
        val content = contentOf(rest, REST_END)
        assertEquals("Repos terminé", content.title)
        assertEquals("C’est reparti", content.text)
        assertNull(content.subText)
        assertEquals(Chrono(STARTED, countDown = false), content.chrono)
        assertNull(content.chip)
        assertEquals(content, contentOf(rest, REST_END + HOUR))
    }

    @Test
    fun `a pause that stops everything shows no clock and says it in the chip`() {
        val content = contentOf(pausedFrozen, NOW)
        assertEquals("Squat", content.title)
        assertEquals("Série 2 sur 4 · Séance A", content.text)
        assertEquals("En pause", content.subText)
        assertNull(content.chrono)
        assertEquals("En pause", content.chip)
    }

    @Test
    fun `a pause that lets the rest go on counts the rest down`() {
        val content = contentOf(pausedRestRuns, NOW)
        assertEquals("Squat", content.title)
        assertEquals("Série 2 sur 4 · Séance A", content.text)
        assertEquals("En pause", content.subText)
        assertEquals(Chrono(REST_END, countDown = true), content.chrono)
        assertNull(content.chip)
    }

    @Test
    fun `a pause with no rest running shows no clock, the session's time standing still`() {
        val content = contentOf(pausedRestRuns.copy(staleAt = FORGOTTEN, restStart = null, restEnd = null), NOW)
        assertEquals("En pause", content.subText)
        assertNull(content.chrono)
        assertEquals("En pause", content.chip)
    }

    @Test
    fun `a rest over during a pause shows no clock either`() {
        val content = contentOf(pausedRestRuns, REST_END)
        assertEquals("Repos terminé", content.title)
        assertNull(content.chrono)
        assertEquals("En pause", content.chip)
    }

    @Test
    fun `every set done shows its line and the session time counting up`() {
        val content = contentOf(done, NOW)
        assertEquals("Toutes les séries faites", content.title)
        assertEquals("Séance A", content.text)
        assertEquals("En cours", content.subText)
        assertEquals(Chrono(STARTED, countDown = false), content.chrono)
        assertNull(content.chip)
    }

    @Test
    fun `past the forgotten mark the last title asks to open the app, with no clock`() {
        for (payload in listOf(due, done, pausedFrozen)) {
            val content = contentOf(payload, FORGOTTEN)
            assertEquals(payload.title, content.title)
            assertEquals("Ouvre Belay pour continuer", content.text)
            assertNull(content.subText)
            assertNull(content.chrono)
            assertNull(content.chip)
        }
    }

    @Test
    fun `the notification times out six hours past the forgotten mark when no rest runs`() {
        assertEquals(FORGOTTEN + 6 * HOUR, contentOf(due, NOW).timeoutAt)
        assertEquals(FORGOTTEN + 6 * HOUR, contentOf(pausedFrozen, NOW).timeoutAt)
        assertEquals(FORGOTTEN + 6 * HOUR, contentOf(due, FORGOTTEN).timeoutAt)
    }

    @Test
    fun `the notification times out twelve hours past a running rest's end`() {
        assertEquals(REST_END + 12 * HOUR, contentOf(rest, NOW).timeoutAt)
        assertEquals(REST_END + 12 * HOUR, contentOf(rest, REST_END).timeoutAt)
        assertEquals(REST_END + 12 * HOUR, contentOf(pausedRestRuns, NOW).timeoutAt)
    }

    @Test
    fun `it is redrawn at the stale date while that date is ahead, and not after`() {
        assertEquals(REST_END, contentOf(rest, NOW).redrawAt)
        assertEquals(FORGOTTEN, contentOf(due, NOW).redrawAt)
        assertNull(contentOf(rest, REST_END).redrawAt)
        assertNull(contentOf(due, FORGOTTEN + 1).redrawAt)
    }

    @Test
    fun shouldPost() {
        val id = due.workoutId
        assertFalse(shouldPost(enabled = false, dismissed = emptySet(), workoutId = id))
        assertFalse(shouldPost(enabled = false, dismissed = setOf(id), workoutId = id))
        assertFalse(shouldPost(enabled = true, dismissed = setOf("other", id), workoutId = id))
        assertTrue(shouldPost(enabled = true, dismissed = emptySet(), workoutId = id))
        assertTrue(shouldPost(enabled = true, dismissed = setOf("other"), workoutId = id))
    }
}
