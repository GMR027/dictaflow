// Textos de la web en ambos idiomas. build.mjs genera /index.html (EN) y /es/index.html (ES) desde aquí.
export const REPO = 'https://github.com/GMR027/dictaflow'

export const DOWNLOADS = [
  { id: 'deb', file: 'dictaflow-linux-amd64.deb', cmd: 'sudo apt install ./dictaflow-linux-amd64.deb' },
  { id: 'rpm', file: 'dictaflow-linux-x86_64.rpm', cmd: 'sudo dnf install ./dictaflow-linux-x86_64.rpm' },
  { id: 'suse', file: 'dictaflow-linux-x86_64.rpm', cmd: 'sudo zypper --no-gpg-checks install ./dictaflow-linux-x86_64.rpm' },
  { id: 'arch', file: 'dictaflow-linux-x86_64.pacman', cmd: 'sudo pacman -U ./dictaflow-linux-x86_64.pacman' },
  { id: 'appimage', file: 'dictaflow-linux-x86_64.AppImage', cmd: 'chmod +x dictaflow-linux-x86_64.AppImage\n./dictaflow-linux-x86_64.AppImage' },
  { id: 'tar', file: 'dictaflow-linux-x64.tar.gz', cmd: 'tar xzf dictaflow-linux-x64.tar.gz\n./dictaflow-linux-x64/dictaflow' }
]

const featureIcons = ['🎤', '✍️', '📚', '🎧', '📖', '🗂', '🌐', '🔒']

