package mx.com.iguzman.dictaflow

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.Locale

@InvokeArg
class ReconocerArgs {
  lateinit var lang: String
  var continuo: Boolean = true
  var offline: Boolean = true
  var bias: List<String> = emptyList()
}

@InvokeArg
class IdiomaArgs {
  lateinit var lang: String
}

/**
 * Voz → texto con el motor del propio teléfono.
 *
 * En Android 12+ se usa el reconocedor **on-device** (`createOnDeviceSpeechRecognizer`): no sale
 * audio del teléfono y la respuesta llega en décimas de segundo. Si el teléfono no tiene ese motor
 * o le falta el paquete de idioma, la interfaz cae a Whisper (local).
 *
 * El reconocedor no está pensado para sesiones eternas: en modo continuo se reinicia al cerrar
 * cada frase. Los resultados parciales se emiten como eventos (`parcial`, `final`, `nivel`,
 * `estado`, `error`) que la interfaz escucha con `addPluginListener`.
 */
@TauriPlugin
class ReconocimientoPlugin(private val activity: Activity) : Plugin(activity) {
  private val main = Handler(Looper.getMainLooper())
  private var recognizer: SpeechRecognizer? = null
  private var continuo = false
  private var offline = true
  private var idioma = "es-ES"
  private var bias: List<String> = emptyList()
  private var cancelado = false
  private var escuchando = false
  private var ultimoNivel = 0L
  private var invokeDetener: Invoke? = null
  private var esperaDetener: Runnable? = null

  @Command
  fun disponibilidad(invoke: Invoke) {
    activity.runOnUiThread {
      val sistema = SpeechRecognizer.isRecognitionAvailable(activity)
      val onDevice = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
        SpeechRecognizer.isOnDeviceRecognitionAvailable(activity)
      val r = JSObject()
      r.put("onDevice", onDevice)
      r.put("sistema", sistema)
      r.put("motor", if (onDevice) "on-device" else if (sistema) "sistema" else "ninguno")
      invoke.resolve(r)
    }
  }

  /**
   * ¿Está instalado el paquete de idioma del motor on-device? (Android 13+)
   * En versiones anteriores `checkable` es false y la interfaz intenta usarlo igual.
   */
  @Command
  fun idioma(invoke: Invoke) {
    val args = invoke.parseArgs(IdiomaArgs::class.java)
    activity.runOnUiThread {
      val r = JSObject()
      r.put("checkable", false)
      r.put("installed", false)
      r.put("pending", false)
      r.put("supported", false)
      r.put("downloadable", false)
      val onDevice = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
        SpeechRecognizer.isOnDeviceRecognitionAvailable(activity)
      if (!onDevice || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        invoke.resolve(r)
        return@runOnUiThread
      }
      val locale = localeDe(args.lang)
      ConsultaIdioma.estado(activity, intento(locale), baseDe(locale)) { estado ->
        if (estado != null) {
          r.put("checkable", true)
          r.put("installed", estado.installed)
          r.put("pending", estado.pending)
          r.put("supported", estado.supported)
          r.put("downloadable", true)
        }
        invoke.resolve(r)
      }
    }
  }

