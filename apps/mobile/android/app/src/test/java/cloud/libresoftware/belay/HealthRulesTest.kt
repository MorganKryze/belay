package cloud.libresoftware.belay

import android.os.RemoteException
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthRulesTest {
    @Test fun `access reads allowed when granted, denied once asked, undetermined before`() {
        assertEquals("allowed", HealthRules.access(granted = true, asked = true))
        assertEquals("allowed", HealthRules.access(granted = true, asked = false))
        assertEquals("denied", HealthRules.access(granted = false, asked = true))
        assertEquals("undetermined", HealthRules.access(granted = false, asked = false))
    }

    private class MapStore : PrefsStore {
        val values = mutableMapOf<String, String>()

        override fun get(key: String): String? = values[key]

        override fun put(key: String, value: String?) {
            if (value == null) values.remove(key) else values[key] = value
        }
    }

    @Test fun `a scope counts as asked once its screen is launched`() {
        val asked = MapStore()
        HealthRules.launchAsking(asked, "import") {}
        assertEquals(mapOf("asked.import" to "1"), asked.values)
    }

    @Test fun `asking the history marks it asked after the launch`() {
        val asked = MapStore()
        HealthRules.launchAsking(asked, "history") { assertTrue(asked.values.isEmpty()) }
        assertEquals(mapOf("asked.history" to "1"), asked.values)
    }

    @Test fun `a screen that never launched leaves the scope unasked`() {
        val asked = MapStore()
        assertThrows(IllegalStateException::class.java) {
            HealthRules.launchAsking(asked, "write") { throw IllegalStateException("no activity") }
        }
        assertTrue(asked.values.isEmpty())
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

    // Health Connect returns the sessions starting inside the read range, so the range opens before
    // Belay's start: a watch started first still counts.
    @Test fun `another app's session starting before Belay's and covering it counts`() {
        val watch = (start - 3_600_000L) to (end + 600_000L)
        assertTrue(watch.first >= HealthRules.overlapReadFrom(start))
        assertTrue(HealthRules.covers(start, end, listOf(watch)))
    }

    @Test fun `the overlap read opens one day before the session`() =
        assertEquals(start - 86_400_000L, HealthRules.overlapReadFrom(start))

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

    @Test fun `a changes token that fails reads everything again, unless refused or cancelled`() {
        assertTrue(HealthRules.readsAgain(IllegalArgumentException("invalid token")))
        assertTrue(HealthRules.readsAgain(IllegalStateException("token unknown")))
        assertTrue(HealthRules.readsAgain(RemoteException()))
        assertFalse(HealthRules.readsAgain(SecurityException("no")))
        assertFalse(HealthRules.readsAgain(CancellationException("left")))
    }

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
        for (offered in listOf(true, false)) {
            assertEquals(write, HealthRules.requested("write", offered))
            assertEquals(write + "android.permission.health.READ_WEIGHT", HealthRules.requested("import", offered))
        }
    }

    @Test fun `history asks the import's permissions and the write set, plus history when offered`() =
        assertEquals(
            HealthRules.requested("import", true) + "android.permission.health.READ_HEALTH_DATA_HISTORY",
            HealthRules.requested("history", true),
        )

    @Test fun `history not offered asks no history permission`() =
        assertEquals(HealthRules.requested("import", false), HealthRules.requested("history", false))

    @Test fun `the history access reads unavailable, allowed, denied, undetermined`() {
        assertEquals("unavailable", HealthRules.historyAccess(offered = false, granted = true, asked = true))
        assertEquals("allowed", HealthRules.historyAccess(offered = true, granted = true, asked = false))
        assertEquals("denied", HealthRules.historyAccess(offered = true, granted = false, asked = true))
        assertEquals("undetermined", HealthRules.historyAccess(offered = true, granted = false, asked = false))
    }

    @Test fun `the history access values are the page's`() =
        assertEquals(setOf("allowed", "denied", "undetermined", "unavailable"), HealthRules.HISTORY_ACCESS)
}
