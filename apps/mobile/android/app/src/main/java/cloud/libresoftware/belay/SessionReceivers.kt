package cloud.libresoftware.belay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// The rest's end or the forgotten mark has passed with no word from the page.
class SessionAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) = SessionNotifier(context).redraw(System.currentTimeMillis())
}

// The person swiped the notification away.
class SessionDismissReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val workoutId = intent.getStringExtra(WORKOUT_ID) ?: return
        SessionNotifier(context).dismissed(workoutId)
    }

    companion object {
        const val WORKOUT_ID = "workoutId"
    }
}
