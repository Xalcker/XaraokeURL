# App iOS de XaraokeURL

Control remoto nativo para iPhone/iPad. Puerto de la app Android de [`../android`](../android): habla con el mismo servidor Node por REST + WebSocket, con el mismo protocolo que `public/remote.js`.

El plan completo por fases está en el chat que generó este código.

## Qué instalar

- **Xcode completo** (Mac App Store). Las Command Line Tools no bastan: hacen falta el compilador de apps iOS, el Simulator, `xcodebuild` y XCTest.
  - Una vez: `sudo xcodebuild -license accept` y `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
- **Nada más para las Fases 1–3.** REST y WebSocket usan `URLSession` (Foundation); la reconexión por red usa `NWPathMonitor` (framework `Network`); cookies y prefs usan `HTTPCookieStorage` / `UserDefaults`. Todo viene en el SDK.
- Más adelante (Fase 4): Google Sign-In SDK, que se añade con Swift Package Manager desde Xcode.

## Estado

**Fase 1 (Core) — hecha.** Lógica pura portada desde `android/.../core/`, con la misma cobertura de pruebas que `CoreTest.kt` y `TourLayoutTest.kt`.

**Fase 2 (red y sala) — hecha.** Compila limpio con `swiftc -typecheck`.

| Archivo | Equivalente Android |
|---|---|
| `Xaraoke/Net/HttpClient.swift` | `OkHttpClient` de `AppController.kt` — sin seguir redirects, Accept-Language, timeouts |
| `Xaraoke/Net/CookiePersistence.swift` | `net/PersistentCookieJar.kt` — cookie de sesión entre aperturas |
| `Xaraoke/Net/ServerApi.swift` | `net/ServerApi.kt` — rutas `/api/*` con async/await |
| `Xaraoke/Room/RoomState.swift` | `room/RoomState.kt` — estado derivado de la sala |
| `Xaraoke/Room/RoomConnection.swift` | `room/RoomConnection.kt` — WebSocket, protocolo de `public/remote.js`, reconexión |
| `Xaraoke/AppController.swift` | `AppController.kt` — servidor, sesión, auto-join, biblioteca, salidas |

**Fase 5 (aviso con la app cerrada: push + Live Activity) — hecha.** Toca cliente iOS y servidor. La lógica no-UI iOS compila con CLT; el servidor pasa sus 489 pruebas (`npm test`).

Cliente iOS:

| Archivo | Qué hace |
|---|---|
| `Xaraoke/Room/PushRegistration.swift` | Registra el device token de APNs y lo manda al servidor (`/api/push/register`) |
| `Xaraoke/AppDelegate.swift` | Recibe el token de APNs (vía `@UIApplicationDelegateAdaptor`) |
| `Xaraoke/Room/RoomActivity.swift` | Atributos de la Live Activity (compartidos app/widget) |
| `Xaraoke/Room/RoomActivityManager.swift` | Arranca/actualiza/termina la Live Activity; reporta su push token |
| `XaraokeWidget/RoomActivityWidget.swift` | Vista de la Live Activity (pantalla de bloqueo + Isla Dinámica) |
| `XaraokeWidget/XaraokeWidgetBundle.swift` | Entrada del target de widget |

Servidor (cambios aditivos, no-op sin APNs configurado):

| Archivo | Qué hace |
|---|---|
| `src/push.js` (nuevo) | Tokens por persona/sala, detección de turno (replica `TurnTracker`), envío APNs por HTTP/2 con JWT ES256 (sin dependencia npm) |
| `src/realtime.js` | Hooks aditivos `push.onQueue/onTime/onRoomGone/updateActivities` en los puntos de difusión |
| `src/routes/api.js` | Rutas `/api/push/register`, `/unregister`, `/activity` |
| `server.js` | Crea `push`, lo pasa a `mountApi`/`createRealtime`, lo cierra al apagar |

### Configuración necesaria (Fase 5)

- **iOS:** capacidades "Push Notifications", "Background Modes → Remote notifications" y "Live Activities" (`NSSupportsLiveActivities = YES` en Info.plist); target de widget `XaraokeWidget`. Requiere dispositivo real para probar la entrega de push.
- **Servidor:** variables de entorno `APNS_KEY_PATH` (archivo .p8), `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` (y `APNS_PRODUCTION=true` en producción). Sin ellas, `push.enabled` es `false` y el servidor se comporta igual que hoy.
- **Apple Developer:** una key APNs (.p8) con el permiso de push.

**Fase 4 (integraciones nativas) — hecha.** La lógica no-UI compila limpio con CLT; los archivos con UIKit/VisionKit/UserNotifications y SwiftUI se verifican en Xcode (las CLT no traen esos frameworks ni el plugin de macros de SwiftUI).

| Archivo | Equivalente Android |
|---|---|
| `Xaraoke/Room/Notifications.swift` | `room/Notifications.kt` — aviso de turno (sonido/haptics en primer plano, notificación time-sensitive si no) y sesión vencida; implementa `RoomNotifying` |
| `Xaraoke/UI/QRScanner.swift` | `scanQrCode` de `ui/PlayServices.kt` — lector QR con Vision (`DataScannerViewController`) |
| `Xaraoke/UI/GoogleSignIn.swift` | `signInWithGoogle` de `ui/PlayServices.kt` — SDK GoogleSignIn, ID token → `/api/auth/google-token` |
| `XaraokeShare/ShareViewController.swift` | intent-filter `ACTION_SEND` de `MainActivity.kt` — Share Extension de YouTube |

Enlaces añadidos: `XaraokeApp` cablea el escáner, el inicio de sesión con Google (por `googleSignInRequest`), el permiso de notificaciones al entrar a una sala, y `onOpenURL` para `xaraoke://` (unirse), la vuelta de Google y `xaraoke://share?video=<id>` de la extensión.

### Configuración necesaria en Xcode (Fase 4)

- **Cámara (QR):** en `Info.plist`, `NSCameraUsageDescription`. El QR requiere iPhone real (el Simulator no tiene cámara; el escáner reporta "no disponible").
- **Google Sign-In:** añadir el paquete [`GoogleSignIn-iOS`](https://github.com/google/GoogleSignIn-iOS) por Swift Package Manager; en `Info.plist`, `GIDClientID` (client iOS) y un `CFBundleURLTypes` con el `REVERSED_CLIENT_ID`; registrar en Google Cloud un OAuth Client ID **iOS** con el Bundle ID. Sin el paquete, el código compila igual (`#if canImport(GoogleSignIn)`) pero el login con Google queda deshabilitado.
- **Notificaciones:** capacidad Push/User Notifications; opcional `turn_alert.caf` (convertido de `public/notification.mp3`) en el bundle para el sonido del aviso; sin él se usa el sonido por defecto.
- **Share Extension:** target aparte (`XaraokeShare`); en su `Info.plist`, `NSExtensionActivationRule` que acepte una URL/texto; añadir `Core/JoinLink.swift` (que trae `youtubeVideoId`) también a ese target; ambos targets comparten el esquema `xaraoke://`.

**Fase 3 (UI SwiftUI) — hecha.** La lógica no-UI compila con CLT; la UI SwiftUI se verificó con `swiftc -typecheck` (sin errores de símbolos ni de tipos; los únicos fallos son los macros `@State`/`@StateObject` que solo Xcode puede expandir).

| Archivo | Equivalente Android |
|---|---|
| `Xaraoke/XaraokeApp.swift` | `XaraokeApp.kt` + `MainActivity.kt` — `@main`, foreground, deep link `xaraoke://` |
| `Xaraoke/UI/Theme.swift` | `ui/Theme.kt` — colores de marca y fondo degradado |
| `Xaraoke/UI/Strings.swift` | `res/values*/strings.xml` — textos ES/EN + plurales, resolver `L(...)`/`LPlural(...)` |
| `Xaraoke/UI/AppRoot.swift` | `ui/AppRoot.kt` — navegación, confirmaciones, "descargando", toasts, share |
| `Xaraoke/UI/JoinScreen.swift` | `ui/JoinScreen.kt` — servidor, sala, nombre/Google |
| `Xaraoke/UI/RoomScreen.swift` | `ui/RoomScreen.kt` — encabezado, mini-reproductor, avisos, votos de skip, calificar, layout adaptable |
| `Xaraoke/UI/QueuePanel.swift` | `ui/QueuePanel.kt` — "Mi lista" con subir/bajar/quitar |
| `Xaraoke/UI/SearchPanel.swift` | `ui/SearchPanel.kt` — explorador, búsqueda local y YouTube |
| `Xaraoke/UI/TourView.swift` | `ui/Tour.kt` (parcial) — pasos y textos del tutorial |

| Archivo | Equivalente Android |
|---|---|
| `Xaraoke/Core/Reconnect.swift` | `core/Reconnect.kt` — códigos de cierre y backoff 3s→30s |
| `Xaraoke/Core/Models.swift` | `core/Models.kt` — modelos del servidor |
| `Xaraoke/Core/TurnTracker.swift` | `core/TurnTracker.kt` — cuándo avisar el turno |
| `Xaraoke/Core/Songs.swift` | `core/Songs.kt` — mostrar y buscar canciones |
| `Xaraoke/Core/JoinLink.swift` | `core/JoinLink.kt` — QR, enlaces, id de YouTube |
| `Xaraoke/Core/TourLayout.swift` | `core/TourLayout.kt` — posición de la tarjeta del tutorial |
| `XaraokeTests/CoreTests.swift` | `test/.../CoreTest.kt` |
| `XaraokeTests/TourLayoutTests.swift` | `test/.../TourLayoutTest.kt` |

Las cinco fases del plan están completas. Falta lo que solo se puede hacer dentro de Xcode: crear el proyecto `.xcodeproj` con sus targets (app, `XaraokeShare`, `XaraokeWidget`), añadir el paquete GoogleSignIn, los assets (logo, íconos, `turn_alert.caf`), las capacidades y el Info.plist, y correr en Simulator/dispositivo.

## Info.plist y entitlements de referencia

Ya están escritos, listos para usar o copiar al proyecto de Xcode. Reemplaza los marcadores `<...>`:

| Archivo | Target | Qué configura |
|---|---|---|
| `Xaraoke/Info.plist` | app | `GIDClientID` y `<REVERSED_CLIENT_ID>` (Google), esquema `xaraoke`, permiso de cámara, Live Activities, background remote-notification, HTTP en red local, orientaciones |
| `Xaraoke/Xaraoke.entitlements` | app | `aps-environment` (push); en Xcode se activa como capacidad "Push Notifications" |
| `XaraokeShare/Info.plist` | Share Extension | punto de extensión de compartir y la regla de activación (URL o texto) |
| `XaraokeWidget/Info.plist` | Widget | punto de extensión de WidgetKit (Live Activity) |

Placeholders a sustituir (vienen del `GoogleService-Info.plist` que descargas al crear el client OAuth iOS en Google Cloud):
- `<GID_CLIENT_ID>` → el client ID iOS (`...apps.googleusercontent.com`).
- `<REVERSED_CLIENT_ID>` → su forma invertida (`com.googleusercontent.apps....`).

Si no vas a usar Google (servidor con `DISABLE_GOOGLE_AUTH=true`), puedes quitar `GIDClientID` y el segundo `CFBundleURLTypes`; el login por nombre no los necesita.

Notas de la Fase 5:
- El aviso de turno con la app abierta lo da la app (haptics); con la app cerrada lo da el servidor por push, replicando la misma lógica de `TurnTracker` del lado servidor sobre los `timeUpdate`/`queueUpdate` que ya recibía.
- El "faltan N para tu turno" de la Live Activity depende de la persona; el `ContentState` lo lleva y el servidor lo envía por-token. El envío del `songsAhead` por persona en la actualización de la actividad quedó como refinamiento (hoy la actividad se actualiza con lo común: qué suena, pausa, host).
- APNs se habla con `http2` nativo y JWT ES256 con `crypto` nativo: sin dependencias npm nuevas.

Notas de la Fase 4:
- El aviso de turno con la app abierta usa haptics; el sonido audible con la app en primer plano (reproducir `turn_alert` con `AVAudioPlayer`) quedó marcado como mejora opcional. Con la app cerrada, el aviso real llega en la Fase 5 (iOS suspende el WebSocket propio en segundo plano).
- `GoogleSignIn.swift` está detrás de `#if canImport(GoogleSignIn)`: compila sin el paquete, pero hay que añadirlo para que el login con Google funcione.

