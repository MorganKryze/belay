package cloud.libresoftware.belay

import android.content.Intent
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall

// The instance's sign-in page in a browser tab; not on this phone yet.
class SignIn(private val plugin: Plugin) {
    fun register() = Unit

    fun start(call: PluginCall) = call.reject("unavailable", "unavailable")

    fun onNewIntent(intent: Intent) = Unit

    fun onResume() = Unit
}
