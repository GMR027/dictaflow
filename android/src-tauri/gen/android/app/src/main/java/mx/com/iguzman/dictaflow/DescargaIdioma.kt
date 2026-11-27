package mx.com.iguzman.dictaflow

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.speech.ModelDownloadListener
import android.speech.SpeechRecognizer
import androidx.annotation.RequiresApi

/**
 * Descarga del paquete de idioma con progreso real (Android 14+).
 *
 * `onScheduled` significa que Android la hará más tarde: la interfaz sigue con Whisper para no
 * dejar al usuario esperando delante de una barra que no avanza.
 */
@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
object DescargaIdioma {
  fun iniciar(
    activity: Activity,
    intent: Intent,
    progreso: (Int) -> Unit,
    done: (String, String?) -> Unit
  ) {
    val rec = try {
      SpeechRecognizer.createOnDeviceSpeechRecognizer(activity)
    } catch (e: Exception) {
      done("error", e.message)
      return
    }
    val main = Handler(Looper.getMainLooper())
    var terminado = false

    fun terminar(estado: String, mensaje: String?) {
      if (terminado) return
      terminado = true
      main.removeCallbacksAndMessages(null)
      try {
        rec.destroy()
      } catch (_: Exception) {
        // El reconocedor ya estaba cerrado.
      }
      done(estado, mensaje)
    }

    // Si el servicio no responde, la ventana no se queda colgada para siempre.
    val limite = Runnable { terminar("error", "Android no respondió a la descarga del idioma.") }
    main.postDelayed(limite, 10 * 60 * 1000L)

    try {
      rec.triggerModelDownload(intent, activity.mainExecutor, object : ModelDownloadListener {
        override fun onProgress(completedPercent: Int) {
          if (!terminado) progreso(completedPercent.coerceIn(0, 100))
        }

        override fun onSuccess() {
          terminar("done", null)
        }

        override fun onScheduled() {
          terminar("scheduled", null)
        }

        override fun onError(error: Int) {
          terminar("error", mensajeError(error))
        }
      })
    } catch (e: Exception) {
      terminar("error", e.message)
    }
  }

  private fun mensajeError(error: Int): String = when (error) {
    SpeechRecognizer.ERROR_NETWORK -> "No hay conexión para descargar el idioma."
    SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "La descarga del idioma tardó demasiado."
    SpeechRecognizer.ERROR_SERVER -> "Android no pudo descargar el idioma."
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Falta el permiso del micrófono."
    SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED -> "El idioma no está disponible en este teléfono."
    SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "Android no pudo preparar el idioma."
    else -> "Android no pudo descargar el idioma ($error)."
  }
}
