package mx.com.iguzman.dictaflow

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import java.io.File
import java.io.RandomAccessFile
import kotlin.math.sqrt

/**
 * Estado compartido entre el plugin de Tauri y el servicio de captura. El servicio corre en el
 * mismo proceso, así que el plugin solo tiene que dejar aquí sus callbacks.
 */
object CapturaAudio {
  /** Bloque PCM 16 bits mono a 16 kHz, ya empaquetado en little-endian. */
  @Volatile var alFragmento: ((ByteArray) -> Unit)? = null
  /** Resultado del arranque: null si el micrófono ya está grabando, o el error. */
  @Volatile var alIniciado: ((String?) -> Unit)? = null
  /** Ruta del WAV (o null si no se pidió) y duración en ms, al terminar. */
  @Volatile var alTerminar: ((String?, Long) -> Unit)? = null
  /** Se detuvo la captura (también desde la notificación): la interfaz debe dejar de grabar. */
  @Volatile var alDetenido: ((String?, Long) -> Unit)? = null
  @Volatile var grabando = false
  @Volatile var rutaWav: String? = null
  @Volatile var duracionMs: Long = 0
}

/**
 * Graba el micrófono en segundo plano mientras la app está en primer plano o con la pantalla
 * apagada. Es el sustituto nativo del micrófono del WebView: menos mensajes, menos CPU y el audio
 * de una reunión queda en un WAV propio aunque la interfaz se pause.
 */
class CapturaService : Service() {
  companion object {
    const val ACCION_INICIAR = "mx.com.iguzman.dictaflow.CAPTURA_INICIAR"
    const val ACCION_PARAR = "mx.com.iguzman.dictaflow.CAPTURA_PARAR"
    const val EXTRA_WAV = "wav"
    const val EXTRA_SESION = "sesion"
    const val EXTRA_DESCARTAR = "descartar"
    private const val CANAL = "dictaflow_captura"
    private const val NOTIFICACION = 4101
    private const val FRECUENCIA = 16000
    private const val MUESTRAS_BLOQUE = 1600 // 100 ms
  }

