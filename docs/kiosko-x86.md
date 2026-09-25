# 🖥️ Kiosko en un miniPC x86

> **Probada en un miniPC con Debian 13** (instalado desde un USB de 128 GB). Funciona de principio a fin (sala, QR con la IP correcta y audio por HDMI); el arranque tiene dos detalles menores (ver [Detalles del arranque](#detalles-del-arranque)). Con Ubuntu Server no funcionó como se esperaba, y no está probado a fondo. Si la pruebas, cualquier ajuste que necesites es bienvenido.

En un miniPC (Intel/AMD) se usa [`scripts/setup-x86-display.sh`](../scripts/setup-x86-display.sh), el equivalente de `setup-raspberry-display.sh`: deja el logo de arranque, el GRUB silencioso y el kiosko funcionando (`cage` + Chromium, `seatd`, audio HDMI, cursor transparente y, si quieres, el servidor). El kiosko en sí lo instala [`scripts/install-kiosk.sh`](../scripts/install-kiosk.sh), que el script llama por ti.

Contexto general del kiosko, variables y operación: [Modo Kiosko](kiosko.md).

## Antes de empezar

* **Distro recomendada: Debian 13 (Trixie) sin escritorio.** Trae Node 20.19 (el proyecto pide 20.17 o más) y un `chromium` normal, que es lo que `cage` necesita.
* **Ubuntu:** ojo con tres cosas. En Ubuntu 24.04 el `nodejs` de los repos es el 18, demasiado viejo; hay que instalar Node desde otra fuente (por ejemplo NodeSource). `chromium` en Ubuntu es un paquete **snap**, que con `cage` suele dar problemas de permisos. Y en Ubuntu Server 26.04 el paquete `plymouth` no trae el comando `plymouth-set-default-theme`; el script lo tiene en cuenta, pero si sigues la guía a mano, el tema se fija en `/etc/plymouth/plymouthd.conf` (`[Daemon]` y `Theme=xaraoke`).
* **Firmware de la GPU:** en equipos AMD (y algunos Intel recientes) instala el firmware de video, o el driver no arranca: `firmware-amd-graphics` o `firmware-misc-nonfree` (requiere habilitar `non-free-firmware` en los repos de Debian).
* **Un teclado y un monitor a mano** para la primera instalación y para poder entrar a GRUB si algo sale mal.

## 1. Instalar el sistema

1. Descarga el ISO *netinst* de Debian 13 y grábalo en un USB.
2. En el instalador, cuando pida la **contraseña de root, déjala vacía**. Así el instalador agrega tu usuario al grupo `sudo`; si pones contraseña de root, tu usuario **no** podrá usar `sudo`.
3. En *"Software selection"* deja marcados solo **SSH server** y **standard system utilities**. **Sin entorno de escritorio.**
4. Crea tu usuario (por ejemplo `xalcker`). El usuario `kiosk` lo crea el instalador del kiosko.
5. Al terminar, entra por SSH: `ssh tu_usuario@<ip-del-miniPC>`. Reserva su IP en el router.

**Si tu usuario quedó sin `sudo`** (pusiste contraseña de root), arréglalo una vez y vuelve a iniciar sesión:

```bash
su -
apt-get install -y sudo
usermod -aG sudo tu_usuario
exit
```

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

## 5. Instalar el kiosko, el logo de arranque y el servidor

Un solo comando. La URL es `localhost` porque el servidor está en este equipo, e `INSTALL_NODE_SERVICE=true` crea el servicio que lo arranca:

```bash
curl -fsSL https://raw.githubusercontent.com/Xalcker/XaraokeURL/main/scripts/setup-x86-display.sh \
  | sudo INSTALL_NODE_SERVICE=true bash -s -- http://localhost:8081/
```

Tarda varios minutos: actualiza el sistema, instala Chromium, `cage` y el resto, y regenera el initramfs. Al final puede avisar que el servidor "no responde ahora": es normal, acaba de arrancar. El script se puede repetir sin duplicar nada.

Qué hace, además de llamar a `install-kiosk.sh`:

* Actualiza el sistema e instala fuentes (sin ellas los emojis salen como cuadritos).
* Instala el logo de arranque (Plymouth, tema `xaraoke`) y lo mete en el initramfs de **todos** los kernels instalados; si alguno queda sin el tema, el arranque mostraría uno de emergencia (gris con puntos) y el script avisa.
* Oculta el menú de GRUB y los mensajes de Linux con un archivo aparte, `/etc/default/grub.d/99-xaraoke.cfg`, sin tocar `/etc/default/grub`. Con el menú oculto no verás GRUB al encender: para entrar, mantén pulsado `Shift` (BIOS) o `Esc` (UEFI) al arrancar.

Variables opcionales: `KIOSK_HOSTNAME` (nombre del equipo), `BOOT_SPLASH=false` (ver GRUB y los textos de arranque, y deshacer lo anterior), `SKIP_UPGRADE=true`, `REBOOT=true`. Están descritas al inicio del script.

Si en cambio el servidor corre en otra máquina de la red, quita `INSTALL_NODE_SERVICE=true` y pon su URL (por ejemplo `http://192.168.1.50:8081/`); entonces tampoco hacen falta los pasos 3 y 4.

## 6. Reiniciar

```bash
sudo reboot
```

## 7. Qué comprobar

* **En el TV:** el logo, un negro corto, un blanco y la sala. La dirección bajo el QR debe ser la de tu red y no `localhost`. Sin puntero.
* **Audio por HDMI:** agrega una canción a la lista y confirma que suena por el TV. Es lo más específico de cada equipo: si no suena, mira [Problemas conocidos](kiosko-problemas.md#no-suena-por-hdmi).
  * El sonido del kiosko lo maneja el PipeWire del usuario `kiosk`, aparte del de tu usuario: un `wpctl set-default` como tú no cambia lo que suena en el TV. Para ver o cambiar la salida, hazlo como `kiosk`: `sudo -u kiosk XDG_RUNTIME_DIR=/run/user/$(id -u kiosk) wpctl status`.
  * No hace falta escribir reglas de WirePlumber a mano. El instalador fija la salida HDMI en cada arranque (reintenta hasta 20 s) y lo deja en el log: `sudo journalctl -u xaraoke-kiosk-prepare.service -b`, línea `salida HDMI ... fijada como predeterminada`. En el equipo de prueba (Ryzen), sin esto el sonido salía por la salida analógica, que tiene prioridad.
* **Servicios:**

```bash
systemctl status xaraoke-server.service xaraoke-kiosk.service xaraoke-kiosk-prepare.service --no-pager | head -30
sudo journalctl -u xaraoke-kiosk.service -u xaraoke-kiosk-prepare.service -b --no-pager | tail -40
```

* Escanea el QR con el teléfono, abre el control remoto y busca una canción en YouTube.

## Detalles del arranque

Al probar en un miniPC con Debian 13 (kernel 6.12) el arranque tuvo dos detalles:

* **Una pantalla azul con un menú de texto** en el primer arranque, antes de GRUB. Es el gestor de claves de Secure Boot: en ese equipo `mokutil --sb-state` decía `SecureBoot enabled`. Elegir **Always continue boot** en ese menú la hizo desaparecer y no volvió. No se sabe por qué pidió confirmación. Si prefieres no depender de esa opción, desactiva Secure Boot en la BIOS.
* **Dos líneas de texto** ("Loading Linux…" y "Loading initial ramdisk…") que alcanzan a verse un instante antes del logo. **No tienen arreglo sencillo y son solo cosméticas.** Las imprime GRUB, no el kernel: en Debian van sueltas en `grub.cfg`, sin condición, así que ni `quiet` ni `GRUB_TIMEOUT_STYLE=hidden` las ocultan (Ubuntu sí trae un interruptor, Debian no). Se probó redefinir `echo` con una función en `/etc/grub.d/`: GRUB la aceptó, pero las líneas siguieron saliendo.

**Ya resuelto y comprobado en ese equipo:**

* **El QR salía con `localhost`** al arrancar: el kiosko se abría antes de que el Wi-Fi conectara y el servidor no encontraba ninguna IP. `install-kiosk.sh` ahora espera hasta 30 s a que exista una ruta de red antes de abrir la pantalla (solo cuando el servidor es `localhost`); ahí la espera fue de unos 14 s y el QR salió con la IP correcta. Si tu equipo ya estaba instalado, vuelve a correr el comando del paso 5. Si aun así sale `localhost`, la red tarda más de 30 s en subir: por cable arranca antes.
* **El audio salía por la salida analógica** en lugar de HDMI. Ver la nota de audio en [Qué comprobar](#7-qué-comprobar).

**Al volver a correr el comando del paso 5** justo después de que se fusionó un cambio, `raw.githubusercontent.com` puede servirte la versión anterior: guarda copias unos 5 minutos. Para pedir una versión exacta, cambia `main` por el identificador completo del commit, en la URL y en `XARAOKE_REF` (`sudo XARAOKE_REF=<commit> ... bash -s -- ...`).

## Diferencias con el Raspberry Pi

| | Raspberry Pi | miniPC x86 |
|---|---|---|
| Script de preparación | `setup-raspberry-display.sh` | `setup-x86-display.sh` (los pasos 2 a 4 son a mano en ambos) |
| Resolución HDMI | Se fuerza (`video=HDMI-A-1:...D`) | El driver (`i915`/`amdgpu`) suele elegir bien; solo fuérzala si el TV no da imagen |
| Arranque | `cmdline.txt` / `config.txt` | `/etc/default/grub.d/99-xaraoke.cfg` |
| Wi-Fi sin ahorro de energía | Lo ajusta el script | No aplica por cable; si usas Wi-Fi, revísalo tú |
| Cursor, `seatd`, servicio de preparación | Igual | Igual |

Si algo no arranca, mira [Problemas conocidos](kiosko-problemas.md), sobre todo la sección de `cage`.
