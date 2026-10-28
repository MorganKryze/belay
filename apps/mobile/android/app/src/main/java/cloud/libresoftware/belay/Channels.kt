package cloud.libresoftware.belay

import android.content.Context
import android.media.AudioAttributes
import android.net.Uri
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationManagerCompat

// What a channel looks like in Android's settings and how it rings.
data class ChannelSpec(
    val id: String,
    val name: Int,
    val description: Int?,
    val importance: Int,
    val sound: Boolean,
)

// The notification channels the rest alert and the open session post to. On Android the sound
// belongs to the channel, not to the notification: the rest's end with the tone, the same end
// without it when the rest sound is off, and the open session quietly.
object Channels {
    const val REST = "rest"
    const val REST_QUIET = "rest-quiet"
    const val SESSION = "session"

    fun specs(): List<ChannelSpec> {
        val high = NotificationManagerCompat.IMPORTANCE_HIGH
        val low = NotificationManagerCompat.IMPORTANCE_LOW
        return listOf(
            ChannelSpec(REST, R.string.channel_rest, R.string.channel_rest_desc, high, sound = true),
            ChannelSpec(REST_QUIET, R.string.channel_rest_quiet, null, low, sound = false),
            ChannelSpec(SESSION, R.string.channel_session, R.string.channel_session_desc, low, sound = false),
        )
    }

    // Created at every launch: Android keeps a channel's settings once made, so this only adds the
    // missing ones and renames them when the phone's language changed. A channel's sound cannot
    // change after its creation; a new sound needs a new id.
    fun create(context: Context) {
        // Notification usage follows silent mode and Do Not Disturb, as the iPhone's tone follows
        // the Silent switch.
        val tone = Uri.parse("android.resource://${context.packageName}/raw/rest")
        val usage = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val channels = specs().map { spec ->
            NotificationChannelCompat.Builder(spec.id, spec.importance)
                .setName(context.getString(spec.name))
                .apply { spec.description?.let { setDescription(context.getString(it)) } }
                .apply {
                    if (spec.sound) {
                        setSound(tone, usage)
                    } else {
                        setSound(null, null)
                        setVibrationEnabled(false)
                    }
                }
                .setShowBadge(spec.id != SESSION)
                .build()
        }
        NotificationManagerCompat.from(context).createNotificationChannelsCompat(channels)
    }
}
