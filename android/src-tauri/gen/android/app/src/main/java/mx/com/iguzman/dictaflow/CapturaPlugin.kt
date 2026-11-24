package mx.com.iguzman.dictaflow

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.atomic.AtomicBoolean

@InvokeArg
class CapturaArgs {
  var wav: Boolean = false
  var sesion: String? = null
}

@InvokeArg
class PararCapturaArgs {
  var descartar: Boolean = false
}

/**
 * Micrófono nativo: `AudioRecord` en un servicio en primer plano. Sustituye el micrófono del
 * WebView (que envía un mensaje cada 8 ms) por bloques PCM de 100 ms y mantiene la grabación con
 * la pantalla apagada. Para reuniones escribe además un WAV en la carpeta privada de la app.
 */
@TauriPlugin
class CapturaPlugin(private val activity: Activity) : Plugin(activity) {
  private val main = Handler(Looper.getMainLooper())

  private fun servicio(accion: String, wav: Boolean = false, sesion: String? = null, descartar: Boolean = false): Intent =
    Intent(activity, CapturaService::class.java).apply {
      this.action = accion
      putExtra(CapturaService.EXTRA_WAV, wav)
      putExtra(CapturaService.EXTRA_SESION, sesion)
      putExtra(CapturaService.EXTRA_DESCARTAR, descartar)
    }

  @Command
  fun iniciar(invoke: Invoke) {
    val args = invoke.parseArgs(CapturaArgs::class.java)
    activity.runOnUiThread {
      if (CapturaAudio.grabando) {
        invoke.reject("Ya hay una grabación en curso.")
        return@runOnUiThread
      }
      val resuelto = AtomicBoolean(false)
      fun resolver(error: String?) {
        if (!resuelto.compareAndSet(false, true)) return
        CapturaAudio.alIniciado = null
        if (error == null) invoke.resolve(JSObject()) else invoke.reject(error)
      }
      CapturaAudio.alIniciado = { error -> resolver(error) }
      CapturaAudio.alDetenido = { ruta, ms ->
        val payload = JSObject()
        payload.put("wavPath", ruta)
        payload.put("durationSec", ms / 1000.0)
        main.post { trigger("detenido", payload) }
      }
      // Cada bloque viaja en base64: por el puente de Android un cuerpo binario sería una lista
      // JSON de bytes, mucho más lenta.
      CapturaAudio.alFragmento = { bytes ->
        val payload = JSObject()
        payload.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
        main.post { trigger("audio", payload) }
      }
      main.postDelayed({ resolver("El micrófono del teléfono no respondió.") }, 4000)
      try {
        val intent = servicio(CapturaService.ACCION_INICIAR, args.wav, args.sesion)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) activity.startForegroundService(intent) else activity.startService(intent)
      } catch (e: Exception) {
        resolver("No se pudo iniciar la captura: ${e.message}")
      }
    }
  }

  @Command
  fun detener(invoke: Invoke) {
    val args = invoke.parseArgs(PararCapturaArgs::class.java)
    activity.runOnUiThread {
      val resuelto = AtomicBoolean(false)
      fun resolver(ruta: String?, ms: Long) {
        if (!resuelto.compareAndSet(false, true)) return
        val o = JSObject()
        o.put("wavPath", ruta)
        o.put("durationSec", ms / 1000.0)
        invoke.resolve(o)
      }
      CapturaAudio.alTerminar = { ruta, ms -> resolver(ruta, ms) }
      // Red de seguridad: si el servicio no contesta, no dejar la interfaz esperando.
      main.postDelayed({ resolver(CapturaAudio.rutaWav, CapturaAudio.duracionMs) }, 3000)
      try {
        activity.startService(servicio(CapturaService.ACCION_PARAR, descartar = args.descartar))
      } catch (e: Exception) {
        resolver(CapturaAudio.rutaWav, CapturaAudio.duracionMs)
      }
    }
  }

  @Command
  fun cancelar(invoke: Invoke) {
    activity.runOnUiThread {
      CapturaAudio.alTerminar = null
      try {
        activity.startService(servicio(CapturaService.ACCION_PARAR, descartar = true))
      } catch (_: Exception) {
        // El servicio no estaba activo.
      }
      invoke.resolve(JSObject())
    }
  }

  override fun onDestroy(activity: AppCompatActivity) {
    CapturaAudio.alFragmento = null
    CapturaAudio.alTerminar = null
    CapturaAudio.alDetenido = null
    super.onDestroy(activity)
  }
}
