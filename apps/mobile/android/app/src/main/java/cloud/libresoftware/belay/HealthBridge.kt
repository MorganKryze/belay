package cloud.libresoftware.belay

import androidx.activity.result.ActivityResultLauncher
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.health.connect.client.units.Mass
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import kotlin.coroutines.cancellation.CancellationException
import kotlin.reflect.KClass
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

// Belay's finished sessions and weigh-ins in Health Connect, and the weigh-ins other apps wrote
// there. Which session, which version, which day: the page decides all of it from the phone's data;
// this side carries out one decoded request and answers object by object.
class HealthBridge(private val plugin: Plugin) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val client by lazy { HealthConnectClient.getOrCreate(plugin.context) }

    // Whether Belay asked, per scope: Health Connect only says granted or not.
    private val asked by lazy { SharedPrefsStore(plugin.context, "belay.health") }
    private var permissions: ActivityResultLauncher<Set<String>>? = null
    private var waiting: PluginCall? = null

    fun register() {
        permissions = plugin.activity.registerForActivityResult(
            PermissionController.createRequestPermissionResultContract(),
        ) {
            val call = waiting ?: return@registerForActivityResult
            waiting = null
            answer(call) { status() }
        }
    }

    // The request is decoded against fixed shapes before anything runs; what to write and when are
    // Belay's rules, and they stay in the page.
    fun handle(call: PluginCall) {
        val request = try {
            HealthRequest.from(call.data, System.currentTimeMillis())
        } catch (e: IllegalArgumentException) {
            return call.reject("health request invalid", e)
        }
        when (request) {
            HealthRequest.Status -> answer(call) { status() }
            is HealthRequest.Authorize -> authorize(call, request.scope)
            is HealthRequest.Apply -> answer(call) { apply(request.objects) }
            is HealthRequest.ReadWeighings -> answer(call) { readWeighings(request.anchor, request.since) }
        }
    }

    private fun answer(call: PluginCall, work: suspend () -> JSObject) {
        scope.launch {
            try {
                call.resolve(work())
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                call.reject("health unavailable", e)
            }
        }
    }

    // Built in on Android 14 and later; on 9 to 13 only once its app is installed and current.
    private fun available() = HealthConnectClient.getSdkStatus(plugin.context) == HealthConnectClient.SDK_AVAILABLE

    // Write access per type.
    private suspend fun status(): JSObject {
        if (!available()) {
            return JSObject().put("available", false).put("workouts", "undetermined").put("weighings", "undetermined")
        }
        val granted = client.permissionController.getGrantedPermissions()
        // Both scopes ask for the write set, so either one counts as asked.
        val wasAsked = asked.get(ASKED_WRITE) != null || asked.get(ASKED_IMPORT) != null
        return JSObject()
            .put("available", true)
            .put("workouts", HealthRules.access(HealthRules.WRITE_EXERCISE in granted, wasAsked))
            .put("weighings", HealthRules.access(HealthRules.WRITE_WEIGHT in granted, wasAsked))
    }

    // Health Connect's permission screen, then the status it leaves. One screen at a time: a second
    // request while one is open is refused, and the page asks again from its switch.
    private fun authorize(call: PluginCall, scopeName: String) {
        val launcher = permissions
        if (!available() || launcher == null) return answer(call) { status() }
        if (waiting != null) return call.reject("health unavailable")
        try {
            asked.put(if (scopeName == "import") ASKED_IMPORT else ASKED_WRITE, "1")
            waiting = call
            launcher.launch(HealthRules.requested(scopeName))
        } catch (e: Exception) {
            waiting = null
            call.reject("health unavailable", e)
        }
    }

    private suspend fun apply(objects: List<HealthObject>): JSObject {
        val outcomes = try {
            val granted = client.permissionController.getGrantedPermissions()
            objects.map { applyOne(it, granted) }
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            List(objects.size) { HealthRules.outcomeOf(e) }
        }
        return JSObject().put("outcomes", JSArray(outcomes))
    }

    // One record per call, so each object gets its own outcome. Health Connect replaces a record
    // with the same client record id only for a greater version, so an equal one changes nothing.
    private suspend fun applyOne(o: HealthObject, granted: Set<String>): String =
        try {
            when (o) {
                is HealthObject.Workout -> when {
                    HealthRules.WRITE_EXERCISE !in granted -> "denied"
                    HealthRules.READ_EXERCISE in granted && overlapped(o) -> "overlap"
                    else -> {
                        client.insertRecords(listOf(session(o)))
                        "written"
                    }
                }
                is HealthObject.WorkoutRemoved -> if (HealthRules.WRITE_EXERCISE !in granted) "denied" else {
                    delete(ExerciseSessionRecord::class, HealthRules.sessionId(o.id))
                    "removed"
                }
                is HealthObject.Weighing -> if (HealthRules.WRITE_WEIGHT !in granted) "denied" else {
                    client.insertRecords(listOf(weight(o)))
                    "written"
                }
                is HealthObject.WeighingRemoved -> if (HealthRules.WRITE_WEIGHT !in granted) "denied" else {
                    delete(WeightRecord::class, HealthRules.weighingId(o.owner, o.date))
                    "removed"
                }
            }
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            HealthRules.outcomeOf(e)
        }

    private fun offsetAt(instant: Instant): ZoneOffset = ZoneId.systemDefault().rules.getOffset(instant)

    // The session's start and end and nothing measured, no title: run live in the app on this phone.
    private fun session(w: HealthObject.Workout): ExerciseSessionRecord {
        val start = Instant.ofEpochMilli(w.startedAt)
        val end = Instant.ofEpochMilli(w.endedAt)
        return ExerciseSessionRecord(
            startTime = start,
            startZoneOffset = offsetAt(start),
            endTime = end,
            endZoneOffset = offsetAt(end),
            metadata = Metadata.activelyRecorded(
                Device(type = Device.TYPE_PHONE),
                HealthRules.sessionId(w.id),
                w.version,
            ),
            exerciseType = ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING,
        )
    }

    // A weigh-in is typed by the person: a manual entry.
    private fun weight(w: HealthObject.Weighing): WeightRecord {
        val at = Instant.ofEpochMilli(w.at)
        return WeightRecord(
            time = at,
            zoneOffset = offsetAt(at),
            weight = Mass.kilograms(w.kg),
            metadata = Metadata.manualEntry(HealthRules.weighingId(w.owner, w.date), w.version),
        )
    }

    // Health Connect lets an app delete only what it wrote, and the client record id is Belay's.
    // Nothing left to delete (the person already removed it) succeeds, and the page reads removed.
    private suspend fun delete(type: KClass<out Record>, clientRecordId: String) =
        client.deleteRecords(type, emptyList(), listOf(clientRecordId))

    // Another app's session covering half of this one or more. Called only with the read grant; a
    // failed read answers as an empty Health Connect, and the session is then written.
    private suspend fun overlapped(w: HealthObject.Workout): Boolean {
        val span = TimeRangeFilter.between(Instant.ofEpochMilli(w.startedAt), Instant.ofEpochMilli(w.endedAt))
        val others = try {
            readAll(ExerciseSessionRecord::class, span)
                .filter { it.metadata.dataOrigin.packageName != plugin.context.packageName }
                .map { it.startTime.toEpochMilli() to it.endTime.toEpochMilli() }
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            emptyList()
        }
        return HealthRules.covers(w.startedAt, w.endedAt, others)
    }

    private suspend fun <T : Record> readAll(type: KClass<T>, range: TimeRangeFilter): List<T> {
        val records = mutableListOf<T>()
        var page: String? = null
        do {
            val response = client.readRecords(ReadRecordsRequest(type, range, pageToken = page))
            records += response.records
            page = response.pageToken
        } while (!page.isNullOrEmpty())
        return records
    }

    // Weight records from `since` that Health Connect received after the anchor, Belay's own left
    // out. Deletions are not followed: a weigh-in once in Belay stays the person's there. With no
    // anchor, or an expired one, everything from `since` is read again; the token is taken first,
    // so a record written during the read comes back next time rather than never.
    private suspend fun readWeighings(anchor: String?, since: Long): JSObject {
        val records = mutableListOf<WeightRecord>()
        var next = anchor?.let { changesAfter(it, records) }
        if (next == null) {
            records.clear()
            next = client.getChangesToken(ChangesTokenRequest(setOf(WeightRecord::class)))
            records += readAll(WeightRecord::class, TimeRangeFilter.after(Instant.ofEpochMilli(since)))
        }
        val ours = plugin.context.packageName
        val samples = JSArray()
        records
            .filter { it.time.toEpochMilli() >= since }
            .filterNot { HealthRules.isOwn(it.metadata.dataOrigin.packageName, ours, it.metadata.clientRecordId) }
            .forEach {
                samples.put(JSObject().put("startedAt", it.time.toEpochMilli()).put("kg", it.weight.inKilograms))
            }
        return JSObject().put("samples", samples).put("anchor", next)
    }

    // The weight records added or changed after the token, until none is left; null once the token
    // expired.
    private suspend fun changesAfter(token: String, into: MutableList<WeightRecord>): String? {
        var current = token
        do {
            val response = client.getChanges(current)
            if (response.changesTokenExpired) return null
            response.changes.filterIsInstance<UpsertionChange>().mapNotNullTo(into) { it.record as? WeightRecord }
            current = response.nextChangesToken
        } while (response.hasMore)
        return current
    }

    private companion object {
        const val ASKED_WRITE = "asked.write"
        const val ASKED_IMPORT = "asked.import"
    }
}
