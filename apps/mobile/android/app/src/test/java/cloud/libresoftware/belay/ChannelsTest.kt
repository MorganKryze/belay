package cloud.libresoftware.belay

import androidx.core.app.NotificationManagerCompat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChannelsTest {
    private val specs = Channels.specs().associateBy { it.id }

    @Test
    fun `ids are rest, rest-quiet and session`() {
        assertEquals(listOf("rest", "rest-quiet", "session"), Channels.specs().map { it.id })
    }

    @Test
    fun `rest rings at high importance with the tone`() {
        val rest = specs.getValue(Channels.REST)
        assertEquals(NotificationManagerCompat.IMPORTANCE_HIGH, rest.importance)
        assertTrue(rest.sound)
        assertEquals(R.string.channel_rest, rest.name)
    }

    @Test
    fun `rest-quiet and session are low without sound`() {
        for (id in listOf(Channels.REST_QUIET, Channels.SESSION)) {
            val spec = specs.getValue(id)
            assertEquals(id, NotificationManagerCompat.IMPORTANCE_LOW, spec.importance)
            assertFalse(id, spec.sound)
        }
        assertEquals(R.string.channel_rest_quiet, specs.getValue(Channels.REST_QUIET).name)
        assertEquals(R.string.channel_session, specs.getValue(Channels.SESSION).name)
    }
}