export const T = {
  en: {
    lang: 'en', htmlLang: 'en', path: '', other: { href: 'es/', label: 'Español' },
    title: 'DictaFlow — Voice dictation with local AI for Linux',
    description: 'Speak, get clean text. DictaFlow turns your voice into polished writing, prompts, notes and audio — locally on your Linux desktop, or with the AI subscriptions you already have.',
    nav: { features: 'Features', shots: 'Screenshots', privacy: 'Privacy', install: 'Install', faq: 'FAQ' },
    hero: { h1: 'Talk. Get clean text.', sub: 'Dictate with your voice and let a local or subscription AI rewrite it, turn it into a coding prompt, read it aloud or transcribe your meetings — all on your Linux desktop.', cta: 'Download for Linux', repo: 'View on GitHub', note: 'Free and open source · MIT license · Works offline' },
    featuresTitle: 'Everything your voice can do',
    features: [
      ['Dictation', 'Continuous or push-to-talk, with any microphone. Voice commands like “new paragraph” or “make it more formal”.'],
      ['AI rewriting', 'Fix, shorten or change the tone. Redo it, copy it or turn it into a structured coding prompt.'],
      ['Prompt library', 'Save your best prompts and ask the Prompt Architect agent to write new ones in your style.'],
      ['Audio ↔ text', 'Transcribe audio files with subtitles (.srt/.vtt) or generate speech and download WAV or MP3.'],
      ['PDF & EPUB reader', 'Listen to books and documents with highlighted reading, or export an audiobook.'],
      ['Meetings & classes', 'Transcribe your mic and system audio, get minutes with tasks, owners and dates, and study notes.'],
      ['Live translation', 'Spanish ↔ English conversations and subtitles, with optional spoken output.'],
      ['Calendar & reminders', 'Events you export to .ics (Google Calendar, Thunderbird, GNOME) and local alerts.'],
      ['PDF & automations', 'Export to PDF and save step sequences you can replay whenever you need them.'],
      ['Diagnostics & backups', 'A report on how everything is doing, and backups of everything you created.'],
      ['Private by design', 'Speech recognition runs on your machine. A network log shows every outgoing request.']
    ],
    shotsTitle: 'A calm, native-feeling interface',
    shotsSub: 'Light and dark themes that follow your system — or choose your own.',
    shotCaptions: { dictado: 'Dictation and AI rewriting', prompts: 'Prompt library and Prompt Architect', reuniones: 'Meetings with minutes', audio: 'Audio tools' },
    privacyTitle: 'Your voice stays yours',
    privacy: [
      ['Local first', 'Whisper speech recognition and Piper voices run on your computer. No account needed.'],
      ['Nothing hidden', 'The status badge tells you if anything uses the cloud, and the Privacy tab logs every external request.'],
      ['Strict offline mode', 'One switch blocks every connection that is not to your own machine.'],
      ['You choose the AI', 'Ollama locally, or your Claude, opencode or OpenAI-compatible subscription. Keys are stored encrypted by your system keyring.']
    ],
    installTitle: 'Install',
    installSub: 'Pick your distribution. Each download is a single file; the app downloads speech models on first run (about 0.5–1.5 GB, only once).',
    distros: {
      deb: ['Ubuntu · Debian · Zorin OS · Mint · Pop!_OS', '.deb package'],
      rpm: ['Fedora · RHEL · Rocky · Alma', '.rpm package'],
      suse: ['openSUSE', '.rpm package'],
      arch: ['Arch · Manjaro · EndeavourOS', '.pacman package'],
      appimage: ['Any distribution', 'AppImage — no install'],
      tar: ['Portable', '.tar.gz archive']
    },
    download: 'Download', copy: 'Copy', copied: 'Copied',
    verifyTitle: 'Verify your download', verify: 'Compare the SHA-256 with the value below, or run:', sums: 'SHA-256 checksums',
    reqTitle: 'Requirements',
    req: ['Linux x86-64 with a graphical session (GNOME/Wayland tested on Zorin OS)', 'PipeWire for capturing system audio (installed by default on modern distributions)', '8 GB RAM recommended; a GPU is not required', 'Ollama is optional — the app can install it for you'],
    limitsTitle: 'Known limitations',
    limits: ['Scanned PDFs (images only) need OCR, which is not available yet.', 'No automatic speaker diarisation yet: meeting speakers are separated only by source (“Me” and “System”), though you can rename any of them by hand.', 'No voice-cloning engine is bundled: “My voices” talks to a local cloning service you run yourself.', 'The app copies dictated text to the clipboard instead of typing it into other apps — Wayland does not allow that without risky permissions.', 'Quality of rewriting depends on the AI model you choose.'],
    faqTitle: 'Questions',
    faq: [
      ['Is it really free?', 'Yes. DictaFlow is MIT-licensed. If you use a paid AI service you pay that provider; local models cost nothing.'],
      ['Does it send my voice anywhere?', 'Not by default. Speech recognition is local. Text goes out only if you pick a cloud AI, and the app shows when that happens.'],
      ['Which languages?', 'Spanish and English today; the app asks for your languages on first run.'],
      ['How do I dictate into other apps?', 'Register a keyboard shortcut once (instructions in Settings). Press it, speak, press again, and paste with Ctrl+V.'],
      ['How do I uninstall it?', 'Settings → Uninstall shows the exact command for your installation and can run it for you, optionally deleting your data.']
    ],
    footer: { license: 'MIT licensed', notAffiliated: 'DictaFlow is an independent project, not affiliated with OpenAI, Anthropic, Ollama or Zorin.', third: 'Third-party software' }
  },
  es: {
    lang: 'es', htmlLang: 'es', path: 'es/', other: { href: '../?lang=en', label: 'English' },
    title: 'DictaFlow — Dictado por voz con IA local para Linux',
    description: 'Habla y obtén texto pulido. DictaFlow convierte tu voz en redacción, prompts, notas y audio — en local en tu escritorio Linux, o con las suscripciones de IA que ya tienes.',
    nav: { features: 'Herramientas', shots: 'Capturas', privacy: 'Privacidad', install: 'Instalar', faq: 'Preguntas' },
    hero: { h1: 'Habla. Obtén texto limpio.', sub: 'Dicta con tu voz y deja que una IA local o de suscripción lo redacte, lo convierta en un prompt de programación, lo lea en voz alta o transcriba tus reuniones — todo en tu escritorio Linux.', cta: 'Descargar para Linux', repo: 'Ver en GitHub', note: 'Gratis y de código abierto · Licencia MIT · Funciona sin conexión' },
    featuresTitle: 'Todo lo que puede hacer tu voz',
    features: [
      ['Dictado', 'Continuo o pulsando para hablar, con cualquier micrófono. Comandos de voz como «nuevo párrafo» o «hazlo más formal».'],
      ['Redacción con IA', 'Corrige, acorta o cambia el tono. Rehazlo, cópialo o conviértelo en un prompt de programación estructurado.'],
      ['Biblioteca de prompts', 'Guarda tus mejores prompts y pide al agente Prompt Architect que escriba nuevos con tu estilo.'],
      ['Audio ↔ texto', 'Transcribe archivos de audio con subtítulos (.srt/.vtt) o genera voz y descarga WAV o MP3.'],
      ['Lector de PDF y EPUB', 'Escucha libros y documentos con lectura resaltada, o exporta un audiolibro.'],
      ['Reuniones y clases', 'Transcribe tu micrófono y el audio del sistema; obtén actas con tareas, responsables y fechas, y apuntes de estudio.'],
      ['Traducción en vivo', 'Conversaciones y subtítulos español ↔ inglés, con salida hablada opcional.'],
      ['Agenda y recordatorios', 'Eventos que exportas a .ics (Google Calendar, Thunderbird, GNOME) y avisos locales.'],
      ['PDF y automatizaciones', 'Exporta a PDF y guarda secuencias de pasos que repites cuando quieras.'],
      ['Diagnóstico y copias', 'Un informe con el estado de todo, y copias de seguridad de lo que has creado.'],
      ['Privado por diseño', 'El reconocimiento de voz se ejecuta en tu equipo. Un registro de red muestra cada petición saliente.']
    ],
    shotsTitle: 'Una interfaz tranquila y nativa',
    shotsSub: 'Temas claro y oscuro que siguen a tu sistema — o elige el tuyo.',
    shotCaptions: { dictado: 'Dictado y redacción con IA', prompts: 'Biblioteca de prompts y Prompt Architect', reuniones: 'Reuniones con acta', audio: 'Herramientas de audio' },
    privacyTitle: 'Tu voz sigue siendo tuya',
    privacy: [
      ['Local primero', 'El reconocimiento Whisper y las voces Piper se ejecutan en tu ordenador. No hace falta cuenta.'],
      ['Nada oculto', 'La insignia de estado te dice si algo usa la nube y la pestaña Privacidad registra cada petición externa.'],
      ['Modo offline estricto', 'Un interruptor bloquea toda conexión que no sea a tu propio equipo.'],
      ['Tú eliges la IA', 'Ollama en local, o tu suscripción de Claude, opencode o compatible con OpenAI. Las claves se guardan cifradas con el llavero del sistema.']
    ],
    installTitle: 'Instalar',
    installSub: 'Elige tu distribución. Cada descarga es un solo archivo; la app descarga los modelos de voz al primer uso (0,5–1,5 GB, una sola vez).',
    distros: {
      deb: ['Ubuntu · Debian · Zorin OS · Mint · Pop!_OS', 'paquete .deb'],
      rpm: ['Fedora · RHEL · Rocky · Alma', 'paquete .rpm'],
      suse: ['openSUSE', 'paquete .rpm'],
      arch: ['Arch · Manjaro · EndeavourOS', 'paquete .pacman'],
      appimage: ['Cualquier distribución', 'AppImage — sin instalar'],
      tar: ['Portable', 'archivo .tar.gz']
    },
    download: 'Descargar', copy: 'Copiar', copied: 'Copiado',
    verifyTitle: 'Verifica tu descarga', verify: 'Compara el SHA-256 con el valor de abajo, o ejecuta:', sums: 'Sumas SHA-256',
    reqTitle: 'Requisitos',
    req: ['Linux x86-64 con sesión gráfica (probado en GNOME/Wayland sobre Zorin OS)', 'PipeWire para capturar el audio del sistema (viene en las distribuciones modernas)', '8 GB de RAM recomendados; no hace falta GPU', 'Ollama es opcional — la app puede instalarlo por ti'],
    limitsTitle: 'Limitaciones conocidas',
    limits: ['Los PDF escaneados (solo imágenes) necesitan OCR, que aún no está disponible.', 'Todavía no hay diarización automática: en las reuniones los hablantes solo se separan por origen («Yo» y «Sistema»), aunque puedes renombrar a cualquiera a mano.', 'No se incluye motor de clonación de voz: «Mis voces» se conecta a un servicio local que pones tú en marcha.', 'La app copia el texto dictado al portapapeles en lugar de escribirlo en otras apps: Wayland no lo permite sin permisos arriesgados.', 'La calidad de la redacción depende del modelo de IA que elijas.'],
    faqTitle: 'Preguntas',
    faq: [
      ['¿De verdad es gratis?', 'Sí. DictaFlow tiene licencia MIT. Si usas un servicio de IA de pago, pagas a ese proveedor; los modelos locales no cuestan nada.'],
      ['¿Envía mi voz a algún sitio?', 'No por defecto. El reconocimiento de voz es local. El texto solo sale si eliges una IA en la nube, y la app avisa cuando ocurre.'],
      ['¿Qué idiomas admite?', 'Español e inglés por ahora; la app te pide tus idiomas al primer inicio.'],
      ['¿Cómo dicto en otras aplicaciones?', 'Registra un atajo de teclado una vez (instrucciones en Ajustes). Púlsalo, habla, púlsalo de nuevo y pega con Ctrl+V.'],
      ['¿Cómo la desinstalo?', 'Ajustes → Desinstalar muestra el comando exacto de tu instalación y puede ejecutarlo por ti, borrando opcionalmente tus datos.']
    ],
    footer: { license: 'Licencia MIT', notAffiliated: 'DictaFlow es un proyecto independiente, sin relación con OpenAI, Anthropic, Ollama ni Zorin.', third: 'Software de terceros' }
  }
}
export { featureIcons }
