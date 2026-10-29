package cloud.libresoftware.belay

import java.net.URI
import java.net.URISyntaxException

// Decides what a browser's return means for the one sign-in that may be waiting. Any app or page can
// send a `belay://auth` address to Belay, so one counts only while a sign-in waits, and only once.
// Called from the main thread alone.
class SignInGate {
    private enum class State { IDLE, STARTING, OPEN }

    private var state = State.IDLE

    // False while another sign-in waits.
    fun begin(): Boolean {
        if (state != State.IDLE) return false
        state = State.STARTING
        return true
    }

    // The browser tab is on screen: from now on, coming back without an address means it was closed.
    fun launched() {
        if (state == State.STARTING) state = State.OPEN
    }

    // The address to hand to the page, or null when nobody asked for it.
    fun callback(uri: String): String? {
        if (state == State.IDLE || !isCallback(uri)) return null
        state = State.IDLE
        return uri
    }

    // True when the person came back from an open tab without signing in. A return before the tab
    // opened (the activity paused and resumed while launching it) is not a cancel.
    fun resumed(): Boolean {
        if (state != State.OPEN) return false
        state = State.IDLE
        return true
    }

    fun end() {
        state = State.IDLE
    }

    private fun isCallback(uri: String): Boolean {
        val parsed =
            try {
                URI(uri)
            } catch (_: URISyntaxException) {
                return false
            }
        return parsed.scheme == SCHEME && parsed.rawAuthority == HOST
    }

    companion object {
        // The address the instance sends the browser back to (NATIVE_CALLBACK on the server).
        const val SCHEME = "belay"
        const val HOST = "auth"
    }
}
