package cloud.libresoftware.belay

import android.os.RemoteException
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthRulesTest {
    @Test fun `access reads allowed when granted, denied once asked, undetermined before`() {
        assertEquals("allowed", HealthRules.access(granted = true, asked = true))
        assertEquals("allowed", HealthRules.access(granted = true, asked = false))
        assertEquals("denied", HealthRules.access(granted = false, asked = true))
        assertEquals("undetermined", HealthRules.access(granted = false, asked = false))
    }

    // A session from 0 to 100 seconds' worth of milliseconds.
    private val start = 0L
    private val end = 100_000L

    @Test fun `another session covering 49 percent of the span does not cover it`() =
        assertFalse(HealthRules.covers(start, end, listOf(51_000L to 200_000L)))

    @Test fun `another session covering half the span covers it`() =
        assertTrue(HealthRules.covers(start, end, listOf(50_000L to 200_000L)))

    @Test fun `two others are not summed, each alone must cover half`() =
        assertFalse(HealthRules.covers(start, end, listOf(0L to 30_000L, 70_000L to 100_000L)))

    @Test fun `one ending as the session starts does not cover it`() =
        assertFalse(HealthRules.covers(start, end, listOf(-600_000L to 0L)))

    @Test fun `no other session, no cover`() = assertFalse(HealthRules.covers(start, end, emptyList()))

    @Test fun `a refusal for a permission reads denied`() =
        assertEquals("denied", HealthRules.outcomeOf(SecurityException("no")))

    @Test fun `an unreachable, failing or busy Health Connect reads unavailable`() {
        assertEquals("unavailable", HealthRules.outcomeOf(RemoteException()))
        assertEquals("unavailable", HealthRules.outcomeOf(IOException("disk")))
        assertEquals("unavailable", HealthRules.outcomeOf(IllegalStateException("not bound")))
    }

    @Test fun `any other refusal reads failed`() =
        assertEquals("failed", HealthRules.outcomeOf(IllegalArgumentException("bad record")))

    @Test fun `the outcomes are the page's`() =
        assertEquals(setOf("written", "removed", "overlap", "denied", "unavailable", "failed"), HealthRules.OUTCOMES)

    @Test fun `a weigh-in is Belay's when it comes from this app or carries Belay's id`() {
        val ours = "cloud.libresoftware.belay"
        assertTrue(HealthRules.isOwn(ours, ours, null))
        assertTrue(HealthRules.isOwn("other.app", ours, "belay-weighing-0a1b2c3d-2026-10-26"))
        assertFalse(HealthRules.isOwn("other.app", ours, null))
        assertFalse(HealthRules.isOwn("other.app", ours, "scale-2026-10-26"))
    }

    @Test fun `client record ids carry Belay's prefix`() {
        val id = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d01"
        assertEquals("belay-session-$id", HealthRules.sessionId(id))
        assertEquals("belay-weighing-0a1b2c3d-2026-10-26", HealthRules.weighingId("0a1b2c3d", "2026-10-26"))
    }

    // A request that leaves out a type may take back its grant, so both scopes ask for the full
    // write set; reading weigh-ins waits for the import.
    @Test fun `both scopes ask to write sessions and weigh-ins and to read sessions`() {
        val write = setOf(
            "android.permission.health.WRITE_EXERCISE",
            "android.permission.health.WRITE_WEIGHT",
            "android.permission.health.READ_EXERCISE",
        )
        assertEquals(write, HealthRules.requested("write"))
        assertEquals(write + "android.permission.health.READ_WEIGHT", HealthRules.requested("import"))
    }
}
