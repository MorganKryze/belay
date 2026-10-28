package cloud.libresoftware.belay

import android.content.Context
import com.getcapacitor.PluginCall

// The session token kept for the instance; not on this phone yet.
class Tokens(private val context: Context) {
    fun read(call: PluginCall) = call.reject("unavailable", "unavailable")

    fun write(call: PluginCall) = call.reject("unavailable", "unavailable")

    fun clear(call: PluginCall) = call.reject("unavailable", "unavailable")
}
