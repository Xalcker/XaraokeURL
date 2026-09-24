# 🖥️ Modo Kiosko

Para dejar la pantalla principal montada de forma permanente en un Raspberry Pi o un miniPC conectado a un TV por HDMI (video y audio), sin teclado ni mouse: el equipo enciende, hace login solo y abre la sala a pantalla completa, sin que nadie tenga que tocar nada.

## Elige tu caso

| Tienes | Guía |
|---|---|
| Un **Raspberry Pi 4 o 5** (2 GB o más), servidor y pantalla en el mismo equipo | [Raspberry Pi: servidor y pantalla](kiosko-raspberry-pi.md#a-pi-4-o-5-servidor-y-pantalla-en-el-mismo-equipo) |
| Un **Raspberry Pi 4 o 5** que solo muestra la pantalla de un servidor en otra máquina | [Raspberry Pi: solo pantalla](kiosko-raspberry-pi.md#b-pi-4-o-5-solo-pantalla) |
| Una **Pi Zero 2 W** u otra placa de menos de 1 GB de RAM | [Raspberry Pi: Zero 2 W](kiosko-raspberry-pi.md#c-pi-zero-2-w-y-placas-chicas-solo-pantalla) y [reproductor nativo](reproductor-nativo.md) |
| Un **miniPC x86** (Debian/Ubuntu) | [miniPC x86](kiosko-x86.md) |
| Algo no funciona | [Problemas conocidos](kiosko-problemas.md) |

## Estado de las pruebas

| Equipo | Estado |
|---|---|
| Raspberry Pi 4 (2 GB), servidor y pantalla en el mismo Pi, Raspberry Pi OS Lite 64 bits (Debian 13) | Probado: logo de arranque, sala, QR, búsqueda y descarga de YouTube, audio y video por HDMI |
| Raspberry Pi Zero 2 W, solo pantalla con el reproductor nativo | Probado: logo, sala, audio por HDMI, cola de canciones y QR |
| miniPC x86 | **Sin probar** |

Antes de confiar en él para un evento, pruébalo una vez en el equipo de destino, sobre todo el audio por HDMI (depende de cómo ese equipo nombre su salida) y el arranque de `cage` con el driver de GPU de esa placa.

## Cómo funciona

El script [`scripts/install-kiosk.sh`](../scripts/install-kiosk.sh) instala el kiosko en Raspberry Pi OS (arm64) y en Debian/Ubuntu x86; son la misma familia, así que usan los mismos paquetes y la misma unidad de `systemd`. Hay dos formas de mostrar la pantalla (`KIOSK_PLAYER`):

* **`chromium`:** la pantalla web completa. Usa Wayland (`cage`, un compositor mínimo hecho para mostrar una sola app a pantalla completa) + Chromium en modo `--kiosk`. Para Raspberry Pi 4/5 y miniPC.
* **`mpv`:** el [reproductor nativo](reproductor-nativo.md), sin navegador. Para placas donde Chromium no alcanza (Pi Zero 2 W).

**Requisitos:** una distro basada en Debian con `systemd` y PipeWire o PulseAudio (Raspberry Pi OS Bookworm o más nuevo, Debian 12+, Ubuntu 22.04+).

En un Raspberry Pi hay además [`scripts/setup-raspberry-display.sh`](../scripts/setup-raspberry-display.sh), que prepara el Pi desde cero (sistema al día, driver de video, HDMI forzado, logo de arranque) y luego llama a `install-kiosk.sh`. En un miniPC se usa `install-kiosk.sh` directamente.

## Uso de `install-kiosk.sh`

Si el equipo va a correr también el servidor Node (la app tiene que estar ya instalada en `APP_DIR`: Node, `npm ci` y el `.env`; el script no la instala):

```bash
sudo INSTALL_NODE_SERVICE=true APP_DIR=/opt/xaraoke ./scripts/install-kiosk.sh
```

Si el servidor corre en otra máquina de la red y este equipo solo muestra la pantalla:

```bash
sudo KIOSK_URL="http://192.168.1.50:8081/" ./scripts/install-kiosk.sh
```

Luego `sudo reboot`. Chromium espera hasta 60 segundos a que el servidor responda antes de abrir, para no ganarle la carrera al arranque. El reproductor nativo no espera: arranca de inmediato con "Conectando…" y reintenta solo.

### Variables de entorno (todas opcionales)

| Variable | Qué hace | Por defecto |
|---|---|---|
| `KIOSK_URL` | URL del servidor | `http://localhost:8081/` |
| `KIOSK_PLAYER` | `chromium` o `mpv` | `chromium` |
| `KIOSK_USER` | Usuario del sistema que corre la sesión del kiosko | `kiosk` |
| `KIOSK_LANG` | Idioma de la interfaz en pantalla (Chromium en Raspberry Pi OS sale en inglés si no se fija) | `es` |
| `MPV_ARGS` | Solo con `mpv`: opciones de video | decodificador por hardware del Pi, o el que detecte `mpv` |
| `PLAYER_SRC_DIR` | Solo con `mpv`: carpeta del repo de donde copiar el reproductor | se descarga de GitHub |
| `XARAOKE_REF` | Rama o tag de GitHub para esa descarga | `main` |
| `INSTALL_NODE_SERVICE` | `true` para instalar también `xaraoke-server.service` (`node server.js`) | `false` |
| `APP_DIR` | Carpeta de la app si `INSTALL_NODE_SERVICE=true` | `/opt/xaraoke` |
| `APP_USER` | Usuario que corre el servidor Node | el de `KIOSK_USER` |

## Qué configura

* Un usuario del sistema sin privilegios (`kiosk` por defecto) para la sesión gráfica.
* `xaraoke-kiosk.service`: arranca `cage` + Chromium (o el reproductor nativo) en `tty1` al encender, sin login manual, y lo reinicia solo si se cae (`Restart=always`).
* `xaraoke-kiosk-prepare.service`: espera al servidor (solo con Chromium) y ajusta el audio HDMI. Va aparte del servicio principal a propósito: si esos pasos corrieran como `ExecStartPre` del kiosko, cada uno abriría su propia sesión de login sobre `tty1` y le cortaría la terminal al logo de arranque.
* Con Chromium: `seatd`, para que `cage` obtenga acceso a la pantalla (en Debian 13, `logind` no le asigna seat a esta sesión) y un cursor transparente, para que no quede un puntero fijo en el centro.
* A la URL se le agrega `?autostart=1`: sin teclado ni mouse nadie puede pulsar "Comenzar", así que la pantalla principal recupera sola la sala anterior (si el servidor la sigue guardando) o crea una nueva. En ese modo los errores no abren diálogos, que nadie podría cerrar: quedan en la consola y se reintenta cada 5 segundos. Sirve igual en cualquier navegador: abre `http://<servidor>:8081/?autostart=1`.
* Chromium arranca en español (`KIOSK_LANG=es`; la interfaz toma el idioma del navegador).
* El audio del sistema (PipeWire/PulseAudio) se fuerza a la salida **HDMI** al 100 % y sin silencio, para que el sonido salga por el mismo cable que el video y el volumen se maneje desde el TV.
* Audio HDMI estable: se instala `rtkit` (prioridad de tiempo real para PipeWire) y WirePlumber usa un búfer más grande para el HDMI y no lo suspende entre canciones. Sin esto, en una Pi Zero 2 W el sonido llegó a quedarse mudo a media sesión (`snd_pcm_mmap_commit error: Broken pipe` en el log).
* Con `INSTALL_NODE_SERVICE=true`, `xaraoke-server.service` corriendo `node server.js` en el mismo equipo.

## Vista minimalista (`?ui=minimal`)

Sin barras laterales, con el video a pantalla completa y "ahora suena" / "a continuación" / logo / QR flotando como overlays translúcidos en cada esquina, la misma estética del [reproductor nativo](reproductor-nativo.md), pero en el navegador. No muestra la lista de próximas 5 canciones.

Se activa sola en un navegador de TV (Fire TV/Silk, Samsung Tizen, LG webOS, Android TV/Google TV, detectados por el user agent en `public/js/uiMode.js`). En cualquier otro navegador, incluido el Chromium de un Raspberry Pi o un miniPC, se agrega a la URL: `http://<servidor>:8081/?autostart=1&ui=minimal`. En una TV se puede volver a la clásica con `?ui=classic`.

**Para activarla en un kiosko ya instalado** (sin reinstalar):

```bash
sudo sed -i '/^ExecStart=\/usr\/bin\/cage/ s#autostart=1#autostart=1\&ui=minimal#' /etc/systemd/system/xaraoke-kiosk.service
sudo systemctl daemon-reload
sudo systemctl restart xaraoke-kiosk.service
```

Para volver a la clásica: `sudo sed -i '/^ExecStart=\/usr\/bin\/cage/ s#&ui=minimal##' /etc/systemd/system/xaraoke-kiosk.service`, y lo mismo con `daemon-reload` y `restart`.

**Para instalarlo así desde el principio**, pasa la URL con el parámetro: `KIOSK_URL="http://localhost:8081/?ui=minimal"`. El instalador detecta el `?` y añade `&autostart=1` por su cuenta.

## Operación

| Qué | Cómo |
|---|---|
| Ver el estado | `systemctl status xaraoke-kiosk.service xaraoke-kiosk-prepare.service xaraoke-server.service --no-pager` |
| Logs del kiosko | `journalctl -u xaraoke-kiosk.service -u xaraoke-kiosk-prepare.service -b --no-pager` |
| Logs del servidor | `journalctl -u xaraoke-server.service -b --no-pager` |
| Reiniciar la pantalla | `sudo systemctl restart xaraoke-kiosk.service` |
| Actualizar la app (si el servidor corre en el equipo) | `cd /opt/xaraoke && sudo -u kiosk git pull && sudo -u kiosk npm ci --omit=dev && sudo systemctl restart xaraoke-server.service` |
| Desinstalar el kiosko | `sudo ./scripts/install-kiosk.sh --uninstall` (en un Raspberry Pi instalado con `setup-raspberry-display.sh`: `sudo /usr/local/sbin/xaraoke-install-kiosk.sh --uninstall`). No borra el usuario `kiosk`, por si guardó algo |
