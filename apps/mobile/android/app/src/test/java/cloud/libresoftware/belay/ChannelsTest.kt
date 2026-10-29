package cloud.libresoftware.belay

import androidx.core.app.NotificationManagerCompat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChannelsTest {
    private val specs = Channels.specs().associateBy { it.id }

    @Test
    fun `ids are rest, rest-quiet and session-shown`() {
        assertEquals(listOf("rest", "rest-quiet", "session-shown"), Channels.specs().map { it.id })
    }

    @Test
    fun `rest rings at high importance with the tone`() {
        val rest = specs.getValue(Channels.REST)
        assertEquals(NotificationManagerCompat.IMPORTANCE_HIGH, rest.importance)
        assertTrue(rest.sound)
        assertEquals(R.string.channel_rest, rest.name)
    }

    @Test
    fun `rest-quiet is low without sound`() {
        val quiet = specs.getValue(Channels.REST_QUIET)
        assertEquals(NotificationManagerCompat.IMPORTANCE_LOW, quiet.importance)
        assertFalse(quiet.sound)
        assertFalse(quiet.lockScreen)
        assertEquals(R.string.channel_rest_quiet, quiet.name)
    }

    // Android 15 and later keep low-importance notifications off the lock screen unless the person
    // turns that on: the session sits one level up, still without sound or vibration.
    @Test
    fun `session shows on the lock screen at default importance, without sound`() {
        val session = specs.getValue(Channels.SESSION)
        assertEquals(NotificationManagerCompat.IMPORTANCE_DEFAULT, session.importance)
        assertFalse(session.sound)
        assertTrue(session.lockScreen)
        assertEquals(R.string.channel_session, session.name)
    }

    // An app cannot raise a channel's importance once made: the first session channel is removed
    // and never made again. The notifications plugin's own channel, which nothing posts to, goes
    // too.
    @Test
    fun `the first session channel and the plugin's default one are retired`() {
        assertEquals(listOf("session", "default"), Channels.RETIRED)
        for (spec in Channels.specs()) assertFalse(spec.id, spec.id in Channels.RETIRED)
    }
}
