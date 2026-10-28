package cloud.libresoftware.belay

import android.os.Bundle
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

// What Belay does with Health Connect data, opened from Health Connect's permission screen and
// from Android's permission usage page. Closing the alert, by OK or by dismissing it, closes it all.
class HealthPrivacyActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        AlertDialog.Builder(this)
            .setTitle(R.string.privacy_title)
            .setMessage(R.string.privacy_body)
            .setPositiveButton(R.string.privacy_ok, null)
            .setOnDismissListener { finish() }
            .show()
    }
}
