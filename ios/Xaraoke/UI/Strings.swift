// Los mismos textos que public/js/i18n.js del remoto web, más los propios de la app.
// Equivalente a android/.../res/values/strings.xml (es) y values-en/strings.xml (en).
//
// Se resuelve por clave con L("clave", args...). El idioma sale del sistema (español si el idioma
// preferido empieza por "es"; inglés si no). Los argumentos usan orden posicional (%1$@, %2$@ en
// Android → aquí se pasan como lista y se sustituyen en orden).

import Foundation

func L(_ key: String, _ args: CVarArg...) -> String {
    let table = Strings.isSpanish ? Strings.es : Strings.en
    guard let template = table[key] else { return key }
    if args.isEmpty { return template }
    return formatPositional(template, args)
}

// Plural: elige la forma según `count` (1 = "one", resto = "other") y sustituye %d por el número.
func LPlural(_ key: String, _ count: Int) -> String {
    let table = Strings.isSpanish ? Strings.esPlural : Strings.enPlural
    guard let forms = table[key] else { return key }
    let template = count == 1 ? forms.one : forms.other
    return template.replacingOccurrences(of: "%d", with: "\(count)")
}

// Sustituye %1$@ / %2$@ / %1$s… por los argumentos en orden. Android usa %n$s/%n$d; aquí basta con
// reemplazar los marcadores posicionales por el argumento correspondiente convertido a texto.
private func formatPositional(_ template: String, _ args: [CVarArg]) -> String {
    var result = template
    for (i, arg) in args.enumerated() {
        let n = i + 1
        let value = "\(arg)"
        for spec in ["%\(n)$@", "%\(n)$s", "%\(n)$d"] {
            result = result.replacingOccurrences(of: spec, with: value)
        }
    }
    return result
}

struct PluralForms { let one: String; let other: String }

enum Strings {
    static var isSpanish: Bool {
        (Locale.preferredLanguages.first ?? "en").lowercased().hasPrefix("es")
    }