  private val main = Handler(Looper.getMainLooper())
  private var hilo: Thread? = null
  private var wav: RandomAccessFile? = null
  private var wavBytes = 0L
  private var rutaWav: String? = null
  private var descartar = false
  private var terminado = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val nm = getSystemService(NotificationManager::class.java)
      nm?.createNotificationChannel(NotificationChannel(CANAL, "Grabación", NotificationManager.IMPORTANCE_LOW))
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACCION_PARAR) {
      descartar = intent.getBooleanExtra(EXTRA_DESCARTAR, false)
      parar()
      return START_NOT_STICKY
    }
    if (CapturaAudio.grabando) return START_NOT_STICKY

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICACION, notificacion(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      } else {
        startForeground(NOTIFICACION, notificacion())
      }
    } catch (e: Exception) {
      main.post { CapturaAudio.alIniciado?.invoke("El sistema no permitió el servicio de micrófono: ${e.message}") }
      stopSelf()
      return START_NOT_STICKY
    }

    if (intent?.getBooleanExtra(EXTRA_WAV, false) == true) {
      try {
        val sesion = limpiarSesion(intent.getStringExtra(EXTRA_SESION))
        val carpeta = File(filesDir, "archivos/capturas").apply { mkdirs() }
        rutaWav = File(carpeta, "$sesion.wav").absolutePath
        abrirWav(rutaWav!!)
      } catch (_: Exception) {
        // Sin WAV se puede seguir transcribiendo; no se pierde el dictado.
        rutaWav = null
        wav = null
      }
    }
    CapturaAudio.rutaWav = rutaWav
    CapturaAudio.duracionMs = 0
    CapturaAudio.grabando = true
    terminado = false
    hilo = Thread { capturar() }.also { it.start() }
    return START_NOT_STICKY
  }

  private fun notificacion(): android.app.Notification {
    val detener = PendingIntent.getService(
      this, 1,
      Intent(this, CapturaService::class.java).apply { action = ACCION_PARAR },
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    return NotificationCompat.Builder(this, CANAL)
      .setContentTitle("DictaFlow está escuchando")
      .setContentText("Grabando audio para transcribir")
      .setSmallIcon(R.mipmap.ic_launcher)
      .setOngoing(true)
      .addAction(android.R.drawable.ic_delete, "Detener", detener)
      .setContentIntent(
        PendingIntent.getActivity(
          this, 0, Intent(this, MainActivity::class.java),
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
      )
      .build()
  }

  private fun capturar() {
    val minimo = AudioRecord.getMinBufferSize(
      FRECUENCIA, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
    )
    val tamano = maxOf(minimo, MUESTRAS_BLOQUE * 2 * 2)
    fun abrir(origen: Int): AudioRecord? = try {
      AudioRecord(
        origen,
        FRECUENCIA,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        tamano
      ).takeIf { it.state == AudioRecord.STATE_INITIALIZED }
    } catch (_: Exception) {
      null
    }

    // VOICE_RECOGNITION desactiva AGC y está pensado para STT; si el teléfono no lo admite, MIC.
    val grabador = abrir(MediaRecorder.AudioSource.VOICE_RECOGNITION)
      ?: abrir(MediaRecorder.AudioSource.MIC)

    if (grabador == null) {
      main.post { CapturaAudio.alIniciado?.invoke("No se pudo abrir el micrófono del teléfono.") }
      terminar()
      return
    }

    try {
      grabador.startRecording()
      main.post { CapturaAudio.alIniciado?.invoke(null) }
      val muestras = ShortArray(MUESTRAS_BLOQUE)
      while (CapturaAudio.grabando) {
        val n = grabador.read(muestras, 0, muestras.size)
        if (n <= 0) {
          if (n < 0) break
          continue
        }
        val bytes = ByteArray(n * 2)
        var suma = 0.0
        for (i in 0 until n) {
          val v = muestras[i].toInt()
          bytes[i * 2] = (v and 0xFF).toByte()
          bytes[i * 2 + 1] = ((v shr 8) and 0xFF).toByte()
          suma += (v / 32768.0) * (v / 32768.0)
        }
        wav?.write(bytes)
        wavBytes += bytes.size.toLong()
        // El nivel no se usa aquí: el segmentador de la interfaz lo calcula del PCM.
        CapturaAudio.alFragmento?.invoke(bytes)
      }
    } catch (e: Exception) {
      // El micrófono puede desaparecer (llamada, otro cliente): se cierra y se avisa al terminar.
      main.post { CapturaAudio.alIniciado?.invoke("El micrófono se detuvo: ${e.message}") }
    } finally {
      try {
        grabador.stop()
      } catch (_: Exception) {
        // Ya estaba parado.
      }
      grabador.release()
      terminar()
    }
  }

  private fun parar() {
    CapturaAudio.grabando = false
    if (hilo == null) terminar()
  }

  /** Cierra el WAV y avisa al plugin; se ejecuta una sola vez al final del hilo o si no arrancó. */
  private fun terminar() {
    if (terminado) return
    terminado = true
    hilo = null
    CapturaAudio.grabando = false
    cerrarWav()
    val ruta = if (descartar) {
      rutaWav?.let { File(it).delete() }
      null
    } else {
      rutaWav
    }
    CapturaAudio.rutaWav = ruta
    CapturaAudio.duracionMs = wavBytes * 1000L / (FRECUENCIA * 2L)
    val duracion = CapturaAudio.duracionMs
    main.post {
      CapturaAudio.alTerminar?.invoke(ruta, duracion)
      CapturaAudio.alDetenido?.invoke(ruta, duracion)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        stopForeground(STOP_FOREGROUND_REMOVE)
      } else {
        @Suppress("DEPRECATION")
        stopForeground(true)
      }
      stopSelf()
    }
  }

  private fun abrirWav(ruta: String) {
    val out = RandomAccessFile(ruta, "rw")
    out.setLength(0)
    out.write(ByteArray(44))
    wavBytes = 0
    wav = out
  }

  private fun cerrarWav() {
    val out = wav ?: return
    val datos = wavBytes.toInt()
    try {
      out.seek(0)
      out.write("RIFF".toByteArray(Charsets.US_ASCII))
      out.write(intLE(36 + datos))
      out.write("WAVEfmt ".toByteArray(Charsets.US_ASCII))
      out.write(intLE(16))
      out.write(shortLE(1)) // PCM
      out.write(shortLE(1)) // mono
      out.write(intLE(FRECUENCIA))
      out.write(intLE(FRECUENCIA * 2))
      out.write(shortLE(2)) // alineación de bloque
      out.write(shortLE(16))
      out.write("data".toByteArray(Charsets.US_ASCII))
      out.write(intLE(datos))
    } catch (_: Exception) {
      // Si el archivo no se puede finalizar, se conserva lo que haya; el SHA no aplica aquí.
    } finally {
      try {
        out.close()
      } catch (_: Exception) {
        // Nada más que hacer.
      }
      wav = null
    }
  }

  private fun intLE(v: Int): ByteArray = byteArrayOf(
    (v and 0xFF).toByte(),
    ((v ushr 8) and 0xFF).toByte(),
    ((v ushr 16) and 0xFF).toByte(),
    ((v ushr 24) and 0xFF).toByte()
  )

  private fun shortLE(v: Int): ByteArray = byteArrayOf((v and 0xFF).toByte(), ((v ushr 8) and 0xFF).toByte())

  private fun limpiarSesion(sesion: String?): String {
    val limpio = sesion.orEmpty().filter { it.isLetterOrDigit() || it == '-' || it == '_' }
    return if (limpio.length >= 8) limpio.take(80) else "reunion-${System.currentTimeMillis()}"
  }

  override fun onDestroy() {
    CapturaAudio.grabando = false
    super.onDestroy()
  }
}
