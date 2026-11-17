package mx.com.iguzman.dictaflow

import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Actividad principal de DictaFlow.
 *  • Android 15+ dibuja de borde a borde: la interfaz no reserva espacio para la barra de estado,
 *    la de navegación ni el teclado, así que el contenedor del WebView recibe esos márgenes.
 *  • El permiso del micrófono lo gestiona el WebView de Tauri (RustWebChromeClient): al llamar a
 *    getUserMedia, Android muestra el diálogo si RECORD_AUDIO está en el manifiesto.
 */
class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Mismos colores de fondo que la interfaz (styles.css) para que no destellen las barras.
    val oscuro = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    val raiz = findViewById<View>(android.R.id.content)
    raiz.setBackgroundColor(if (oscuro) Color.parseColor("#1f1f1f") else Color.parseColor("#f6f5f4"))
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = !oscuro
      isAppearanceLightNavigationBars = !oscuro
    }
    ViewCompat.setOnApplyWindowInsetsListener(raiz) { v, insets ->
      val b = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime() or WindowInsetsCompat.Type.displayCutout())
      v.setPadding(b.left, b.top, b.right, b.bottom)
      WindowInsetsCompat.CONSUMED
    }
    ViewCompat.requestApplyInsets(raiz)
  }
}
