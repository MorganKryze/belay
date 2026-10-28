package cloud.libresoftware.belay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

// A receiver has no page to answer: a failure (preferences not written, a refused notify) is
// reported rather than crash the app's process in the background.
internal fun inBackground(report: (Exception) -> Unit, work: () -> Unit) {
    try {
        work()
    } catch (e: Exception) {
        report(e)
    }
}

// The rest's end or the forgotten mark has passed with no word from the page.
class SessionAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) =
        inBackground({ Log.w("Belay", "session notification not redrawn", it) }) {
            SessionNotifier(context).redraw(System.currentTimeMillis())
        }
}

// The person swiped the notification away.
class SessionDismissReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val workoutId = intent.getStringExtra(WORKOUT_ID) ?: return
        inBackground({ Log.w("Belay", "session dismissal not kept", it) }) {
            SessionNotifier(context).dismissed(workoutId)
        }
    }

    companion object {
        const val WORKOUT_ID = "workoutId"
    }
}
