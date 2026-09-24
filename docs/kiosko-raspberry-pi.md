# 🍓 Kiosko en Raspberry Pi

Guía completa para convertir un Raspberry Pi con **Raspberry Pi OS Lite** (la más básica, sin escritorio) en la pantalla de XaraokeURL. Para el contexto general (qué es el kiosko, variables, operación) mira [Modo Kiosko](kiosko.md).

Hay tres casos:

* **A.** Pi 4 o 5: servidor y pantalla en el mismo equipo.
* **B.** Pi 4 o 5: solo pantalla, con el servidor en otra máquina.
* **C.** Pi Zero 2 W y placas chicas: solo pantalla, con el [reproductor nativo](reproductor-nativo.md).

## 0. Preparar la tarjeta (todos los casos)

1. En **Raspberry Pi Imager** elige **Raspberry Pi OS Lite (64-bit)**.
2. En los ajustes (el engrane) configura: nombre del equipo (por ejemplo `xaraoke-tv`), tu usuario y contraseña, el Wi-Fi con el país correcto y **SSH activado**.
3. Enciende el Pi, espera un par de minutos y entra por SSH: `ssh tu_usuario@xaraoke-tv.local`.

**Recomendación de red:** reserva una IP fija para el Pi en tu router (por su MAC). El QR y las pantallas que apunten a este Pi dependen de esa IP.

## A. Pi 4 o 5: servidor y pantalla en el mismo equipo

Necesitas un Pi con 2 GB de RAM o más: con menos de 1 GB el script elige el reproductor nativo en lugar de Chromium.

**1. Anota su IP** (para reconocerlo en la red y reservarlo en el router; el `.env` no la necesita):

```bash
hostname -I
```

**2. Instala Node, git, ffmpeg y yt-dlp.** Node 20.19 sale de los repos de Debian 13 y el proyecto pide 20.17 o más. `ffmpeg` y `yt-dlp` solo hacen falta para la búsqueda y descarga desde YouTube ([detalles](youtube.md)):

```bash
sudo apt-get update
sudo apt-get install -y nodejs npm git ffmpeg python3-pip
sudo pip install --break-system-packages yt-dlp
node --version                       # 20.17 o más
ffmpeg -version | head -1; yt-dlp --version
```

**3. Baja la app y sus dependencias.** El usuario `kiosk` es el que correrá el servidor; se crea aquí para poder darle la carpeta:

```bash
sudo useradd -m -s /bin/bash kiosk
sudo git clone https://github.com/Xalcker/XaraokeURL.git /opt/xaraoke
sudo chown -R kiosk:kiosk /opt/xaraoke
cd /opt/xaraoke && sudo -u kiosk npm ci --omit=dev
```

**4. Crea el `.env`.** Para una prueba rápida, sin Google OAuth:

```bash
sudo -u kiosk tee /opt/xaraoke/.env >/dev/null <<EOF
PORT=8081
NODE_ENV=development
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
DISABLE_GOOGLE_AUTH=true
EOF
```

No hace falta fijar la IP para el QR: el servidor la detecta solo (la del adaptador que da salida a la red; ver [Instalación](instalacion.md)). Con `DISABLE_GOOGLE_AUTH` no necesitas credenciales de Google, pero solo funciona con `NODE_ENV=development` ([más detalles](instalacion.md)). Para producción y Google OAuth, mira [Despliegue en producción](produccion.md).

**5. Instala la pantalla y el servicio del servidor.** La URL es `localhost` porque el servidor está en este mismo Pi; `INSTALL_NODE_SERVICE=true` crea el servicio que lo arranca:

```bash
curl -fsSL https://raw.githubusercontent.com/Xalcker/XaraokeURL/main/scripts/setup-raspberry-display.sh \
  | sudo INSTALL_NODE_SERVICE=true bash -s -- http://localhost:8081/
```

Tarda varios minutos: actualiza el sistema, regenera el initramfs y descarga los paquetes. Al final puede avisar que el servidor "no responde ahora": es normal, acaba de arrancar.

**6. Reinicia:**

```bash
sudo reboot
```

