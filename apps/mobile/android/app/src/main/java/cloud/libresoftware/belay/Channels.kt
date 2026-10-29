package cloud.libresoftware.belay

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.net.Uri
import androidx.core.app.NotificationManagerCompat

// What a channel looks like in Android's settings, how it rings and whether the lock screen shows
// what it posts.
data class ChannelSpec(
    val id: String,
    val name: Int,
    val description: Int?,
    val importance: Int,
    val sound: Boolean,
    val lockScreen: Boolean = false,
)

// The notification channels the rest alert and the open session post to. On Android the sound
// belongs to the channel, not to the notification: the rest's end with the tone, the same end
// without it when the rest sound is off, and the open session quietly.
object Channels {
    const val REST = "rest"
    const val REST_QUIET = "rest-quiet"
    const val SESSION = "session-shown"

    // Channels removed at every launch. The session's first one was low importance, which Android
    // 15 and later keep off the lock screen by default, and an app cannot raise the importance of
    // a channel it already made: the session moved to a new id. The notifications plugin makes
    // « default » each time it loads, named in English; every alert names its own channel, so
    // nothing posts there.
    val RETIRED = listOf("session", "default")

    fun specs(): List<ChannelSpec> {
        val high = NotificationManagerCompat.IMPORTANCE_HIGH
        val default = NotificationManagerCompat.IMPORTANCE_DEFAULT
        val low = NotificationManagerCompat.IMPORTANCE_LOW
        return listOf(
            ChannelSpec(REST, R.string.channel_rest, R.string.channel_rest_desc, high, sound = true),
            ChannelSpec(REST_QUIET, R.string.channel_rest_quiet, null, low, sound = false),
            // Default importance without sound or vibration: on the lock screen, never ringing.
            ChannelSpec(
                SESSION,
                R.string.channel_session,
                R.string.channel_session_desc,
                default,
                sound = false,
                lockScreen = true,
            ),
        )
    }

    // Created at every launch, once the bridge has loaded its plugins: Android keeps a channel's
    // settings once made, so this only adds the missing ones and renames them when the phone's
    // language changed. A channel's sound and importance cannot change after its creation; a new
    // one needs a new id.
    fun create(context: Context) {
        // Notification usage follows silent mode and Do Not Disturb, as the iPhone's tone follows
        // the Silent switch.
        val tone = Uri.parse("android.resource://${context.packageName}/raw/rest")
        val usage = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val channels = specs().map { spec ->
            NotificationChannel(spec.id, context.getString(spec.name), spec.importance).apply {
                spec.description?.let { description = context.getString(it) }
                if (spec.sound) {
                    setSound(tone, usage)
                } else {
                    setSound(null, null)
                    enableVibration(false)
                }
                setShowBadge(spec.id != SESSION)
                if (spec.lockScreen) lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
        }
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannels(channels)
        RETIRED.forEach(manager::deleteNotificationChannel)
    }
}
