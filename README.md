# XaraokeURL 🎤🎶

Un reproductor de karaoke interactivo basado en la web, construido con HTML5, Node.js y WebSockets. Los usuarios exploran una biblioteca de canciones y añaden canciones a una lista compartida en tiempo real desde sus teléfonos, escaneando un código QR: no hace falta instalar ninguna app.

## ✨ Lo esencial

* **Pantalla principal (host)** en un TV o navegador: reproduce el video, muestra quién canta y quién sigue, y un QR para que los demás se unan.
* **Control remoto en el teléfono:** busca, agrega a la lista, reordena tus canciones y controla la reproducción cuando te toca cantar. Se instala como app (PWA) y no necesita cuenta de Google en modo local.
* **Salas virtuales** de 4 letras, cada una con su lista, sincronizadas al instante por WebSockets.
* **Biblioteca local** (URLs en SQLite) y **búsqueda y descarga desde YouTube** con `yt-dlp`.
* **Modo kiosko:** un Raspberry Pi o un miniPC que enciende y abre la sala a pantalla completa por HDMI, sin teclado ni mouse.
* **Español e inglés**, cada persona en el idioma de su navegador.

La lista completa está en [Características](docs/caracteristicas.md).

## 🛠️ Stack

* **Backend:** Node.js, Express, WebSockets (`ws`), SQLite3
* **Frontend:** HTML5, CSS3, JavaScript (Vanilla)
* **Autenticación:** Passport.js con Google OAuth 2.0 (opcional en desarrollo)
* **Búsqueda/descarga de YouTube:** `yt-dlp` + `ffmpeg` (binarios del sistema, no son paquetes de npm)

## 🚀 Empezar rápido

Requiere Node.js 20.17 o superior.

```bash
git clone https://github.com/Xalcker/XaraokeURL.git && cd XaraokeURL
npm install
cp .env.example .env          # y en el .env: DISABLE_GOOGLE_AUTH=true para probar sin Google
npm start
```

Abre `http://localhost:8081`, pulsa **Comenzar** y escanea el QR con el teléfono. Los detalles (Google OAuth, catálogo de canciones, `yt-dlp`, la dirección del QR) están en [Instalación](docs/instalacion.md).

## 📚 Documentación

| Quiero... | Lee |
|---|---|
| Instalar el servidor, configurar el `.env`, cargar canciones | [Instalación](docs/instalacion.md) |
| Saber cómo se usa (salas, lista, Modo TV, calificar) | [Uso](docs/uso.md) |
| Buscar y descargar canciones desde YouTube | [YouTube](docs/youtube.md) |
| Ver todas las características | [Características](docs/caracteristicas.md) |
| Dejar una pantalla fija en un Raspberry Pi o miniPC | [Modo Kiosko](docs/kiosko.md) |
| Publicarlo en un servidor de producción | [Producción](docs/produccion.md) |
| Entender las medidas de seguridad | [Seguridad](docs/seguridad.md) |
| Tocar el código (estructura, pruebas, idiomas, convenciones) | [Desarrollo](docs/desarrollo.md) |

## 🖥️ Modo Kiosko

Convierte un Raspberry Pi o un miniPC en una pantalla dedicada: enciende, muestra el logo y abre la sala a pantalla completa por HDMI (video y audio). Un Pi 4 puede además correr el servidor.

| Equipo | Guía | Estado |
|---|---|---|
| Raspberry Pi 4/5, servidor y pantalla en el mismo Pi | [Raspberry Pi](docs/kiosko-raspberry-pi.md) | Probado |
| Raspberry Pi Zero 2 W (reproductor nativo, sin navegador) | [Raspberry Pi](docs/kiosko-raspberry-pi.md#c-pi-zero-2-w-y-placas-chicas-solo-pantalla) | Probado |
| miniPC x86 (Debian 13) | [miniPC x86](docs/kiosko-x86.md) | Probado en Debian 13; Ubuntu Server sin resolver |

Si algo no arranca, mira [Problemas conocidos](docs/kiosko-problemas.md).

## 🛠️ Scripts disponibles

* `npm start` - Inicia el servidor
* `npm run lint` - Corre ESLint sobre todo el proyecto
* `npm test` - Corre las pruebas (`node --test`)
* `npm run import` - Importa canciones desde `songs.csv` a la base de datos (ruta configurable con `CSV_PATH`; ver [formato](docs/instalacion.md#formato-de-songscsv))
* `sudo ./scripts/install-kiosk.sh` - Instala el modo kiosko (ver [Modo Kiosko](docs/kiosko.md))
* `sudo ./scripts/setup-raspberry-display.sh <url>` - Convierte un Raspberry Pi OS Lite limpio en pantalla de XaraokeURL (ver [Raspberry Pi](docs/kiosko-raspberry-pi.md))
* `sudo ./scripts/setup-x86-display.sh <url>` - Convierte un Debian 13 x86 sin escritorio en pantalla de XaraokeURL (ver [miniPC x86](docs/kiosko-x86.md))
* `node player/xaraoke-player.js <url>` - La pantalla principal sin navegador, con `mpv` (ver [Reproductor nativo](docs/reproductor-nativo.md))
