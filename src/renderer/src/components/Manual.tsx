import { useState } from 'react'

const ANDROID = window.api.platform === 'android'

/**
 * Un tema del manual. `android` sustituye el texto en el teléfono (`null` lo oculta allí) y
 * `onlyAndroid` marca los temas que solo existen en el teléfono.
 */
interface Topic { id: string; title: string; body: JSX.Element; android?: JSX.Element | null; androidTitle?: string; onlyAndroid?: boolean }

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
    </>),
    android: (<>
      <p>DictaFlow convierte tu voz en texto, lo redacta mejor con IA y te lo deja listo para copiar, guardar o escuchar. <b>Todo ocurre dentro del teléfono</b>: no se envía tu voz ni tus textos a ningún servidor.</p>
      <ol>
        <li>En el asistente inicial eliges tus idiomas y descargas los modelos (usa Wi-Fi: son de 60 MB a 1 GB).</li>
        <li>En <b>🎤 Dictado</b> pulsa el botón del micrófono, habla y vuelve a pulsarlo.</li>
        <li>Revisa la redacción y cópiala con <b>📋 Copiar</b> para pegarla en WhatsApp, el correo o cualquier app.</li>
      </ol>
      <p>Las secciones están en la barra de abajo: deslízala hacia los lados para ver todas.</p>
    </>)
  },
  {
    id: 'aura', title: 'Colores de la pantalla', onlyAndroid: true,
    body: (<>
      <p>Cuando usas una herramienta de audio, el borde de la pantalla se ilumina para que sepas qué está pasando sin mirar ningún botón:</p>
      <ul>
        <li><b style={{ color: '#3584e4' }}>Azul</b>: el micrófono te está escuchando o la app está hablando.</li>
        <li><b style={{ color: '#e5a50a' }}>Amarillo</b>: se está transcribiendo o redactando lo que dijiste.</li>
        <li><b style={{ color: '#2ec27e' }}>Verde</b>: listo, unos segundos.</li>
      </ul>
      <p className="muted">Funciona en Dictado, Audio, Lector, Reuniones, Traducción, Prompts y Mis voces.</p>
    </>)
  },
  {
    id: 'actualizaciones', title: 'Actualizaciones', onlyAndroid: true,
    body: (<>
      <p>Al abrir la app se comprueba si hay una versión nueva en la web de DictaFlow; también puedes buscarla en <b>Ajustes → General → Actualizaciones</b>. Si la hay, ves sus novedades y eliges <b>Actualizar ahora</b> o <b>Ahora no</b>.</p>
      <p>La app descarga la versión nueva, comprueba que sea idéntica a la publicada y abre el instalador de Android. Tus datos y modelos se conservan. La primera vez Android te pedirá activar <b>«Permitir de esta fuente»</b> para DictaFlow: actívalo, vuelve y toca <b>Reintentar</b>.</p>
    </>)
  },
  {
    id: 'dictado', title: 'Dictado y micrófono',
    body: (<>
      <p>El botón redondo del micrófono es la acción principal: su anillo se mueve con tu voz para que sepas que te escucha. El micrófono se elige en <b>Opciones del micrófono</b>, bajo el botón.</p>
      <p>Mientras se transcribe aparece un bot escribiendo y el borde del texto se anima; cuando la redacción con IA está lista, su borde queda en verde.</p>
      <h4>Texto en vivo</h4>
      <p>En el teléfono, con el modelo «Texto en vivo» descargado (Ajustes → Servicios de IA), ves lo que dices palabra a palabra mientras hablas. Al cerrarse la frase, Whisper pone el texto definitivo con puntuación.</p>
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
    </>),
    androidTitle: 'Modelos de IA del teléfono',
    android: (<>
      <p>En <b>Ajustes → 🤖 Servicios de IA</b> descargas los modelos que usa la app. Cada uno indica si es el <b>★ Recomendado</b> para tu teléfono según su memoria.</p>
      <ul>
        <li><b>Voz → texto (Whisper):</b> transcribe lo que dictas. «Small» es el más preciso; «Base» y «Tiny» van más rápido en teléfonos modestos.</li>
        <li><b>Redacción con IA:</b> pule, traduce y resume. Con <b>Probar redacción</b> compruebas que funciona.</li>
        <li><b>Lectura en voz alta:</b> una voz por idioma. Con ▶ la escuchas antes de descargarla.</li>
      </ul>
      <p>Si una descarga se corta, continúa donde se quedó. Puedes borrar un modelo para liberar espacio.</p>
    </>)
  },
  {
    id: 'cualquier-app', title: 'Dictar en cualquier app',
    body: (<>
      <p>Con un atajo de GNOME (instrucciones en Ajustes) dictas sin abrir la ventana: pulsas el atajo, hablas, lo pulsas otra vez y el texto redactado queda en el portapapeles. Una píldora flotante indica el estado y llega una notificación. Pega con <b>Ctrl+V</b>.</p>
      <p className="muted">No se escribe solo en la otra app a propósito: en Wayland eso exigiría un permiso que permitiría a cualquier programa simular tu teclado.</p>
    </>),
    androidTitle: 'Usar el texto en otras apps',
    android: (<>
      <p>Dicta en DictaFlow y toca <b>📋 Copiar</b>: el texto queda en el portapapeles y lo pegas en cualquier app manteniendo pulsado el campo de texto → <b>Pegar</b>.</p>
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
    </>),
    android: null
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
      <p>Con los comandos activos (Ajustes) hay tres formas de usarlos:</p>
      <ul>
        <li><b>Solo el comando:</b> una frase que sea solo un comando se ejecuta en vez de escribirse: «borra todo», «nuevo párrafo», «nueva línea», «copia», «rehaz», «redacta», «más formal / más corto / más cercano», «conviértelo en prompt», «instrucciones de cambio», «guarda este prompt», «pausa».</li>
        <li><b>Al final, con «Flow»:</b> «…nos vemos el lunes. <b>Flow, redacta</b>». Se escribe lo que dijiste y luego se ejecuta el comando. Es la forma de usarlos con <b>Parlante controlado</b>, donde todo lo que dices hasta pulsar Detener es una sola frase.</li>
        <li><b>Formato en medio del texto:</b> «punto y aparte», «nuevo párrafo» y «salto de línea» se convierten en saltos de línea, sin «Flow».</li>
      </ul>
      <p>En Dictado, el botón <b>🎙 Comandos</b> muestra la lista.</p>
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
    </>),
    android: (<>
      <h4>🎧 Voz → Texto</h4>
      <p>Elige un archivo de audio del teléfono o graba con el micrófono. Transcribe con marcas de tiempo y lo puedes guardar como .txt, .srt o .vtt.</p>
      <p>Con IA puedes generar resumen, capítulos, post para redes, notas o apuntes de estudio, y traducir.</p>
      <h4>🔊 Texto → Voz</h4>
      <p>Escribe o pega texto, elige idioma, voz y velocidad, escúchalo y guárdalo en <b>WAV o MP3</b> donde quieras (Descargas, Drive…). Las voces se descargan en Ajustes → Servicios de IA.</p>
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
    </>),
    android: (<>
      <p>Añade un PDF, EPUB, TXT o MD del teléfono. El lector muestra el texto por capítulos, con tamaño ajustable, y recuerda por dónde ibas.</p>
      <ul>
        <li><b>▶ Leer en voz alta</b> resalta cada párrafo mientras suena. Toca uno para empezar desde ahí.</li>
        <li><b>Audiolibro</b>: convierte el libro en MP3 en segundo plano (un archivo por capítulo y uno completo). Al terminar, toca <b>⬇ Guardar MP3</b> en el aviso para guardarlo en el teléfono. Si se interrumpe, continúa sin rehacer lo hecho.</li>
        <li>Con IA: resumir capítulo, traducir un párrafo o preguntar sobre el contenido.</li>
      </ul>
      <p className="muted">Los PDF escaneados (solo imágenes) aún no se pueden leer.</p>
    </>)
  },
  {
    id: 'reuniones', title: 'Reuniones y clases',
    body: (<>
      <p>Transcribe en directo desde tu micrófono, el <b>audio del sistema</b> (lo que suena en Meet, Zoom o YouTube) o ambos. Con «Ambos» las frases se etiquetan «Yo» y «Sistema»; usa auriculares para evitar eco. El audio se guarda para poder volver a transcribirlo.</p>
      <p>Al terminar se guarda con marcas de tiempo. <b>📋 Generar acta</b> pide a la IA un acta con las partes separadas: <b>resumen ejecutivo</b>, temas tratados, decisiones, acuerdos y <b>tareas con responsable y fecha</b>. Las tareas se pueden marcar como hechas. También puedes generar apuntes de clase, exportar a notas, a PDF o a .srt y buscar frases en todas tus reuniones.</p>
      <p className="muted">Lo que <b>no</b> hay todavía: distinguir hablantes dentro de la misma fuente (diarización automática). Ahora solo se separan por origen. Puedes <b>renombrar a quien habla</b> con un clic sobre su nombre, y esa atribución queda guardada como tuya.</p>
    </>),
    android: (<>
      <p>Pon el teléfono cerca de quien habla y pulsa <b>● Empezar a transcribir</b>: transcribe en directo y guarda el audio para volver a transcribirlo.</p>
      <p>Al terminar, <b>📋 Generar acta</b> separa resumen, temas, decisiones, acuerdos y <b>tareas con responsable y fecha</b>. También puedes guardar apuntes, notas o un PDF y buscar frases en todas tus reuniones.</p>
      <p className="muted">En el teléfono solo se graba con el micrófono: Android no deja captar el sonido de otras apps (Meet, Zoom…). Avisa a los participantes antes de grabar.</p>
    </>)
  },
  {
    id: 'agenda', title: 'Agenda y recordatorios',
    body: (<>
      <p>En <b>🗓 Agenda</b> creas eventos con título, fecha, duración y descripción. Puedes exportarlos a un archivo <b>.ics</b> (que entienden Google Calendar, Thunderbird, GNOME Calendar u Outlook) e importar los que ya tengas.</p>
      <p>Los <b>recordatorios</b> son avisos locales: suena una notificación del sistema cuando toca, sin salir de tu equipo. Funcionan aunque la ventana esté cerrada.</p>
    </>),
    android: (<>
      <p>En <b>🗓 Agenda</b> creas eventos y recordatorios. Suenan como <b>notificaciones de Android a su hora</b>, aunque la app esté cerrada; la primera vez Android te pide permiso para mostrarlas.</p>
      <p>Puedes guardar tus eventos en un archivo <b>.ics</b> (Google Calendar, Outlook…) e importar los que ya tengas.</p>
    </>)
  },
  {
    id: 'voces', title: 'Mis voces',
    body: (<>
      <p><b>🎙 Mis voces</b> reúne tus grabaciones originales, las voces que creas con ellas, los audios que generes y las frases de prueba.</p>
      <p><b>El consentimiento es obligatorio</b>: al guardar una voz se anota quién autoriza el uso y cuándo, y ese dato se guarda con la voz y va en las copias de seguridad. No se clonan voces de terceros.</p>
      <p className="muted">Cada voz puede usar una <b>voz local de Piper</b> (funciona sin conexión y sin descargar nada más) o un <b>servicio local de clonación</b> que tengas en marcha (por defecto <code>http://127.0.0.1:8020</code>). Esta versión no incluye un motor de clonación: los que existen ocupan entre 2 y 3 GB y algunos, como XTTS-v2, no se pueden usar comercialmente.</p>
    </>),
    android: (<>
      <p><b>🎙 Mis voces</b> reúne tus grabaciones, las voces con nombre que creas y los audios que generas con ellas. Cada voz usa una de las voces del teléfono.</p>
      <p><b>El consentimiento es obligatorio</b>: al guardar una voz se anota quién autoriza su uso y cuándo.</p>
      <p className="muted">La clonación de voz no está en el teléfono: necesitaría un servicio aparte en tu red.</p>
    </>)
  },
  {
    id: 'automatizaciones', title: 'Automatizaciones',
    body: (<>
      <p>En <b>⚙ Automatizaciones</b> guardas secuencias de pasos y las vuelves a ejecutar cuando quieras: <b>resumir</b>, <b>convertir en notas</b>, <b>generar acta</b>, <b>guardar como PDF</b>, <b>guardar como nota</b>, <b>crear evento</b> o <b>leer en voz alta</b>.</p>
      <p>Los pasos con IA se encadenan: el resultado de uno es la entrada del siguiente. La ejecución va en segundo plano, con progreso en la barra lateral, y se puede cancelar.</p>
    </>),
    android: (<>
      <p>En <b>⚙ Automatizaciones</b> guardas secuencias de pasos para repetirlas sobre cualquier texto: <b>resumir</b>, <b>convertir en notas</b>, <b>generar acta</b>, <b>PDF</b>, <b>nota</b>, <b>crear evento</b> o <b>audio</b>.</p>
      <p>Van en segundo plano y se pueden cancelar. Los archivos que producen se guardan con <b>⬇ Guardar</b> en el aviso que aparece al terminar.</p>
    </>)
  },
  {
    id: 'diagnostico', title: 'Diagnóstico y copias de seguridad',
    body: (<>
      <p>En <b>Ajustes → Diagnóstico</b> ves, de un vistazo, la versión, el equipo, los motores instalados, los modelos, las voces, el espacio que se usa y los problemas que el propio programa ha detectado. Puedes copiar el informe entero para mandarlo a quien te ayude.</p>
      <p>Desde ahí también se crea una <b>copia de seguridad</b> en ZIP con todo lo que has creado (ajustes, biblioteca, reuniones, prompts, historial, voces y modelos) y se restaura en otro equipo. <b>Las claves de los servicios en la nube no se copian</b>: van cifradas con el llavero de tu sistema y no se pueden llevar a otro equipo, así que al restaurar hay que volver a escribirlas.</p>
    </>),
    androidTitle: 'Copias de seguridad',
    android: (<>
      <p>En <b>Ajustes → General → Copia de seguridad</b> guardas un ZIP con todo lo que has creado: ajustes, biblioteca, reuniones, prompts, historial, agenda, automatizaciones y «Mis voces». Eliges dónde guardarlo (Descargas, Drive…).</p>
      <p>Es el mismo formato que en la computadora: sirve para pasar tus datos de un lado a otro. Los modelos de IA no se copian (se vuelven a descargar) y al restaurar se conservan los del teléfono.</p>
    </>)
  },
  {
    id: 'traduccion', title: 'Traducción en vivo',
    body: (<>
      <p>Elige el idioma de origen (el destino es el otro) y la fuente: tu micrófono (conversación) o el audio del sistema (subtítulos). Cada frase aparece con su original y su traducción, con unos segundos de retraso. Puedes activar la lectura en voz alta de la traducción.</p>
    </>),
    android: (<>
      <p>Elige el idioma de origen (el destino es el otro) y habla, o deja el teléfono cerca de quien habla. Cada frase aparece con su original y su traducción, con unos segundos de retraso. Puedes activar que la traducción se lea en voz alta.</p>
    </>)
  },
  {
    id: 'notas', title: 'Notas y exportación',
    body: (<>
      <p>Los botones <b>📝 A notas</b> guardan archivos Markdown con metadatos (fecha, etiquetas) en la carpeta que elijas en Ajustes, por defecto <code>~/Documentos/DictaFlow-Notas</code>. Sirve directamente como vault de Obsidian o Logseq.</p>
    </>),
    android: (<>
      <p>Los botones <b>📝 A notas</b>, PDF y exportar abren el selector de archivos de Android: eliges carpeta y nombre (Descargas, Drive o la carpeta de tu vault de Obsidian). Las notas son Markdown con fecha y etiquetas.</p>
    </>)
  },
  {
    id: 'desinstalar', title: 'Desinstalar',
    body: (<>
      <p>En <b>Ajustes → Desinstalar</b> la app detecta cómo la instalaste y te muestra el comando exacto (<code>apt</code>, <code>dnf</code>, <code>pacman</code> o borrar el AppImage). El botón <b>Desinstalar aplicación</b> lo ejecuta por ti: el sistema te pide la contraseña en su propio diálogo y antes se te pide confirmación.</p>
      <p>Si marcas «Borrar también mis datos» se eliminan los modelos, voces, ajustes, biblioteca y reuniones. Tus notas y audios exportados no se tocan.</p>
    </>),
    android: (<>
      <p>Mantén pulsado el ícono de DictaFlow → <b>Desinstalar</b>, o hazlo desde Ajustes de Android → Aplicaciones. Se borran también los modelos y tus datos: haz antes una copia de seguridad si los quieres conservar.</p>
    </>)
  },
  {
    id: 'apariencia', title: 'Apariencia',
    body: (<>
      <p>Abajo a la izquierda eliges el tema: 🖥 Sistema (sigue al sistema operativo), 🌙 Oscuro o ☀ Claro.</p>
    </>),
    android: (<>
      <p>En <b>Ajustes → General → Apariencia</b> eliges el tema: 📱 Sistema (sigue al teléfono), 🌙 Oscuro o ☀ Claro.</p>
    </>)
  },
  {
    id: 'privacidad', title: 'Privacidad',
    body: (<>
      <p>El indicador de la barra lateral muestra si todo es local o si usas un servicio en la nube. En <b>Privacidad</b> ves cada conexión externa (destino, motivo y tamaño) y puedes activar el modo offline estricto, que las bloquea. Tus datos viven en una carpeta tuya que puedes abrir o borrar.</p>
    </>),
    android: (<>
      <p>Tu voz, tus textos y tus documentos se procesan dentro del teléfono. La app solo se conecta a internet para <b>descargar modelos y voces</b> y para <b>buscar actualizaciones</b>; en <b>🔒 Privacidad</b> ves cada conexión y puedes activar el modo offline estricto, que las bloquea todas.</p>
    </>)
  },
  {
    id: 'rendimiento', title: 'Rendimiento y latencias',
    body: (<>
      <p>En <b>Ajustes → Rendimiento</b> hay tres perfiles (<b>Ligero</b>, <b>Equilibrado</b>, <b>Acelerado</b>) y un modo automático que los elige según tu equipo, con una prueba corta de la voz.</p>
      <p>Debajo están las <b>latencias medidas</b> por etapas: cuánto se espera al silencio, cuánto tarda la inferencia de voz, cuánto desde que se cierra la frase hasta que aparece el texto y cuánto tarda la redacción. Es la forma de saber si el atasco está en la voz, en la IA o en la configuración.</p>
      <p>El texto provisional <b>no</b> retrasa la transcripción final: la definitiva va siempre primero y el borrador se descarta si llega tarde. Si en tu equipo va justo, apaga el texto provisional.</p>
    </>),
    android: null
  }
]