    static let es: [String: String] = [
        "app_name": "Xaraoke",
        // Servidor
        "server_title": "Conéctate a tu karaoke",
        "server_hint": "Escanea el código QR de la pantalla principal o escribe la dirección del servidor.",
        "server_label": "Dirección del servidor",
        "server_placeholder": "192.168.0.72:8081",
        "server_connect": "Conectar",
        "server_invalid": "Esa no parece una dirección válida.",
        "server_unreachable": "No se pudo conectar con %1$@. ¿El teléfono está en la misma red?",
        "server_outdated": "El servidor de %1$@ necesita actualizarse para usar la app (inicio de sesión con Google). Actualízalo y vuelve a intentar.",
        "server_current": "Servidor: %1$@",
        "server_change": "Cambiar",
        "server_connecting": "Conectando con el servidor…",
        // Unirse
        "join_title": "Unirse a una Sala",
        "join_hint": "Introduce el código de 4 letras de la sala.",
        "join_code_label": "Código de sala",
        "join_name_label": "Tu nombre",
        "join_button": "Unirse",
        "join_verifying": "Verificando…",
        "join_code_length": "El código debe tener 4 letras.",
        "join_name_required": "Escribe tu nombre.",
        "join_room_missing": "La sala \"%1$@\" no existe.",
        "join_saved_room_gone": "La sala \"%1$@\" ya no existe. Escribe el código de una sala nueva.",
        "join_verify_failed": "Error al verificar la sala.",
        "join_scan": "Escanear código QR",
        "scan_not_found": "No se reconoció un código de sala en ese QR. Prueba de nuevo.",
        "scan_unavailable": "El lector de QR no está disponible en este teléfono.",
        // Inicio de sesión
        "login_prompt": "Este servidor pide iniciar sesión con tu cuenta de Google.",
        "login_google": "Iniciar sesión con Google",
        "login_signing_in": "Iniciando sesión…",
        "login_failed": "No se pudo iniciar sesión con Google.",
        "login_domain_hint": "Usa una cuenta de %1$@.",
        "signed_in_as": "Sesión iniciada como %1$@",
        "sign_out": "Cerrar sesión",
        // Sala
        "room_code": "SALA: %1$@",
        "user": "Usuario: %1$@",
        "leave_room": "Cambiar sala",
        "menu": "Más opciones",
        "notification_settings": "Ajustes de avisos",
        "host_disconnected": "El host se desconectó. La reproducción está pausada hasta que vuelva a conectarse.",
        "host_disconnected_short": "El host se desconectó",
        "conn_retrying": "Sin conexión con el servidor. Reintentando…",
        "conn_room_gone": "La sala ya no existe (pasó el tiempo de espera o se reinició el servidor). Vuelve a unirte con un código.",
        "conn_session_expired": "Tu sesión venció. Vuelve a iniciar sesión para seguir en la sala.",
        "conn_rejected": "El servidor rechazó la conexión. Intenta unirte de nuevo.",
        "api_name_taken": "Alguien en la sala ya usa ese nombre. Elige otro (por ejemplo, agrega tu apellido).",
        "turn_banner": "¡Prepárate! Tu canción está por empezar…",
        "play": "Reproducir",
        "pause": "Pausar",
        "paused_tag": "En pausa",
        "controls_locked": "Solo quien canta puede pausar. Con el botón de saltar votas para saltarla",
        "vote_skip": "Votar para saltar (%1$@ de %2$@)",
        "vote_skip_done": "Ya votaste para saltar (%1$@ de %2$@)",
        "skip": "Saltar canción",
        "now_playing": "%1$@ - %2$@",
        "now_playing_label": "Ahora suena",
        "time_left": "%1$@ / %2$@ (Faltan %3$@)",
        "unknown_artist": "Desconocido",
        // Pestañas
        "tab_search": "Buscar",
        "tab_queue": "Mi lista",
        "search_placeholder": "Buscar canción o artista…",
        "queue_empty": "La lista está vacía",
        "queue_summary_none": "No tienes canciones en la lista.",
        "queue_summary_playing": "Tu canción está sonando.",
        "queue_summary_next": "Tu canción es la siguiente.",
        "queue_empty_list": "No hay canciones en espera todavía. Ve a Buscar para añadir la tuya.",
        "queue_you": "tú",
        "queue_remove": "Quitar",
        "move_up": "Subir una posición",
        "move_down": "Bajar una posición",
        // Calificar
        "rating_title": "¿Cómo estuvo el karaoke de \"%1$@\"?",
        "rating_hint": "Califica el video y la música, no cómo cantaste.",
        "rating_up": "Bien",
        "rating_down": "Mal",
        "rating_skip": "Ahora no",
        "rating_total": "%1$@ a favor y %2$@ en contra, sumando todas las salas",
        // Biblioteca
        "back": "Volver",
        "retry": "Reintentar",
        "loading": "Cargando…",
        "library_load_failed": "No se pudieron cargar las canciones.",
        "library_empty": "La biblioteca local está vacía. Escribe el nombre de una canción y toca Buscar en el teclado para buscarla en YouTube.",
        "library_already_downloaded": "Ya descargado de YouTube",
        // Confirmaciones y mensajes
        "confirm_cancel": "Cancelar",
        "confirm_add": "Añadir",
        "confirm_add_song": "¿Añadir \"%1$@\" a la lista?",
        "confirm_skip_mine": "¿Saltar tu canción \"%1$@\"?",
        "confirm_skip_other": "¿Saltar \"%1$@\", la canción de %2$@?",
        "confirm_skip_yes": "Saltar",
        "confirm_remove": "¿Quitar \"%1$@\" de la lista?",
        "confirm_remove_yes": "Quitar",
        "confirm_download": "¿Descargar \"%1$@\" desde YouTube y agregarla a la lista? Puede tardar unos segundos.",
        "toast_added": "Añadida a la lista",
        "toast_rated": "¡Gracias por calificar!",
        "toast_offline": "Sin conexión con la sala. Inténtalo de nuevo.",
        "toast_host_back": "El host volvió: la sala está disponible de nuevo.",
        // YouTube
        "yt_press_enter": "Toca Buscar en el teclado para buscar en YouTube.",
        "yt_no_local_matches": "No se encontraron canciones en la biblioteca. Toca Buscar en el teclado para buscarla en YouTube.",
        "yt_search_button": "Buscar en YouTube",
        "yt_searching": "Buscando en YouTube…",
        "yt_search_failed": "No se pudo buscar en YouTube. Intenta de nuevo.",
        "yt_no_results": "No se encontraron resultados en YouTube.",
        "yt_fallback_instrumental": "No hubo versiones karaoke: estas son versiones instrumentales.",
        "yt_fallback_none": "No hubo versiones karaoke ni instrumentales: estos son los resultados de tu búsqueda, tal cual.",
        "yt_downloading": "Descargando desde YouTube, esto puede tardar unos segundos…",
        "yt_download_failed": "No se pudo descargar el video. Intenta de nuevo.",
        // Compartir desde YouTube
        "share_confirm": "¿Descargar este video de YouTube y agregarlo a la lista? Puede tardar unos segundos.",
        "share_not_youtube": "Lo que compartiste no es un video de YouTube.",
        "share_join_first": "Únete a una sala y el video se agregará a la lista.",
        "notifications_denied": "Sin permiso de notificaciones no podremos avisarte cuando te toque con el teléfono bloqueado.",
        // Notificaciones
        "notif_turn_title": "¡Te toca cantar en unos segundos!",
        "notif_playing_title": "¡Tu canción está empezando!",
        // Tutorial
        "tour_open": "Tutorial",
        "tour_skip": "Saltar tutorial",
        "tour_back": "Atrás",
        "tour_next": "Siguiente",
        "tour_done": "Listo",
        "tour_counter": "%1$@ de %2$@",
        "tour_room_title": "Código de sala",
        "tour_room_text": "Es la sala a la que estás conectado, la misma que se ve en la pantalla principal. Quien quiera unirse tiene que escribir este código o escanear el QR de la pantalla.",
        "tour_now_playing_title": "Ahora suena",
        "tour_now_playing_text": "Aquí ves la canción que suena, cuánto lleva y cuánto falta. La línea de abajo es su avance. Esta barra se queda fija aunque bajes por la lista.",
        "tour_play_pause_title": "Pausar y reanudar",
        "tour_play_pause_text": "Pausa o reanuda tu canción para toda la sala. El ícono muestra lo que pasará al tocarlo. Solo funciona mientras suena la tuya: con la de otra persona (o sin nada en la lista) está desactivado.",
        "tour_skip_title": "Saltar canción",
        "tour_skip_text": "Salta tu canción mientras suena; antes te pide confirmar. Con la de otra persona sirve para votar: el anillo se ilumina con cada voto y, al completarse, la canción se salta. Si esa persona lleva un rato sin conexión, salta directo.",
        "tour_search_title": "Buscador",
        "tour_search_text": "Escribe el nombre de una canción o de un artista. Si no está en la biblioteca, toca Buscar en el teclado para buscarla en YouTube: se descarga y se añade a la lista. También puedes compartir un video desde la app de YouTube con Compartir → Xaraoke.",
        "tour_browse_title": "Explorar la biblioteca",
        "tour_browse_text": "También puedes elegir una letra, luego un artista y al final la canción. Al tocar una canción te pide confirmar antes de añadirla a la lista.",
        "tour_queue_title": "Mi lista",
        "tour_queue_text": "Aquí está la lista de todos, con tus canciones resaltadas. El número junto a \"Mi lista\" indica cuántas tienes, y dentro se lee cuánto falta para tu turno. Con las flechas y con Quitar reordenas o sacas las tuyas.",
        "tour_alerts_title": "Avisos",
        "tour_alerts_text": "Unos 10 segundos antes de tu turno el teléfono vibra y suena, aunque esté bloqueado o tengas la app cerrada. Mientras estés en la sala verás una notificación con lo que suena y cuánto falta para tu turno. Cuando termina tu canción puedes calificar el video y la música con un pulgar arriba o abajo.",
        "tour_help_title": "¿Quieres verlo otra vez?",
        "tour_help_text": "El tutorial está en este menú, junto con Cambiar sala y Ajustes de avisos (para elegir cómo suena y vibra el aviso de tu turno).",
    ]

