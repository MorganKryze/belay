package cloud.libresoftware.belay

import org.json.JSONArray
import org.json.JSONObject

private const val LAST = "last"
private const val DISMISSED = "dismissed"

// A session swiped away stays away; the latest ones are enough, as only one session is open at a
// time and an older one never comes back.
private const val DISMISSED_KEPT = 20

// The last description posted, which the redraw alarm reads once the app's process may be gone,
// and the sessions swiped away.
class SessionStore(private val store: PrefsStore) {
    // A description this build cannot decode (an older build's) reads as none.
    fun last(): ActivityPayload? =
        store.get(LAST)?.let { json -> runCatching { ActivityPayload.from(JSONObject(json)) }.getOrNull() }

    fun save(p: ActivityPayload?) = store.put(LAST, p?.toJson()?.toString())

    fun dismiss(workoutId: String) {
        val ids = (ordered() - workoutId + workoutId).takeLast(DISMISSED_KEPT)
        store.put(DISMISSED, JSONArray(ids).toString())
    }

    fun dismissed(): Set<String> = ordered().toSet()

    private fun ordered(): List<String> {
        val json = store.get(DISMISSED) ?: return emptyList()
        return runCatching {
            val array = JSONArray(json)
            List(array.length()) { array.getString(it) }
        }.getOrDefault(emptyList())
    }
}