Notas de la Fase 3:
- Faltan recursos que se añaden al crear el proyecto Xcode: el `Assets.xcassets` con la imagen `logo` (de `public/img/logo.svg`) y los íconos de la app. Sin `logo` en assets, `Image("logo")` de `JoinScreen` no se ve, pero no rompe el build.
- El escáner de QR está en stub (`JoinScreen.scan` → aviso "no disponible"); se completa en la Fase 4 (Vision/DataScanner) junto con Google Sign-In, Share Extension y notificaciones.
- El tour de la Fase 3 es una versión por tarjetas con los pasos y textos correctos; el resaltado del elemento concreto sobre la pantalla (con `tourCardPosition`) se afinará después.
- Los textos se resuelven con `L("clave", args...)` desde `Strings.swift`. Al crear el proyecto se puede migrar a `Localizable.xcstrings` si se prefiere el catálogo nativo; el resolver actual mantiene los textos versionables y no depende del catálogo.

Notas de la Fase 2:
- Los avisos de notificación se delegan en el protocolo `RoomNotifying` (en `AppController.swift`), con una implementación vacía (`NoopNotifying`) por ahora. La Fase 4 la reemplazará por una real (UNUserNotificationCenter / Live Activities).
- Los errores y mensajes de `SessionState`/`toast` son claves de texto (p. ej. `join_room_missing`); la Fase 3 las mapea a `Localizable.xcstrings` ES/EN, salvo los errores que ya vienen traducidos del servidor (`ApiException.serverMessage`), que se muestran tal cual.
- El código de cierre del WebSocket del servidor (4001/4004/4009) se lee de `URLSessionWebSocketTask.closeCode` cuando `receive` falla.

## Cómo compilar y probar

Todavía no hay proyecto Xcode (`.xcodeproj`); estos son archivos fuente listos para integrar. Para correr las pruebas hace falta **Xcode completo** (las Command Line Tools no traen XCTest).

Al crear el proyecto en Xcode:

1. **File → New → Project → iOS → App**, nombre `Xaraoke`, interfaz SwiftUI, lenguaje Swift, iOS 16 mínimo, Bundle ID `xyz.xalcker.xaraoke`.
2. Añadir los archivos de `Xaraoke/Core/` al target de la app.
3. Añadir un **Unit Testing Bundle** (`XaraokeTests`) e incluir los archivos de `XaraokeTests/`.
4. `Cmd+U` para correr las pruebas (o `xcodebuild test -scheme Xaraoke -destination 'platform=iOS Simulator,name=iPhone 15'`).

Durante la Fase 1 la lógica se validó compilando el Core con `swiftc` y ejecutando los mismos casos de prueba; todos pasan.
