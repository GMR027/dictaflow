package mx.com.iguzman.dictaflow

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.SpeechRecognizer
import androidx.annotation.RequiresApi
import java.util.Locale

/** Estado de un paquete de idioma del reconocedor on-device. */
data class EstadoIdioma(
  val installed: Boolean,
  val pending: Boolean,
  val supported: Boolean
)

/**
 * Consulta y petición de descarga de paquetes de idioma (Android 13+).
 *
 * Todo lo que usa tipos nuevos del SDK vive aquí y solo se toca cuando `SDK_INT` lo permite;
 * así las versiones anteriores no cargan estas clases al abrir la app.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
object ConsultaIdioma {
  fun estado(activity: Activity, intent: Intent, base: String, done: (EstadoIdioma?) -> Unit) {
    val rec = crear(activity)
    if (rec == null) {
      done(null)
      return
    }
    val main = Handler(Looper.getMainLooper())
    var terminado = false
    fun terminar(resultado: EstadoIdioma?) {
      if (terminado) return
      terminado = true
      main.removeCallbacksAndMessages(null)
      try {
        rec.destroy()
      } catch (_: Exception) {
        // El reconocedor ya estaba cerrado.
      }
      done(resultado)
    }
    // Si el servicio no responde, la interfaz no se queda esperando: se intenta el motor igual.
    main.postDelayed({ terminar(null) }, 3000)
    try {
      rec.checkRecognitionSupport(intent, activity.mainExecutor, object : RecognitionSupportCallback {
        override fun onSupportResult(support: RecognitionSupport) {
          val instalados = support.installedOnDeviceLanguages.map(::normalizar)
          val pendientes = support.pendingOnDeviceLanguages.map(::normalizar)
          val soportados = support.supportedOnDeviceLanguages.map(::normalizar)
          terminar(
            EstadoIdioma(
              installed = instalados.any { mismoIdioma(it, base) },
              pending = pendientes.any { mismoIdioma(it, base) },
              supported = soportados.any { mismoIdioma(it, base) } || pendientes.any { mismoIdioma(it, base) }
            )
          )
        }

        override fun onError(error: Int) {
          terminar(null)
        }
      })
    } catch (_: Exception) {
      terminar(null)
    }
  }

  /**
   * Android 13 no informa del progreso: abre su propio aviso de descarga y la interfaz
   * comprueba después si el idioma ya está instalado. Se mantiene el reconocedor unos segundos
   * para que la petición llegue al servicio antes de soltarlo.
   */
  fun pedirDescarga(activity: Activity, intent: Intent, done: (Boolean) -> Unit) {
    val rec = crear(activity)
    if (rec == null) {
      done(false)
      return
    }
    try {
      rec.triggerModelDownload(intent)
      Handler(Looper.getMainLooper()).postDelayed({
        try {
          rec.destroy()
        } catch (_: Exception) {
          // El reconocedor ya estaba cerrado.
        }
      }, 2000)
      done(true)
    } catch (_: Exception) {
      try {
        rec.destroy()
      } catch (_: Exception) {
        // El reconocedor ya estaba cerrado.
      }
      done(false)
    }
  }

  private fun crear(activity: Activity): SpeechRecognizer? = try {
    SpeechRecognizer.createOnDeviceSpeechRecognizer(activity)
  } catch (_: Exception) {
    null
  }

  private fun normalizar(tag: String): String = tag.replace('_', '-').lowercase(Locale.ROOT)

  private fun mismoIdioma(tag: String, base: String): Boolean = tag == base || tag.startsWith("$base-")
}
