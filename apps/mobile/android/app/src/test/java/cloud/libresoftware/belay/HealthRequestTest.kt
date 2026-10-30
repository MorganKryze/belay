package cloud.libresoftware.belay

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

// The page's Health requests as the decoder takes or refuses them, case for case with the iPhone's.
class HealthRequestTest {
    private val now = 1_761_480_000_000L // 2025-10-26T12:00:00Z
    private val id = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d01"
    private val owner = "0a1b2c3d"
    private val hour = 3_600_000L
    private val floor = -2_209_075_200_000L // 1899-12-31T00:00:00Z, the page's Date.UTC(1899, 11, 31)

    private fun decodes(json: String): HealthRequest? =
        try {
            HealthRequest.from(JSONObject(json), now)
        } catch (e: IllegalArgumentException) {
            null
        }

    private fun refusal(json: String): String? =
        try {
            HealthRequest.from(JSONObject(json), now)
            null
        } catch (e: IllegalArgumentException) {
            e.message
        }

    private fun workout(extra: String = "", started: Long = 0, ended: Long = 3_600_000, version: Long = 5) =
        """{"kind":"workout","id":"$id","startedAt":$started,"endedAt":$ended,"version":$version$extra}"""

    private fun weighing(at: Long) =
        """{"kind":"weighing","owner":"$owner","date":"1900-01-01","kg":80,"at":$at,"version":1}"""

    private fun apply(vararg objects: String) = decodes("""{"op":"apply","objects":[${objects.joinToString(",")}]}""")

    private fun removal(owner: String, date: String) =
        """{"op":"apply","objects":[{"kind":"weighingRemoved","owner":"$owner","date":"$date"}]}"""

    private val aWeighing = """{"kind":"weighing","owner":"$owner","date":"2026-10-26","kg":80.4,"at":0,"version":1}"""

    @Test fun `status decodes`() = assertEquals(HealthRequest.Status, decodes("""{"op":"status"}"""))

    @Test fun `an unknown key is refused`() = assertNull(decodes("""{"op":"status","x":1}"""))

    @Test fun `an unknown operation is refused`() = assertNull(decodes("""{"op":"delete"}"""))

    @Test fun `authorize import decodes`() =
        assertEquals(HealthRequest.Authorize("import"), decodes("""{"op":"authorize","scope":"import"}"""))

    @Test fun `authorize history decodes`() =
        assertEquals(HealthRequest.Authorize("history"), decodes("""{"op":"authorize","scope":"history"}"""))

    @Test fun `an unknown scope is refused`() = assertNull(decodes("""{"op":"authorize","scope":"read"}"""))

    @Test fun `a workout decodes with its times in milliseconds`() =
        assertEquals(HealthRequest.Apply(listOf(HealthObject.Workout(id, 0, 3_600_000, 5))), apply(workout()))

    @Test fun `a workout ending at its start is refused`() = assertNull(apply(workout(ended = 0)))

    @Test fun `a workout with version 0 is refused`() = assertNull(apply(workout(version = 0)))

