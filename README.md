# XaraokeURL 🎤🎶

Un reproductor de karaoke interactivo basado en la web, construido con HTML5, Node.js y WebSockets. Los usuarios pueden explorar una biblioteca de canciones y añadir colaborativamente canciones a una cola en tiempo real desde sus dispositivos móviles usando un código QR.

---
## ✨ Características

* **Base de Datos de URLs:** Las canciones de karaoke (videos MP4) se gestionan a través de URLs directas en una base de datos local SQLite.
* **Control Remoto en Tiempo Real:** La interfaz del reproductor y los controles remotos se sincronizan instantáneamente usando WebSockets.
* **Conexión por QR:** Escanea un código QR en la pantalla principal para abrir la interfaz remota en cualquier teléfono, sin necesidad de instalar una app.
* **Explorador de Canciones Alfabético:** Navega por la biblioteca de canciones de forma intuitiva, filtrando por artista y luego seleccionando la canción.
* **Cola de Reproducción Compartida:** Múltiples usuarios pueden ver y añadir canciones a la misma cola de reproducción en tiempo real.
* **Solo quien canta controla la reproducción:** pausar, reanudar y saltar solo los puede pedir la persona cuya canción está sonando; para los demás los botones quedan deshabilitados con un aviso que lo explica. Lo hace cumplir el servidor (no solo la interfaz). Excepción para que la sala no se trabe: si esa persona lleva un rato sin ningún dispositivo conectado a la sala, cualquiera puede controlar su canción (y sigue pidiendo confirmación). Ese "rato" es un **tiempo de gracia** (`SINGER_GRACE_SECONDS`, 120 segundos por defecto; con `0` no hay gracia) para que un celular que se suspende y pierde la conexión no deje su canción a merced de los demás. Se cuenta desde lo más reciente entre que se desconectó y que empezó a sonar su canción, así que quien bloquea el celular mientras espera su turno tampoco la pierde en cuanto le toca. La pantalla principal (host) no está sujeta a la regla.
* **Controles de Reproducción con estado real:** los controles remotos pueden pausar, reanudar y saltar canciones. El botón de play/pausa muestra siempre lo que hará según el estado **real** del video (lo informa el host, y quien entra a la sala tarde lo ve enseguida), aparece una etiqueta "En pausa" en el mini-reproductor y un aviso sobre el video en la pantalla principal. Sin canción en la cola o con el host desconectado, los botones quedan deshabilitados.
* **Saltar pide confirmación:** saltar afecta a todos, así que antes se pregunta qué canción es y de quién (de quién solo importa cuando quien canta lleva un rato desconectado; si no, solo puedes saltar la tuya). Se pide saltar *esa* canción: si mientras se decidía ya cambió (terminó, la saltó otra persona), no se salta la siguiente por error, y una confirmación abierta se cierra sola.
* **Reordena tus canciones:** si tienes más de una en espera, en **Mi cola** cada una trae botones para subirla o bajarla. Solo ordenas las tuyas entre sí: las canciones de los demás nunca cambian de turno, y la que ya está sonando no se mueve ni se puede pasar por encima de ella.
* **Califica el karaoke:** cuando tu canción termina, te sale una tarjeta con un pulgar arriba o abajo. Es la calidad del **karaoke** (el video, la letra, la música), no cómo cantaste. Se puede ignorar con "Ahora no". Ver "Calificar el karaoke" más abajo.
* **Modo TV en la pantalla principal:** letra y tarjetas que crecen con la pantalla, "quién canta" en grande y de color, pantalla completa (botón, tecla `F` o doble clic) y una pantalla de espera con el código QR enorme cuando la cola está vacía. Mantiene la pantalla encendida durante la sesión (ver "Modo TV").
* **Remoto pensado para el celular:** una barra fija arriba con lo que suena, su avance y los botones de play/pausa y saltar, siempre a la vista aunque bajes por una lista larga. Debajo, dos pestañas: **Buscar** (el buscador y el explorador) y **Mi cola** (la cola de todos, tus canciones resaltadas, cuántas tienes y cuántas faltan para tu turno). El aviso de "tu turno" aparece pegado bajo el mini-reproductor.
* **Tutorial en el remoto:** la primera vez que alguien entra a una sala desde su navegador se abre un recorrido guiado que resalta cada elemento (código de sala, lo que suena, play/pausa, saltar, buscador, biblioteca, Mi cola, avisos) y explica para qué sirve. Se puede saltar o cerrar con Esc, y volver a verlo con el botón **Tutorial** del encabezado. Que ya se vio se recuerda en el navegador (`localStorage`, clave `xaraoke.remoteTourSeen`); si el navegador no deja guardar nada, no se abre solo.
* **Salas Virtuales:** Soporte de salas virtuales con colas independientes mediante códigos de 4 letras.
* **Autenticación Google OAuth:** Acceso seguro al control remoto mediante autenticación con cuentas de Google (dominio configurable).
* **Gestión de Sesiones:** Sesiones persistentes almacenadas en archivos para mantener usuarios autenticados.
* **Redirección Automática:** Los dispositivos móviles son redirigidos automáticamente al control remoto.
* **Buscador de Canciones:** Además del explorador alfabético, un buscador de texto (insensible a acentos) filtra por artista o título.
* **Aviso de Host Desconectado:** Si la pantalla principal se desconecta, todos los remotos muestran un aviso en vez de seguir agregando canciones a una cola que nadie va a reproducir.
* **Notificaciones Confiables:** El control remoto vibra, suena y muestra un aviso visual pulsante para avisar cuando la canción está a punto de empezar (10 segundos antes), incluso en navegadores que bloquean el autoplay de audio.
* **Multi-idioma (español e inglés):** la interfaz y los mensajes del servidor se muestran en el idioma del navegador de cada persona, con español como predeterminado (ver "Idiomas" más abajo).
* **Búsqueda y Descarga desde YouTube:** Si una canción no está en la biblioteca, se puede buscar en YouTube (con sufijos como "karaoke", "instrumental" o "pista"), elegir entre varios resultados y agregarla a la cola. Las descargas se registran en su propia base de datos, son buscables y se reutilizan (no se descargan dos veces), y se borran solas pasado el tiempo que configures.
* **Control remoto instalable (PWA):** `/remote.html` tiene su propio manifiesto y un service worker que cachea sus assets estáticos, así que Android/Chrome lo ofrece como app instalable (ícono en el launcher, se abre en pantalla completa sin la barra del navegador); en iOS/Safari basta con "Agregar a inicio". Solo cachea archivos estáticos (CSS, JS, íconos): la API, el WebSocket y el login siguen yendo directo a la red.
* **Unirse a una sala escaneando su QR desde el remoto:** además de que el QR de la pantalla principal ya lleva la sala en el enlace (ver "Cómo Usar"), en la pantalla de "Unirse a una Sala" el ícono de cámara junto al código abre la cámara del teléfono y lee cualquier QR de sala (con [jsQR](https://github.com/cozmo/jsQR), vendorizado en `public/js/jsQR.js`), completando el código de 4 letras solo. Útil para unirse a una sala sin volver a escanear con la cámara del sistema, por ejemplo con la app ya instalada. Requiere HTTPS (o `localhost`): la cámara del navegador no funciona por HTTP en la IP de la red local, así que el ícono avisa si no está disponible en vez de fallar en silencio.

---
## 🛠️ Stack Tecnológico

* **Backend:** Node.js, Express, WebSockets (`ws`), SQLite3
* **Frontend:** HTML5, CSS3, JavaScript (Vanilla)
* **Autenticación:** Passport.js con Google OAuth 2.0
* **Sesiones:** express-session con almacenamiento en archivos (session-file-store)
* **Dependencias Clave:** `sqlite3`, `qrcode`, `ws`, `passport`, `passport-google-oauth20`, `express-session`, `dotenv`, `helmet`, `express-rate-limit`
* **Búsqueda/descarga de YouTube:** `yt-dlp` + `ffmpeg` (binarios del sistema, no son paquetes de npm)

---
## 🚀 Cómo Empezar

Sigue estos pasos para ejecutar el proyecto en tu máquina local.

### Pre-requisitos

* Node.js v20.17 o superior (lo exige `sqlite3@6`)
* npm
* Cuenta de Google Cloud con OAuth 2.0 configurado (para autenticación)
* (Opcional) `yt-dlp` y `ffmpeg` instalados y en el `PATH` del sistema, solo si quieres usar la búsqueda/descarga desde YouTube. Sin estos binarios, el resto de la app funciona normal — la búsqueda/descarga de YouTube simplemente devuelve error y el servidor arranca igual (queda un aviso en los logs).

  **Linux (Debian/Ubuntu):**
  ```bash
  sudo apt-get install -y ffmpeg
  pip install --break-system-packages yt-dlp
  ```

  **macOS (con [Homebrew](https://brew.sh/)):**
  ```bash
  brew install ffmpeg yt-dlp
  ```

  **Windows (con [winget](https://learn.microsoft.com/windows/package-manager/winget/), incluido en Windows 10/11):**
  ```powershell
  winget install ffmpeg
  winget install yt-dlp
  ```

  Verifica que ambos quedaron en el `PATH` con `ffmpeg -version` y `yt-dlp --version`. Si el servidor corre en un lugar distinto de donde instalaste los binarios (por ejemplo, un contenedor o un servicio systemd), asegúrate de instalarlos ahí también.

### Instalación

1.  **Copia todos los archivos** proporcionados en un nuevo directorio.

2.  **Configura las variables de entorno.** Copia el archivo `.env.example` a `.env` y completa los valores:
    ```bash
    cp .env.example .env
    ```
    
    Luego edita el archivo `.env` con tus valores reales. Para generar un `SESSION_SECRET` seguro, puedes usar:
    ```bash
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    ```
    
    Para obtener las credenciales de Google OAuth:
    - Ve a [Google Cloud Console](https://console.cloud.google.com/)
    - Crea un proyecto nuevo o selecciona uno existente
    - Habilita la API de Google+ 
    - Crea credenciales OAuth 2.0
    - Configura las URLs de redirección autorizadas (ej: `http://localhost:8081/auth/google/callback`)

3.  **Crea tu catálogo de canciones** en un archivo llamado `songs.csv` en la raíz del proyecto. Usa el formato: `Artista,Cancion,URL`.
    
    Ejemplo:
    ```csv
    Queen,Bohemian Rhapsody,https://ejemplo.com/video1.mp4
    The Beatles,Hey Jude,https://ejemplo.com/video2.mp4
    ```

4.  **Abre una terminal** en el directorio del proyecto e instala las dependencias:
    ```bash
    npm install
    ```

5.  **Importa tus canciones** a la base de datos. Este comando leerá `songs.csv` y creará/llenará el archivo `karaoke.db`:
    ```bash
    npm run import
    ```

    Este paso es opcional: si no existe `karaoke.db`, el servidor arranca igual en "modo sin biblioteca" (ver la sección "Búsqueda y descarga desde YouTube" más abajo).

6.  **Inicia el servidor:**
    ```bash
    npm start
    ```

7.  Abre tu navegador y ve a `http://localhost:8081` (o el puerto configurado en `.env`).

    **La pantalla principal se abre mejor como `localhost`.** El código QR que ven los teléfonos no puede llevar `localhost` (en el teléfono apuntaría al propio teléfono), así que el servidor lo arma con la dirección de tu red local. Además, con `localhost` el navegador permite mantener la pantalla encendida (ver "Modo TV" más abajo), cosa que no hace si abres la página por la IP con HTTP. Al iniciar, el servidor imprime sus direcciones y marca la que llevará el QR:

    ```
    🚀 Servidor corriendo en el puerto 8081
    🌐 Direcciones de este servidor:
       http://192.168.0.72:8081   (Wi-Fi)   <- la que lleva el código QR si abres la pantalla como localhost
       En este equipo: http://localhost:8081   (recomendada para la pantalla principal: ...)
    ```

    La dirección del QR también aparece escrita bajo el código, en la pantalla principal. Si hay varias redes, se prefieren las reales y se dejan al final las de máquinas virtuales (VirtualBox, WSL, docker...); si aun así el QR usa la red equivocada, fija la correcta en el `.env` con `LAN_IP=192.168.0.72`. Si Windows muestra el aviso del Firewall la primera vez, permite el acceso en redes privadas. Estas direcciones solo se muestran fuera de producción.

### Levantar el server en local sin configurar Google OAuth

Si solo quieres probar la app en tu máquina y no quieres meterte a configurar credenciales de Google Cloud, puedes saltarte el login. En tu `.env` (con `NODE_ENV=development`, que es el default):

```bash
DISABLE_GOOGLE_AUTH=true
DEV_USER_NAME=Tu Nombre   # opcional, nombre para las conexiones que llegan sin nombre elegido; nadie puede escogerlo (si no lo fijas: "Usuario Local" o "Local User", según el idioma del navegador)
```

Con esto, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` ni hacen falta: el control remoto (`/remote.html`) queda accesible directamente. Esta variable **se ignora si `NODE_ENV=production`**, así que no hay riesgo de dejarla prendida por error en un deploy real.

**Cada dispositivo elige su propio nombre.** Al unirse a una sala, el control remoto pide "Tu nombre" y no sugiere ninguno: hay que escribirlo. El nombre se guarda en la sesión del navegador, así que al recargar la página vuelve prellenado, y es el que se muestra en la cola. Así funcionan igual que con Google el "(tú)", el botón "Quitar" (solo quitas tus canciones) y el aviso de "tu turno" (solo le llega a quien sigue). Se limita a 30 caracteres y se le quitan saltos de línea y caracteres invisibles. Como el nombre es lo único que distingue a una persona de otra, **no puede repetirse dentro de una sala**: el primer dispositivo que entra con un nombre se lo queda (sin distinguir mayúsculas ni acentos), y quien intente usarlo después tiene que elegir otro. El nombre se libera cuando su dueño ya no está conectado ni tiene canciones en la cola. Tampoco se aceptan los genéricos ("Usuario Local", "Local User", "Usuario", "User" ni el de `DEV_USER_NAME`). Por lo mismo, sin login cada persona usa un solo dispositivo por sala.

---
## 💡 Cómo Usar

1.  Abre la aplicación en un navegador en tu computadora o TV (el **Host**).
2.  Haz clic en "Comenzar" para crear una nueva sala. Se generará un código de sala de 4 letras.
3.  Escanea el código QR con la cámara de tu teléfono para abrir el **Control Remoto**. El QR ya lleva el código de sala (`/remote.html?sala=ABCD`), así que no hay que escribirlo.
4.  Inicia sesión con tu cuenta de Google (debe ser del dominio autorizado configurado en el código). Al volver de Google, el teléfono entra directo a la sala. Sin login de Google (modo desarrollo), el código aparece ya escrito y solo falta poner tu nombre y tocar "Unirse".
5.  Si no puedes escanear el QR, entra a la dirección escrita bajo él e introduce el código de sala de 4 letras.
6.  En la pestaña **Buscar**, usa el explorador alfabético o el buscador de texto para encontrar tu canción favorita y añadirla a la cola (si no aparece, puedes buscarla en YouTube — ver la sección "Búsqueda y descarga desde YouTube" más abajo).
7.  Un aviso confirma que se añadió, y la cola se actualiza en la pantalla principal y en todos los remotos conectados; en la pestaña **Mi cola** ves tu posición, puedes quitar tus canciones y, si tienes varias en espera, cambiarles el orden con las flechas.
8.  Recibirás una notificación (vibración, sonido y un aviso visual) 10 segundos antes de que empiece tu canción.
9.  ¡Espera tu turno y canta! Al terminar, califica con un pulgar qué tal estuvo el karaoke.

### Si el host cierra el reproductor sin querer

Si el host se desconecta (por ejemplo, alguien cierra la pestaña de la pantalla principal por error), todos los remotos muestran un aviso de que la reproducción está en pausa hasta que vuelva.

* **La sala no se borra al momento.** Si se queda sin nadie conectado, se conserva con su cola durante un tiempo de gracia: `ROOM_GRACE_MINUTES` (10 minutos por defecto; con `0` se borra en cuanto se queda vacía). Mientras haya algún remoto conectado, la sala sigue existiendo.
* **El host la recupera.** La pantalla principal guarda en el navegador el código de la sala y su token de host. Al volver a abrirla, la pantalla de inicio ofrece **"Recuperar la sala XXXX"** (con cuántas canciones hay en la cola) y, aparte, **"Crear una sala nueva"**. Recuperarla reconecta como host y retoma la cola tal como estaba; la canción que sonaba empieza desde el principio.
* **Los remotos se enteran.** Los que sigan abiertos ven un aviso de que el host regresó y la sala está disponible de nuevo, y los controles de reproducción se reactivan.
* **Si el tiempo se agotó** (o el servidor se reinició), la sala ya no existe: la pantalla de inicio solo ofrece crear una nueva. Si el host tenía la pantalla abierta cuando pasó, avisa y vuelve al inicio.
* **Una sola pantalla de host por sala.** Si se recupera la sala mientras la pantalla anterior seguía abierta, el servidor desconecta a la anterior para que no suenen dos karaokes a la vez.

## 📺 Modo TV (pantalla principal)

La pantalla principal está pensada para verse de lejos:

* **Se adapta al tamaño de la pantalla:** el tamaño de la letra y de las tarjetas crece con el ancho de la ventana (de 16 px en una ventana pequeña a unos 22 px en una TV de 1920 px, con tope de 26 px). "Ahora suena" y "A continuación" muestran en grande el artista, la canción y **quién canta**, en color.
* **Pantalla de espera:** con la cola vacía, el video negro deja su lugar a un código QR grande, el código de sala y la dirección escrita por si no se puede escanear. En cuanto alguien añade una canción, vuelve el video.
* **Pantalla completa:** botón discreto abajo a la izquierda, tecla `F` o doble clic sobre el video. Entra toda la página (no solo el video), así que la cola y el QR siguen a la vista; `Esc` sale. Tras 3 segundos sin mover el ratón ni pulsar teclas, se ocultan el cursor y el botón.
* **Pantalla siempre encendida:** al comenzar la sesión se pide al navegador que no apague la pantalla (Screen Wake Lock API), y se vuelve a pedir si la pestaña se oculta y regresa. **El navegador solo lo permite en `localhost` o con HTTPS**: si abres la pantalla por la IP de la red con HTTP (`http://192.168.0.72:8081`), no está disponible y la pantalla puede apagarse por inactividad del sistema (mientras suena un video, los navegadores suelen mantenerla encendida). Por eso conviene abrirla como `localhost`.

## ⭐ Calificar el karaoke

Al terminar una canción, a **quien la cantó** (y solo a esa persona) le aparece abajo una tarjeta: *"¿Cómo estuvo el karaoke de …?"*, con **Bien** (pulgar arriba), **Mal** (pulgar abajo) y **Ahora no**. Lo que se califica es el video y la música, no el desempeño de quien cantó; la tarjeta lo dice.

* **Solo cuando la canción termina sola.** Si alguien la salta, no se pide calificar.
* **No estorba:** no es una ventana que bloquee la pantalla y se puede ignorar. Si se termina otra canción tuya antes de responder, se muestran una tras otra. Si pierdes la conexión o recargas la página, se te vuelve a pedir mientras la sala siga abierta.
* **Una calificación por persona y canción.** Las de YouTube se identifican por el video (no por el archivo, que se borra con el tiempo), así que una calificación sobrevive aunque la descarga se borre; las de la biblioteca, por su nombre de archivo. Si la misma persona vuelve a calificarla más adelante, la nueva reemplaza a la anterior.
* **Se guardan en `ratings.db`** (`RATINGS_DB_PATH`; `./ratings.db` en desarrollo, `/data/ratings.db` en producción, se crea sola), aparte de `downloads.db` porque las descargas se borran solas y las calificaciones deben quedar. Cada fila trae la clave de la canción (`yt:<id del video>` o `lib:<archivo>`), quién calificó, el valor (1 o -1), el título y la fecha. Si esa base no se puede abrir, el servidor arranca igual, deja un aviso en los logs y simplemente no pide calificar.
* **Se muestran sumadas de todas las salas.** Junto a cada canción (en los resultados de búsqueda y en la cola) aparece cuántos pulgares arriba y abajo lleva en total. Las de YouTube se muestran mientras el video siga descargado. Por ahora no influyen en el orden de los resultados.

## 🔎 Búsqueda y descarga desde YouTube

Si buscas una canción y no aparece en la biblioteca, el control remoto ofrece buscarla en YouTube:

1. Al no haber resultados en la búsqueda local, aparece la opción de buscar en YouTube con un sufijo (Karaoke, Instrumental, Pista o sin sufijo; en inglés, "Backing track" en lugar de "Pista"). Basta con pulsar **Enter** (o la tecla "Ir/Buscar" del teclado del celular) para buscar directamente con el sufijo elegido, "Karaoke" por defecto. Si hay coincidencias en la biblioteca local, Enter no hace nada, pero el selector de sufijo y el botón **Buscar en YouTube** aparecen igual arriba de la lista, para buscar otra versión aunque ya haya algo descargado del mismo artista.
2. Se muestran 5 resultados por defecto (miniatura, título, canal y duración), configurable de 5 a 10 con `SEARCH_RESULTS` en el `.env`, para elegir manualmente — nunca se reproduce el primer resultado a ciegas. Los videos de canales de los que ya descargaste algo salen primero (el canal con más descargas, arriba); dentro de cada grupo se respeta el orden de YouTube.
3. Al elegir uno, se descarga (video + audio, hasta 720p) y se agrega a la cola de esa sesión. Se prefiere el códec H.264, que casi cualquier dispositivo reproduce con aceleración por hardware (TVs, Safari/iOS, navegadores sin soporte de AV1); si el video no lo ofrece, se usa AV1 u otro MP4 disponible.

Detalles a tener en cuenta:

* **Funciona sin biblioteca.** Si no existe `karaoke.db` (no ejecutaste `npm run import`), el servidor arranca igual y deja un aviso en los logs: el catálogo local aparece vacío (con el selector de sufijo ya visible) y la única forma de agregar canciones es escribir el nombre y pulsar Enter para buscarlas en YouTube. Al ejecutar `npm run import` y reiniciar el servidor, la biblioteca local queda disponible junto con la búsqueda en YouTube.
* **Cómo se ve en la cola.** Las canciones de YouTube se muestran con el título del video (y "YouTube" como artista), tanto en la pantalla principal como en el control remoto, en lugar del nombre interno del archivo.
* **Las descargas se registran en su propia base de datos.** `karaoke.db` nunca se modifica: cada video descargado queda en `downloads.db` (`DOWNLOADS_DB_PATH`; `./downloads.db` en desarrollo, `/data/downloads.db` en producción, se crea sola) con su uuid, el ID y el link del video, el título original, el canal, la duración, la búsqueda original y el sufijo, quién lo pidió, el tamaño, la fecha y hora de descarga, el último uso y cuántas veces se agregó a una cola. El archivo vive en `DOWNLOADS_PATH` (`./downloads` en desarrollo, `/data/downloads` en producción).
* **Son buscables y no se descargan dos veces.** La búsqueda local incluye los videos ya descargados (por título, canal y por la búsqueda con la que se encontraron), y se agregan a la cola directo. Si alguien elige un video que ya está descargado, se reutiliza el archivo; y si dos personas piden el mismo a la vez, se descarga una sola vez. Como el registro está en disco, todo esto sobrevive a reiniciar el servidor. Las descargas son de todas las salas: cuando alguien termina una (o se borra una), el servidor avisa por WebSocket a los controles remotos de todas las salas y su búsqueda se actualiza sola, sin recargar.
* **Cuánto viven las descargas: `DOWNLOAD_TTL_HOURS`.** Es el número de horas que una descarga puede pasar sin usarse antes de borrarse (archivo y registro); por defecto 6. Cada vez que se agrega a una cola, la cuenta empieza de nuevo, y **nunca se borra lo que está en la cola de una sala**. Con `0` (o `never`) no se borra nunca; acepta decimales (`0.5` = 30 minutos). Un valor inválido se avisa en los logs y se usa el valor por defecto. Cuando el borrado está activo, también se limpian los archivos huérfanos (con nombre de uuid, sin registro y de más de una hora), como los restos de una descarga fallida.
* **Límites anti-abuso:** máximo 20 búsquedas/min y 5 descargas/min por IP, como mucho 3 descargas corriendo a la vez, y se rechazan videos de más de 10 minutos.
* **Requiere `yt-dlp` y `ffmpeg`** instalados en el servidor (ver Pre-requisitos). Sin ellos, la búsqueda/descarga devuelve error pero el resto de la app sigue funcionando normal.
* **Consideración legal:** descargar contenido de YouTube puede estar en conflicto con sus Términos de Servicio. Esta función se ofrece para uso personal/privado (la misma sala cerrada por autenticación que ya protege al resto de la app); usarla es criterio y responsabilidad de quien despliega el servidor.

## 🔒 Seguridad

* El acceso al control remoto requiere autenticación con Google OAuth 2.0.
* **La pantalla principal (host) NO pide sesión, a propósito.** Es un televisor o un proyector que nadie va a tener logueado, así que `/` (y con ella `/api/rooms`, `/api/song-url`, `/api/qr` y `/api/rooms/:id/resume`) está abierta a quien pueda alcanzar el servidor. En una red local es justo lo que se quiere; **si expones el servidor a internet, ponlo detrás de una autenticación propia del proxy** (Basic Auth en Nginx, por ejemplo), porque cualquiera podría abrir la pantalla y crear salas. Lo que sí está protegido en todos los casos es el catálogo (`/api/songs`), la lista de descargas, las calificaciones y el control remoto.
* Por defecto, solo se permiten cuentas del dominio `@xalcker.xyz` (configurable con la variable de entorno `ALLOWED_DOMAIN`).
* Las sesiones se almacenan de forma segura en el servidor; en producción, las cookies usan el flag `secure` para HTTPS.
* **El host de una sala se autentica con un token secreto** (`hostToken`, generado al crear la sala), no con un flag que el cliente pueda falsificar — solo quien creó la sala puede controlar la reproducción o suplantar el nombre en la cola.
* **Solo el host manda `playNext`, `timeUpdate` y `playbackState`** (el servidor los ignora de un control remoto), y las órdenes de reproducción de los remotos (`play`, `pause`, `skip`) se validan y se limpian antes de reenviarse al host, y el servidor solo las acepta de quien canta la canción que suena (o de cualquiera si esa persona lleva más que el tiempo de gracia sin conexión; ver `presentNames` y `canControlPlayback` en `lib/wsPolicy.js`). Así ni la confirmación al saltar ni la regla de "solo quien canta" se pueden esquivar mandando el mensaje a mano, ni un remoto puede falsear el tiempo o el estado que ven los demás.
* **Solo puedes reordenar y calificar lo tuyo.** Para `moveSong` y `rateSong` el servidor usa el nombre de la sesión de esa conexión (fijado al conectarse), nunca un nombre que venga en el mensaje; una calificación solo se acepta si el servidor la pidió antes para esa canción y esa persona, con un valor de 1, -1 o 0. Que el host avise que una canción terminó sola (`playNext` con `ended` y el id de la canción) solo lo puede hacer el host, como el resto de `playNext`.
* **El WebSocket valida el header `Origin`** en el handshake, rechazando conexiones cross-site que intenten aprovechar la cookie de sesión del navegador.
* **Headers de seguridad HTTP** vía `helmet` (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, etc.).
* **Content-Security-Policy activa**, con `script-src 'self'` y `style-src 'self'` **sin `unsafe-inline`**: no queda ningún script ni estilo inline en el proyecto. Las excepciones son las que el karaoke necesita de verdad: `data:` en imágenes (el código QR se genera así), `https:` para las miniaturas de YouTube, y `media-src` abierto porque las canciones del catálogo son URLs arbitrarias que salen de `songs.csv`. No se fuerza `upgrade-insecure-requests`, que en una red local por HTTP rompería la propia página.
* **Rate limiting** en los endpoints más sensibles: creación de salas (10/min), búsqueda en YouTube (20/min) y descarga de YouTube (5/min, máximo 3 descargas simultáneas).
* **Consultar si una sala existe está limitado** (60/min): un código son 4 letras, así que sin tope se podían barrer las 456.976 combinaciones y listar las salas activas. Unirse sigue requiriendo sesión.
* **Topes en el WebSocket**: la cola de una sala tiene un máximo (`MAX_QUEUE_LENGTH`, 100 por defecto), cada persona puede tener un número limitado de canciones esperando (`MAX_SONGS_PER_PERSON`, 5 por defecto) y cada conexión tiene un tope de mensajes por ventana de tiempo. Sin esto, un control remoto podía encolar sin límite, y cada canción difundía la cola entera a toda la sala.
* **Salas y descargas se limpian solas:** una sala sin conexiones se borra al pasar su tiempo de gracia (`ROOM_GRACE_MINUTES`, 10 minutos por defecto; ver más abajo), y las descargas de YouTube tras `DOWNLOAD_TTL_HOURS` horas sin usarse (6 por defecto) — nada queda creciendo en memoria o disco indefinidamente, salvo que se desactive el borrado a propósito con `DOWNLOAD_TTL_HOURS=0`.
* **Contenido generado por usuarios escapado antes de insertarse en el DOM** (nombres de perfil, títulos de canciones) para evitar XSS.
* **La cola solo acepta canciones válidas:** un `filename` en `addSong` se valida contra la base de datos o el registro de descargas de YouTube antes de encolarse; nunca se confía en lo que mande el cliente a ciegas.
* **La descarga de YouTube nunca interpola datos del usuario en un shell:** se invoca `yt-dlp` vía `execFile` con argumentos separados, el ID de video se valida con una expresión regular estricta antes de usarse, y los archivos se guardan con un nombre generado por el servidor (UUID), nunca con datos provistos por el cliente.

## 📁 Estructura del Proyecto

```
XaraokeURL/
├── public/
│   ├── css/
│   │   ├── tokens.css            # Tokens de diseño: colores de la marca, acento turquesa (única fuente)
│   │   ├── icons.css             # Tamaño y alineación de los íconos SVG
│   │   ├── host.css              # Estilos para la pantalla principal
│   │   ├── remote.css            # Estilos para el control remoto
│   │   └── simple-page.css       # Estilos de las pantallas de acceso (el HTML lo arma server.js)
│   ├── img/
│   │   ├── logo.svg              # Logo de la marca (fuente de todos los demás íconos)
│   │   ├── favicon-32.png        # Favicon de respaldo (navegadores sin favicon SVG)
│   │   ├── apple-touch-icon.png  # Ícono al agregar a la pantalla de inicio en iOS
│   │   └── icon-192.png / icon-512.png  # Íconos de la app (manifiesto), aptos para "maskable"
│   ├── js/
│   │   ├── mobileRedirect.js     # Manda al control remoto si la pantalla se abre en un teléfono
│   │   ├── wakeLock.js           # Mantiene la pantalla del host encendida (Screen Wake Lock API)
│   │   ├── icons.js              # Íconos SVG (iconSvg / data-icon); la interfaz no usa emojis
│   │   ├── i18n.js               # Textos en español e inglés y detección del idioma (navegador y servidor)
│   │   ├── tour.js               # Tutorial guiado del control remoto (pasos y colocación de la tarjeta)
│   │   ├── shared.js             # Utilidades compartidas (escapeHtml, parseSongFilename)
│   │   ├── registerRemoteSW.js   # Registra el service worker del control remoto (fuera de línea por CSP)
│   │   ├── jsQR.js               # Librería de terceros vendorizada: lee códigos QR desde la cámara
│   │   └── jsQR.LICENSE          # Licencia (Apache-2.0) de jsQR
│   ├── index.html                # Interfaz del host/reproductor
│   ├── karaoke.js                # Lógica del reproductor principal
│   ├── manifest.webmanifest      # Manifiesto de la app (nombre, íconos, colores)
│   ├── remote.html               # Interfaz del control remoto
│   ├── remote.js                 # Lógica del control remoto
│   ├── remote-manifest.webmanifest # Manifiesto del control remoto (app instalable aparte)
│   ├── sw-remote.js              # Service worker del control remoto (cachea sus assets estáticos)
│   └── notification.mp3          # Sonido de notificación
├── lib/
│   ├── displayName.js            # Validación del nombre elegido en modo desarrollo (testeable)
│   ├── downloadPolicy.js         # Vida útil de las descargas (DOWNLOAD_TTL_HOURS) y limpieza de la búsqueda original
│   ├── downloadsStore.js         # Registro de las descargas de YouTube en downloads.db
│   ├── network.js                # Detección de las IPs de la red local (testeable)
│   ├── queuePolicy.js            # Reordenar las canciones propias sin mover las de los demás (testeable)
│   ├── ratingsStore.js           # Calificaciones del karaoke en ratings.db
│   ├── roomId.js                 # Generación de códigos de sala (testeable)
│   ├── roomPolicy.js             # Tiempos de gracia: salas vacías (ROOM_GRACE_MINUTES) y quien canta (SINGER_GRACE_SECONDS) (testeable)
│   ├── wsPolicy.js               # Qué mensajes del WebSocket acepta el servidor y de quién (testeable)
│   ├── sessionStore.js           # Endurece las sesiones en archivo ante bloqueos transitorios en Windows (EPERM)
│   └── ytdlp.js                  # Wrapper seguro sobre el binario yt-dlp
├── src/                          # El servidor, por piezas (lo junta server.js)
│   ├── config.js                 # Toda la configuración que sale de .env, ya validada
│   ├── auth.js                   # Sesiones, Google OAuth y las pantallas de acceso
│   ├── rooms.js                  # Registro de salas en memoria y su ciclo de vida
│   ├── downloads.js              # Registro de descargas y orquestación de yt-dlp
│   ├── realtime.js               # El WebSocket: conexión, despacho y difusión a la sala
│   └── routes/
│       └── api.js                # Los endpoints HTTP
├── test/                         # Pruebas unitarias y de integración (node --test)
├── test-helpers/                 # Levanta el servidor de verdad para las de integración
│   ├── testServer.js             # Arranca server.js en un puerto libre con datos temporales
│   └── wsClient.js               # Cliente de WebSocket que sabe esperar a un mensaje
├── .github/workflows/ci.yml      # CI: lint + test en cada push/PR
├── eslint.config.js              # Configuración de ESLint
├── server.js                     # Arranque: crea las piezas de src/, las conecta y escucha
├── import_csv.js                 # Script para importar canciones desde CSV
├── package.json                  # Dependencias del proyecto
├── .env.example                  # Plantilla de variables de entorno
├── .env                          # Variables de entorno (no incluido en git)
├── songs.csv                     # Catálogo de canciones (no incluido en git)
├── karaoke.db                    # Base de datos SQLite (generada automáticamente)
├── downloads.db                  # Registro de las descargas de YouTube (generada automáticamente)
├── ratings.db                    # Calificaciones del karaoke (generada automáticamente)
└── downloads/                    # Videos descargados de YouTube (no incluido en git)
```

### Pruebas

Dos tipos, ambas con `npm test`:

* **Unitarias.** Todo lo de `lib/` y `public/js/` se prueba directo y aislado: son rápidas y no levantan nada.
* **De integración.** `test/httpApi.test.js`, `test/wsHandshake.test.js` y `test/wsQueue.test.js` arrancan `server.js` de verdad, en un puerto libre y con sus bases en una carpeta temporal, y hablan con él por HTTP y por WebSocket como lo haría un navegador. Son las que comprueban que una ruta siga pidiendo sesión, que un control remoto no pueda hacerse pasar por el host y que "solo quien canta controla" se cumpla con varios clientes conectados a la vez.

Los ayudantes viven en `test-helpers/` y no en `test/` a propósito: `node --test` trata como archivo de prueba a todo `.js` que cuelgue de `test/`.

Quedan unas pocas comprobaciones sobre el **código fuente** (leen el servidor y le pasan una expresión regular), solo para las reglas que no se pueden observar desde fuera sin `yt-dlp` o sin una cuenta de Google de verdad. Leen el servidor entero a través de `test-helpers/serverSources.js`, así que mover código de un módulo a otro ya no las rompe.

### Cómo está organizado el servidor

`server.js` solo arranca: lee la configuración, crea las piezas de `src/`, las conecta y escucha. No tiene reglas de negocio.

Cada pieza **recibe lo que necesita** en vez de buscarlo, así que no hay `require` circulares y se pueden probar por separado. El caso más claro: las descargas avisan de sus cambios con un callback (`onChange`) en vez de llamar al WebSocket, y es el arranque quien conecta los dos cables.

### Idiomas

La interfaz está en **español** (predeterminado) e **inglés**, y cada persona ve el idioma de su navegador (`navigator.languages`); si no coincide con ninguno de los dos, se usa español. El host y cada control remoto pueden estar en idiomas distintos. Los mensajes de error de la API y las pantallas de acceso los traduce el servidor con el header `Accept-Language` del navegador. Los registros de la consola del servidor siguen en español.

Todos los textos viven en `public/js/i18n.js`. En el HTML se marcan con `data-i18n="clave"` (o `data-i18n-placeholder`, `-aria-label`, `-title`, `-alt`, `-html`), dejando dentro el texto en español como respaldo; en JavaScript se usa `t("clave", { parametro })`, y en el servidor `tr(req, "clave")`. Para **agregar un idioma** basta con una entrada más en `MESSAGES` (con las mismas claves que `es`) y su código en `SUPPORTED`. `test/i18n.test.js` comprueba que no falte ninguna clave, que los `{parámetros}` coincidan, que el código no pida claves inexistentes y que nadie escriba textos a mano en los scripts.

### Convenciones de interfaz

* **Colores:** se definen solo en `public/css/tokens.css`. Para cambiar el acento de la marca basta con editar `--accent` (y `--accent-rgb`); el texto sobre el acento usa siempre `--on-accent` (oscuro, contraste 10:1).
* **Íconos:** son SVG de `public/js/icons.js` (`<span data-icon="mic">` en HTML o `iconSvg("mic")` en JS); no se usan emojis.
* `test/designSystem.test.js` hace cumplir ambas reglas (sin colores escritos a mano, sin emojis, texto legible sobre el acento, también al pasar el cursor).

## 🚀 Despliegue en Producción

Para desplegar en producción:

1. Configura `NODE_ENV=production` en tu archivo `.env`
2. Asegúrate de usar HTTPS (el servidor confía en el primer proxy)
3. Configura las rutas de datos persistentes:
   - Base de datos: `/data/karaoke.db`
   - Sesiones: `/data/sessions`
   - Descargas de YouTube: `/data/downloads` (archivos) y `/data/downloads.db` (registro; necesita permiso de escritura)
   - Calificaciones del karaoke: `/data/ratings.db` (necesita permiso de escritura; si no se puede abrir, el servidor arranca igual pero no pide calificar)
4. Actualiza las URLs de callback de Google OAuth con tu dominio de producción
5. Si vas a usar la búsqueda/descarga de YouTube, instala `yt-dlp` y `ffmpeg` en el host de producción (no se instalan solos con `npm install`)
6. El servidor cierra ordenadamente con `SIGTERM` o `SIGINT`: deja de aceptar conexiones, cierra las que haya y cierra las bases de datos antes de salir, para no cortar una escritura a medias en un despliegue. Si algo se cuelga, se sale igual a los 10 segundos.

## 🖥️ Modo Kiosko (Raspberry Pi / miniPC)

Para dejar la pantalla principal montada de forma permanente en un Raspberry Pi o un miniPC conectado a un TV por HDMI (video y audio), sin teclado ni mouse: el equipo enciende, hace login solo y abre el navegador a pantalla completa directo sobre la sala, sin que nadie tenga que tocar nada.

El script [`scripts/install-kiosk.sh`](scripts/install-kiosk.sh) automatiza esa instalación en Raspberry Pi OS (arm64) y en Debian/Ubuntu de un miniPC x86 — ambos son Debian-based, así que es el mismo script y los mismos paquetes en los dos. Usa Wayland (`cage`, un compositor mínimo hecho para mostrar una sola app a pantalla completa) + Chromium en modo `--kiosk`, arrancados por un servicio `systemd` que reemplaza el login de texto de la terminal — no hace falta escritorio.

**Requisitos:** una distro basada en Debian con `systemd` y PipeWire o PulseAudio (Raspberry Pi OS Bookworm o más nuevo; Debian 12+; Ubuntu 22.04+).

### Uso

Si el Raspberry Pi/miniPC va a correr también el servidor Node (copia el proyecto a `/opt/xaraoke`, `npm install` y configura su `.env` ahí primero):

```bash
sudo INSTALL_NODE_SERVICE=true APP_DIR=/opt/xaraoke ./scripts/install-kiosk.sh
```

Si el servidor corre en otra máquina de la red y este equipo solo muestra la pantalla:

```bash
sudo KIOSK_URL="http://192.168.1.50:8081/" ./scripts/install-kiosk.sh
```

Luego `sudo reboot`. El navegador espera hasta 60 segundos a que el servidor responda antes de abrir, para no ganarle la carrera al arranque.

### Raspberry Pi desde cero (solo pantalla)

Si partes de un Raspberry Pi OS **Lite** recién instalado (graba la microSD con Raspberry Pi Imager y configura ahí el Wi-Fi y el SSH), [`scripts/setup-raspberry-display.sh`](scripts/setup-raspberry-display.sh) lo convierte en pantalla de un servidor que corre en otra máquina, sin tener que clonar el repo:

```bash
curl -fsSL https://raw.githubusercontent.com/Xalcker/XaraokeURL/main/scripts/setup-raspberry-display.sh | sudo bash -s -- http://192.168.1.50:8081/
```

Además de instalar el kiosko (con `install-kiosk.sh`), actualiza el sistema, instala fuentes (Lite casi no trae), activa el driver de video KMS, **fuerza la salida HDMI** (1080p, o 720p en placas con menos de 1.5 GB de RAM; así el kiosko aparece aunque el TV esté apagado al encender el Pi) y desactiva el ahorro de energía del Wi-Fi, que corta el WebSocket. Opciones por variables de entorno: `DISPLAY_MODE` (`1280x720@60`, `auto`...), `KIOSK_HOSTNAME`, `READ_ONLY=true` (sistema de solo lectura para proteger la microSD de apagones), `REBOOT=true`; los detalles están al inicio del script.

**Hardware:** Raspberry Pi 4 (2 GB o más) o Pi 5 para la pantalla web con Chromium. En placas con menos de 1 GB de RAM (una Zero 2 W, por ejemplo) el script instala el **reproductor nativo** (ver abajo), porque ahí Chromium no alcanza.

### Reproductor nativo (Raspberry Pi Zero 2 W y placas chicas)

En una Pi Zero 2 W (512 MB) Chromium no llega a dibujar la página, y un navegador más liviano (WPE WebKit con `cog`) la dibuja pero decodifica el video por software y va a tirones. Por eso existe [`player/xaraoke-player.js`](player/xaraoke-player.js): la pantalla principal **sin navegador**. `mpv` reproduce el video con el decodificador H.264 por hardware del Pi y dibuja encima quién canta (arriba a la izquierda), quién sigue (abajo a la izquierda), el QR con el código de sala (abajo a la derecha) y el logo, semitransparente (arriba a la derecha). Sin canciones, muestra el logo y el QR grande sobre el fondo con los colores de la marca. El logo sale del mismo `public/img/logo.svg`: su trazo se convierte en un dibujo vectorial de ASS (`player/lib/svgPath.js`), así que se ve nítido a cualquier tamaño. Hace de host con las mismas APIs y mensajes que la pantalla web, así que el servidor y los remotos no notan la diferencia.

* Se elige con `KIOSK_PLAYER=mpv` en `install-kiosk.sh`; `setup-raspberry-display.sh` lo elige solo con menos de 1 GB de RAM.
* No necesita `npm`: solo `nodejs` y `mpv` del sistema. Usa el WebSocket que trae Node (Node 22+, o Node 20.10+ con `--experimental-websocket`, que el instalador agrega si hace falta).
* Recuerda la sala en disco: tras un reinicio recupera la misma (si el servidor la sigue guardando) o crea otra.
* En una Zero 2 W, un video de 720p se reproduce con ~70 % de un núcleo y pierde alrededor del 10 % de los cuadros: se nota poco, pero no es tan fluido como en una Pi 4.
* Se puede probar a mano, sin instalar el servicio: `XARAOKE_MPV_ARGS="--vo=gpu --gpu-context=drm --hwdec=v4l2m2m-copy" node --experimental-websocket player/xaraoke-player.js http://<servidor>:8081/` (con el kiosko detenido).

Frente a la pantalla web se ve más sencillo: sin barras laterales ni la lista de próximas canciones, sin tutorial ni pantalla completa (ya es pantalla completa). Si cambia cómo se comporta la pantalla principal en `public/karaoke.js` (pausas, saltos, reanudar tras un error), hay que reflejarlo también en `player/lib/hostLogic.js`.

### Qué configura

* Un usuario del sistema sin privilegios (`kiosk` por defecto) para la sesión gráfica.
* `xaraoke-kiosk.service`: arranca `cage` + Chromium (o el reproductor nativo, con `KIOSK_PLAYER=mpv`) en `tty1` al encender, sin login manual, y lo reinicia solo si se cae (`Restart=always`).
* A la URL se le agrega `?autostart=1`: sin teclado ni mouse nadie puede pulsar "Comenzar", así que la pantalla principal recupera sola la sala anterior (si el servidor la sigue guardando) o crea una nueva. En ese modo los errores no abren diálogos, que nadie podría cerrar: quedan en la consola y se reintenta cada 5 segundos. Sirve igual en cualquier navegador: abre `http://<servidor>:8081/?autostart=1`.
* Chromium arranca en español (`KIOSK_LANG=es`; la interfaz toma el idioma del navegador).
* El audio del sistema (PipeWire/PulseAudio, lo que haya) se fuerza a la salida **HDMI** al 100 % y sin silencio, para que el sonido salga por el mismo cable que el video y el volumen se maneje desde el TV.
* Audio HDMI estable: se instala `rtkit` (prioridad de tiempo real para PipeWire) y WirePlumber usa un búfer más grande para el HDMI y no lo suspende entre canciones. Sin esto, en una Pi Zero 2 W el sonido llegó a quedarse mudo a media sesión (`snd_pcm_mmap_commit error: Broken pipe` en el log).
* Opcionalmente (`INSTALL_NODE_SERVICE=true`), `xaraoke-server.service` corriendo `node server.js` en el mismo equipo.

Logs si algo no arranca: `journalctl -u xaraoke-kiosk.service -f`. Para revertir todo: `sudo ./scripts/install-kiosk.sh --uninstall` (no borra el usuario `kiosk`, por si guardó algo).

**No probado en hardware real todavía** — antes de confiar en él para un evento, probarlo una vez en el Raspberry Pi/miniPC de destino, sobre todo el paso de audio por HDMI (depende de cómo ese equipo en particular nombre su salida HDMI) y el arranque de `cage` con el driver de GPU de esa placa.

## 🛠️ Scripts Disponibles

* `npm start` - Inicia el servidor de producción
* `npm run lint` - Corre ESLint sobre todo el proyecto
* `npm test` - Corre las pruebas (`node --test`)
* `npm run import` - Importa canciones desde `songs.csv` a la base de datos (ruta configurable con `CSV_PATH`)
* `sudo ./scripts/install-kiosk.sh` - Instala el modo kiosko en un Raspberry Pi/miniPC (ver "Modo Kiosko" más arriba)
* `node player/xaraoke-player.js <url>` - La pantalla principal sin navegador, con `mpv` (ver "Reproductor nativo")
* `sudo ./scripts/setup-raspberry-display.sh <url>` - Convierte un Raspberry Pi OS Lite limpio en pantalla de XaraokeURL (ver "Raspberry Pi desde cero")

### Formato de `songs.csv`

Una canción por línea, `artista,titulo,url`. La primera línea puede ser la cabecera: se detecta y se salta sola.

Si el artista o el título llevan una coma, **hay que entrecomillar ese campo**:

```csv
artista,titulo,url
Queen,Bohemian Rhapsody,https://ejemplo/1.mp4
"Tyler, The Creator",EARFQUAKE,https://ejemplo/2.mp4
```

El importador avisa de las líneas que no pudo usar (con su número), de las que ya estaban y de aquellas cuya URL no parece una URL —el síntoma típico de una coma sin entrecomillar—, y sale con un código distinto de 0 si algo quedó fuera, para que se note desde un script.