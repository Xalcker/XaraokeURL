# 📱 App de Android (control remoto nativo)

Una versión instalable (APK) del control remoto, en Kotlin y Jetpack Compose. Está en [`android/`](../android). Hace lo mismo que `/remote.html` y habla con el mismo WebSocket y las mismas rutas `/api/*`, así que no hace falta nada distinto en el servidor más allá de las dos rutas de inicio de sesión que se describen abajo.

## Qué agrega frente al remoto web

* **Leer el QR sin permiso de cámara y sin HTTPS.** Usa el lector de Google Play Services, que abre su propia cámara. El remoto web necesita HTTPS para usar la cámara, así que en la red de la casa (`http://192.168...`) no funciona.
* **Aviso de tu turno con el teléfono bloqueado.** Un servicio en primer plano mantiene la conexión con la sala. Cuando a la canción que suena le quedan 10 segundos y la siguiente es tuya, llega una notificación urgente que suena (con `notification.mp3`) y vibra. También avisa si tu canción empieza sin ese aviso previo, por ejemplo porque saltaron la anterior. Con la app abierta suena, vibra y muestra el aviso en pantalla. El sonido y la vibración se ajustan en **⋮ → Ajustes de avisos** (es el canal "Tu turno" de Android, y respeta No molestar).
* **Notificación fija de la sala.** Muestra lo que suena, cuánto le falta y cuántas canciones hay antes de tu turno, con botones para pausar o reanudar (solo cuando la canción es tuya) y para salir de la sala.
* **Compartir desde YouTube.** En la app de YouTube, **Compartir → Xaraoke** descarga el video en el servidor y lo agrega a la lista (pide confirmación). Si todavía no estás en una sala, se agrega en cuanto entras.
* **Reconexión más rápida.** Cuando vuelve la red o se abre la app, reconecta al momento en vez de esperar el siguiente reintento.

Lo demás es igual que en el web: buscador sin acentos, explorador por letra y artista, descargas de YouTube ya bajadas, búsqueda en YouTube con los avisos de "instrumental" y "tal cual", Mi lista con subir, bajar y quitar, saltar con confirmación, votos para saltar, calificar el karaoke, y los avisos de host desconectado y de sala perdida.

**Tutorial:** la primera vez que entras a una sala se abre un recorrido guiado, con los mismos pasos que el del web adaptados a la app: oscurece la pantalla y resalta un elemento a la vez. Se puede saltar, o cerrar con el botón Atrás del teléfono. Se vuelve a ver desde **⋮ → Tutorial**. Que ya se vio se guarda al abrirlo, no al terminarlo.

**Tablets, plegables y horizontal:** desde 600 dp de ancho (teléfono acostado, plegable abierto, tablet) la sala se ve en dos columnas, sin pestañas. A la izquierda van el mini-reproductor y "Mi lista", que se desplazan juntos para que con el teléfono acostado la lista no quede aplastada; a la derecha, el buscador. En pantallas más angostas se usan las pestañas **Buscar** y **Mi lista**. Al cerrar o abrir un plegable, la app sigue en la sala y cambia de diseño sola. Se probó en emuladores de teléfono chico, plegable (abierto y cerrado), tablet de 8" y de 11", en vertical y horizontal.

## Cómo encuentra el servidor

La primera vez pide **escanear el QR** de la pantalla principal o escribir la dirección (`192.168.0.72:8081`; sin `http://` se asume HTTP). El QR ya trae el servidor y la sala. La app recuerda el servidor y la última sala, y al abrirla vuelve a entrar sola, igual que el web. **Cambiar** (junto al servidor) lo olvida.

También entiende el enlace `xaraoke://unirse?servidor=<url>&sala=ABCD`, por si quieres mandarlo en un mensaje.

## Inicio de sesión

La app le pregunta al servidor cómo se entra (`GET /api/auth/config`):

