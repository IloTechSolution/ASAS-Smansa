package id.sch.sman1gorontalo.seb

import android.app.ActivityManager
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.WindowManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    companion object {
        private const val CHANNEL = "id.sch.sman1gorontalo.seb/kiosk"
        private const val LIFECYCLE_CHANNEL = "id.sch.sman1gorontalo.seb/lifecycle"
        private const val ALARM_MS = 4500L
        private const val ALARM_COOLDOWN_MS = 1500L
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var ringtone: Ringtone? = null
    private var lastAlarmAt = 0L
    private var flutterEngineRef: FlutterEngine? = null

    /** Jendela waktu saat alarm & flag "keluar aplikasi" diabaikan (mis. dialog
     * konfirmasi screen pinning). Diset lewat MethodChannel `suppressAlarm`. */
    @Volatile
    private var suppressAlarmUntil = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        // Kiosk: layar tetap menyala + screenshot/thumbnail Recents diblokir.
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        super.onCreate(savedInstanceState)
    }

    override fun onUserLeaveHint() {
        // Pengguna menekan Home/Recents/Overview — bunyikan alarm segera,
        // tanpa menunggu Flutter/WebView sempat bereaksi.
        if (!alarmSuppressed()) playAlarm()
        super.onUserLeaveHint()
    }

    // onPause selalu terpanggil (Home, Recents, power, dialog sistem) — sinyal
    // paling andal untuk "siswa meninggalkan aplikasi".
    override fun onPause() {
        if (!alarmSuppressed()) playAlarm()
        notifyFlutter("paused")
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        notifyFlutter("resumed")
    }

    private fun alarmSuppressed(): Boolean = System.currentTimeMillis() < suppressAlarmUntil

    private fun notifyFlutter(event: String) {
        try {
            val engine = flutterEngineRef ?: return
            MethodChannel(engine.dartExecutor.binaryMessenger, LIFECYCLE_CHANNEL)
                .invokeMethod(event, null)
        } catch (_: Throwable) {
            // Flutter belum siap — abaikan.
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        flutterEngineRef = flutterEngine
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "startLockTask" -> {
                    startScreenPinning()
                    result.success(true)
                }
                "stopLockTask" -> {
                    stopScreenPinning()
                    result.success(true)
                }
                "isInLockTaskMode" -> result.success(isScreenPinned())
                "playAlarm" -> {
                    playAlarm()
                    result.success(true)
                }
                "maximizeAlarmVolume" -> {
                    val ok = try {
                        val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
                        val max = audio.getStreamMaxVolume(AudioManager.STREAM_ALARM)
                        audio.setStreamVolume(AudioManager.STREAM_ALARM, max, 0)
                        true
                    } catch (_: Throwable) {
                        false
                    }
                    result.success(ok)
                }
                "suppressAlarm" -> {
                    suppressAlarmUntil = (call.argument<Number>("until")?.toLong() ?: 0L)
                    result.success(true)
                }
                else -> result.notImplemented()
            }
        }
    }

    /** Screen pinning BYOD: Home/Recents/notifikasi terkunci sampai siswa membuka
     * kunci (Back+Recents, hanya bisa dilepas dengan PIN layar bila perangkat diset).
     * Pertama kali, Android menampilkan dialog konfirmasi "Pin app?". */
    private fun startScreenPinning() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return
        try {
            startLockTask()
        } catch (_: Throwable) {
            // OS/OEM menolak pinning — aplikasi tetap berjalan immersive fullscreen.
        }
    }

    private fun stopScreenPinning() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return
        try {
            stopLockTask()
        } catch (_: Throwable) {
        }
    }

    private fun isScreenPinned(): Boolean {
        return try {
            val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            @Suppress("DEPRECATION")
            am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE
        } catch (_: Throwable) {
            false
        }
    }

    private fun playAlarm() {
        val now = System.currentTimeMillis()
        if (now - lastAlarmAt < ALARM_COOLDOWN_MS) return
        lastAlarmAt = now
        vibrateAlarm()
        try {
            val alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            ringtone?.stop()
            ringtone = RingtoneManager.getRingtone(this, alarmUri)?.apply {
                // Stream ALARM mengabaikan mode senyap — siswa tidak bisa mematikan
                // "bunyi pelanggaran" lewat tombol volume/silent.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    audioAttributes = AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                } else {
                    @Suppress("DEPRECATION")
                    setStreamType(AudioManager.STREAM_ALARM)
                }
                play()
            }
            mainHandler.postDelayed({ ringtone?.stop() }, ALARM_MS)
        } catch (_: Throwable) {
            try {
                val tone = ToneGenerator(AudioManager.STREAM_ALARM, ToneGenerator.MAX_VOLUME)
                tone.startTone(ToneGenerator.TONE_CDMA_EMERGENCY_RINGBACK, 1500)
                mainHandler.postDelayed({ tone.release() }, 1600)
            } catch (_: Throwable) {
            }
        }
    }

    private fun vibrateAlarm() {
        try {
            val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }
            val pattern = longArrayOf(0, 600, 200, 600, 200, 900)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createWaveform(pattern, -1))
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(pattern, -1)
            }
        } catch (_: Throwable) {
        }
    }

    override fun onDestroy() {
        ringtone?.stop()
        mainHandler.removeCallbacksAndMessages(null)
        flutterEngineRef = null
        super.onDestroy()
    }
}
