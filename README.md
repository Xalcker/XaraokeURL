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
* **Notificaciones Inteligentes:** El control remoto vibra y suena para avisar al usuario cuando su canción está a punto de empezar.
* **Salas virtuales:** Soporte de Salas virtuales con colas independientes.

---
## 🛠️ Stack Tecnológico

* **Backend:** Node.js, Express, WebSockets (`ws`), SQLite3
* **Frontend:** HTML5, CSS3, JavaScript (Vanilla)
* **Dependencias Clave:** `sqlite3`, `qrcode`

---
## 🚀 Cómo Empezar

Sigue estos pasos para ejecutar el proyecto en tu máquina local.

### Pre-requisitos

* Node.js (v16 o superior)
* npm

### Instalación

1.  **Copia todos los archivos** proporcionados en un nuevo directorio.

2.  **Crea tu catálogo de canciones** en un archivo llamado `songs.csv` en la raíz del proyecto. Usa el formato: `Artista,Cancion,URL`.

3.  **Abre una terminal** en el directorio del proyecto e instala las dependencias:
    ```bash
    npm install
    ```
4.  **Importa tus canciones** a la base de datos. Este comando leerá `songs.csv` y creará/llenará el archivo `karaoke.db`.
    ```bash
    npm run import
    ```
5.  **Inicia el servidor:**
    ```bash
    npm start
    ```
6.  Abre tu navegador y ve a `http://localhost:3000`.

---
## 💡 Cómo Usar

1.  Abre la aplicación en un navegador en tu computadora o TV (el **Host**).
2.  Escanea el código QR con la cámara de tu teléfono para abrir el **Control Remoto**.
3.  Introduce tu nombre en la interfaz remota.
4.  Usa el explorador alfabético para encontrar tu canción favorita y añadirla a la cola.
5.  La cola se actualizará en la pantalla principal y en todos los remotos conectados.
6.  ¡Espera tu turno y canta!