package cloud.libresoftware.belay

import android.os.Bundle
import androidx.activity.OnBackPressedCallback
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // The bridge loads its plugins in onCreate: the app's own one is registered before it.
        registerPlugin(BelayNativePlugin::class.java)
        super.onCreate(savedInstanceState)
        // After the bridge, whose notifications plugin makes a channel of its own as it loads.
        Channels.create(this)
        // Back returns to the previous page, as in the browser. With none left, the app steps
        // aside instead of closing, so a session under way keeps its place.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val webView = bridge.webView
                if (webView.canGoBack()) webView.goBack() else moveTaskToBack(true)
            }
        })
    }
}
