package cloud.libresoftware.belay

import android.content.Context

// The notification channels the rest alert and the open session post to.
object Channels {
    const val REST = "rest"
    const val REST_QUIET = "rest-quiet"
    const val SESSION = "session"

    fun create(context: Context) = Unit
}
