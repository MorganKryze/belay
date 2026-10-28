package cloud.libresoftware.belay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// The ongoing notification's alarm and its swipe-away; they arrive with the notification itself.
class SessionAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) = Unit
}

class SessionDismissReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) = Unit
}
