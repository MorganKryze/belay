package cloud.libresoftware.belay

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.activity.result.ActivityResultLauncher
import androidx.browser.auth.AuthTabIntent
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall

// The instance's sign-in page in a private browser tab. Chrome's Auth Tab hands the address back
// as an activity result; a browser without it opens a Custom Tab, and the address comes back as a
// `belay://auth` link to the main activity. Everything here runs on the main thread.
class SignIn(private val plugin: Plugin) {
    private val gate = SignInGate()
    private var pending: PluginCall? = null
    private var authTab: ActivityResultLauncher<Intent>? = null

    // An Auth Tab answers through its result alone, a close included: a link arriving meanwhile
    // came from elsewhere, and a resume is not a cancel.
    private var viaAuthTab = false

    fun register() {
        val activity = plugin.activity
        authTab = AuthTabIntent.registerActivityResultLauncher(activity, ::onAuthTabResult)
        // The tab counts as open once it covers the app, not when it is asked for: a resume before
        // that is the launch itself, not the person closing the tab.
        activity.lifecycle.addObserver(
            LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) gate.launched() },
        )
    }

    fun start(call: PluginCall) {
        val url = call.getString("url")
        val scheme = call.getString("callbackScheme")
        if (url == null || scheme == null) return call.reject("url or callbackScheme missing")
        // The main activity answers to this scheme alone, so no other could ever come back.
        if (scheme != SignInGate.SCHEME) return call.reject("callbackScheme unsupported")
        val page = Uri.parse(url)
        if (page.scheme != "https" && page.scheme != "http") return call.reject("url invalid")
        plugin.activity.runOnUiThread { open(call, page) }
    }

    fun onNewIntent(intent: Intent) {
        if (viaAuthTab || intent.action != Intent.ACTION_VIEW) return
        val url = gate.callback(intent.dataString ?: return) ?: return
        settle()?.resolve(JSObject().put("url", url))
    }

    fun onResume() {
        if (!viaAuthTab && gate.resumed()) settle()?.reject("cancelled", "cancelled")
    }

    private fun open(call: PluginCall, page: Uri) {
        if (!gate.begin()) return call.reject("busy", "busy")
        pending = call
        val activity = plugin.activity
        // Null when no browser offers tabs, or none is visible to the app.
        val browser = CustomTabsClient.getPackageName(activity, null)
        val launcher = authTab
        try {
            if (launcher != null && browser != null && CustomTabsClient.isAuthTabSupported(activity, browser)) {
                // Private: no cookie of the identity provider outlives the tab, so signing out of
                // the app is complete.
                val tab = AuthTabIntent.Builder().setEphemeralBrowsingEnabled(true).build()
                tab.intent.setPackage(browser)
                viaAuthTab = true
                tab.launch(launcher, page, SignInGate.SCHEME)
            } else {
                // Private where the browser offers it; others ignore the request.
                val tab = CustomTabsIntent.Builder().setEphemeralBrowsingEnabled(true).build()
                if (browser != null) tab.intent.setPackage(browser)
                tab.launchUrl(activity, page)
            }
        } catch (_: ActivityNotFoundException) {
            settle()?.reject("sign-in tab did not open")
        }
    }

    private fun onAuthTabResult(result: AuthTabIntent.AuthResult) {
        when (result.resultCode) {
            AuthTabIntent.RESULT_OK -> {
                val url = result.resultUri?.let { gate.callback(it.toString()) }
                if (url != null) settle()?.resolve(JSObject().put("url", url)) else settle()?.reject("sign-in failed")
            }
            AuthTabIntent.RESULT_CANCELED -> settle()?.reject("cancelled", "cancelled")
            else -> settle()?.reject("sign-in failed")
        }
    }

    // The waiting call, handed out once, and the gate opened for the next sign-in.
    private fun settle(): PluginCall? {
        gate.end()
        viaAuthTab = false
        return pending.also { pending = null }
    }
}
