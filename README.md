# XaraokeURL 🎤🎶

Un reproductor de karaoke interactivo basado en la web, construido con HTML5, Node.js y WebSockets. Los usuarios pueden explorar una biblioteca de canciones y añadir colaborativamente canciones a una cola en tiempo real desde sus dispositivos móviles usando un código QR.

---
## ✨ Características

* **Base de Datos de URLs:** Las canciones de karaoke (videos MP4) se gestionan a través de URLs directas en una base de datos local SQLite.
* **Control Remoto en Tiempo Real:** La interfaz del reproductor y los controles remotos se sincronizan instantáneamente usando WebSockets.
* **Conexión por QR:** Escanea un código QR en la pantalla principal para abrir la interfaz remota en cualquier teléfono, sin necesidad de instalar una app.
* **Explorador de Canciones Alfabético:** Navega por la biblioteca de canciones de forma intuitiva, filtrando por artista y luego seleccionando la canción.
* **Cola de Reproducción Compartida:** Múltiples usuarios pueden ver y añadir canciones a la misma cola de reproducción en tiempo real.
* **Controles de Reproducción:** Los controles remotos pueden pausar, reanudar y saltar canciones.
* **Salas Virtuales:** Soporte de salas virtuales con colas independientes mediante códigos de 4 letras.
* **Autenticación Google OAuth:** Acceso seguro al control remoto mediante autenticación con cuentas de Google (dominio configurable).
* **Gestión de Sesiones:** Sesiones persistentes almacenadas en archivos para mantener usuarios autenticados.
* **Redirección Automática:** Los dispositivos móviles son redirigidos automáticamente al control remoto.
* **Buscador de Canciones:** Además del explorador alfabético, un buscador de texto (insensible a acentos) filtra por artista o título.
* **Aviso de Host Desconectado:** Si la pantalla principal se desconecta, todos los remotos muestran un aviso en vez de seguir agregando canciones a una cola que nadie va a reproducir.
* **Notificaciones Confiables:** El control remoto vibra, suena y muestra un aviso visual pulsante para avisar cuando la canción está a punto de empezar (10 segundos antes), incluso en navegadores que bloquean el autoplay de audio.
* **Búsqueda y Descarga desde YouTube:** Si una canción no está en la biblioteca, se puede buscar en YouTube (con sufijos como "karaoke", "instrumental" o "pista"), elegir entre varios resultados y agregarla a la cola de forma efímera.

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

    **Si vas a conectar teléfonos con el código QR, no uses `localhost`:** el QR se arma con la dirección con la que abriste la página, y en el teléfono `localhost` apunta al propio teléfono. Al iniciar, el servidor imprime las direcciones de tu red local; abre la pantalla principal con una de ellas (por ejemplo `http://192.168.0.72:8081`):

    ```
    🚀 Servidor corriendo en el puerto 8081
    🌐 Abre la pantalla principal con una de estas direcciones (con localhost, el QR no funcionaría en los teléfonos):
       http://192.168.0.72:8081   (Wi-Fi)
       Solo en este equipo: http://localhost:8081
    ```

    Si aparece más de una, usa la del adaptador por el que estás conectado a la misma red Wi-Fi que los teléfonos (el nombre del adaptador aparece entre paréntesis). Si Windows muestra el aviso del Firewall la primera vez, permite el acceso en redes privadas. Estas direcciones solo se muestran fuera de producción.

### Levantar el server en local sin configurar Google OAuth

Si solo quieres probar la app en tu máquina y no quieres meterte a configurar credenciales de Google Cloud, puedes saltarte el login. En tu `.env` (con `NODE_ENV=development`, que es el default):

```bash
DISABLE_GOOGLE_AUTH=true
DEV_USER_NAME=Tu Nombre   # opcional, es el nombre que se sugiere por defecto
```

