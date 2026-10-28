package cloud.libresoftware.belay

import org.json.JSONObject

// The open session as the page describes it (native/live-activity.ts), the same shape the iPhone
// app decodes. Every word arrives already in the person's language; times are epoch milliseconds.
data class ActivityPayload(
    val workoutId: String,
    val staleAt: Long,
    val status: String,
    val title: String,
    val detail: String,
    val statusLabel: String,
    val restOverTitle: String,
    val restOverDetail: String,
    val staleLine: String,
    val startedAt: Long,
    val pausedAt: Long?,
    val restStart: Long?,
    val restEnd: Long?,
    val restFrozen: Boolean,
) {
    // The page's own shape, so a saved description decodes as the page's would.
    fun toJson(): JSONObject =
        JSONObject()
            .put("workoutId", workoutId)
            .put("staleAt", staleAt)
            .put(
                "state",
                JSONObject()
                    .put("status", status)
                    .put("title", title)
                    .put("detail", detail)
                    .put("statusLabel", statusLabel)
                    .put("restOverTitle", restOverTitle)
                    .put("restOverDetail", restOverDetail)
                    .put("staleLine", staleLine)
                    .put("startedAt", startedAt)
                    .put("pausedAt", pausedAt ?: JSONObject.NULL)
                    .put("restStart", restStart ?: JSONObject.NULL)
                    .put("restEnd", restEnd ?: JSONObject.NULL)
                    .put("restFrozen", restFrozen),
            )

    companion object {
        // The page cuts every text to this length (ACTIVITY_TEXT_MAX); anything longer did not come
        // from it.
        const val TEXT_MAX = 80
        val ACTIVITY_KEYS = setOf("workoutId", "staleAt", "state")
        val STATE_KEYS =
            setOf(
                "status", "title", "detail", "statusLabel", "restOverTitle", "restOverDetail", "staleLine",
                "startedAt", "pausedAt", "restStart", "restEnd", "restFrozen",
            )
        val STATUSES = setOf("due", "rest", "paused", "done")

        // None for no description; an IllegalArgumentException for any other shape than the page's.
        fun from(json: JSONObject?): ActivityPayload? {
            if (json == null) return null
            json.requireKeys(ACTIVITY_KEYS)
            val state = json.opt("state") as? JSONObject ?: throw IllegalArgumentException("state is not an object")
            state.requireKeys(STATE_KEYS)
            val status = state.text("status")
            require(status in STATUSES) { "status $status unknown" }
            return ActivityPayload(
                workoutId = json.text("workoutId"),
                staleAt = json.time("staleAt"),
                status = status,
                title = state.text("title"),
                detail = state.text("detail"),
                statusLabel = state.text("statusLabel"),
                restOverTitle = state.text("restOverTitle"),
                restOverDetail = state.text("restOverDetail"),
                staleLine = state.text("staleLine"),
                startedAt = state.time("startedAt"),
                pausedAt = state.timeOrNull("pausedAt"),
                restStart = state.timeOrNull("restStart"),
                restEnd = state.timeOrNull("restEnd"),
                restFrozen = state.opt("restFrozen") as? Boolean ?: throw IllegalArgumentException("restFrozen is not a boolean"),
            )
        }

        private fun JSONObject.requireKeys(expected: Set<String>) {
            val keys = keys().asSequence().toSet()
            require(keys == expected) { "keys ${keys - expected} unknown, ${expected - keys} missing" }
        }

        private fun JSONObject.text(key: String): String {
            val value = opt(key) as? String ?: throw IllegalArgumentException("$key is not a text")
            require(value.length <= TEXT_MAX) { "$key is over $TEXT_MAX characters" }
            return value
        }

        // A whole number of milliseconds, however the JSON parser typed it.
        private fun JSONObject.time(key: String): Long =
            when (val value = opt(key)) {
                is Int -> value.toLong()
                is Long -> value
                is Double -> value.toLong().takeIf { it.toDouble() == value }
                else -> null
            } ?: throw IllegalArgumentException("$key is not a time")

        private fun JSONObject.timeOrNull(key: String): Long? = if (isNull(key)) null else time(key)
    }
}
