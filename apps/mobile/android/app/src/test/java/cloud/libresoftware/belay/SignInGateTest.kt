package cloud.libresoftware.belay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SignInGateTest {
    private val gate = SignInGate()

    @Test
    fun `begin refuses a second sign-in`() {
        assertTrue(gate.begin())
        assertFalse(gate.begin())
    }

    @Test
    fun `ignored when idle`() {
        assertNull(gate.callback("belay://auth?code=x"))
    }

    @Test
    fun `takes belay auth only`() {
        gate.begin()
        assertNull(gate.callback("belay://other"))
        assertNull(gate.callback("https://auth"))
        assertNull(gate.callback("belay://auth.example?code=x"))
        assertNull(gate.callback("belay://evil@auth?code=x"))
        assertNull(gate.callback("not a uri"))
        assertEquals("belay://auth?code=x", gate.callback("belay://auth?code=x"))
        assertNull(gate.callback("belay://auth?code=x"))
    }

    @Test
    fun `second callback ignored`() {
        gate.begin()
        gate.launched()
        assertEquals("belay://auth?code=x", gate.callback("belay://auth?code=x"))
        assertNull(gate.callback("belay://auth?code=y"))
        assertFalse(gate.resumed())
    }

    @Test
    fun `resume before the tab opened is not a cancel`() {
        gate.begin()
        assertFalse(gate.resumed())
        assertFalse(gate.begin())
    }

    @Test
    fun `resume after the tab opened is a cancel`() {
        gate.begin()
        gate.launched()
        assertTrue(gate.resumed())
        assertFalse(gate.resumed())
        assertNull(gate.callback("belay://auth?code=x"))
        assertTrue(gate.begin())
    }

    @Test
    fun `end frees the gate`() {
        gate.begin()
        gate.launched()
        gate.end()
        assertNull(gate.callback("belay://auth?code=x"))
        assertFalse(gate.resumed())
        assertTrue(gate.begin())
    }
}
