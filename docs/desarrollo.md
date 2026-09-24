# 📁 Estructura del Proyecto

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
│   │   ├── shared.js             # Utilidades compartidas (escapeHtml, parseSongFilename, cuenta regresiva)
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
│   ├── roomPolicy.js             # Tiempos de gracia (ROOM_GRACE_MINUTES, SINGER_GRACE_SECONDS) y cuenta regresiva (SONG_COUNTDOWN_SECONDS) (testeable)
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
├── docs/                         # La documentación (instalación, uso, kiosko, seguridad...); el README enlaza a ella
├── scripts/                      # install-kiosk.sh y setup-raspberry-display.sh (ver docs/kiosko.md)
├── player/                       # El reproductor nativo con mpv, sin navegador (ver docs/reproductor-nativo.md)
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

## Pruebas

Dos tipos, ambas con `npm test`:

* **Unitarias.** Todo lo de `lib/` y `public/js/` se prueba directo y aislado: son rápidas y no levantan nada.
* **De integración.** `test/httpApi.test.js`, `test/wsHandshake.test.js` y `test/wsQueue.test.js` arrancan `server.js` de verdad, en un puerto libre y con sus bases en una carpeta temporal, y hablan con él por HTTP y por WebSocket como lo haría un navegador. Son las que comprueban que una ruta siga pidiendo sesión, que un control remoto no pueda hacerse pasar por el host y que "solo quien canta controla" se cumpla con varios clientes conectados a la vez.

Los ayudantes viven en `test-helpers/` y no en `test/` a propósito: `node --test` trata como archivo de prueba a todo `.js` que cuelgue de `test/`.

Quedan unas pocas comprobaciones sobre el **código fuente** (leen el servidor y le pasan una expresión regular), solo para las reglas que no se pueden observar desde fuera sin `yt-dlp` o sin una cuenta de Google de verdad. Leen el servidor entero a través de `test-helpers/serverSources.js`, así que mover código de un módulo a otro ya no las rompe.

## Cómo está organizado el servidor

`server.js` solo arranca: lee la configuración, crea las piezas de `src/`, las conecta y escucha. No tiene reglas de negocio.

Cada pieza **recibe lo que necesita** en vez de buscarlo, así que no hay `require` circulares y se pueden probar por separado. El caso más claro: las descargas avisan de sus cambios con un callback (`onChange`) en vez de llamar al WebSocket, y es el arranque quien conecta los dos cables.

## Idiomas

La interfaz está en **español** (predeterminado) e **inglés**, y cada persona ve el idioma de su navegador (`navigator.languages`); si no coincide con ninguno de los dos, se usa español. El host y cada control remoto pueden estar en idiomas distintos. Los mensajes de error de la API y las pantallas de acceso los traduce el servidor con el header `Accept-Language` del navegador. Los registros de la consola del servidor siguen en español.

Todos los textos viven en `public/js/i18n.js`. En el HTML se marcan con `data-i18n="clave"` (o `data-i18n-placeholder`, `-aria-label`, `-title`, `-alt`, `-html`), dejando dentro el texto en español como respaldo; en JavaScript se usa `t("clave", { parametro })`, y en el servidor `tr(req, "clave")`. Para **agregar un idioma** basta con una entrada más en `MESSAGES` (con las mismas claves que `es`) y su código en `SUPPORTED`. `test/i18n.test.js` comprueba que no falte ninguna clave, que los `{parámetros}` coincidan, que el código no pida claves inexistentes y que nadie escriba textos a mano en los scripts.

## Convenciones de interfaz

* **Colores:** se definen solo en `public/css/tokens.css`. Para cambiar el acento de la marca basta con editar `--accent` (y `--accent-rgb`); el texto sobre el acento usa siempre `--on-accent` (oscuro, contraste 10:1).
* **Íconos:** son SVG de `public/js/icons.js` (`<span data-icon="mic">` en HTML o `iconSvg("mic")` en JS); no se usan emojis.
* `test/designSystem.test.js` hace cumplir ambas reglas (sin colores escritos a mano, sin emojis, texto legible sobre el acento, también al pasar el cursor).
