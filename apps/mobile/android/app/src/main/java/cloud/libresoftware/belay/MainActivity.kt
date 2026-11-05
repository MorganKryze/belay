package cloud.libresoftware.belay

import android.content.pm.ActivityInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.activity.OnBackPressedCallback
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    // The web view reports itself online whatever the phone's state: it is told when the phone's
    // network comes and goes, so the page can tell no connection from an address that fails.
    private val network = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(n: Network) = online(true)

        override fun onLost(n: Network) = online(false)
    }

    private fun online(available: Boolean) {
        runOnUiThread { bridge?.webView?.setNetworkAvailable(available) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // A phone stays upright, one hand at the gym; a tablet turns every way. Android 16 ignores
        // a manifest lock on large screens only, so the screen itself decides on every version.
        if (resources.configuration.smallestScreenWidthDp < 600) requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        // The bridge loads its plugins in onCreate: the app's own one is registered before it.
        registerPlugin(BelayNativePlugin::class.java)
        super.onCreate(savedInstanceState)
        // After the bridge, whose notifications plugin makes a channel of its own as it loads.
        Channels.create(this)
        val connectivity = getSystemService(ConnectivityManager::class.java)
        online(connectivity.activeNetwork != null)
        connectivity.registerDefaultNetworkCallback(network)
        // Back closes what is on top of the page first, then goes back a step; on Accueil the
        // app steps aside instead of closing, so a session under way keeps its place.
        val back = SystemBack(bridge.webView, Handler(Looper.getMainLooper())) { moveTaskToBack(true) }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = back.press()
        })
    }

    override fun onDestroy() {
        getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(network)
        super.onDestroy()
    }
}