Con esto, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` ni hacen falta: el control remoto (`/remote.html`) queda accesible directamente. Esta variable **se ignora si `NODE_ENV=production`**, así que no hay riesgo de dejarla prendida por error en un deploy real.

**Cada dispositivo elige su propio nombre.** Al unirse a una sala, el control remoto pide "Tu nombre" (con `DEV_USER_NAME` como sugerencia). El nombre se guarda en la sesión del navegador, así que al recargar la página vuelve prellenado, y es el que se muestra en la cola. Así funcionan igual que con Google el "(tú)", el botón "Quitar" (solo quitas tus canciones) y el aviso de "tu turno" (solo le llega a quien sigue). Se limita a 30 caracteres y se le quitan saltos de línea y caracteres invisibles. Ten en cuenta que dos personas que elijan **el mismo nombre** se comportan como una sola.

---
## 💡 Cómo Usar

1.  Abre la aplicación en un navegador en tu computadora o TV (el **Host**).
2.  Haz clic en "Comenzar" para crear una nueva sala. Se generará un código de sala de 4 letras.
3.  Escanea el código QR con la cámara de tu teléfono para abrir el **Control Remoto**.
4.  Inicia sesión con tu cuenta de Google (debe ser del dominio autorizado configurado en el código).
5.  Introduce el código de sala de 4 letras para unirte a la sesión.
6.  Usa el explorador alfabético o el buscador de texto para encontrar tu canción favorita y añadirla a la cola (si no aparece, puedes buscarla en YouTube — ver la sección "Búsqueda y descarga desde YouTube" más abajo).
7.  La cola se actualizará en la pantalla principal y en todos los remotos conectados.
8.  Recibirás una notificación (vibración, sonido y un aviso visual) 10 segundos antes de que empiece tu canción.
9.  ¡Espera tu turno y canta!

Si el host se desconecta (por ejemplo, alguien cierra la pestaña de la pantalla principal por error), todos los remotos muestran un aviso hasta que se reconecte.

## 🔎 Búsqueda y descarga desde YouTube

Si buscas una canción y no aparece en la biblioteca, el control remoto ofrece buscarla en YouTube:

1. Al no haber resultados en la búsqueda local, aparece la opción de buscar en YouTube con un sufijo (Karaoke, Instrumental, Pista o sin sufijo). Basta con pulsar **Enter** (o la tecla "Ir/Buscar" del teclado del celular) para buscar directamente con el sufijo elegido, "Karaoke" por defecto. Si hay coincidencias en la biblioteca local, Enter no hace nada.
2. Se muestran hasta 4 resultados (miniatura, título, canal y duración) para elegir manualmente — nunca se reproduce el primer resultado a ciegas.
3. Al elegir uno, se descarga (video + audio, hasta 720p) y se agrega a la cola de esa sesión. Se prefiere el códec H.264, que casi cualquier dispositivo reproduce con aceleración por hardware (TVs, Safari/iOS, navegadores sin soporte de AV1); si el video no lo ofrece, se usa AV1 u otro MP4 disponible.

Detalles a tener en cuenta:

* **Funciona sin biblioteca.** Si no existe `karaoke.db` (no ejecutaste `npm run import`), el servidor arranca igual y deja un aviso en los logs: el catálogo local aparece vacío (con el selector de sufijo ya visible) y la única forma de agregar canciones es escribir el nombre y pulsar Enter para buscarlas en YouTube. Al ejecutar `npm run import` y reiniciar el servidor, la biblioteca local queda disponible junto con la búsqueda en YouTube.
* **Cómo se ve en la cola.** Las canciones de YouTube se muestran con el título del video (y "YouTube" como artista), tanto en la pantalla principal como en el control remoto, en lugar del nombre interno del archivo.
* **Es efímero, no permanente.** El video descargado no se guarda en `karaoke.db`; vive en `DOWNLOADS_PATH` (`./downloads` en desarrollo, `/data/downloads` en producción) y se borra automáticamente 6 horas después de descargado.
* **Límites anti-abuso:** máximo 20 búsquedas/min y 5 descargas/min por IP, como mucho 3 descargas corriendo a la vez, y se rechazan videos de más de 10 minutos.
* **Requiere `yt-dlp` y `ffmpeg`** instalados en el servidor (ver Pre-requisitos). Sin ellos, la búsqueda/descarga devuelve error pero el resto de la app sigue funcionando normal.
* **Consideración legal:** descargar contenido de YouTube puede estar en conflicto con sus Términos de Servicio. Esta función se ofrece para uso personal/privado (la misma sala cerrada por autenticación que ya protege al resto de la app); usarla es criterio y responsabilidad de quien despliega el servidor.

## 🔒 Seguridad

* El acceso al control remoto requiere autenticación con Google OAuth 2.0.
* Por defecto, solo se permiten cuentas del dominio `@xalcker.xyz` (configurable con la variable de entorno `ALLOWED_DOMAIN`).
* Las sesiones se almacenan de forma segura en el servidor; en producción, las cookies usan el flag `secure` para HTTPS.
* **El host de una sala se autentica con un token secreto** (`hostToken`, generado al crear la sala), no con un flag que el cliente pueda falsificar — solo quien creó la sala puede controlar la reproducción o suplantar el nombre en la cola.
* **El WebSocket valida el header `Origin`** en el handshake, rechazando conexiones cross-site que intenten aprovechar la cookie de sesión del navegador.
* **Headers de seguridad HTTP** vía `helmet` (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, etc.).
* **Rate limiting** en los endpoints más sensibles: creación de salas (10/min), búsqueda en YouTube (20/min) y descarga de YouTube (5/min, máximo 3 descargas simultáneas).
* **Salas y descargas se limpian solas:** una sala sin conexiones se borra a los 10 minutos, y las descargas de YouTube a las 6 horas — nada queda creciendo en memoria o disco indefinidamente.
* **Contenido generado por usuarios escapado antes de insertarse en el DOM** (nombres de perfil, títulos de canciones) para evitar XSS.
* **La cola solo acepta canciones válidas:** un `filename` en `addSong` se valida contra la base de datos o el registro de descargas de YouTube antes de encolarse; nunca se confía en lo que mande el cliente a ciegas.
* **La descarga de YouTube nunca interpola datos del usuario en un shell:** se invoca `yt-dlp` vía `execFile` con argumentos separados, el ID de video se valida con una expresión regular estricta antes de usarse, y los archivos se guardan con un nombre generado por el servidor (UUID), nunca con datos provistos por el cliente.

## 📁 Estructura del Proyecto

```
XaraokeURL/
├── public/
│   ├── css/
│   │   ├── host.css              # Estilos para la pantalla principal
│   │   └── remote.css            # Estilos para el control remoto
│   ├── js/
│   │   └── shared.js             # Utilidades compartidas (escapeHtml, parseSongFilename)
│   ├── index.html                # Interfaz del host/reproductor
│   ├── karaoke.js                # Lógica del reproductor principal
│   ├── remote.html               # Interfaz del control remoto
│   ├── remote.js                 # Lógica del control remoto
│   └── notification.mp3          # Sonido de notificación
├── lib/
│   ├── displayName.js            # Validación del nombre elegido en modo desarrollo (testeable)
│   ├── network.js                # Detección de las IPs de la red local (testeable)
│   ├── roomId.js                 # Generación de códigos de sala (testeable)
│   └── ytdlp.js                  # Wrapper seguro sobre el binario yt-dlp
├── test/                         # Pruebas unitarias (node --test)
├── .github/workflows/ci.yml      # CI: lint + test en cada push/PR
├── eslint.config.js              # Configuración de ESLint
├── server.js                     # Servidor principal con WebSockets y OAuth
├── import_csv.js                 # Script para importar canciones desde CSV
├── package.json                  # Dependencias del proyecto
├── .env.example                  # Plantilla de variables de entorno
├── .env                          # Variables de entorno (no incluido en git)
├── songs.csv                     # Catálogo de canciones (no incluido en git)
├── karaoke.db                    # Base de datos SQLite (generada automáticamente)
└── downloads/                    # Descargas efímeras de YouTube (no incluido en git)
```

## 🚀 Despliegue en Producción

Para desplegar en producción:

1. Configura `NODE_ENV=production` en tu archivo `.env`
2. Asegúrate de usar HTTPS (el servidor confía en el primer proxy)
3. Configura las rutas de datos persistentes:
   - Base de datos: `/data/karaoke.db`
   - Sesiones: `/data/sessions`
   - Descargas de YouTube: `/data/downloads`
4. Actualiza las URLs de callback de Google OAuth con tu dominio de producción
5. Si vas a usar la búsqueda/descarga de YouTube, instala `yt-dlp` y `ffmpeg` en el host de producción (no se instalan solos con `npm install`)

## 🛠️ Scripts Disponibles

* `npm start` - Inicia el servidor de producción
* `npm run lint` - Corre ESLint sobre todo el proyecto
* `npm test` - Corre las pruebas unitarias (`node --test`)
* `npm run import` - Importa canciones desde `songs.csv` a la base de datos