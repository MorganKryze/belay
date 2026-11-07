package cloud.libresoftware.belay

import android.content.pm.ActivityInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.getcapacitor.BridgeActivity
import com.getcapacitor.WebViewListener

// The page's own safety delay on its launch screen: a page that never draws lets the splash go then.
private const val SPLASH_MS = 4_000L

class MainActivity : BridgeActivity() {
    // Set once the page has loaded, and with it the launch screen that carries the splash's mark on.
    private var loaded = false

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
        // Android's splash would leave on the activity's first frame, seconds before the page
        // draws, and the web view's own white would fill the gap: it holds the activity until the
        // page has loaded.
        val start = SystemClock.uptimeMillis()
        val splash = installSplashScreen()
        splash.setKeepOnScreenCondition { !loaded }
        // Then the activity draws under the splash, but a web view's first frames are its bare
        // background, paper with no mark: the splash stays over it until the web view has drawn the
        // page, two frames after it says the page is ready to draw, so that frame is on screen.
        splash.setOnExitAnimationListener { provider ->
            var gone = false
            val remove = Runnable {
                if (!gone) provider.remove()
                gone = true
            }
            val web = bridge.webView
            web.postVisualStateCallback(0, object : WebView.VisualStateCallback() {
                override fun onComplete(requestId: Long) {
                    web.postOnAnimation { web.postOnAnimation(remove) }
                }
            })
            Handler(Looper.getMainLooper()).postAtTime(remove, start + SPLASH_MS)
        }
        // A phone stays upright, one hand at the gym; a tablet turns every way. Android 16 ignores
        // a manifest lock on large screens only, so the screen itself decides on every version.
        if (resources.configuration.smallestScreenWidthDp < 600) requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        // The bridge loads its plugins in onCreate: the app's own one is registered before it.
        registerPlugin(BelayNativePlugin::class.java)
        super.onCreate(savedInstanceState)
        // Should a frame slip between the splash and the page, it is the launch colour, not white.
        bridge.webView.setBackgroundColor(getColor(R.color.launch))
        bridge.addWebViewListener(object : WebViewListener() {
            override fun onPageLoaded(webView: WebView) {
                loaded = true
            }
        })
        Handler(Looper.getMainLooper()).postAtTime({ loaded = true }, start + SPLASH_MS)
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
