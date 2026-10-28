package cloud.libresoftware.belay

import android.content.Context
import com.getcapacitor.PluginCall

// The open session as an ongoing notification; not on this phone yet.
class SessionNotifier(private val context: Context) {
    fun show(call: PluginCall) = call.reject("unavailable", "unavailable")
}