    static let en: [String: String] = [
        "app_name": "Xaraoke",
        "server_title": "Connect to your karaoke",
        "server_hint": "Scan the QR code on the main screen or type the server address.",
        "server_label": "Server address",
        "server_placeholder": "192.168.0.72:8081",
        "server_connect": "Connect",
        "server_invalid": "That doesn't look like a valid address.",
        "server_unreachable": "Couldn't connect to %1$@. Is the phone on the same network?",
        "server_outdated": "The server at %1$@ needs an update to work with the app (Google sign-in). Update it and try again.",
        "server_current": "Server: %1$@",
        "server_change": "Change",
        "server_connecting": "Connecting to the server…",
        "join_title": "Join a Room",
        "join_hint": "Enter the room's 4-letter code.",
        "join_code_label": "Room code",
        "join_name_label": "Your name",
        "join_button": "Join",
        "join_verifying": "Checking…",
        "join_code_length": "The code must be 4 letters.",
        "join_name_required": "Enter your name.",
        "join_room_missing": "Room \"%1$@\" doesn't exist.",
        "join_saved_room_gone": "Room \"%1$@\" no longer exists. Enter the code of a new room.",
        "join_verify_failed": "Couldn't check the room.",
        "join_scan": "Scan QR code",
        "scan_not_found": "Couldn't recognize a room code in that QR. Try again.",
        "scan_unavailable": "The QR scanner isn't available on this phone.",
        "login_prompt": "This server asks you to sign in with your Google account.",
        "login_google": "Sign in with Google",
        "login_signing_in": "Signing in…",
        "login_failed": "Couldn't sign in with Google.",
        "login_domain_hint": "Use a %1$@ account.",
        "signed_in_as": "Signed in as %1$@",
        "sign_out": "Sign out",
        "room_code": "ROOM: %1$@",
        "user": "User: %1$@",
        "leave_room": "Change room",
        "menu": "More options",
        "notification_settings": "Alert settings",
        "host_disconnected": "The host disconnected. Playback is paused until they reconnect.",
        "host_disconnected_short": "The host disconnected",
        "conn_retrying": "No connection to the server. Retrying…",
        "conn_room_gone": "This room no longer exists (it timed out or the server restarted). Join again with a code.",
        "conn_session_expired": "Your session expired. Sign in again to stay in the room.",
        "conn_rejected": "The server refused the connection. Try joining again.",
        "api_name_taken": "Someone in this room already uses that name. Pick another one (for example, add your last name).",
        "turn_banner": "Get ready! Your song is about to start…",
        "play": "Play",
        "pause": "Pause",
        "paused_tag": "Paused",
        "controls_locked": "Only the singer can pause. The skip button lets you vote to skip it",
        "vote_skip": "Vote to skip (%1$@ of %2$@)",
        "vote_skip_done": "You voted to skip (%1$@ of %2$@)",
        "skip": "Skip song",
        "now_playing": "%1$@ - %2$@",
        "now_playing_label": "Now playing",
        "time_left": "%1$@ / %2$@ (%3$@ left)",
        "unknown_artist": "Unknown",
        "tab_search": "Search",
        "tab_queue": "My queue",
        "search_placeholder": "Search song or artist…",
        "queue_empty": "The queue is empty",
        "queue_summary_none": "You have no songs in the queue.",
        "queue_summary_playing": "Your song is playing.",
        "queue_summary_next": "Your song is next.",
        "queue_empty_list": "No songs waiting yet. Go to Search to add yours.",
        "queue_you": "you",
        "queue_remove": "Remove",
        "move_up": "Move up one place",
        "move_down": "Move down one place",
        "rating_title": "How was the karaoke for \"%1$@\"?",
        "rating_hint": "Rate the video and the music, not your singing.",
        "rating_up": "Good",
        "rating_down": "Bad",
        "rating_skip": "Not now",
        "rating_total": "%1$@ thumbs up and %2$@ thumbs down, across all rooms",
        "back": "Back",
        "retry": "Retry",
        "loading": "Loading…",
        "library_load_failed": "Couldn't load the songs.",
        "library_empty": "The local library is empty. Type a song name and tap Search on the keyboard to find it on YouTube.",
        "library_already_downloaded": "Already downloaded from YouTube",
        "confirm_cancel": "Cancel",
        "confirm_add": "Add",
        "confirm_add_song": "Add \"%1$@\" to the queue?",
        "confirm_skip_mine": "Skip your song \"%1$@\"?",
        "confirm_skip_other": "Skip \"%1$@\", %2$@'s song?",
        "confirm_skip_yes": "Skip",
        "confirm_remove": "Remove \"%1$@\" from the queue?",
        "confirm_remove_yes": "Remove",
        "confirm_download": "Download \"%1$@\" from YouTube and add it to the queue? It may take a few seconds.",
        "toast_added": "Added to the queue",
        "toast_rated": "Thanks for rating!",
        "toast_offline": "No connection to the room. Try again.",
        "toast_host_back": "The host is back: the room is available again.",
        "yt_press_enter": "Tap Search on the keyboard to search YouTube.",
        "yt_no_local_matches": "No songs found in the library. Tap Search on the keyboard to find it on YouTube.",
        "yt_search_button": "Search YouTube",
        "yt_searching": "Searching YouTube…",
        "yt_search_failed": "Couldn't search YouTube. Try again.",
        "yt_no_results": "No results found on YouTube.",
        "yt_fallback_instrumental": "No karaoke versions found: these are instrumental versions.",
        "yt_fallback_none": "No karaoke or instrumental versions found: these are the results for your search as typed.",
        "yt_downloading": "Downloading from YouTube, this may take a few seconds…",
        "yt_download_failed": "Couldn't download the video. Try again.",
        "share_confirm": "Download this YouTube video and add it to the queue? It may take a few seconds.",
        "share_not_youtube": "What you shared isn't a YouTube video.",
        "share_join_first": "Join a room and the video will be added to the queue.",
        "notifications_denied": "Without notification permission we can't alert you when it's your turn with the phone locked.",
        "notif_turn_title": "You're up in a few seconds!",
        "notif_playing_title": "Your song is starting!",
        "tour_open": "Tutorial",
        "tour_skip": "Skip tutorial",
        "tour_back": "Back",
        "tour_next": "Next",
        "tour_done": "Done",
        "tour_counter": "%1$@ of %2$@",
        "tour_room_title": "Room code",
        "tour_room_text": "This is the room you're connected to, the same one shown on the main screen. Anyone who wants to join has to enter this code or scan the QR code on the screen.",
        "tour_now_playing_title": "Now playing",
        "tour_now_playing_text": "Here you see the song that's playing, how far along it is and how much is left. The line below is its progress. This bar stays in place even when you scroll down the list.",
        "tour_play_pause_title": "Pause and resume",
        "tour_play_pause_text": "Pauses or resumes your song for the whole room. The icon shows what will happen when you tap it. It only works while yours is playing: with someone else's song (or an empty queue) it's disabled.",
        "tour_skip_title": "Skip song",
        "tour_skip_text": "Skips your song while it's playing; it asks you to confirm first. With someone else's song it casts a vote: the ring lights up with each vote and, once it's full, the song is skipped. If that person has been offline for a while, it skips directly.",
        "tour_search_title": "Search",
        "tour_search_text": "Type a song or artist name. If it isn't in the library, tap Search on the keyboard to find it on YouTube: it gets downloaded and added to the queue. You can also share a video from the YouTube app with Share → Xaraoke.",
        "tour_browse_title": "Browse the library",
        "tour_browse_text": "You can also pick a letter, then an artist, and finally the song. Tapping a song asks you to confirm before adding it to the queue.",
        "tour_queue_title": "My queue",
        "tour_queue_text": "Here is everyone's queue, with your songs highlighted. The number next to \"My queue\" shows how many you have, and inside you can read how long until your turn. Use the arrows and Remove to reorder or take out your own.",
        "tour_alerts_title": "Alerts",
        "tour_alerts_text": "About 10 seconds before your turn your phone vibrates and beeps, even when it's locked or the app is closed. While you're in the room you'll see a notification with what's playing and how long until your turn. When your song ends you can rate the video and the music with a thumbs up or down.",
        "tour_help_title": "Want to see it again?",
        "tour_help_text": "The tutorial is in this menu, along with Change room and Alert settings (to choose how your turn alert sounds and vibrates).",
    ]

