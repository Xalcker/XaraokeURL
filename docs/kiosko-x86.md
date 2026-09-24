# 🖥️ Kiosko en un miniPC x86

> **Sin probar todavía en hardware real.** Esta guía se armó a partir de lo que sí funciona en un Raspberry Pi. Los pasos de GRUB y del logo de arranque son a mano porque ningún script del repo los hace en x86. Si la pruebas, cualquier ajuste que necesites es bienvenido.

En un miniPC (Intel/AMD) se usa [`scripts/install-kiosk.sh`](../scripts/install-kiosk.sh) directamente: `setup-raspberry-display.sh` se niega a correr fuera de un Raspberry Pi. Ese instalador deja el kiosko funcionando (`cage` + Chromium, `seatd`, audio HDMI, cursor transparente y, si quieres, el servidor). Lo que **no** hace es tocar el arranque: el menú de GRUB, los mensajes de Linux y el logo hay que dejarlos a mano (paso 5).

Contexto general del kiosko, variables y operación: [Modo Kiosko](kiosko.md).

## Antes de empezar

* **Distro recomendada: Debian 13 (Trixie) sin escritorio.** Trae Node 20.19 (el proyecto pide 20.17 o más) y un `chromium` normal, que es lo que `cage` necesita.
* **Ubuntu:** ojo con dos cosas. En Ubuntu 24.04 el `nodejs` de los repos es el 18, demasiado viejo; hay que instalar Node desde otra fuente (por ejemplo NodeSource). Y `chromium` en Ubuntu es un paquete **snap**, que con `cage` suele dar problemas de permisos. No lo he probado ahí; si vas con Ubuntu, espera tener que resolver esos dos puntos.
* **Firmware de la GPU:** en equipos AMD (y algunos Intel recientes) instala el firmware de video, o el driver no arranca: `firmware-amd-graphics` o `firmware-misc-nonfree` (requiere habilitar `non-free-firmware` en los repos de Debian).
* **Un teclado y un monitor a mano** para la primera instalación y para poder entrar a GRUB si algo sale mal.

## 1. Instalar el sistema

1. Descarga el ISO *netinst* de Debian 13 y grábalo en un USB.
2. En el instalador, en *"Software selection"* deja marcados solo **SSH server** y **standard system utilities**. **Sin entorno de escritorio.**
3. Crea tu usuario (por ejemplo `xalcker`). El usuario `kiosk` lo crea el instalador del kiosko.
4. Al terminar, entra por SSH: `ssh tu_usuario@<ip-del-miniPC>`. Reserva su IP en el router.

## 2. Instalar Node, git, ffmpeg y yt-dlp

`ffmpeg` y `yt-dlp` solo hacen falta para YouTube ([detalles](youtube.md)):

```bash
sudo apt-get update
sudo apt-get install -y nodejs npm git ffmpeg python3-pip curl
sudo pip install --break-system-packages yt-dlp
node --version                       # 20.17 o más
```

## 3. Bajar la app

```bash
sudo useradd -m -s /bin/bash kiosk
sudo git clone https://github.com/Xalcker/XaraokeURL.git /opt/xaraoke
sudo chown -R kiosk:kiosk /opt/xaraoke
cd /opt/xaraoke && sudo -u kiosk npm ci --omit=dev
```

## 4. Crear el `.env`

Para una prueba rápida, sin Google OAuth ([más detalles](instalacion.md)). No hace falta fijar la IP para el QR: el servidor la detecta solo (la del adaptador que da salida a la red):

```bash
sudo -u kiosk tee /opt/xaraoke/.env >/dev/null <<EOF
PORT=8081
NODE_ENV=development
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
DISABLE_GOOGLE_AUTH=true
EOF
```

## 5. Arranque limpio: logo, sin textos y sin menú de GRUB

Este paso es opcional: sin él, el kiosko funciona igual, pero durante el arranque se ven los mensajes de Linux y el menú de GRUB. **Hazlo antes de instalar el kiosko (paso 6)**, porque el instalador solo enlaza el logo con la sala si encuentra Plymouth ya instalado.

**5.1. Instala Plymouth y crea el tema `xaraoke`.** El logo sale de la app que acabas de clonar:

