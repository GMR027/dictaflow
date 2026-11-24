package mx.com.iguzman.dictaflow

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/**
 * Entrega a la interfaz la vista que pidió un atajo de la app o el texto que llegó con
 * «Compartir con DictaFlow». Se consume una sola vez.
 */
@TauriPlugin
class VistaPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun inicial(invoke: Invoke) {
    val r = JSObject()
    r.put("vista", MainActivity.vistaInicial)
    r.put("texto", MainActivity.textoCompartido)
    MainActivity.vistaInicial = null
    MainActivity.textoCompartido = null
    invoke.resolve(r)
  }
}
