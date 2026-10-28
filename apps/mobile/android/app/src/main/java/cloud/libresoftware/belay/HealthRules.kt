package cloud.libresoftware.belay

import android.os.RemoteException
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException

// Belay's few rules on this side of Health Connect, apart from its I/O so the JVM tests reach them.
object HealthRules {
    // The values the page reads (health.ts), as sets its contract test reads.
    val OUTCOMES = setOf("written", "removed", "overlap", "denied", "unavailable", "failed")
    val ACCESS = setOf("allowed", "denied", "undetermined")

    const val WRITE_EXERCISE = "android.permission.health.WRITE_EXERCISE"
    const val READ_EXERCISE = "android.permission.health.READ_EXERCISE"
    const val WRITE_WEIGHT = "android.permission.health.WRITE_WEIGHT"
    const val READ_WEIGHT = "android.permission.health.READ_WEIGHT"

    // Health Connect only says granted or not; Belay records that it asked, so not granted after
    // asking reads as a refusal and the page can say where to allow it.
    fun access(granted: Boolean, asked: Boolean): String =
        when {
            granted -> "allowed"
            asked -> "denied"
            else -> "undetermined"
        }

    const val ASKED_WRITE = "asked.write"
    const val ASKED_IMPORT = "asked.import"

    // Marked asked only once the screen is launched: a launch that fails never turns the status
    // into a refusal for a screen nobody saw.
    fun launchAsking(asked: PrefsStore, scope: String, launch: () -> Unit) {
        launch()
        asked.put(if (scope == "import") ASKED_IMPORT else ASKED_WRITE, "1")
    }

    // What each scope asks for. A request leaving out a type may take back its grant, so every
    // request repeats the write set (with reading sessions, for the overlap); reading weigh-ins
    // waits for the import.
    fun requested(scope: String): Set<String> {
        val write = setOf(WRITE_EXERCISE, WRITE_WEIGHT, READ_EXERCISE)
        return if (scope == "import") write + READ_WEIGHT else write
    }

    // Another app's session covering at least half of Belay's means a watch (or another app)
    // already recorded it. Each one alone must cover half: a walk to the gym and a stretch after it
    // are not one session.
    fun covers(start: Long, end: Long, others: List<Pair<Long, Long>>): Boolean =
        others.any { (from, to) -> 2 * (minOf(end, to) - maxOf(start, from)) >= end - start }

    // How the page should take a refusal: a permission, a Health Connect it cannot reach right now
    // (a lost binding, its storage, its rate limit), or anything else.
    fun outcomeOf(error: Throwable): String =
        when (error) {
            is SecurityException -> "denied"
            is RemoteException, is IOException, is IllegalStateException -> "unavailable"
            else -> "failed"
        }

    // A changes token Health Connect no longer takes, for whatever reason, is read again from
    // `since`, as an expired one is: the page keeps one weigh-in per day, so nothing doubles. A
    // missing permission or a cancelled call is not the token's fault and stays a failure.
    fun readsAgain(error: Throwable): Boolean = error !is SecurityException && error !is CancellationException

    // A weigh-in Belay wrote, known by this app's package or by Belay's own id: the import never
    // reads Belay's weigh-ins back as a scale's.
    fun isOwn(packageName: String, ourPackage: String, clientRecordId: String?): Boolean =
        packageName == ourPackage || clientRecordId?.startsWith("belay-weighing-") == true

    fun sessionId(id: String) = "belay-session-$id"

    // Health Connect keeps one store for the whole phone, so a weigh-in's id carries the tag of the
    // account that wrote it: two accounts never replace or delete each other's day.
    fun weighingId(owner: String, date: String) = "belay-weighing-$owner-$date"
}
