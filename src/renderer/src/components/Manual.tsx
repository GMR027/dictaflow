import { useState } from 'react'

interface Topic { id: string; title: string; body: JSX.Element }

const TOPICS: Topic[] = [
  {
    id: 'inicio', title: 'Primeros pasos',
    body: (<>
      <p>DictaFlow convierte tu voz en texto, lo redacta mejor con IA y te deja copiarlo o convertirlo en un prompt.</p>
      <ol>
        <li>En el asistente inicial eliges idiomas y modelos según tu equipo.</li>
        <li>En <b>Dictado</b> escoge tu micrófono y el modo de dictado.</li>
        <li>Habla, revisa la redacción y copia el resultado.</li>
      </ol>
    </>)
  },
  {
    id: 'dictado', title: 'Dictado y micrófono',
    body: (<>
      <p>Arriba eliges el micrófono; la barra muestra el nivel en vivo para comprobar que te escucha.</p>
      <h4>Parlante controlado</h4>
      <p>Pulsas <b>Pulsar para hablar</b>, hablas todo lo que quieras y pulsas <b>Detener y transcribir</b>. El micrófono solo está abierto entre esos dos clics.</p>
      <h4>Parlante activo</h4>
      <p>El micrófono queda abierto hasta que lo desactives. Cada pausa de casi un segundo cierra una frase y se transcribe sola. Desactívalo siempre al terminar.</p>
      <p className="muted">El texto de la sección 1 es editable: corrige errores antes de redactar.</p>
    </>)
  },
  {
    id: 'redaccion', title: 'Redacción con IA y botones',
    body: (<>
      <ul>
        <li><b>Tono:</b> neutro, formal, cercano o conciso.</li>
        <li><b>Automático:</b> redacta solo tras unos segundos sin dictar. Si lo apagas, usa «Redactar con IA».</li>
        <li><b>🔄 Rehacer:</b> pide otra versión distinta de la actual.</li>
        <li><b>💻 Convertir en prompt:</b> lo transforma en un prompt de programación (Objetivo, Contexto, Requisitos…). No inventa datos que no dijiste.</li>
        <li><b>🛠 Instrucciones de cambio:</b> para pedirle modificaciones a una IA sobre un proyecto que ya existe. Genera una lista numerada de cambios concretos (y qué no tocar), sin Objetivo ni Criterios.</li>
        <li><b>📋 Copiar:</b> copia la redacción (o la transcripción si aún no hay).</li>
        <li><b>🗑 Eliminar:</b> borra ambas secciones; puedes pulsar «Deshacer» unos segundos.</li>
      </ul>
    </>)
  },
  {
    id: 'proveedores', title: 'Cuentas y modelos de IA',
    body: (<>
      <p>En <b>Ajustes → Cuentas y servicios</b> eliges quién redacta:</p>
      <ul>
        <li><b>Ollama:</b> modelo local, privado y gratuito. Si no lo tienes, el botón <b>Instalar Ollama</b> (en el asistente y en Ajustes) lo instala con el instalador oficial; antes te muestra el comando y el sistema te pide tu contraseña. Si ya está instalado pero parado, aparece <b>Iniciar Ollama</b>.</li>
        <li><b>Claude (API key):</b> tu clave se guarda cifrada con el llavero del sistema.</li>
        <li><b>Claude CLI / opencode:</b> usan las herramientas ya instaladas e iniciadas en tu equipo; Claude CLI se ejecuta sin acceso a archivos. DictaFlow detecta el CLI aunque esté en <code>~/.opencode/bin</code> y muestra la lista de modelos que opencode tenga disponibles para elegir uno.</li>
        <li><b>Compatible con OpenAI:</b> LM Studio, OpenRouter u otro servidor.</li>
      </ul>
      <p>Usa «Probar conexión» tras configurar. La voz a texto siempre es local.</p>
    </>)
  },
  {
    id: 'cualquier-app', title: 'Dictar en cualquier app',
    body: (<>
      <p>Con un atajo de GNOME (instrucciones en Ajustes) dictas sin abrir la ventana: pulsas el atajo, hablas, lo pulsas otra vez y el texto redactado queda en el portapapeles. Una píldora flotante indica el estado y llega una notificación. Pega con <b>Ctrl+V</b>.</p>
      <p className="muted">No se escribe solo en la otra app a propósito: en Wayland eso exigiría un permiso que permitiría a cualquier programa simular tu teclado.</p>
    </>)
  },
  {
    id: 'programador', title: 'Modo programador',
    body: (<>
      <p>En <b>Dictado → 💻 Modo programador</b> eliges el destino del prompt (Claude Code, opencode, Cursor, ChatGPT o genérico) y una carpeta de proyecto.</p>
      <ul>
        <li>«Convertir en prompt» lee la estructura del proyecto, el README, el CLAUDE.md y las dependencias, y menciona rutas y tecnologías reales. No inventa archivos.</li>
        <li><b>▶ Enviar a Claude Code / opencode</b> abre una terminal en el proyecto con tu prompt. Antes te pide confirmación, porque esos agentes pueden modificar archivos.</li>
      </ul>
    </>)
  },
  {
    id: 'prompts', title: 'Biblioteca de prompts y Prompt Architect',
    body: (<>
      <p>Guarda tus mejores prompts con <b>💾 Guardar prompt</b> (o di «guarda este prompt»). En <b>Prompts</b> puedes buscarlos, ponerles etiquetas y valorarlos con 👍/👎.</p>
      <p>El agente <b>Prompt Architect</b> te ayuda a escribir uno nuevo basándose en los tuyos: marca referencias con ☑ (o deja que elija las 4 más relevantes), habla o escribe qué necesitas y refínalo conversando. Atajos: <b>Fusionar</b>, <b>Crítica</b> y <b>Plantilla</b> (extrae variables {'{{así}}'}).</p>
    </>)
  },
  {
    id: 'voz', title: 'Comandos de voz y diccionario',
    body: (<>
      <p>Con los comandos activos, una frase que sea exactamente un comando se ejecuta en vez de escribirse: «borra eso», «nuevo párrafo», «nueva línea», «copia», «rehaz», «redacta», «hazlo más formal / corto / casual», «conviértelo en prompt», «instrucciones de cambio», «guarda este prompt», «pausa». Puedes anteponer «Flow».</p>
      <p>El <b>diccionario personal</b> (Ajustes) corrige términos que Whisper escribe mal y se los indica a la IA. Importa listas desde .txt o .csv («transcribe,escribir»).</p>
    </>)
  },
  {
    id: 'audio', title: 'Audio: voz ↔ texto',
    body: (<>
      <h4>🎧 Voz → Texto</h4>
      <p>Arrastra un archivo (mp3, wav, ogg, flac, m4a, webm…) o graba con el micrófono. Transcribe con marcas de tiempo y exporta .txt, .srt o .vtt. <b>💾 Guardar audio</b> conserva el audio original.</p>
      <p>Con IA puedes generar resumen, capítulos con tiempos, post para redes, notas o apuntes de estudio, y traducir.</p>
      <h4>🔊 Texto → Voz</h4>
      <p>Escribe o pega texto, elige idioma, voz y velocidad, escucha y descarga en <b>WAV o MP3</b>. La voz local (Piper) se descarga una vez desde la propia pantalla; también puedes usar un servicio en la nube en Ajustes → Audio.</p>
    </>)
  },
  {
    id: 'lector', title: 'Lector de PDF y EPUB',
    body: (<>
      <p>Añade PDF, EPUB, TXT o MD. El lector muestra el texto por capítulos, con tamaño ajustable y progreso guardado.</p>
      <ul>
        <li><b>▶ Leer en voz alta</b> resalta cada párrafo mientras suena. Haz clic en uno para empezar desde ahí.</li>
        <li><b>Exportar a MP3</b>: un capítulo o el libro completo (audiolibro).</li>
        <li>Con IA: resumir capítulo, traducir un párrafo o preguntar sobre el contenido.</li>
      </ul>
      <p className="muted">Los PDF escaneados (solo imágenes) aún no se pueden leer: necesitarían OCR.</p>
    </>)
  },
  {
    id: 'reuniones', title: 'Reuniones y clases',
    body: (<>
      <p>Transcribe en directo desde tu micrófono, el <b>audio del sistema</b> (lo que suena en Meet, Zoom o YouTube) o ambos. Con «Ambos» las frases se etiquetan «Yo» y «Sistema»; usa auriculares para evitar eco. El audio se guarda para poder volver a transcribirlo.</p>
      <p>Al terminar se guarda con marcas de tiempo. <b>📋 Generar acta</b> pide a la IA un acta con las partes separadas: <b>resumen ejecutivo</b>, temas tratados, decisiones, acuerdos y <b>tareas con responsable y fecha</b>. Las tareas se pueden marcar como hechas. También puedes generar apuntes de clase, exportar a notas, a PDF o a .srt y buscar frases en todas tus reuniones.</p>
      <p className="muted">Lo que <b>no</b> hay todavía: distinguir hablantes dentro de la misma fuente (diarización automática). Ahora solo se separan por origen. Puedes <b>renombrar a quien habla</b> con un clic sobre su nombre, y esa atribución queda guardada como tuya.</p>
    </>)
  },
  {
    id: 'agenda', title: 'Agenda y recordatorios',
    body: (<>
      <p>En <b>🗓 Agenda</b> creates eventos con título, fecha, duración y descripción. Puedes exportarlos a un archivo <b>.ics</b> (que entienden Google Calendar, Thunderbird, GNOME Calendar u Outlook) e importar los que ya tengas.</p>
      <p>Los <b>recordatorios</b> son avisos locales: suena una notificación del sistema cuando toca, sin salir de tu equipo. Funcionan aunque la ventana esté cerrada.</p>
    </>)
  },
  {
    id: 'voces', title: 'Mis voces',
    body: (<>
      <p><b>🎙 Mis voces</b> reúne tus grabaciones originales, las voces que creas con ellas, los audios que generes y las frases de prueba.</p>
      <p><b>El consentimiento es obligatorio</b>: al guardar una voz se anota quién autoriza el uso y cuándo, y ese dato se guarda con la voz y va en las copias de seguridad. No se clonan voces de terceros.</p>
      <p className="muted">Cada voz puede usar una <b>voz local de Piper</b> (funciona sin conexión y sin descargar nada más) o un <b>servicio local de clonación</b> que tengas en marcha (por defecto <code>http://127.0.0.1:8020</code>). Esta versión no incluye un motor de clonación: los que existen ocupan entre 2 y 3 GB y algunos, como XTTS-v2, no se pueden usar comercialmente.</p>
    </>)
  },
  {
    id: 'automatizaciones', title: 'Automatizaciones',
    body: (<>
      <p>En <b>⚙ Automatizaciones</b> guardas secuencias de pasos y las vuelves a ejecutar cuando quieras: <b>resumir</b>, <b>convertir en notas</b>, <b>generar acta</b>, <b>guardar como PDF</b>, <b>guardar como nota</b>, <b>crear evento</b> o <b>leer en voz alta</b>.</p>
      <p>Los pasos con IA se encadenan: el resultado de uno es la entrada del siguiente. La ejecución va en segundo plano, con progreso en la barra lateral, y se puede cancelar.</p>
    </>)
  },
  {
    id: 'diagnostico', title: 'Diagnóstico y copias de seguridad',
    body: (<>
      <p>En <b>Ajustes → Diagnóstico</b> ves, de un vistazo, la versión, el equipo, los motores instalados, los modelos, las voces, el espacio que se usa y los problemas que el propio programa ha detectado. Puedes copiar el informe entero para mandarlo a quien te ayude.</p>
      <p>Desde ahí también se crea una <b>copia de seguridad</b> en ZIP con todo lo que has creado (ajustes, biblioteca, reuniones, prompts, historial, voces y modelos) y se restaura en otro equipo. <b>Las claves de los servicios en la nube no se copian</b>: van cifradas con el llavero de tu sistema y no se pueden llevar a otro equipo, así que al restaurar hay que volver a escribirlas.</p>
    </>)
  },
  {
    id: 'traduccion', title: 'Traducción en vivo',
    body: (<>
      <p>Elige el idioma de origen (el destino es el otro) y la fuente: tu micrófono (conversación) o el audio del sistema (subtítulos). Cada frase aparece con su original y su traducción, con unos segundos de retraso. Puedes activar la lectura en voz alta de la traducción.</p>
    </>)
  },
  {
    id: 'notas', title: 'Notas y exportación',
    body: (<>
      <p>Los botones <b>📝 A notas</b> guardan archivos Markdown con metadatos (fecha, etiquetas) en la carpeta que elijas en Ajustes, por defecto <code>~/Documentos/DictaFlow-Notas</code>. Sirve directamente como vault de Obsidian o Logseq.</p>
    </>)
  },
  {
    id: 'desinstalar', title: 'Desinstalar',
    body: (<>
      <p>En <b>Ajustes → Desinstalar</b> la app detecta cómo la instalaste y te muestra el comando exacto (<code>apt</code>, <code>dnf</code>, <code>pacman</code> o borrar el AppImage). El botón <b>Desinstalar aplicación</b> lo ejecuta por ti: el sistema te pide la contraseña en su propio diálogo y antes se te pide confirmación.</p>
      <p>Si marcas «Borrar también mis datos» se eliminan los modelos, voces, ajustes, biblioteca y reuniones. Tus notas y audios exportados no se tocan.</p>
    </>)
  },
  {
    id: 'apariencia', title: 'Apariencia',
    body: (<>
      <p>Abajo a la izquierda eliges el tema: 🖥 Sistema (sigue al sistema operativo), 🌙 Oscuro o ☀ Claro.</p>
    </>)
  },
  {
    id: 'privacidad', title: 'Privacidad',
    body: (<>
      <p>El indicador de la barra lateral muestra si todo es local o si usas un servicio en la nube. En <b>Privacidad</b> ves cada conexión externa (destino, motivo y tamaño) y puedes activar el modo offline estricto, que las bloquea. Tus datos viven en una carpeta tuya que puedes abrir o borrar.</p>
    </>)
  },
  {
    id: 'rendimiento', title: 'Rendimiento y latencias',
    body: (<>
      <p>En <b>Ajustes → Rendimiento</b> hay tres perfiles (<b>Ligero</b>, <b>Equilibrado</b>, <b>Acelerado</b>) y un modo automático que los elige según tu equipo, con una prueba corta de la voz.</p>
      <p>Debajo están las <b>latencias medidas</b> por etapas: cuánto se espera al silencio, cuánto tarda la inferencia de voz, cuánto desde que se cierra la frase hasta que aparece el texto y cuánto tarda la redacción. Es la forma de saber si el atasco está en la voz, en la IA o en la configuración.</p>
      <p>El texto provisional <b>no</b> retrasa la transcripción final: la definitiva va siempre primero y el borrador se descarta si llega tarde. Si en tu equipo va justo, apaga el texto provisional.</p>
    </>)
  }
]

export function Manual(): JSX.Element {
  const [id, setId] = useState(TOPICS[0].id)
  const topic = TOPICS.find((t) => t.id === id) ?? TOPICS[0]
  return (
    <div className="view manual">
      <nav className="card" aria-label="Temas del manual">
        {TOPICS.map((t) => (
          <button key={t.id} className={t.id === id ? 'on' : ''} onClick={() => setId(t.id)}>{t.title}</button>
        ))}
      </nav>
      <article className="card grow">
        <h2>{topic.title}</h2>
        {topic.body}
      </article>
    </div>
  )
}
