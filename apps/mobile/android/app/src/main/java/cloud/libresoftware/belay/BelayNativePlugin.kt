package cloud.libresoftware.belay

import android.content.Intent
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

// The page's native calls (native/plugin.ts), each handed to the part of the app that owns it.
// Every part is built on its first use, so a launch pays only for what the page asks.
@CapacitorPlugin(name = "BelayNative")
class BelayNativePlugin : Plugin() {
    private val tokens by lazy { Tokens(context) }
    private val signIn by lazy { SignIn(this) }
    private val session by lazy { SessionNotifier(context) }
    private val healthBridge by lazy { HealthBridge(this) }

    override fun load() {
        Channels.create(context)
        // The sign-in and Health Connect register their activity results here, while the activity
        // is still being created: Android refuses a registration once it has started.
        signIn.register()
        healthBridge.register()
    }

    override fun handleOnNewIntent(intent: Intent) {
        super.handleOnNewIntent(intent)
        signIn.onNewIntent(intent)
    }

    override fun handleOnResume() {
        super.handleOnResume()
        signIn.onResume()
    }

    @PluginMethod
    fun readToken(call: PluginCall) = tokens.read(call)

    @PluginMethod
    fun writeToken(call: PluginCall) = tokens.write(call)

    @PluginMethod
    fun clearToken(call: PluginCall) = tokens.clear(call)

    @PluginMethod
    fun authenticate(call: PluginCall) = signIn.start(call)

    @PluginMethod
    fun setLiveActivity(call: PluginCall) = session.show(call)

    @PluginMethod
    fun health(call: PluginCall) = healthBridge.handle(call)
}
