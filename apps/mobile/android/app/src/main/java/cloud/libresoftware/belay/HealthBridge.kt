package cloud.libresoftware.belay

import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall

// Health Connect for the Health page; not on this phone yet.
class HealthBridge(private val plugin: Plugin) {
    fun register() = Unit

    fun handle(call: PluginCall) = call.reject("unavailable", "unavailable")
}