  /** Pide a Android que descargue el paquete de idioma (Android 13+). */
  @Command
  fun descargarIdioma(invoke: Invoke) {
    val args = invoke.parseArgs(IdiomaArgs::class.java)
    activity.runOnUiThread {
      val onDevice = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
        SpeechRecognizer.isOnDeviceRecognitionAvailable(activity)
      if (!onDevice || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        invoke.reject("Este Android no permite descargar el idioma desde la app.")
        return@runOnUiThread
      }
      val locale = localeDe(args.lang)
      val intentoIdioma = intento(locale)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        DescargaIdioma.iniciar(
          activity,
          intentoIdioma,
          { pct -> eventoDescarga("progress", pct, null) }
        ) { estado, mensaje ->
          if (estado == "error") {
            eventoDescarga("error", null, mensaje)
            invoke.reject(mensaje ?: "Android no pudo descargar el idioma.")
          } else {
            eventoDescarga(estado, null, null)
            val r = JSObject()
            r.put("state", estado)
            invoke.resolve(r)
          }
        }
      } else {
        ConsultaIdioma.pedirDescarga(activity, intentoIdioma) { ok ->
          if (ok) {
            eventoDescarga("dialog", null, null)
            val r = JSObject()
            r.put("state", "dialog")
            invoke.resolve(r)
          } else {
            invoke.reject("Android no pudo iniciar la descarga del idioma.")
          }
        }
      }
    }
  }

  @Command
  fun iniciar(invoke: Invoke) {
    val args = invoke.parseArgs(ReconocerArgs::class.java)
    activity.runOnUiThread {
      resolverDetener()
      detenerReconocedor()
      cancelado = false
      continuo = args.continuo
      offline = args.offline
      bias = args.bias
      idioma = localeDe(args.lang)

      val onDevice = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
        SpeechRecognizer.isOnDeviceRecognitionAvailable(activity)
      if (offline && !onDevice) {
        invoke.reject("Este teléfono no tiene reconocimiento de voz on-device. Se usará Whisper.")
        return@runOnUiThread
      }
      if (!offline && !SpeechRecognizer.isRecognitionAvailable(activity)) {
        invoke.reject("Este teléfono no tiene un servicio de reconocimiento de voz.")
        return@runOnUiThread
      }

      try {
        recognizer = if (offline) {
          SpeechRecognizer.createOnDeviceSpeechRecognizer(activity)
        } else {
          SpeechRecognizer.createSpeechRecognizer(activity)
        }
      } catch (e: Exception) {
        invoke.reject("No se pudo abrir el motor de voz del teléfono: ${e.message}")
        return@runOnUiThread
      }
      recognizer?.setRecognitionListener(oyente)
      try {
        recognizer?.startListening(intento())
        escuchando = true
        val r = JSObject()
        r.put("onDevice", onDevice)
        r.put("lang", idioma)
        invoke.resolve(r)
      } catch (e: Exception) {
        detenerReconocedor()
        invoke.reject("No se pudo empezar a escuchar: ${e.message}")
      }
    }
  }

  @Command
  fun detener(invoke: Invoke) {
    activity.runOnUiThread {
      continuo = false
      invokeDetener?.resolve(JSObject())
      invokeDetener = invoke
      esperaDetener?.let { main.removeCallbacks(it) }
      esperaDetener = Runnable { resolverDetener() }
      main.postDelayed(esperaDetener!!, 1500)
      if (recognizer == null || !escuchando) {
        resolverDetener()
        return@runOnUiThread
      }
      try {
        recognizer?.stopListening()
      } catch (_: Exception) {
        resolverDetener()
      }
    }
  }

  @Command
  fun cancelar(invoke: Invoke) {
    activity.runOnUiThread {
      cancelado = true
      continuo = false
      escuchando = false
      try {
        recognizer?.cancel()
      } catch (_: Exception) {
        // El reconocedor ya estaba cerrado.
      }
      detenerReconocedor()
      resolverDetener()
      invoke.resolve(JSObject())
    }
  }

  private fun intento(locale: String = idioma): Intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
    putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
    putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, activity.packageName)
    // Cierra la frase antes que el valor por defecto del motor; la pausa larga la decide el VAD
    // de la interfaz en Whisper, aquí manda el reconocedor.
    putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 700L)
    putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 500L)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      // Puntuación, mayúsculas y formato sin pasar por el LLM.
      putExtra(RecognizerIntent.EXTRA_ENABLE_FORMATTING, RecognizerIntent.FORMATTING_OPTIMIZE_LATENCY)
      if (bias.isNotEmpty()) {
        putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, ArrayList(bias.take(100)))
      }
    }
  }

  private val oyente = object : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) {
      estado("escuchando")
    }

    override fun onBeginningOfSpeech() {
      estado("hablando")
    }

    override fun onRmsChanged(rmsdB: Float) {
      val ahora = System.currentTimeMillis()
      if (ahora - ultimoNivel < 120) return
      ultimoNivel = ahora
      // El motor entrega dB aproximadamente entre -2 y 10: se normaliza para la barra de nivel.
      val nivel = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)
      val o = JSObject()
      o.put("nivel", nivel)
      trigger("nivel", o)
    }

    override fun onBufferReceived(buffer: ByteArray?) {}

    override fun onEndOfSpeech() {
      estado("procesando")
    }

    override fun onError(error: Int) {
      if (cancelado) {
        detenerReconocedor()
        resolverDetener()
        return
      }
      escuchando = false
      estado("detenido")
      val idiomaNoDisponible = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && (
        error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED ||
          error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE ||
          error == SpeechRecognizer.ERROR_CANNOT_CHECK_SUPPORT
        )
      val fatal = error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ||
        error == SpeechRecognizer.ERROR_CLIENT ||
        error == SpeechRecognizer.ERROR_AUDIO ||
        idiomaNoDisponible ||
        (offline && (error == SpeechRecognizer.ERROR_NETWORK ||
          error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT ||
          error == SpeechRecognizer.ERROR_SERVER))
      if (fatal) {
        val o = JSObject()
        o.put("codigo", error)
        o.put("mensaje", mensajeError(error))
        o.put("fatal", true)
        o.put("idioma", idiomaNoDisponible)
        trigger("error", o)
        detenerReconocedor()
        resolverDetener()
        return
      }
      // Silencio, sin coincidencia o motor ocupado: en continuo se vuelve a escuchar sin avisar.
      if (continuo) {
        val espera = if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ||
          error == SpeechRecognizer.ERROR_TOO_MANY_REQUESTS) 700L else 250L
        main.postDelayed({ if (!cancelado && continuo) iniciarEscucha() }, espera)
      } else {
        resolverDetener()
      }
    }

    override fun onPartialResults(partialResults: Bundle?) {
      val texto = mejor(partialResults)
      if (texto.isEmpty()) return
      val o = JSObject()
      o.put("texto", texto)
      trigger("parcial", o)
    }

    override fun onResults(results: Bundle?) {
      escuchando = false
      val texto = mejor(results)
      if (texto.isNotEmpty()) {
        val o = JSObject()
        o.put("texto", texto)
        trigger("final", o)
      }
      if (continuo && !cancelado) {
        estado("escuchando")
        main.postDelayed({ if (!cancelado && continuo) iniciarEscucha() }, 120)
      } else {
        estado("detenido")
        resolverDetener()
      }
    }

    override fun onEvent(eventType: Int, params: Bundle?) {}
  }

  private fun iniciarEscucha() {
    val rec = recognizer ?: return
    try {
      escuchando = true
      rec.startListening(intento())
    } catch (e: Exception) {
      val o = JSObject()
      o.put("codigo", -1)
      o.put("mensaje", "No se pudo seguir escuchando: ${e.message}")
      o.put("fatal", true)
      trigger("error", o)
      detenerReconocedor()
      resolverDetener()
    }
  }

  private fun mejor(results: Bundle?): String =
    results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()

  private fun estado(valor: String) {
    val o = JSObject()
    o.put("estado", valor)
    trigger("estado", o)
  }

  private fun eventoDescarga(estado: String, pct: Int?, mensaje: String?) {
    val o = JSObject()
    o.put("state", estado)
    if (pct != null) o.put("pct", pct)
    if (mensaje != null) o.put("message", mensaje)
    trigger("descarga", o)
  }

  private fun localeDe(lang: String): String = when (lang.lowercase(Locale.ROOT)) {
    "en" -> "en-US"
    else -> "es-ES"
  }

  private fun baseDe(locale: String): String = locale.substringBefore('-').lowercase(Locale.ROOT)

  private fun mensajeError(error: Int): String = when (error) {
    SpeechRecognizer.ERROR_AUDIO -> "No se pudo leer el micrófono."
    SpeechRecognizer.ERROR_CLIENT -> "El motor de voz del teléfono se detuvo."
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Falta el permiso del micrófono."
    SpeechRecognizer.ERROR_NETWORK -> "El motor de voz necesita conexión (no hay modelo on-device)."
    SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "El motor de voz tardó demasiado."
    SpeechRecognizer.ERROR_NO_MATCH -> "No se entendió la frase."
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "El motor de voz está ocupado."
    SpeechRecognizer.ERROR_SERVER -> "El servicio de voz del teléfono falló."
    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No se escuchó nada."
    SpeechRecognizer.ERROR_TOO_MANY_REQUESTS -> "Demasiadas peticiones al motor de voz."
    else -> when {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED ->
        "El idioma no está disponible en este teléfono."
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE ->
        "El idioma del teléfono no está preparado."
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && error == SpeechRecognizer.ERROR_CANNOT_CHECK_SUPPORT ->
        "No se pudo comprobar el idioma del teléfono."
      else -> "Error del motor de voz ($error)."
    }
  }

  private fun resolverDetener() {
    esperaDetener?.let { main.removeCallbacks(it) }
    esperaDetener = null
    val i = invokeDetener ?: return
    invokeDetener = null
    i.resolve(JSObject())
  }

  private fun detenerReconocedor() {
    try {
      recognizer?.destroy()
    } catch (_: Exception) {
      // Ya estaba destruido.
    }
    recognizer = null
    escuchando = false
    esperaDetener?.let { main.removeCallbacks(it) }
    esperaDetener = null
  }

  override fun onDestroy(activity: AppCompatActivity) {
    cancelado = true
    continuo = false
    detenerReconocedor()
    resolverDetener()
    super.onDestroy(activity)
  }
}
