package cloud.libresoftware.belay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private class MapStore : PrefsStore {
    val values = mutableMapOf<String, String>()

    override fun get(key: String): String? = values[key]

    override fun put(key: String, value: String?) {
        if (value == null) values.remove(key) else values[key] = value
    }
}

private val payload =
    ActivityPayload(
        workoutId = "0192c3a0-0000-7000-8000-000000000001",
        staleAt = 1_761_674_520_000L,
        status = "paused",
        title = "Squat",
        detail = "Série 2 sur 4 · Séance A",
        statusLabel = "En pause",
        restOverTitle = "Repos terminé",
        restOverDetail = "C’est reparti",
        staleLine = "Ouvre Belay pour continuer",
        startedAt = 1_761_673_800_000L,
        pausedAt = 1_761_674_340_000L,
        restStart = 1_761_674_370_000L,
        restEnd = 1_761_674_520_000L,
        restFrozen = true,
    )

class SessionStoreTest {
    @Test
    fun `the last description comes back as it was saved`() {
        val session = SessionStore(MapStore())
        assertNull(session.last())
        session.save(payload)
        assertEquals(payload, session.last())
        val due = payload.copy(status = "due", pausedAt = null, restStart = null, restEnd = null, restFrozen = false)
        session.save(due)
        assertEquals(due, session.last())
        session.save(null)
        assertNull(session.last())
    }

    @Test
    fun `undecodable stored description reads as none`() {
        val store = MapStore()
        val session = SessionStore(store)
        session.save(payload)
        session.dismiss(payload.workoutId)
        store.values.replaceAll { _, _ -> "{\"state\":" }
        assertNull(session.last())
        assertEquals(emptySet<String>(), session.dismissed())

        // An older build's description, with a key this one no longer knows.
        session.save(payload)
        store.values.replaceAll { _, json -> json.replaceFirst("{", "{\"progress\":0.5,") }
        assertNull(session.last())
    }

    @Test
    fun `dismissed keeps the last 20 sessions`() {
        val session = SessionStore(MapStore())
        assertEquals(emptySet<String>(), session.dismissed())
        val ids = (0 until 25).map { "session-$it" }
        ids.forEach(session::dismiss)
        assertEquals(ids.takeLast(20).toSet(), session.dismissed())
    }

    @Test
    fun `a session dismissed again counts as the latest`() {
        val session = SessionStore(MapStore())
        session.dismiss("first")
        (1 until 20).forEach { session.dismiss("session-$it") }
        session.dismiss("first")
        session.dismiss("one more")
        val dismissed = session.dismissed()
        assertEquals(20, dismissed.size)
        assertTrue("first" in dismissed)
    }
}