    static let esPlural: [String: PluralForms] = [
        "queue_summary_ahead": PluralForms(one: "Antes de tu turno hay 1 canción.", other: "Antes de tu turno hay %d canciones."),
        "library_downloads": PluralForms(
            one: "Hay 1 video ya descargado de YouTube: aparece al buscar, sin volver a descargarlo.",
            other: "Hay %d videos ya descargados de YouTube: aparecen al buscar, sin volver a descargarlos."),
        "toast_queue_full": PluralForms(
            one: "La lista de la sala está llena (%d canción). Espera a que se libere un lugar.",
            other: "La lista de la sala está llena (%d canciones). Espera a que se libere un lugar."),
        "toast_personal_limit": PluralForms(
            one: "Ya tienes %d canción esperando. Agrega otra cuando te toque.",
            other: "Ya tienes %d canciones esperando. Agrega otra cuando te toque alguna."),
    ]

    static let enPlural: [String: PluralForms] = [
        "queue_summary_ahead": PluralForms(one: "1 song before your turn.", other: "%d songs before your turn."),
        "library_downloads": PluralForms(
            one: "There is 1 video already downloaded from YouTube: it shows up when you search, no need to download it again.",
            other: "There are %d videos already downloaded from YouTube: they show up when you search, no need to download them again."),
        "toast_queue_full": PluralForms(
            one: "The room's queue is full (%d song). Wait for a slot to free up.",
            other: "The room's queue is full (%d songs). Wait for a slot to free up."),
        "toast_personal_limit": PluralForms(
            one: "You already have %d song waiting. Add another once it plays.",
            other: "You already have %d songs waiting. Add another once one of yours plays."),
    ]
}