```bash
sudo apt-get install -y --no-install-recommends plymouth
sudo mkdir -p /usr/share/plymouth/themes/xaraoke
sudo cp /opt/xaraoke/public/img/icon-512.png /usr/share/plymouth/themes/xaraoke/logo.png

sudo tee /usr/share/plymouth/themes/xaraoke/xaraoke.plymouth >/dev/null <<'EOF'
[Plymouth Theme]
Name=XaraokeURL
Description=El logo de XaraokeURL mientras arranca la pantalla
ModuleName=script

[script]
ImageDir=/usr/share/plymouth/themes/xaraoke
ScriptFile=/usr/share/plymouth/themes/xaraoke/xaraoke.script
EOF

sudo tee /usr/share/plymouth/themes/xaraoke/xaraoke.script >/dev/null <<'EOF'
Window.SetBackgroundTopColor(0.0902, 0.0667, 0.1412);
Window.SetBackgroundBottomColor(0.0902, 0.0667, 0.1412);

scale = Window.GetHeight() * 150 / (720 * 270);
logo.image = Image("logo.png");
logo.image = logo.image.Scale(Math.Int(512 * scale), Math.Int(512 * scale));
logo.sprite = Sprite(logo.image);
logo.sprite.SetX(Window.GetX() + Window.GetWidth() / 2 - 271 * scale);
logo.sprite.SetY(Window.GetY() + Window.GetHeight() * 170 / 720 - 113 * scale);
EOF

sudo plymouth-set-default-theme xaraoke
```

**5.2. Ajusta GRUB.** Edita `/etc/default/grub` (`sudo nano /etc/default/grub`) y deja estas líneas:

```
GRUB_TIMEOUT=0
GRUB_TIMEOUT_STYLE=hidden
GRUB_RECORDFAIL_TIMEOUT=0
GRUB_GFXPAYLOAD_LINUX=keep
GRUB_CMDLINE_LINUX_DEFAULT="quiet splash plymouth.ignore-serial-consoles loglevel=3 logo.nologo vt.global_cursor_default=0 systemd.show_status=false rd.udev.log_level=3 console=tty3"
```

Los parámetros son los mismos que usa el script de Raspberry Pi. Con el menú oculto no verás GRUB al encender: si algún día necesitas entrar (para arrancar un kernel anterior, por ejemplo), mantén pulsado `Shift` (BIOS) o `Esc` (UEFI) al arrancar.

**5.3. Aplica y comprueba.** El tema tiene que quedar **dentro del initramfs** de cada kernel, o el arranque mostrará un tema de emergencia (gris con puntos):

```bash
sudo update-initramfs -u -k all
sudo update-grub
for f in /boot/initrd.img-*; do echo "$f:"; lsinitramfs "$f" | grep -E "xaraoke.script|script.so"; done
```

Cada `initrd.img-*` debe listar `script.so` y `themes/xaraoke/xaraoke.script`. Si alguno sale vacío, repite `sudo update-initramfs -u -k all`.

## 6. Instalar el kiosko y el servidor

Desde la carpeta de la app. La URL es `localhost` porque el servidor está en este equipo:

```bash
cd /opt/xaraoke
sudo KIOSK_URL="http://localhost:8081/" INSTALL_NODE_SERVICE=true APP_DIR=/opt/xaraoke ./scripts/install-kiosk.sh
sudo reboot
```

Si en cambio el servidor corre en otra máquina de la red, quita `INSTALL_NODE_SERVICE` y `APP_DIR`, y pon su URL en `KIOSK_URL`; entonces tampoco hacen falta los pasos 3 y 4.

## 7. Qué comprobar

* **En el TV:** el logo (si hiciste el paso 5), un negro corto, un blanco y la sala. La dirección bajo el QR debe ser la de tu red y no `localhost`. Sin puntero.
* **Audio por HDMI:** agrega una canción a la lista y confirma que suena por el TV. Es lo más específico de cada equipo: si no suena, mira [Problemas conocidos](kiosko-problemas.md#no-suena-por-hdmi).
* **Servicios:**

```bash
systemctl status xaraoke-server.service xaraoke-kiosk.service xaraoke-kiosk-prepare.service --no-pager | head -30
journalctl -u xaraoke-kiosk.service -u xaraoke-kiosk-prepare.service -b --no-pager | tail -40
```

* Escanea el QR con el teléfono, abre el control remoto y busca una canción en YouTube.

## Diferencias con el Raspberry Pi

| | Raspberry Pi | miniPC x86 |
|---|---|---|
| Script de preparación | `setup-raspberry-display.sh` | No hay; los pasos 2 a 5 son a mano |
| Resolución HDMI | Se fuerza (`video=HDMI-A-1:...D`) | El driver (`i915`/`amdgpu`) suele elegir bien; solo fuérzala si el TV no da imagen |
| Arranque | `cmdline.txt` / `config.txt` | `/etc/default/grub` |
| Wi-Fi sin ahorro de energía | Lo ajusta el script | No aplica por cable; si usas Wi-Fi, revísalo tú |
| Cursor, `seatd`, servicio de preparación | Igual | Igual |

Si algo no arranca, mira [Problemas conocidos](kiosko-problemas.md), sobre todo la sección de `cage`.
