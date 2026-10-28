package cloud.libresoftware.belay

import android.content.Context

// A small key-value store, behind an interface so the JVM tests use a map instead of Android.
interface PrefsStore {
    fun get(key: String): String?

    // A null value removes the key.
    fun put(key: String, value: String?)

    // Several keys at once; the app's file writes them in one commit.
    fun putAll(values: Map<String, String?>) = values.forEach { (key, value) -> put(key, value) }
}

// The app's private preferences file `name`. Written synchronously: the page is answered only once
// the value is on disk.
class SharedPrefsStore(context: Context, name: String) : PrefsStore {
    private val prefs = context.getSharedPreferences(name, Context.MODE_PRIVATE)

    override fun get(key: String): String? = prefs.getString(key, null)

    override fun put(key: String, value: String?) = putAll(mapOf(key to value))

    override fun putAll(values: Map<String, String?>) {
        val edit = prefs.edit()
        for ((key, value) in values) if (value == null) edit.remove(key) else edit.putString(key, value)
        if (!edit.commit()) throw IllegalStateException("preferences ${values.keys} not written")
    }
}
