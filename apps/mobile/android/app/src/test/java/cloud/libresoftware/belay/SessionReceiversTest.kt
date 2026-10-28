package cloud.libresoftware.belay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionReceiversTest {
    @Test
    fun `a failing redraw is reported, never thrown`() {
        val reported = mutableListOf<Exception>()
        inBackground({ reported += it }) { throw IllegalStateException("preferences last not written") }
        assertEquals("preferences last not written", reported.single().message)
    }

    @Test
    fun `a redraw that works reports nothing`() {
        val reported = mutableListOf<Exception>()
        var ran = false
        inBackground({ reported += it }) { ran = true }
        assertTrue(ran)
        assertTrue(reported.isEmpty())
    }
}