/** Temas que se ven en esta plataforma, con su texto. */
const VISIBLE: { id: string; title: string; body: JSX.Element }[] = TOPICS.flatMap((t) => {
  if (!ANDROID) return t.onlyAndroid ? [] : [t]
  if (t.android === null) return []
  return [{ id: t.id, title: t.androidTitle ?? t.title, body: t.android ?? t.body }]
})

export function Manual(): JSX.Element {
  const [id, setId] = useState(VISIBLE[0].id)
  const i = Math.max(0, VISIBLE.findIndex((t) => t.id === id))
  const topic = VISIBLE[i]
  const go = (n: number): void => {
    setId(VISIBLE[n].id)
    document.querySelector('main')?.scrollTo({ top: 0 })
  }
  return (
    <div className="view manual">
      {/* En el teléfono el índice es un desplegable arriba: la lista ocupaba toda la pantalla. */}
      <label className="manual-pick">Tema
        <select value={topic.id} onChange={(e) => go(VISIBLE.findIndex((t) => t.id === e.target.value))}>
          {VISIBLE.map((t, n) => <option key={t.id} value={t.id}>{n + 1}. {t.title}</option>)}
        </select>
      </label>
      <nav className="card" aria-label="Temas del manual">
        {VISIBLE.map((t) => (
          <button key={t.id} className={t.id === topic.id ? 'on' : ''} onClick={() => setId(t.id)}>{t.title}</button>
        ))}
      </nav>
      <article className="card grow">
        <h2>{topic.title}</h2>
        {topic.body}
        <div className="row manual-steps">
          <button onClick={() => go(i - 1)} disabled={i === 0}>← Anterior</button>
          <span className="muted">{i + 1} de {VISIBLE.length}</span>
          <button onClick={() => go(i + 1)} disabled={i === VISIBLE.length - 1}>Siguiente →</button>
        </div>
      </article>
    </div>
  )
}
