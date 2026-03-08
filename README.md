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
* **Notificaciones Inteligentes:** El control remoto vibra y suena para avisar al usuario cuando su canción está a punto de empezar (10 segundos antes).
* **Salas Virtuales:** Soporte de salas virtuales con colas independientes mediante códigos de 4 letras.
* **Autenticación Google OAuth:** Acceso seguro al control remoto mediante autenticación con cuentas de Google (dominio configurable).
* **Gestión de Sesiones:** Sesiones persistentes almacenadas en archivos para mantener usuarios autenticados.
* **Redirección Automática:** Los dispositivos móviles son redirigidos automáticamente al control remoto.

---
## 🛠️ Stack Tecnológico

* **Backend:** Node.js, Express, WebSockets (`ws`), SQLite3
* **Frontend:** HTML5, CSS3, JavaScript (Vanilla)
* **Autenticación:** Passport.js con Google OAuth 2.0
* **Sesiones:** express-session con almacenamiento en archivos (session-file-store)
* **Dependencias Clave:** `sqlite3`, `qrcode`, `ws`, `passport`, `passport-google-oauth20`, `express-session`, `dotenv`

---
## 🚀 Cómo Empezar

Sigue estos pasos para ejecutar el proyecto en tu máquina local.

### Pre-requisitos

* Node.js (v16 o superior)
* npm
* Cuenta de Google Cloud con OAuth 2.0 configurado (para autenticación)

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

6.  **Inicia el servidor:**
    ```bash
    npm start
    ```

7.  Abre tu navegador y ve a `http://localhost:8081` (o el puerto configurado en `.env`).

---
## 💡 Cómo Usar

1.  Abre la aplicación en un navegador en tu computadora o TV (el **Host**).
2.  Haz clic en "Comenzar" para crear una nueva sala. Se generará un código de sala de 4 letras.
3.  Escanea el código QR con la cámara de tu teléfono para abrir el **Control Remoto**.
4.  Inicia sesión con tu cuenta de Google (debe ser del dominio autorizado configurado en el código).
5.  Introduce el código de sala de 4 letras para unirte a la sesión.
6.  Usa el explorador alfabético para encontrar tu canción favorita y añadirla a la cola.
7.  La cola se actualizará en la pantalla principal y en todos los remotos conectados.
8.  Recibirás una notificación (vibración y sonido) 10 segundos antes de que empiece tu canción.
9.  ¡Espera tu turno y canta!

## 🔒 Seguridad

* El acceso al control remoto requiere autenticación con Google OAuth 2.0
* Por defecto, solo se permiten cuentas del dominio `@xalcker.xyz` (configurable en `server.js`)
* Las sesiones se almacenan de forma segura en el servidor
* En producción, las cookies de sesión usan el flag `secure` para HTTPS

## 📁 Estructura del Proyecto

```
XaraokeURL/
├── public/
│   ├── css/
│   │   ├── host.css          # Estilos para la pantalla principal
│   │   └── remote.css        # Estilos para el control remoto
│   ├── index.html            # Interfaz del host/reproductor
│   ├── karaoke.js            # Lógica del reproductor principal
│   ├── remote.html           # Interfaz del control remoto
│   ├── remote.js             # Lógica del control remoto
│   └── notification.mp3      # Sonido de notificación
├── server.js                 # Servidor principal con WebSockets y OAuth
├── import_csv.js             # Script para importar canciones desde CSV
├── package.json              # Dependencias del proyecto
├── .env.example              # Plantilla de variables de entorno
├── .env                      # Variables de entorno (no incluido en git)
├── songs.csv                 # Catálogo de canciones (no incluido en git)
└── karaoke.db                # Base de datos SQLite (generada automáticamente)
```

## 🚀 Despliegue en Producción

Para desplegar en producción:

1. Configura `NODE_ENV=production` en tu archivo `.env`
2. Asegúrate de usar HTTPS (el servidor confía en el primer proxy)
3. Configura las rutas de datos persistentes:
   - Base de datos: `/data/karaoke.db`
   - Sesiones: `/data/sessions`
4. Actualiza las URLs de callback de Google OAuth con tu dominio de producción

## 🛠️ Scripts Disponibles

* `npm start` - Inicia el servidor de producción
* `npm run import` - Importa canciones desde `songs.csv` a la base de datos