    @Test fun `a workout with a name is refused`() = assertNull(apply(workout(""","name":"A"""")))

    @Test fun `an id that is no session id is refused`() =
        assertNull(apply("""{"kind":"workoutRemoved","id":"../x"}"""))

    // A NUL as JSON escapes it.
    @Test fun `an id followed by a NUL and more text is refused`() =
        assertNull(apply("""{"kind":"workoutRemoved","id":"$id\u0000../x"}"""))

    @Test fun `an uppercase id is refused`() =
        assertNull(apply("""{"kind":"workoutRemoved","id":"${id.uppercase()}"}"""))

    @Test fun `a workout with an uppercase id is refused`() =
        assertNull(apply(workout().replace(id, id.uppercase())))

    @Test fun `a removal with a lowercase id decodes`() =
        assertEquals(
            HealthRequest.Apply(listOf(HealthObject.WorkoutRemoved(id))),
            apply("""{"kind":"workoutRemoved","id":"$id"}"""),
        )

    // The page dates weigh-ins and sessions from 1900-01-01; 08:00 that day east of UTC is still
    // 1899-12-31 in UTC.
    @Test fun `a weigh-in at 08 00 on 1900-01-01 in Tokyo decodes`() = assertNotNull(apply(weighing(floor + 23 * hour)))

    @Test fun `a weigh-in at 1899-12-31T00 00Z exactly decodes`() = assertNotNull(apply(weighing(floor)))

    @Test fun `a weigh-in before 1899-12-31 is refused`() = assertNull(apply(weighing(floor - 1)))

    @Test fun `a weigh-in two days ahead is refused`() = assertNull(apply(weighing(now + 48 * hour)))

    @Test fun `a weigh-in an hour ahead decodes`() = assertNotNull(apply(weighing(now + hour)))

    @Test fun `a weigh-in exactly a day ahead decodes, a millisecond more is refused`() {
        assertNotNull(apply(weighing(now + HealthRequest.DAY)))
        assertNull(apply(weighing(now + HealthRequest.DAY + 1)))
    }

    @Test fun `a workout starting before 1899-12-31 is refused`() =
        assertNull(apply(workout(started = floor - 1, ended = floor + hour)))

    @Test fun `a workout ending two days ahead is refused`() =
        assertNull(apply(workout(started = now, ended = now + 48 * hour)))

    @Test fun `a workout ending an hour ahead decodes`() =
        assertNotNull(apply(workout(started = now, ended = now + hour)))

    @Test fun `a workout of 24 hours decodes`() = assertNotNull(apply(workout(ended = 24 * hour)))

    @Test fun `a workout of more than 24 hours is refused`() = assertNull(apply(workout(ended = 24 * hour + 1)))

    @Test fun `readWeighings since before 1899-12-31 is refused`() =
        assertNull(decodes("""{"op":"readWeighings","anchor":null,"since":${floor - 1}}"""))

    @Test fun `readWeighings since at EARLIEST decodes`() =
        assertEquals(
            HealthRequest.ReadWeighings(null, HealthRequest.EARLIEST),
            decodes("""{"op":"readWeighings","anchor":null,"since":${HealthRequest.EARLIEST}}"""),
        )

    @Test fun `readWeighings since two days ahead is refused`() =
        assertNull(decodes("""{"op":"readWeighings","anchor":null,"since":${now + 48 * hour}}"""))

    @Test fun `100 objects decode`() = assertNotNull(apply(*Array(100) { workout() }))

    @Test fun `101 objects are refused`() = assertNull(apply(*Array(101) { workout() }))

    @Test fun `101 objects are counted before any is decoded`() {
        val broken = List(101) { "{}" }.joinToString(",")
        assertEquals("too many objects", refusal("""{"op":"apply","objects":[$broken]}"""))
    }

    private fun anchor(length: Int) = """{"op":"readWeighings","anchor":"${"A".repeat(length)}","since":0}"""

    @Test fun `an anchor of 4096 characters decodes`() = assertNotNull(decodes(anchor(4096)))

    @Test fun `an anchor of 4097 characters is refused`() = assertNull(decodes(anchor(4097)))

    @Test fun `a weighing decodes`() =
        assertEquals(
            HealthRequest.Apply(listOf(HealthObject.Weighing(owner, "2026-10-26", 80.4, 0, 1))),
            apply(aWeighing),
        )

    @Test fun `19,9 kg is refused`() = assertNull(apply(aWeighing.replace("80.4", "19.9")))

    @Test fun `20 and 400 kg decode, 400,1 kg is refused`() {
        assertNotNull(apply(aWeighing.replace("80.4", "20")))
        assertNotNull(apply(aWeighing.replace("80.4", "400")))
        assertNull(apply(aWeighing.replace("80.4", "400.1")))
    }

    @Test fun `a weight that is no number is refused`() = assertNull(apply(aWeighing.replace("80.4", "\"80\"")))

    @Test fun `a removal decodes`() =
        assertEquals(
            HealthRequest.Apply(listOf(HealthObject.WeighingRemoved(owner, "2026-10-26"))),
            decodes(removal(owner, "2026-10-26")),
        )

    @Test fun `month 13 is refused`() = assertNull(decodes(removal(owner, "2026-13-01")))

    @Test fun `a day followed by a line break is refused`() = assertNull(decodes(removal(owner, "2026-10-26\\n")))

    @Test fun `a day in other digits is refused`() = assertNull(decodes(removal(owner, "٢٠٢٦-10-26")))

    // Health Connect keeps one store for the whole phone: each account's weigh-ins carry its own tag.
    @Test fun `weighing without owner refused`() =
        assertNull(apply("""{"kind":"weighing","date":"2026-10-26","kg":80.4,"at":0,"version":1}"""))

    @Test fun `a removal without its owner is refused`() =
        assertNull(apply("""{"kind":"weighingRemoved","date":"2026-10-26"}"""))

    @Test fun `an owner other than 8 lowercase hex digits is refused`() {
        for (bad in listOf("0A1B2C3D", "0a1b2c3", "0a1b2c3d4", "../x/../", "")) {
            assertNull(bad, decodes(removal(bad, "2026-10-26")))
        }
        assertNull(decodes(removal("0a1b2c3d\\n", "2026-10-26")))
    }

    private fun weighingIdOf(request: HealthRequest?): String? =
        when (val o = (request as? HealthRequest.Apply)?.objects?.firstOrNull()) {
            is HealthObject.Weighing -> HealthRules.weighingId(o.owner, o.date)
            is HealthObject.WeighingRemoved -> HealthRules.weighingId(o.owner, o.date)
            else -> null
        }

    @Test fun `two accounts get two client record ids for one day, under Belay's prefix`() =
        assertEquals(
            listOf("belay-weighing-0a1b2c3d-2026-10-26", "belay-weighing-ffff0000-2026-10-26"),
            listOf("0a1b2c3d", "ffff0000").map { weighingIdOf(decodes(removal(it, "2026-10-26"))) },
        )

    @Test fun `a weighing and its removal share one client record id`() =
        assertEquals(weighingIdOf(decodes(removal(owner, "2026-10-26"))), weighingIdOf(apply(aWeighing)))

    @Test fun `readWeighings with no anchor decodes`() =
        assertEquals(
            HealthRequest.ReadWeighings(null, 1000),
            decodes("""{"op":"readWeighings","anchor":null,"since":1000}"""),
        )

    @Test fun `readWeighings with an anchor decodes`() =
        assertEquals(
            HealthRequest.ReadWeighings("token", 1000),
            decodes("""{"op":"readWeighings","anchor":"token","since":1000}"""),
        )

    @Test fun `readWeighings without its anchor key is refused`() =
        assertNull(decodes("""{"op":"readWeighings","since":1000}"""))

    @Test fun `apply without a list is refused`() = assertNull(decodes("""{"op":"apply","objects":{}}"""))

    @Test fun `an object of an unknown kind is refused`() = assertNull(apply("""{"kind":"sleep","id":"$id"}"""))
}