**7. Qué debes ver en el TV, en orden:** el logo de XaraokeURL, un negro corto, un blanco y la sala. Sin texto en medio y sin puntero. La dirección escrita bajo el QR debe ser la de tu red (por ejemplo `192.168.0.72`) y no `localhost`.

**8. Comprobaciones:**

```bash
systemctl status xaraoke-server.service xaraoke-kiosk.service --no-pager | head -30
curl -sI http://localhost:8081/ | head -1
```

Escanea el QR con el teléfono y confirma que abre el control remoto. Si además usas YouTube, busca una canción y revisa `journalctl -u xaraoke-server.service -b --no-pager`.

**Ya con biblioteca local:** sin `karaoke.db` el servidor arranca en "modo sin biblioteca" (solo YouTube). Si tienes un `songs.csv` ([formato](instalacion.md#formato-de-songscsv)): `cd /opt/xaraoke && sudo -u kiosk npm run import` y `sudo systemctl restart xaraoke-server.service`.

### Por cable en lugar de Wi-Fi

Funciona igual y suele ir más estable. Vigila:

* La IP cambia, pero el QR la sigue solo: el servidor usa la del adaptador con la ruta por defecto (el cable, si está conectado) y la vuelve a leer cada vez que la pantalla pide el QR (al crear o recuperar la sala, o al recargarse). No hay que tocar el `.env` ni reiniciar el servidor, pero un QR que ya está en pantalla no cambia hasta entonces. Las pantallas que apunten a este Pi con su IP vieja (una Pi Zero, por ejemplo) sí hay que cambiarlas: reserva la IP del cable en el router para no tener que hacerlo.
* Con Wi-Fi y cable a la vez, el QR lleva la IP del adaptador con la ruta por defecto. Si no es la que quieres, fija `LAN_IP` en el `.env`.
* Reserva la IP del cable en el router.

## B. Pi 4 o 5: solo pantalla

Igual que el caso A, pero sin los pasos 1 a 4 (no hay servidor en este Pi) y con la URL del servidor, no `localhost`:

```bash
curl -fsSL https://raw.githubusercontent.com/Xalcker/XaraokeURL/main/scripts/setup-raspberry-display.sh \
  | sudo bash -s -- http://192.168.1.50:8081/
sudo reboot
```

Sustituye `192.168.1.50` por la IP de tu servidor. Debe estar encendido y respondiendo antes de arrancar el Pi.

## C. Pi Zero 2 W y placas chicas (solo pantalla)

Con menos de 1 GB de RAM el script instala solo el [reproductor nativo](reproductor-nativo.md) (`mpv`), porque ahí Chromium no alcanza. Es el mismo comando del caso B, con la IP del servidor (por ejemplo, la de un Pi 4 que corre el caso A):

```bash
curl -fsSL https://raw.githubusercontent.com/Xalcker/XaraokeURL/main/scripts/setup-raspberry-display.sh \
  | sudo bash -s -- http://192.168.0.99:8081/
```

Cuando termine (dice "Listo. El Pi va a abrir ... a pantalla completa"), reinicia con `sudo reboot`. **Mantén encendido el servidor** antes de arrancar la Zero.

La instalación tarda más que en un Pi 4, sobre todo al regenerar el initramfs para dos kernels. Déjala terminar sin cortarla; si pasan más de unos 15 minutos sin mensajes nuevos, en otra sesión SSH `top -bn1 | head -12` debería mostrar `update-initramfs`, `cpio` o `gzip` usando CPU.

**Qué debes ver:** el logo desde que enciende, "Conectando…" y la sala (casi instantánea si el servidor ya estaba encendido). Comprueba sobre todo el **audio por HDMI**:

```bash
systemctl status xaraoke-kiosk.service xaraoke-kiosk-prepare.service --no-pager | head -25
journalctl -u xaraoke-kiosk-prepare.service -b --no-pager
```

Si la red se corta durante la instalación (`curl: (56) Network is unreachable`), el script reintenta cada descarga hasta 5 veces. Si aun así falla, acerca la Zero al router o usa un adaptador USB-Ethernet, y repite el mismo comando: el script se puede correr de nuevo sin duplicar nada.

## Qué hace `setup-raspberry-display.sh`

Además de instalar el kiosko (con `install-kiosk.sh`):

* Actualiza el sistema, instala fuentes (Lite casi no trae; sin ellas los emojis y acentos raros salen como cuadritos) y activa el driver de video KMS.
* **Fuerza la salida HDMI** (1080p, o 720p en placas con menos de 1.5 GB de RAM). La "D" final del parámetro `video=` deja la salida encendida aunque el TV esté apagado al encender el Pi; sin eso, el kiosko no aparece hasta el siguiente reinicio.
* Desactiva el ahorro de energía del Wi-Fi, que duerme la antena y corta el WebSocket con el servidor.
* **Muestra el logo mientras arranca**, en lugar de los textos de Linux (la pantalla de colores del firmware, los mensajes del kernel y de systemd y el cursor). El logo sale con Plymouth desde el initramfs y se queda hasta que aparece la sala, en el mismo lugar que el de "Conectando…" del reproductor nativo. Los mensajes que quedan salen en `tty3`, y SSH sigue igual. El script comprueba que el tema esté dentro del initramfs de cada kernel y lo regenera si falta.

Si el servidor va a correr en el mismo Pi (`INSTALL_NODE_SERVICE=true`), la app tiene que estar instalada antes (pasos 2 a 4 del caso A): el script solo crea el servicio.

### Variables de entorno

Se pasan antes de `bash`, por ejemplo `sudo DISPLAY_MODE=auto bash -s -- <URL>`. Los detalles están al inicio del script.

| Variable | Qué hace |
|---|---|
| `DISPLAY_MODE` | Resolución forzada en HDMI, p. ej. `1280x720@60`. Por defecto 1920x1080@60, o 1280x720@60 con menos de 1.5 GB de RAM. `auto` deja que el TV decida (ojo: un TV 4K hace que Chromium dibuje en 4K, y el Pi no da para eso) |
| `KIOSK_PLAYER` | `chromium` o `mpv`. Por defecto `mpv` con menos de 1 GB de RAM y `chromium` en las demás |
| `KIOSK_HOSTNAME` | Nombre del equipo en la red. Sin cambios si no se da |
| `BOOT_SPLASH` | `false` para ver los mensajes de Linux al arrancar (útil para depurar) |
| `SKIP_UPGRADE` | `true` para no correr `apt full-upgrade` (más rápido, menos recomendable) |
| `READ_ONLY` | `true` para activar el sistema de archivos de solo lectura (overlayfs): protege la microSD si desconectan el Pi de golpe, pero cualquier cambio se pierde al reiniciar. Se desactiva con `sudo raspi-config nonint do_overlayfs 1` |
| `INSTALL_NODE_SERVICE` | `true` para que el servidor corra en este mismo Pi |
| `APP_DIR` | Carpeta de la app si `INSTALL_NODE_SERVICE=true` (`/opt/xaraoke`) |
| `REBOOT` | `true` para reiniciar solo al terminar |
| `XARAOKE_REF` | Rama o tag de GitHub de donde bajar `install-kiosk.sh` (`main`) |

Los respaldos de `config.txt` y `cmdline.txt` quedan junto a los originales, con la extensión `.xaraoke.bak`.

## Probar una rama antes de fusionarla

`raw.githubusercontent.com` guarda una caché de unos minutos. Para probar una rama, apunta a ella en la URL **y** en `XARAOKE_REF`, para que también `install-kiosk.sh` salga de esa rama:

```bash
curl -fsSL https://raw.githubusercontent.com/Xalcker/XaraokeURL/mi-rama/scripts/setup-raspberry-display.sh \
  | sudo XARAOKE_REF=mi-rama bash -s -- http://192.168.0.99:8081/
```

Con el servidor en el mismo Pi, clona también esa rama: `sudo git clone --branch mi-rama https://github.com/Xalcker/XaraokeURL.git /opt/xaraoke`. Después de fusionar y borrar la rama, vuelve a `main` con `cd /opt/xaraoke && sudo -u kiosk git fetch origin && sudo -u kiosk git checkout -B main origin/main`.
