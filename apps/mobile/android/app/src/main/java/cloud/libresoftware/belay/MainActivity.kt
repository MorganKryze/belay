package cloud.libresoftware.belay

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // The bridge loads its plugins in onCreate: the app's own one is registered before it.
        registerPlugin(BelayNativePlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