* **Sin Google** (`DISABLE_GOOGLE_AUTH=true`): escribes tu nombre, igual que en el web (`POST /api/dev-name`).
* **Con Google**: Google no deja iniciar sesión dentro de una app embebida, así que la app usa **Credential Manager**. Credential Manager entrega un *ID token* firmado por Google, que la app manda a `POST /api/auth/google-token`. El servidor lo verifica con `google-auth-library`: la firma, que no haya vencido, que la audiencia sea su `GOOGLE_CLIENT_ID`, y que el correo esté verificado y sea del `ALLOWED_DOMAIN`. Luego crea la misma sesión que el login web. Cuando la sesión vence (24 h), la app vuelve a entrar sola con la misma cuenta si puede.

### Configurar Google para la app (una sola vez)

En la [consola de Google Cloud](https://console.cloud.google.com/apis/credentials), **en el mismo proyecto** del `GOOGLE_CLIENT_ID` del servidor, crea un **ID de cliente de OAuth de tipo Android** por cada llave con la que firmes la app:

| Versión | Nombre del paquete | SHA-1 del certificado |
|---|---|---|
| Release | `xyz.xalcker.xaraoke` | el de tu llave (ver abajo) |
| Debug (desarrollo) | `xyz.xalcker.xaraoke.debug` | el de `~/.android/debug.keystore` |

El SHA-1 se obtiene con:

```bash
keytool -list -v -keystore android/signing/xaraoke-release.jks   # release
keytool -list -v -keystore ~/.android/debug.keystore -storepass android   # debug
```

No hay que tocar el `.env` ni la app: la app pide el token con el client ID "Web" que ya usa el servidor, y el cliente Android solo sirve para que Google reconozca a la app.

## Compilar

Hace falta el Android SDK y un JDK 17 o más nuevo (sirve el que trae Android Studio en `jbr/`).

```bash
cd android
./gradlew testDebugUnitTest   # pruebas de la lógica (enlaces, turnos, reconexión)
./gradlew assembleDebug       # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease     # app/build/outputs/apk/release/app-release.apk (firmado)
```

La versión debug usa otro id (`.debug`), así que convive con la de release en el mismo teléfono.

Para instalarla con `adb`, usa `--user 0`. Sin eso, en un Samsung con **Dual App** (o con otros perfiles) se instala también en esos perfiles y aparece repetida:

```bash
adb install --user 0 -r app/build/outputs/apk/release/app-release.apk
adb shell pm uninstall --user 95 xyz.xalcker.xaraoke   # quitarla de Dual App (usuario 95) si ya quedó ahí
```

Si instalas el APK a mano (copiándolo al teléfono), se instala solo en el perfil donde lo abres.

### Firma de release

`android/signing/keystore.properties` (fuera de git) apunta a la llave:

```properties
storeFile=signing/xaraoke-release.jks
storePassword=...
keyAlias=xaraoke
keyPassword=...
```

**Respalda la llave y su contraseña fuera del repo.** Si se pierde, las actualizaciones no se pueden instalar encima de la app ya instalada (hay que desinstalarla primero) y hay que registrar otro SHA-1 en Google. Sin ese archivo el APK de release sale sin firmar.

### Probar contra el servidor de tu PC

Con el teléfono por USB o ADB inalámbrico:

```bash
adb reverse tcp:8081 tcp:8081
adb shell am start -a android.intent.action.VIEW -d "xaraoke://unirse?servidor=http%3A%2F%2F127.0.0.1%3A8081&sala=ABCD"
```

## Estructura

| Archivo | Qué hace |
|---|---|
| `core/` | Lógica pura, con pruebas: leer el QR, el id de un video de YouTube, cuándo avisar el turno, qué hacer al cerrarse la conexión |
| `net/ServerApi.kt` | Las rutas HTTP (`/api/me`, `/api/songs`, YouTube…) |
| `net/PersistentCookieJar.kt` | Guarda la cookie de sesión entre aperturas |
| `room/RoomConnection.kt` | El WebSocket de la sala: el mismo protocolo que `public/remote.js` |
| `room/RoomService.kt` | El servicio en primer plano y su notificación |
| `room/Notifications.kt` | Canales, aviso de turno, sonido y vibración |
| `AppController.kt` | Servidor, sesión, biblioteca y sala; vive lo que vive la app, no la pantalla |
| `ui/` | Las pantallas en Compose |
