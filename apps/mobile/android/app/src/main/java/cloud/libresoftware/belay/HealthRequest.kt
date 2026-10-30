package cloud.libresoftware.belay

import org.json.JSONArray
import org.json.JSONObject

// What the page may ask of Health Connect, decoded against the iPhone's fixed shapes: an operation
// the app does not know, a key it does not expect, a value out of range or more than 100 objects is
// refused before Health Connect is touched. org.json only, so these rules run in a JVM test.

// The objects, field for field as the page writes them (epoch milliseconds, YYYY-MM-DD, kg).
sealed interface HealthObject {
    data class Workout(val id: String, val startedAt: Long, val endedAt: Long, val version: Long) : HealthObject

    data class WorkoutRemoved(val id: String) : HealthObject

    data class Weighing(
        val owner: String,
        val date: String,
        val kg: Double,
        val at: Long,
        val version: Long,
    ) : HealthObject

    data class WeighingRemoved(val owner: String, val date: String) : HealthObject
}

sealed interface HealthRequest {
    data object Status : HealthRequest

    data class Authorize(val scope: String) : HealthRequest

    data class Apply(val objects: List<HealthObject>) : HealthRequest

    data class ReadWeighings(val anchor: String?, val since: Long) : HealthRequest

    companion object {
        // The page's bounds (health.ts, health-plan.ts), held to them by its contract test.
        const val MAX_OBJECTS = 100L

        // A changes token this side handed out: a fixed ceiling keeps any other string from
        // reaching Health Connect at whatever size.
        const val MAX_ANCHOR = 4096L

        // The page dates sessions and weigh-ins from 1900-01-01, and 08:00 on that day east of UTC
        // is still 1899-12-31 in UTC: the page's Date.UTC(1899, 11, 31). Nothing is more than a day
        // ahead of this phone's clock, and a workout lasts a day at most.
        const val EARLIEST = -2_209_075_200_000L
        const val DAY = 86_400_000L
        const val KG_MIN = 20
        const val KG_MAX = 400

        // Every value and every key the page sends, as sets the page's contract test reads.
        val OPS = setOf("status", "authorize", "apply", "readWeighings")
        val SCOPES = setOf("write", "import", "history")
        val KINDS = setOf("workout", "workoutRemoved", "weighing", "weighingRemoved")

        val STATUS_KEYS = setOf("op")
        val AUTHORIZE_KEYS = setOf("op", "scope")
        val APPLY_KEYS = setOf("op", "objects")
        val READ_WEIGHINGS_KEYS = setOf("op", "anchor", "since")

        val WORKOUT_KEYS = setOf("kind", "id", "startedAt", "endedAt", "version")
        val WORKOUT_REMOVED_KEYS = setOf("kind", "id")
        val WEIGHING_KEYS = setOf("kind", "owner", "date", "kg", "at", "version")
        val WEIGHING_REMOVED_KEYS = setOf("kind", "owner", "date")

        // Throws IllegalArgumentException, its message saying why, for anything else.
        fun from(json: JSONObject, now: Long): HealthRequest =
            when (json.opt("op")) {
                "status" -> {
                    expectKeys(json, STATUS_KEYS)
                    Status
                }
                "authorize" -> {
                    expectKeys(json, AUTHORIZE_KEYS)
                    val scope = json.opt("scope")
                    if (scope !is String || scope !in SCOPES) refuse("scope unknown")
                    Authorize(scope)
                }
                "apply" -> {
                    expectKeys(json, APPLY_KEYS)
                    val list = json.opt("objects") as? JSONArray ?: refuse("objects not a list")
                    // Counted before any object is decoded, so an oversized batch costs nothing.
                    if (list.length() > MAX_OBJECTS) refuse("too many objects")
                    Apply(List(list.length()) { objectOf(list.opt(it), now) })
                }
                "readWeighings" -> {
                    expectKeys(json, READ_WEIGHINGS_KEYS)
                    val since = long(json, "since")
                    if (!isTime(since, now)) refuse("since out of range")
                    val anchor = when (val value = json.opt("anchor")) {
                        JSONObject.NULL -> null
                        is String -> value
                        else -> refuse("anchor not a string")
                    }
                    if (anchor != null && anchor.length > MAX_ANCHOR) refuse("anchor too long")
                    ReadWeighings(anchor, since)
                }
                else -> refuse("operation unknown")
            }

        private fun objectOf(value: Any?, now: Long): HealthObject {
            val json = value as? JSONObject ?: refuse("object not an object")
            return when (json.opt("kind")) {
                "workout" -> {
                    expectKeys(json, WORKOUT_KEYS)
                    val w = HealthObject.Workout(
                        string(json, "id"), long(json, "startedAt"), long(json, "endedAt"), long(json, "version"),
                    )
                    if (!isSessionId(w.id) || !isTime(w.startedAt, now) || !isTime(w.endedAt, now) ||
                        w.endedAt <= w.startedAt || w.endedAt - w.startedAt > DAY || w.version <= 0
                    ) {
                        refuse("workout out of range")
                    }
                    w
                }
                "workoutRemoved" -> {
                    expectKeys(json, WORKOUT_REMOVED_KEYS)
                    val w = HealthObject.WorkoutRemoved(string(json, "id"))
                    if (!isSessionId(w.id)) refuse("id invalid")
                    w
                }
                "weighing" -> {
                    expectKeys(json, WEIGHING_KEYS)
                    val w = HealthObject.Weighing(
                        string(json, "owner"),
                        string(json, "date"),
                        number(json, "kg"),
                        long(json, "at"),
                        long(json, "version"),
                    )
                    if (!isOwner(w.owner) || !isDay(w.date) || !w.kg.isFinite() || w.kg < KG_MIN ||
                        w.kg > KG_MAX || !isTime(w.at, now) || w.version <= 0
                    ) {
                        refuse("weighing out of range")
                    }
                    w
                }
                "weighingRemoved" -> {
                    expectKeys(json, WEIGHING_REMOVED_KEYS)
                    val w = HealthObject.WeighingRemoved(string(json, "owner"), string(json, "date"))
                    if (!isOwner(w.owner) || !isDay(w.date)) refuse("date invalid")
                    w
                }
                else -> refuse("kind unknown")
            }
        }

        private fun refuse(why: String): Nothing = throw IllegalArgumentException(why)

        private fun expectKeys(json: JSONObject, keys: Set<String>) {
            // Android's org.json has no keySet().
            if (json.keys().asSequence().toSet() != keys) refuse("unexpected keys")
        }

        private fun string(json: JSONObject, key: String): String =
            json.opt(key) as? String ?: refuse("$key not a string")

        // org.json reads 80 as an Int, 80.4 as a Double on Android and a BigDecimal elsewhere.
        private fun number(json: JSONObject, key: String): Double =
            (json.opt(key) as? Number)?.toDouble() ?: refuse("$key not a number")

        // Epoch milliseconds and versions are whole numbers; the page's stay far below 2^53, where a
        // Double holds every whole number exactly.
        private fun long(json: JSONObject, key: String): Long {
            val value = number(json, key)
            if (!value.isFinite() || value != Math.floor(value) || Math.abs(value) > MAX_EXACT) {
                refuse("$key not whole")
            }
            return value.toLong()
        }

        private const val MAX_EXACT = 9_007_199_254_740_991.0

        private fun isTime(t: Long, now: Long) = t >= EARLIEST && t <= now + DAY

        // Each of these becomes part of a client record id, so only the form the page writes, ASCII
        // only: `\d` takes any script's digits, and a whole-input match leaves no trailing line break.
        private val DAY_FORM = Regex("[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])")
        private val OWNER_FORM = Regex("[0-9a-f]{8}")
        private val SESSION_FORM = Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")

        private fun isDay(date: String) = DAY_FORM.matches(date)

        private fun isOwner(owner: String) = OWNER_FORM.matches(owner)

        // Lowercase only: the same id in capitals would be a second record for one session.
        private fun isSessionId(id: String) = SESSION_FORM.matches(id)
    }
}
