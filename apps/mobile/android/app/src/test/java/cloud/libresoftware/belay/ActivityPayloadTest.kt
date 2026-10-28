package cloud.libresoftware.belay

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

private const val NOW = 1_761_674_400_000L

// The description as the page's liveActivityOf writes it, during a rest.
private fun pageJson(): JSONObject =
    JSONObject(
        """
        {
          "workoutId": "0192c3a0-0000-7000-8000-000000000001",
          "staleAt": ${NOW + 120_000},
          "state": {
            "status": "rest",
            "title": "Squat",
            "detail": "Série 2 sur 4 · Séance A",
            "statusLabel": "Repos",
            "restOverTitle": "Repos terminé",
            "restOverDetail": "C’est reparti",
            "staleLine": "Ouvre Belay pour continuer",
            "startedAt": ${NOW - 600_000},
            "pausedAt": null,
            "restStart": ${NOW - 30_000},
            "restEnd": ${NOW + 120_000},
            "restFrozen": false
          }
        }
        """,
    )

private fun JSONObject.state(): JSONObject = getJSONObject("state")

class ActivityPayloadTest {
    @Test
    fun `a description as the page writes it decodes`() {
        assertEquals(
            ActivityPayload(
                workoutId = "0192c3a0-0000-7000-8000-000000000001",
                staleAt = NOW + 120_000,
                status = "rest",
                title = "Squat",
                detail = "Série 2 sur 4 · Séance A",
                statusLabel = "Repos",
                restOverTitle = "Repos terminé",
                restOverDetail = "C’est reparti",
                staleLine = "Ouvre Belay pour continuer",
                startedAt = NOW - 600_000,
                pausedAt = null,
                restStart = NOW - 30_000,
                restEnd = NOW + 120_000,
                restFrozen = false,
            ),
            ActivityPayload.from(pageJson()),
        )
    }

    @Test
    fun `a paused description with its rest held decodes its times`() {
        val json = pageJson()
        json.state().put("status", "paused").put("pausedAt", NOW - 60_000).put("restFrozen", true)
        val payload = ActivityPayload.from(json)!!
        assertEquals(NOW - 60_000, payload.pausedAt)
        assertEquals(true, payload.restFrozen)
    }

    @Test
    fun `no description reads as none`() {
        assertNull(ActivityPayload.from(null))
    }

    @Test
    fun `an unknown key is refused`() {
        assertRefused(pageJson().put("progress", 0.5))
        assertRefused(pageJson().also { it.state().put("load", "80 kg") })
    }

    @Test
    fun `a missing key is refused`() {
        assertRefused(pageJson().also { it.remove("staleAt") })
        assertRefused(pageJson().also { it.state().remove("restFrozen") })
        assertRefused(pageJson().also { it.state().remove("pausedAt") })
    }

    @Test
    fun `a text over 80 characters is refused`() {
        for (key in listOf("title", "detail", "statusLabel", "restOverTitle", "restOverDetail", "staleLine")) {
            assertRefused(pageJson().also { it.state().put(key, "x".repeat(81)) })
        }
        assertEquals("x".repeat(80), ActivityPayload.from(pageJson().also { it.state().put("title", "x".repeat(80)) })!!.title)
    }

    @Test
    fun `a status other than due, rest, paused or done is refused`() {
        assertRefused(pageJson().also { it.state().put("status", "running") })
        for (status in listOf("due", "rest", "paused", "done")) {
            assertEquals(status, ActivityPayload.from(pageJson().also { it.state().put("status", status) })!!.status)
        }
    }

    @Test
    fun `a value of the wrong kind is refused`() {
        assertRefused(pageJson().put("staleAt", "soon"))
        assertRefused(pageJson().put("staleAt", 1.5))
        assertRefused(pageJson().put("workoutId", 7))
        assertRefused(pageJson().put("state", "rest"))
        assertRefused(pageJson().also { it.state().put("restFrozen", "no") })
        assertRefused(pageJson().also { it.state().put("startedAt", JSONObject.NULL) })
    }

    private fun assertRefused(json: JSONObject) {
        assertThrows(IllegalArgumentException::class.java) { ActivityPayload.from(json) }
    }
}
