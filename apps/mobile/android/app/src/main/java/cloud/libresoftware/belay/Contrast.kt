package cloud.libresoftware.belay

import android.app.UiModeManager
import android.content.Context
import android.os.Build
import android.provider.Settings

// The system's contrast setting runs 0 (standard), 0.5 (medium), 1 (high); anything above 0.25
// counts as increased, as does the high-contrast text switch of older versions.
internal fun isHighContrast(contrast: Float, highText: Boolean): Boolean =
    highText || contrast > 0.25f

// Read each time the page asks, so a change in Settings shows on its next read.
internal fun readContrast(context: Context): Boolean {
    val level =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            context.getSystemService(UiModeManager::class.java).contrast
        } else {
            0f
        }
    val highText = Settings.Secure.getInt(context.contentResolver, "high_text_contrast_enabled", 0) == 1
    return isHighContrast(level, highText)
}
