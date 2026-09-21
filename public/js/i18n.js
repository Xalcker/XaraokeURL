// Textos de la interfaz en cada idioma, compartidos por el navegador y el servidor.
// Se carga como <script> plano en el navegador (define `t` y `currentLang`, y traduce
// los elementos con data-i18n*) y también es requireable desde Node, donde el
// servidor lo usa para los mensajes de error de la API y las pantallas de acceso.
//
// Para agregar un idioma: una entrada en MESSAGES con las mismas claves que "es"
// (test/i18n.test.js lo comprueba) y su código en SUPPORTED.
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = mod;
  }
  if (root && root.document) {
    const nav = root.navigator || {};
    const lang = mod.pickLanguage(nav.languages && nav.languages.length ? nav.languages : nav.language);
    root.currentLang = lang;
    root.t = (key, params) => mod.translate(lang, key, params);
    const apply = () => {
      root.document.documentElement.lang = lang;
      mod.applyTranslations(lang, root.document);
    };
    apply(); // el script va al final del <body>: los elementos ya existen y no hay parpadeo
    root.document.addEventListener("DOMContentLoaded", apply);
  }
})(typeof window !== "undefined" ? window : undefined, function () {
  const DEFAULT_LANG = "es";
  const SUPPORTED = ["es", "en"];

  const MESSAGES = {
    es: {
      // ----- Control remoto: unirse a una sala
      "remote.join.title": "Unirse a una Sala",
      "remote.join.hint": "Introduce el código de 4 letras de la sala.",
      "remote.join.nameLabel": "Tu nombre",
      "remote.join.button": "Unirse",
      "remote.join.verifying": "Verificando...",
      "remote.join.codeLength": "El código debe tener 4 letras.",
      "remote.join.nameRequired": "Escribe tu nombre.",
      "remote.join.nameSaveFailed": "No se pudo guardar el nombre.",
      "remote.join.roomMissing": 'La sala "{code}" no existe.',
      "remote.join.verifyFailed": "Error al verificar la sala.",

      // ----- Control remoto: pantalla principal
      "remote.header": "Control Remoto",
      "remote.room": "SALA: {code}",
      "remote.hostDisconnected": "El host se desconectó. La reproducción está pausada hasta que vuelva a conectarse.",
      "remote.turnBanner": "¡Prepárate! Tu canción está por empezar...",
      "remote.loading": "Cargando...",
      "remote.play": "Reproducir",
      "remote.pause": "Pausar",
      "remote.pausedTag": "En pausa",
      "remote.skip": "Saltar canción",
      "remote.userLoading": "Cargando usuario...",
      "remote.user": "Usuario: {name}",
      "remote.logout": "Salir",
      "remote.search.placeholder": "Buscar canción o artista...",
      "remote.search.label": "Buscar canción o artista",
      "remote.tab.search": "Buscar",
      "remote.tab.queue": "Mi cola",
      "remote.queue.empty": "La cola está vacía",
      "queue.summary.none": "No tienes canciones en la cola.",
      "queue.summary.playing": "Tu canción está sonando.",
      "queue.summary.next": "Tu canción es la siguiente.",
      "queue.summary.ahead.one": "Antes de tu turno hay 1 canción.",
      "queue.summary.ahead.other": "Antes de tu turno hay {n} canciones.",
      "queue.emptyList": "No hay canciones en espera todavía. Ve a Buscar para añadir la tuya.",
      "toast.added": "Añadida a la cola",
      "remote.queue.you": "tú",
      "remote.queue.remove": "Quitar",
      "remote.queue.moveUp": "Subir una posición",
      "remote.queue.moveDown": "Bajar una posición",
      "rating.title": '¿Cómo estuvo el karaoke de "{song}"?',
      "rating.hint": "Califica el video y la música, no cómo cantaste.",
      "rating.up": "Bien",
      "rating.down": "Mal",
      "rating.skip": "Ahora no",
      "rating.total": "{up} a favor y {down} en contra, sumando todas las salas",
      "toast.rated": "¡Gracias por calificar!",
      "remote.nowPlaying": "{artist} - {title}",
      "remote.nowPlayingLabel": "Ahora suena",
      "remote.timeLeft": "{elapsed} / {total} (Faltan {remaining})",
      "remote.back": "Volver",
      "remote.retry": "Reintentar",

      // ----- Control remoto: biblioteca y búsqueda
      "library.loadFailed": "No se pudieron cargar las canciones.",
      "library.empty": "La biblioteca local está vacía. Escribe el nombre de una canción y pulsa Enter para buscarla en YouTube.",
      "library.downloads.one": "Hay 1 video ya descargado de YouTube: aparece al buscar, sin volver a descargarlo.",
      "library.downloads.other": "Hay {n} videos ya descargados de YouTube: aparecen al buscar, sin volver a descargarlos.",
      "library.alreadyDownloaded": "Ya descargado de YouTube",
      "song.unknownArtist": "Desconocido",

      "confirm.cancel": "Cancelar",
      "confirm.add": "Añadir",
      "confirm.addSong": '¿Añadir "{title}" a la cola?',
      "confirm.skipMine": '¿Saltar tu canción "{song}"?',
      "confirm.skipOther": '¿Saltar "{song}", la canción de {name}?',
      "confirm.skipYes": "Saltar",
      "confirm.remove": '¿Quitar "{title}" de la cola?',
      "confirm.removeYes": "Quitar",
      "toast.offline": "Sin conexión con la sala. Inténtalo de nuevo.",
      "toast.hostBack": "El host volvió: la sala está disponible de nuevo.",
      "confirm.download": '¿Descargar "{title}" desde YouTube y agregarla a la cola? Puede tardar unos segundos.',

      "yt.suffixLabel": "Buscar en YouTube como:",
      // Opciones del selector, en orden. "pista" es como se dice en español; en inglés se usa "backing track".
      "yt.suffixOptions": "karaoke,instrumental,pista,none",
      "yt.suffix.karaoke": "Karaoke",
      "yt.suffix.instrumental": "Instrumental",
      "yt.suffix.pista": "Pista",
      "yt.suffix.backing": "Backing track",
      "yt.suffix.none": "Sin sufijo",
      "yt.pressEnter": "Pulsa Enter para buscar en YouTube.",
      "yt.noLocalMatches": "No se encontraron canciones en la biblioteca. Pulsa Enter para buscarla en YouTube.",
      "yt.searchButton": "Buscar en YouTube",
      "yt.searching": "Buscando en YouTube...",
      "yt.searchFailed": "No se pudo buscar en YouTube. Intenta de nuevo.",
      "yt.noResults": "No se encontraron resultados en YouTube.",
      "yt.downloading": "Descargando desde YouTube, esto puede tardar unos segundos...",
      "yt.downloadFailed": "No se pudo descargar el video. Intenta de nuevo.",

      // ----- Control remoto: tutorial (un paso por elemento; ver REMOTE_TOUR_STEPS en js/tour.js)
      "tour.open": "Tutorial",
      "tour.skip": "Saltar tutorial",
      "tour.back": "Atrás",
      "tour.next": "Siguiente",
      "tour.done": "Listo",
      "tour.counter": "{current} de {total}",
      "tour.room.title": "Código de sala",
      "tour.room.text": "Es la sala a la que estás conectado, la misma que se ve en la pantalla principal. Quien quiera unirse tiene que escribir este código.",
      "tour.nowPlaying.title": "Ahora suena",
      "tour.nowPlaying.text": "Aquí ves la canción que suena, cuánto lleva y cuánto falta. La línea de abajo es su avance. Esta barra se queda fija aunque bajes por la lista.",
      "tour.playPause.title": "Pausar y reanudar",
      "tour.playPause.text": "Pausa o reanuda la canción para toda la sala. El ícono muestra lo que pasará al tocarlo. Se desactiva si no hay nada en la cola.",
      "tour.skip.title": "Saltar canción",
      "tour.skip.text": "Salta la canción que está sonando, sea tuya o de otra persona. Antes te pide confirmar, porque afecta a todos.",
      "tour.search.title": "Buscador",
      "tour.search.text": "Escribe el nombre de una canción o de un artista. Si no está en la biblioteca, pulsa Enter para buscarla en YouTube: se descarga y se añade a la cola.",
      "tour.browse.title": "Explorar la biblioteca",
      "tour.browse.text": "También puedes elegir una letra, luego un artista y al final la canción. Al tocar una canción te pide confirmar antes de añadirla a la cola.",
      "tour.queue.title": "Mi cola",
      "tour.queue.text": "Aquí está la cola de todos, con tus canciones resaltadas. El número de la pestaña indica cuántas tienes, y dentro se lee cuánto falta para tu turno. Con las flechas y con Quitar reordenas o sacas las tuyas.",
      "tour.alerts.title": "Avisos",
      "tour.alerts.text": "Unos 10 segundos antes de tu turno el teléfono vibra y suena. Cuando termina tu canción puedes calificar el video y la música con un pulgar arriba o abajo.",
      "tour.help.title": "¿Quieres verlo otra vez?",
      "tour.help.text": "Toca este botón cuando quieras volver a ver el tutorial.",

      // ----- Host (pantalla principal)
      "host.welcome": "Haz clic para iniciar la sesión",
      "host.start": "Comenzar",
      "host.creating": "Creando sala...",
      "host.createFailed": "Error al crear la sala. Por favor, intenta de nuevo.",
      "host.resume": "Recuperar la sala {code}",
      "host.resumeQueue": "Canciones en la cola: {n}",
      "host.startNew": "Crear una sala nueva",
      "host.resuming": "Recuperando sala...",
      "host.resumeError": "No se pudo recuperar la sala. Inténtalo de nuevo.",
      "host.replaced": "Otra pantalla tomó el control de esta sala, así que esta se detuvo. Recarga la página si quieres volver a usarla aquí.",
      "host.resumeFailed": "La sala ya no existe: pasó el tiempo de espera o el servidor se reinició. Crea una sala nueva.",
      "host.roomLost": "La sala ya no existe en el servidor (pasó el tiempo de espera o se reinició). Se abrirá la pantalla de inicio para crear otra.",
      "host.nowPlaying": "Ahora Suena",
      "host.upNext": "A Continuación",
      "host.upcoming": "Próximas 5 Canciones",
      "host.remote": "Control Remoto",
      "host.room": "Sala:",
      "host.scan": "Escanea para añadir canciones",
      "host.qrAlt": "Código QR del control remoto",
      "host.idle.title": "Escanea el código para elegir tu canción",
      "host.idle.hint": "¿No puedes escanear? Entra a {url} e introduce el código.",
      "host.paused": "En pausa",
      "host.fullscreen": "Pantalla completa",
      "host.exitFullscreen": "Salir de pantalla completa",
      "host.qrError.html": "No se pudo generar el QR. Entra manualmente a <strong>/remote.html</strong> desde tu teléfono.",
      "host.loading": "Cargando...",
      "host.nobodyWaiting": "Nadie en espera",
      "host.queueEmpty": "La cola está vacía",
      "host.noMoreSongs": "No hay más canciones en cola.",
      "host.by": "por {name}",
      "host.duration": "Duración: {time}",

      // ----- Mensajes de la API y pantallas de acceso (los arma el servidor)
      "api.songNameMissing": "Falta el nombre de la canción.",
      "api.songNotFound": "Canción no encontrada.",
      "api.songsFailed": "No se pudieron obtener las canciones.",
      "api.ratingsFailed": "No se pudieron obtener las calificaciones.",
      "api.roomGone": "La sala ya no existe.",
      "api.nameRequired": "Escribe un nombre.",
      "api.queryMissing": "Falta el término de búsqueda.",
      "api.queryTooLong": "Búsqueda demasiado larga.",
      "api.searchFailed": "No se pudo buscar en YouTube.",
      "api.tooManySearches": "Demasiadas búsquedas en YouTube. Espera un minuto.",
      "api.tooManyDownloads": "Demasiadas descargas. Espera un minuto.",
      "api.tooManyRooms": "Demasiadas salas creadas. Intenta de nuevo en un minuto.",
      "api.invalidVideoId": "ID de video inválido.",
      "api.videoTooLong": "El video es demasiado largo (máximo {minutes} minutos).",
      "api.downloadsBusy": "Ya hay demasiadas descargas en curso, intenta en un momento.",
      "api.downloadFailed": "No se pudo descargar el video.",
      "login.prompt": "Necesitas iniciar sesión para acceder al control remoto.",
      "login.google": "Iniciar sesión con Google",
      "login.deniedTitle": "Acceso denegado",
      "login.deniedBody": "Debes usar una cuenta del dominio {domain} para acceder.",
      "login.retry": "Volver a intentar",
      "user.default": "Usuario",
      "dev.defaultName": "Usuario Local",
    },

    en: {
      "remote.join.title": "Join a Room",
      "remote.join.hint": "Enter the room's 4-letter code.",
      "remote.join.nameLabel": "Your name",
      "remote.join.button": "Join",
      "remote.join.verifying": "Checking...",
      "remote.join.codeLength": "The code must be 4 letters.",
      "remote.join.nameRequired": "Enter your name.",
      "remote.join.nameSaveFailed": "Couldn't save the name.",
      "remote.join.roomMissing": 'Room "{code}" doesn\'t exist.',
      "remote.join.verifyFailed": "Couldn't check the room.",

      "remote.header": "Remote Control",
      "remote.room": "ROOM: {code}",
      "remote.hostDisconnected": "The host disconnected. Playback is paused until they reconnect.",
      "remote.turnBanner": "Get ready! Your song is about to start...",
      "remote.loading": "Loading...",
      "remote.play": "Play",
      "remote.pause": "Pause",
      "remote.pausedTag": "Paused",
      "remote.skip": "Skip song",
      "remote.userLoading": "Loading user...",
      "remote.user": "User: {name}",
      "remote.logout": "Log out",
      "remote.search.placeholder": "Search song or artist...",
      "remote.search.label": "Search song or artist",
      "remote.tab.search": "Search",
      "remote.tab.queue": "My queue",
      "remote.queue.empty": "The queue is empty",
      "queue.summary.none": "You have no songs in the queue.",
      "queue.summary.playing": "Your song is playing.",
      "queue.summary.next": "Your song is next.",
      "queue.summary.ahead.one": "1 song before your turn.",
      "queue.summary.ahead.other": "{n} songs before your turn.",
      "queue.emptyList": "No songs waiting yet. Go to Search to add yours.",
      "toast.added": "Added to the queue",
      "remote.queue.you": "you",
      "remote.queue.remove": "Remove",
      "remote.queue.moveUp": "Move up one place",
      "remote.queue.moveDown": "Move down one place",
      "rating.title": 'How was the karaoke for "{song}"?',
      "rating.hint": "Rate the video and the music, not your singing.",
      "rating.up": "Good",
      "rating.down": "Bad",
      "rating.skip": "Not now",
      "rating.total": "{up} thumbs up and {down} thumbs down, across all rooms",
      "toast.rated": "Thanks for rating!",
      "remote.nowPlaying": "{artist} - {title}",
      "remote.nowPlayingLabel": "Now playing",
      "remote.timeLeft": "{elapsed} / {total} ({remaining} left)",
      "remote.back": "Back",
      "remote.retry": "Retry",

      "library.loadFailed": "Couldn't load the songs.",
      "library.empty": "The local library is empty. Type a song name and press Enter to search for it on YouTube.",
      "library.downloads.one": "There is 1 video already downloaded from YouTube: it shows up when you search, no need to download it again.",
      "library.downloads.other": "There are {n} videos already downloaded from YouTube: they show up when you search, no need to download them again.",
      "library.alreadyDownloaded": "Already downloaded from YouTube",
      "song.unknownArtist": "Unknown",

      "confirm.cancel": "Cancel",
      "confirm.add": "Add",
      "confirm.addSong": 'Add "{title}" to the queue?',
      "confirm.skipMine": 'Skip your song "{song}"?',
      "confirm.skipOther": 'Skip "{song}", {name}\'s song?',
      "confirm.skipYes": "Skip",
      "confirm.remove": 'Remove "{title}" from the queue?',
      "confirm.removeYes": "Remove",
      "toast.offline": "No connection to the room. Try again.",
      "toast.hostBack": "The host is back: the room is available again.",
      "confirm.download": 'Download "{title}" from YouTube and add it to the queue? It may take a few seconds.',

      "yt.suffixLabel": "Search YouTube as:",
      "yt.suffixOptions": "karaoke,instrumental,backing,none",
      "yt.suffix.karaoke": "Karaoke",
      "yt.suffix.instrumental": "Instrumental",
      "yt.suffix.pista": "Pista",
      "yt.suffix.backing": "Backing track",
      "yt.suffix.none": "No extra term",
      "yt.pressEnter": "Press Enter to search YouTube.",
      "yt.noLocalMatches": "No songs found in the library. Press Enter to search for it on YouTube.",
      "yt.searchButton": "Search YouTube",
      "yt.searching": "Searching YouTube...",
      "yt.searchFailed": "Couldn't search YouTube. Try again.",
      "yt.noResults": "No results found on YouTube.",
      "yt.downloading": "Downloading from YouTube, this may take a few seconds...",
      "yt.downloadFailed": "Couldn't download the video. Try again.",

      "tour.open": "Tutorial",
      "tour.skip": "Skip tutorial",
      "tour.back": "Back",
      "tour.next": "Next",
      "tour.done": "Done",
      "tour.counter": "{current} of {total}",
      "tour.room.title": "Room code",
      "tour.room.text": "This is the room you're connected to, the same one shown on the main screen. Anyone who wants to join has to enter this code.",
      "tour.nowPlaying.title": "Now playing",
      "tour.nowPlaying.text": "Here you see the song that's playing, how far along it is and how much is left. The line below is its progress. This bar stays in place even when you scroll down the list.",
      "tour.playPause.title": "Pause and resume",
      "tour.playPause.text": "Pauses or resumes the song for the whole room. The icon shows what will happen when you tap it. It's disabled when the queue is empty.",
      "tour.skip.title": "Skip song",
      "tour.skip.text": "Skips the song that's playing, whether it's yours or someone else's. It asks you to confirm first, because it affects everyone.",
      "tour.search.title": "Search",
      "tour.search.text": "Type a song or artist name. If it isn't in the library, press Enter to search for it on YouTube: it gets downloaded and added to the queue.",
      "tour.browse.title": "Browse the library",
      "tour.browse.text": "You can also pick a letter, then an artist, and finally the song. Tapping a song asks you to confirm before adding it to the queue.",
      "tour.queue.title": "My queue",
      "tour.queue.text": "Here is everyone's queue, with your songs highlighted. The number on the tab shows how many you have, and inside you can read how long until your turn. Use the arrows and Remove to reorder or take out your own.",
      "tour.alerts.title": "Alerts",
      "tour.alerts.text": "About 10 seconds before your turn your phone vibrates and beeps. When your song ends you can rate the video and the music with a thumbs up or down.",
      "tour.help.title": "Want to see it again?",
      "tour.help.text": "Tap this button whenever you want to watch the tutorial again.",

      "host.welcome": "Click to start the session",
      "host.start": "Start",
      "host.creating": "Creating room...",
      "host.createFailed": "Couldn't create the room. Please try again.",
      "host.resume": "Recover room {code}",
      "host.resumeQueue": "Songs in the queue: {n}",
      "host.startNew": "Create a new room",
      "host.resuming": "Recovering room...",
      "host.resumeError": "Couldn't recover the room. Please try again.",
      "host.replaced": "Another screen took over this room, so this one stopped. Reload the page if you want to use it here again.",
      "host.resumeFailed": "The room no longer exists: the waiting time ran out or the server restarted. Create a new room.",
      "host.roomLost": "The room no longer exists on the server (the waiting time ran out or it restarted). The start screen will open so you can create another.",
      "host.nowPlaying": "Now Playing",
      "host.upNext": "Up Next",
      "host.upcoming": "Next 5 Songs",
      "host.remote": "Remote Control",
      "host.room": "Room:",
      "host.scan": "Scan to add songs",
      "host.qrAlt": "Remote control QR code",
      "host.idle.title": "Scan the code to pick your song",
      "host.idle.hint": "Can't scan? Go to {url} and enter the code.",
      "host.paused": "Paused",
      "host.fullscreen": "Full screen",
      "host.exitFullscreen": "Exit full screen",
      "host.qrError.html": "Couldn't generate the QR code. On your phone, go to <strong>/remote.html</strong> manually.",
      "host.loading": "Loading...",
      "host.nobodyWaiting": "Nobody waiting",
      "host.queueEmpty": "The queue is empty",
      "host.noMoreSongs": "No more songs in the queue.",
      "host.by": "by {name}",
      "host.duration": "Duration: {time}",

      "api.songNameMissing": "The song name is missing.",
      "api.songNotFound": "Song not found.",
      "api.songsFailed": "Couldn't get the songs.",
      "api.ratingsFailed": "Couldn't get the ratings.",
      "api.roomGone": "The room no longer exists.",
      "api.nameRequired": "Enter a name.",
      "api.queryMissing": "The search term is missing.",
      "api.queryTooLong": "Search is too long.",
      "api.searchFailed": "Couldn't search YouTube.",
      "api.tooManySearches": "Too many YouTube searches. Wait a minute.",
      "api.tooManyDownloads": "Too many downloads. Wait a minute.",
      "api.tooManyRooms": "Too many rooms created. Try again in a minute.",
      "api.invalidVideoId": "Invalid video ID.",
      "api.videoTooLong": "The video is too long (maximum {minutes} minutes).",
      "api.downloadsBusy": "There are too many downloads in progress, try again in a moment.",
      "api.downloadFailed": "Couldn't download the video.",
      "login.prompt": "You need to sign in to use the remote control.",
      "login.google": "Sign in with Google",
      "login.deniedTitle": "Access denied",
      "login.deniedBody": "You must use an account from the {domain} domain to sign in.",
      "login.retry": "Try again",
      "user.default": "User",
      "dev.defaultName": "Local User",
    },
  };

  // Elige el primer idioma de la lista de preferencias que esté soportado; si
  // ninguno lo está, el predeterminado. Acepta la lista de navigator.languages o
  // el texto del header Accept-Language ("es-MX,es;q=0.9,en;q=0.8"). Solo cuenta
  // el idioma, no la región: "en-GB" y "en-US" dan "en".
  function pickLanguage(preferences) {
    let tags = [];
    if (Array.isArray(preferences)) {
      tags = preferences.map((tag) => ({ tag, q: 1 }));
    } else if (typeof preferences === "string") {
      tags = preferences.split(",").map((part, index) => {
        const [tag, ...params] = part.trim().split(";");
        const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
        const q = qParam === undefined ? 1 : Number(qParam.slice(2));
        return { tag, q: Number.isNaN(q) ? 0 : q, index };
      });
      // Mayor prioridad primero; a igualdad se respeta el orden en que llegaron.
      tags.sort((a, b) => b.q - a.q || a.index - b.index);
    }
    for (const { tag, q } of tags) {
      if (typeof tag !== "string" || q <= 0) continue;
      const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
      if (SUPPORTED.includes(primary)) return primary;
    }
    return DEFAULT_LANG;
  }

  // Texto de `key` en `lang`. Si falta en ese idioma se usa el predeterminado, y
  // si falta en todos, la propia clave (así un olvido se nota en pantalla).
  // {nombre} se sustituye por params.nombre. Si hay params.n y existe la variante
  // "clave.one" / "clave.other" (según las reglas de plural del idioma), se usa esa.
  function translate(lang, key, params) {
    const table = MESSAGES[lang] || MESSAGES[DEFAULT_LANG];
    const fallback = MESSAGES[DEFAULT_LANG];
    let template;
    if (params && typeof params.n === "number") {
      const category = new Intl.PluralRules(lang in MESSAGES ? lang : DEFAULT_LANG).select(params.n);
      // Categorías como "many" (español, millones) o "few" (otros idiomas) que no
      // tengan variante propia caen en "other".
      for (const cat of [category, "other"]) {
        template = template ?? table[`${key}.${cat}`] ?? fallback[`${key}.${cat}`];
      }
    }
    template = template ?? table[key] ?? fallback[key] ?? key;
    // Con una función, "$&" o "$1" dentro de un valor no se interpretan como patrones.
    return template.replace(/\{(\w+)\}/g, (whole, name) =>
      params && params[name] !== undefined ? String(params[name]) : whole
    );
  }

  // Traduce los elementos marcados de un documento:
  //   data-i18n="clave"              -> textContent
  //   data-i18n-html="clave"         -> innerHTML (solo textos propios con <strong>; ver test)
  //   data-i18n-placeholder / -aria-label / -title / -alt="clave" -> ese atributo
  function applyTranslations(lang, doc) {
    doc.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = translate(lang, el.getAttribute("data-i18n"));
    });
    doc.querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = translate(lang, el.getAttribute("data-i18n-html"));
    });
    for (const attr of ["placeholder", "aria-label", "title", "alt"]) {
      doc.querySelectorAll(`[data-i18n-${attr}]`).forEach((el) => {
        el.setAttribute(attr, translate(lang, el.getAttribute(`data-i18n-${attr}`)));
      });
    }
  }

  return { DEFAULT_LANG, SUPPORTED, MESSAGES, pickLanguage, translate, applyTranslations };
});
