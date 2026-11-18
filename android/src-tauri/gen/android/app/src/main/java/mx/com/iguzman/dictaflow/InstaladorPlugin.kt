package mx.com.iguzman.dictaflow

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class InstalarArgs {
  lateinit var ruta: String
}

/**
 * Abre el instalador de Android con el APK de una actualización que Rust ya descargó y verificó
 * (src-tauri/src/lib.rs, `instalar_actualizacion`). Solo acepta archivos de la caché de la app.
 *
 * La primera vez Android pide permitir que DictaFlow instale apps («Instalar apps desconocidas»):
 * se abre esa pantalla de Ajustes y se responde `permiso`; al volver, se toca «Actualizar» otra vez.
 */
@TauriPlugin
class InstaladorPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun instalar(invoke: Invoke) {
    val args = invoke.parseArgs(InstalarArgs::class.java)
    val archivo = File(args.ruta).canonicalFile
    val cache = activity.cacheDir.canonicalFile
    if (!archivo.path.startsWith(cache.path + File.separator) || !archivo.isFile || !archivo.name.endsWith(".apk")) {
      invoke.reject("Ese archivo no es una actualización descargada por DictaFlow.")
      return
    }
    val respuesta = JSObject()
    if (!activity.packageManager.canRequestPackageInstalls()) {
      activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
      respuesta.put("estado", "permiso")
      invoke.resolve(respuesta)
      return
    }
    val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", archivo)
    val intent = Intent(Intent.ACTION_VIEW)
      .setDataAndType(uri, "application/vnd.android.package-archive")
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    activity.startActivity(intent)
    respuesta.put("estado", "instalador")
    invoke.resolve(respuesta)
  }
}
