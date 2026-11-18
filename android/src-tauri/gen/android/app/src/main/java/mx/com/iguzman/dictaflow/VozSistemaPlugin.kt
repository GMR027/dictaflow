package mx.com.iguzman.dictaflow

import android.app.Activity
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

@InvokeArg
class SintetizarArgs {
  lateinit var voz: String
  lateinit var texto: String
  var velocidad: Float = 1f
}

/**
 * Voces del motor de texto a voz del propio teléfono (Google, Samsung, Honor…): las que el usuario
 * ya tiene instaladas, sin descargas desde DictaFlow. Solo se ofrecen voces que funcionan sin
 * conexión. `sintetizar` escribe el audio a un WAV temporal de la caché y lo devuelve en base64.
 *
 * TextToSpeech arranca de forma asíncrona: las peticiones que llegan antes esperan en `pendientes`.
 */
@TauriPlugin
class VozSistemaPlugin(private val activity: Activity) : Plugin(activity) {
  private var tts: TextToSpeech? = null
  private var listo = false
  private var fallo: String? = null
  private val pendientes = mutableListOf<() -> Unit>()
  private val enCurso = ConcurrentHashMap<String, Pair<Invoke, File>>()

  private fun conMotor(invoke: Invoke, accion: (TextToSpeech) -> Unit) {
    synchronized(this) {
      fallo?.let { invoke.reject(it); return }
      val motor = tts
      if (motor != null && listo) { accion(motor); return }
      pendientes.add { val m = tts; if (m != null && listo) accion(m) else invoke.reject(fallo ?: "El motor de voz del teléfono no está disponible.") }
      if (motor == null) arrancar()
    }
  }

  private fun arrancar() {
    tts = TextToSpeech(activity) { estado ->
      synchronized(this) {
        if (estado == TextToSpeech.SUCCESS) {
          listo = true
          tts?.setOnUtteranceProgressListener(oyente)
        } else {
          fallo = "El teléfono no tiene un motor de texto a voz activo (Ajustes → Accesibilidad → Texto a voz)."
        }
        val cola = pendientes.toList()
        pendientes.clear()
        cola.forEach { it() }
      }
    }
  }

  private val oyente = object : UtteranceProgressListener() {
    override fun onStart(id: String) {}
    override fun onDone(id: String) {
      val (invoke, archivo) = enCurso.remove(id) ?: return
      try {
        val bytes = archivo.readBytes()
        val r = JSObject()
        r.put("wav", Base64.encodeToString(bytes, Base64.NO_WRAP))
        invoke.resolve(r)
      } catch (e: Exception) {
        invoke.reject("No se pudo leer el audio de la voz del teléfono: ${e.message}")
      } finally {
        archivo.delete()
      }
    }
    @Deprecated("Deprecated in Java")
    override fun onError(id: String) = onError(id, TextToSpeech.ERROR)
    override fun onError(id: String, codigo: Int) {
      val (invoke, archivo) = enCurso.remove(id) ?: return
      archivo.delete()
      invoke.reject(if (codigo == TextToSpeech.ERROR_NETWORK || codigo == TextToSpeech.ERROR_NETWORK_TIMEOUT)
        "Esta voz del teléfono necesita conexión." else "La voz del teléfono no pudo leer este texto (error $codigo).")
    }
  }

  private fun sinConexion(v: Voice): Boolean =
    !v.isNetworkConnectionRequired && !v.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)

  /** Voces instaladas y sin conexión, en español o inglés. */
  @Command
  fun voces(invoke: Invoke) {
    conMotor(invoke) { motor ->
      val lista = JSArray()
      val voces = try { motor.voices } catch (e: Exception) { null } ?: emptySet()
      voces.filter { (it.locale.language == "es" || it.locale.language == "en") && sinConexion(it) }
        .sortedWith(compareBy({ it.locale.toLanguageTag() }, { -it.quality }, { it.name }))
        .forEach { v ->
          val o = JSObject()
          o.put("nombre", v.name)
          o.put("idioma", v.locale.language)
          o.put("region", v.locale.country)
          o.put("etiqueta", v.locale.getDisplayName(v.locale))
          o.put("calidad", v.quality)
          lista.put(o)
        }
      val r = JSObject()
      r.put("motor", motor.defaultEngine ?: "")
      r.put("voces", lista)
      invoke.resolve(r)
    }
  }

  @Command
  fun sintetizar(invoke: Invoke) {
    val args = invoke.parseArgs(SintetizarArgs::class.java)
    conMotor(invoke) { motor ->
      val voz = (try { motor.voices } catch (e: Exception) { null })?.firstOrNull { it.name == args.voz }
      if (voz == null || !sinConexion(voz)) {
        invoke.reject("La voz «${args.voz}» ya no está instalada en el teléfono.")
        return@conMotor
      }
      motor.voice = voz
      motor.setSpeechRate(args.velocidad.coerceIn(0.5f, 2f))
      val id = UUID.randomUUID().toString()
      val archivo = File(activity.cacheDir, "voz-sistema-$id.wav")
      enCurso[id] = invoke to archivo
      val estado = motor.synthesizeToFile(args.texto.take(TextToSpeech.getMaxSpeechInputLength() - 1), Bundle(), archivo, id)
      if (estado != TextToSpeech.SUCCESS) {
        enCurso.remove(id)
        invoke.reject("La voz del teléfono no aceptó el texto.")
      }
    }
  }
}
