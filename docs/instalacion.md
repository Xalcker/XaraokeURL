# 🚀 Cómo Empezar

Sigue estos pasos para ejecutar el proyecto en tu máquina local.

## Pre-requisitos

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

## Instalación

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

    Este paso es opcional: si no existe `karaoke.db`, el servidor arranca igual en "modo sin biblioteca" (ver [Búsqueda y descarga desde YouTube](youtube.md)).

6.  **Inicia el servidor:**
    ```bash
    npm start
    ```

7.  Abre tu navegador y ve a `http://localhost:8081` (o el puerto configurado en `.env`).

    **La pantalla principal se abre mejor como `localhost`.** El código QR que ven los teléfonos no puede llevar `localhost` (en el teléfono apuntaría al propio teléfono), así que el servidor lo arma con la dirección de tu red local. Además, con `localhost` el navegador permite mantener la pantalla encendida (ver [Modo TV](uso.md#-modo-tv-pantalla-principal)), cosa que no hace si abres la página por la IP con HTTP. Al iniciar, el servidor imprime sus direcciones y marca la que llevará el QR:

    ```
    🚀 Servidor corriendo en el puerto 8081
    🌐 Direcciones de este servidor:
       http://192.168.0.72:8081   (Wi-Fi)   <- la que lleva el código QR si abres la pantalla como localhost
       En este equipo: http://localhost:8081   (recomendada para la pantalla principal: ...)
    ```

    La dirección del QR también aparece escrita bajo el código, en la pantalla principal (en la vista minimalista, solo en la pantalla de espera). Con varias redes, va primero la del adaptador que da salida a la red (la de la ruta por defecto, en Linux; se vuelve a leer cada vez que la pantalla pide el QR, así que si pasas de Wi-Fi a cable el QR cambia solo, sin reiniciar el servidor: la pantalla lo actualiza al crear otra sala o al recargarse), luego las demás reales, y al final las de máquinas virtuales (VirtualBox, WSL, docker...). En Windows y macOS no se consulta la ruta por defecto y queda ese último orden. Si aun así el QR usa la red equivocada, fija la correcta en el `.env` con `LAN_IP=192.168.0.72`, que manda sobre todo lo demás. Si Windows muestra el aviso del Firewall la primera vez, permite el acceso en redes privadas. Estas direcciones solo se muestran fuera de producción.

## Levantar el server en local sin configurar Google OAuth

Si solo quieres probar la app en tu máquina y no quieres meterte a configurar credenciales de Google Cloud, puedes saltarte el login. En tu `.env` (con `NODE_ENV=development`, que es el default):

```bash
DISABLE_GOOGLE_AUTH=true
DEV_USER_NAME=Tu Nombre   # opcional, nombre para las conexiones que llegan sin nombre elegido; nadie puede escogerlo (si no lo fijas: "Usuario Local" o "Local User", según el idioma del navegador)
```

Con esto, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` ni hacen falta: el control remoto (`/remote.html`) queda accesible directamente. Esta variable **se ignora si `NODE_ENV=production`**, así que no hay riesgo de dejarla prendida por error en un deploy real.

**Cada dispositivo elige su propio nombre.** Al unirse a una sala, el control remoto pide "Tu nombre" y no sugiere ninguno: hay que escribirlo. El nombre se guarda en la sesión del navegador, así que al recargar la página vuelve prellenado, y es el que se muestra en la lista. Así funcionan igual que con Google el "(tú)", el botón "Quitar" (solo quitas tus canciones) y el aviso de "tu turno" (solo le llega a quien sigue). Se limita a 30 caracteres y se le quitan saltos de línea y caracteres invisibles. Como el nombre es lo único que distingue a una persona de otra, **no puede repetirse dentro de una sala**: el primer dispositivo que entra con un nombre se lo queda (sin distinguir mayúsculas ni acentos), y quien intente usarlo después tiene que elegir otro. El nombre se libera cuando su dueño ya no está conectado ni tiene canciones en la lista. Tampoco se aceptan los genéricos ("Usuario Local", "Local User", "Usuario", "User" ni el de `DEV_USER_NAME`). Por lo mismo, sin login cada persona usa un solo dispositivo por sala.

---

## Formato de `songs.csv`

Una canción por línea, `artista,titulo,url`. La primera línea puede ser la cabecera: se detecta y se salta sola.

Si el artista o el título llevan una coma, **hay que entrecomillar ese campo**:

```csv
artista,titulo,url
Queen,Bohemian Rhapsody,https://ejemplo/1.mp4
"Tyler, The Creator",EARFQUAKE,https://ejemplo/2.mp4
```

El importador avisa de las líneas que no pudo usar (con su número), de las que ya estaban y de aquellas cuya URL no parece una URL —el síntoma típico de una coma sin entrecomillar—, y sale con un código distinto de 0 si algo quedó fuera, para que se note desde un script.