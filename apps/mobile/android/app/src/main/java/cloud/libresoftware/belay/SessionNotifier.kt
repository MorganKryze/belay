package cloud.libresoftware.belay

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.PluginCall

// The open session as an ongoing notification, Android's counterpart of the iPhone's Live
// Activity. One notification at a time: a description for another session replaces it in place.
class SessionNotifier(private val context: Context) {
    private val store = SessionStore(SharedPrefsStore(context, "belay.session.notification"))
    private val notifications = NotificationManagerCompat.from(context)

    fun show(call: PluginCall) {
        val payload =
            try {
                ActivityPayload.from(call.data.optJSONObject("activity"))
            } catch (e: IllegalArgumentException) {
                return call.reject("activity invalid", "invalid", e)
            }
        try {
            if (payload == null) end() else post(payload, System.currentTimeMillis())
        } catch (e: Exception) {
            // The page carries on without the notification and tries again on its next change.
            return call.reject("unavailable", "unavailable", e)
        }
        call.resolve()
    }

    // Drawn again at the stale date from the last description alone: the app's process may be gone.
    // One this build cannot read takes the notification away rather than leave it wrong.
    fun redraw(now: Long) {
        val payload = store.last() ?: return end()
        post(payload, now)
    }

    // Swiped away: never posted again for this session, and no redraw brings it back.
    fun dismissed(workoutId: String) {
        store.dismiss(workoutId)
        alarms().cancel(redrawIntent())
    }

    private fun end() {
        notifications.cancel(TAG, ID)
        alarms().cancel(redrawIntent())
        store.save(null)
    }

    private fun post(payload: ActivityPayload, now: Long) {
        if (!shouldPost(notifications.areNotificationsEnabled(), store.dismissed(), payload.workoutId)) return
        val content = contentOf(payload, now)
        // Past its timeout the notification would never go: iOS has ended the Activity by then too.
        if (content.timeoutAt <= now) return end()
        val builder =
            NotificationCompat.Builder(context, Channels.SESSION)
                .setSmallIcon(R.drawable.ic_stat_belay)
                .setColor(ContextCompat.getColor(context, R.color.accent))
                // A promoted notification refuses a colourised one.
                .setColorized(false)
                .setContentTitle(content.title)
                .setContentText(content.text)
                .setSubText(content.subText)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(openApp())
                .setDeleteIntent(dismissIntent(payload.workoutId))
                .setRequestPromotedOngoing(true)
                .setTimeoutAfter(content.timeoutAt - now)
        content.chip?.let(builder::setShortCriticalText)
        val chrono = content.chrono
        if (chrono == null) {
            builder.setShowWhen(false)
        } else {
            builder
                .setWhen(chrono.base)
                .setShowWhen(true)
                .setUsesChronometer(true)
                .setChronometerCountDown(chrono.countDown)
        }
        notifications.notify(TAG, ID, builder.build())
        store.save(payload)
        val redrawAt = content.redrawAt
        if (redrawAt == null) alarms().cancel(redrawIntent()) else scheduleRedraw(redrawAt)
    }

    // Not waking the phone: the redraw only matters when someone looks, so it waits for the next
    // wake and spends none of the idle quota the rest alert needs.
    private fun scheduleRedraw(at: Long) {
        val alarms = alarms()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarms.canScheduleExactAlarms()) {
            // Exact alarms withdrawn in the settings: a late redraw beats none.
            alarms.set(AlarmManager.RTC, at, redrawIntent())
        } else {
            alarms.setExact(AlarmManager.RTC, at, redrawIntent())
        }
    }

    private fun alarms() = context.getSystemService(AlarmManager::class.java)

    private fun openApp(): PendingIntent? {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
        return PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun dismissIntent(workoutId: String): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            0,
            Intent(context, SessionDismissReceiver::class.java).putExtra(SessionDismissReceiver.WORKOUT_ID, workoutId),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    private fun redrawIntent(): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            0,
            Intent(context, SessionAlarmReceiver::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    private companion object {
        // Apart from the rest alert's notification, so neither replaces the other.
        const val TAG = "session"
        const val ID = 7001
    }
}
