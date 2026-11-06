package cloud.libresoftware.belay

import android.os.Handler
import android.webkit.WebView

// How long the page has to answer a Back press before the app steps back on its own.
const val ANSWER_MS = 500L

enum class Answer { DONE, LEAVE, SILENT }

// The page's answer as the web view hands it over, JSON-encoded: one of a few fixed words, and
// anything else is silence.
object BackAnswer {
    private val DONE = setOf("surface", "cover", "page", "tab-root")

    fun of(raw: String?): Answer {
        if (raw == null || raw.length < 2 || raw.first() != '"' || raw.last() != '"') return Answer.SILENT
        return when (raw.substring(1, raw.length - 1)) {
            "home" -> Answer.LEAVE
            in DONE -> Answer.DONE
            else -> Answer.SILENT
        }
    }
}

// Back asks the page first, which closes what is on top or goes back a step and says which. A
// page that is silent (not yet loaded, an error) or late gets the browser's own step back, so Back
// never does nothing. A page frozen past the wait may still take its step afterwards: one extra
// step back, rather than a press that does nothing.
class SystemBack(
    private val webView: WebView,
    private val handler: Handler,
    private val leave: () -> Unit,
) {
    fun press() {
        var settled = false
        val fallback = Runnable {
            settled = true
            stepBack()
        }
        handler.postDelayed(fallback, ANSWER_MS)
        webView.evaluateJavascript("window.belayBack?.() ?? null") { raw ->
            if (settled) return@evaluateJavascript
            settled = true
            handler.removeCallbacks(fallback)
            when (BackAnswer.of(raw)) {
                Answer.DONE -> Unit
                Answer.LEAVE -> leave()
                Answer.SILENT -> stepBack()
            }
        }
    }

    // As the app did before the page could answer: the previous page, or with none the app steps
    // aside, so a session under way keeps its place.
    private fun stepBack() {
        if (webView.canGoBack()) webView.goBack() else leave()
    }
}
