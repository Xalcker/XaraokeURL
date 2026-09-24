# 🩺 Problemas conocidos del kiosko

Cada apartado sale de un problema real encontrado al probar el kiosko en un Raspberry Pi 4 y una Pi Zero 2 W. Antes de nada, los dos comandos que casi siempre dicen qué pasa:

```bash
journalctl -u xaraoke-kiosk.service -u xaraoke-kiosk-prepare.service -u xaraoke-server.service -b --no-pager | tail -50
cat /boot/firmware/cmdline.txt        # en Raspberry Pi; en x86: cat /proc/cmdline
```

Guías: [Modo Kiosko](kiosko.md) · [Raspberry Pi](kiosko-raspberry-pi.md) · [miniPC x86](kiosko-x86.md).

## Pantalla gris con tres puntos al encender (no sale el logo)

**Causa:** el tema del logo (`xaraoke`) no está dentro del initramfs que carga el equipo, así que Plymouth usa un tema de emergencia. Suele verse el logo bien al hacer `sudo reboot` (ahí Plymouth corre desde el sistema ya arrancado) y mal al encender.

**Comprobar:**

```bash
ls -l /boot/firmware/initramfs*      # en x86: ls -l /boot/initrd.img-*
lsinitramfs /boot/firmware/initramfs8 | grep -iE "xaraoke|script.so"
sudo plymouth-set-default-theme
```

Si el `grep` sale vacío, el tema no está dentro. `plymouth-set-default-theme` puede responder `xaraoke` igualmente: el tema puede estar bien configurado y aun así el initramfs se generó antes.

**Arreglo:**

```bash
sudo update-initramfs -u -k all
lsinitramfs /boot/firmware/initramfs8 | grep -iE "xaraoke|script.so"     # ahora sí debe listarlos
sudo reboot
```

Es `-k all`, no `-k "$(uname -r)"`: tras un `full-upgrade` el kernel que arrancará es el nuevo y `uname -r` todavía apunta al viejo. El aviso `label-pango.so is missing` no afecta: nuestro tema solo dibuja una imagen.

Para ver por qué Plymouth cierra o falla, agrega `plymouth.debug` al `cmdline.txt` (o a `GRUB_CMDLINE_LINUX_DEFAULT` en x86), reinicia y lee `/var/log/plymouth-debug.log`. Quítalo después.

## Entre el logo y la sala aparece texto, o el logo se corta antes de tiempo

**Causa:** si la espera al servidor y el ajuste de audio corren como `ExecStartPre` del servicio del kiosko, cada uno abre su propia sesión de login sobre `tty1` y le corta la terminal a Plymouth (en el log de depuración: `tty disconnected` repetido). Ya está resuelto: esos pasos van en `xaraoke-kiosk-prepare.service`, sin `PAMName` ni `TTYPath`.

**Comprobar** que la instalación lo tenga:

```bash
ls /etc/systemd/system/xaraoke-kiosk-prepare.service
systemctl cat xaraoke-kiosk.service | grep -E "^(After|Wants|ExecStartPre)="
```

Debe existir el servicio de preparación, y el kiosko debe tener un único `ExecStartPre` (el `plymouth quit --retain-splash`). Si no, reinstala con el `install-kiosk.sh` actual.

## Un negro corto entre el logo y la sala

Es normal. Cuando `cage` toma la pantalla hace su propio cambio de modo y la imagen del logo se pierde hasta que Chromium pinta su primer cuadro (unos segundos en un Pi 4 de 2 GB), y después se ve un blanco mientras carga la página. `plymouth quit --retain-splash` no lo evita. No hay solución simple; el reproductor nativo de la Pi Zero muestra la sala casi al instante.

## `cage` o Chromium se reinician en bucle

Síntoma: `journalctl -u xaraoke-kiosk.service` muestra `Main process exited, code=exited, status=134` o `133`, y `Scheduled restart job, restart counter is at 84`. Hay dos causas conocidas.

**a) `Timeout waiting session to become active` / `Failed to start a DRM session`.** En Debian 13, `logind` no le asigna seat a la sesión y `cage` espera 10 s antes de rendirse. Se resuelve con `seatd`: el instalador lo instala y el servicio usa `LIBSEAT_BACKEND=seatd`. Si instalaste con una versión anterior:

```bash
sudo apt-get install -y seatd
sudo systemctl enable --now seatd
sudo mkdir -p /etc/systemd/system/xaraoke-kiosk.service.d
printf '[Service]\nEnvironment=LIBSEAT_BACKEND=seatd\n' | sudo tee /etc/systemd/system/xaraoke-kiosk.service.d/override.conf
sudo systemctl daemon-reload && sudo systemctl restart xaraoke-kiosk.service
```

Con `sudo systemctl edit`, escribe el contenido en líneas reales: pegar `\n` como texto deja un archivo inválido (`Invalid section header`).

**b) `chrome_crashpad_handler: --database is required`, `mkdir: No such file or directory` y `Zygote process exited prematurely`.** Chromium no puede crear su perfil porque `~kiosk/.config` es de root (el instalador creaba `~/.config/wireplumber` con `install -d -o`, que solo da dueño al último directorio). Se distingue porque con tu usuario `chromium --headless=new --dump-dom about:blank` funciona y con `kiosk` no. Arreglo:

```bash
sudo chown -R kiosk:kiosk /home/kiosk
sudo systemctl restart xaraoke-kiosk.service
```

Para ver la causa exacta, detén el servicio y corre `cage` a mano con la salida visible:

```bash
sudo systemctl stop xaraoke-kiosk.service
sudo systemctl mask --runtime xaraoke-kiosk.service          # evita que reinicie
sudo systemd-run --pty --wait -p User=kiosk -p PAMName=login -p TTYPath=/dev/tty1 \
  -p StandardInput=tty -p StandardOutput=tty -p StandardError=tty \
  -E XDG_RUNTIME_DIR=/run/user/$(id -u kiosk) -E LIBSEAT_BACKEND=seatd -E HOME=/home/kiosk \
  /usr/bin/cage -d -- /usr/bin/chromium --kiosk --ozone-platform=wayland --enable-logging=stderr http://localhost:8081/ 2>&1 | tail -40
sudo systemctl unmask --runtime xaraoke-kiosk.service
```

## Se ve un puntero fijo en el centro de la pantalla

Es una flecha negra con borde blanco (el cursor de Adwaita), sin que haya ratón conectado. `cage` dibuja su cursor por defecto, y la página no puede ocultarlo: Chromium fija el cursor cuando el puntero entra a la ventana, antes de que la página pueda aplicar `cursor: none`, y sin movimiento del ratón esa regla nunca se ejecuta.

El instalador lo resuelve con un cursor transparente de 24×24 como tema `default` en `~kiosk/.icons/default`, más la configuración de GTK en `~kiosk/.config/gtk-3.0` y `gtk-4.0`, más, si el equipo trae los esquemas de GNOME, un override de `org.gnome.desktop.interface`. Este último es el que a veces falta: paquetes como `ffmpeg` arrastran `gsettings-desktop-schemas`, y GTK toma el tema de ahí (Adwaita) antes que de `settings.ini`. Comprueba y arregla:

```bash
ls -l /home/kiosk/.icons/default/cursors/left_ptr            # 2368 bytes
cat /home/kiosk/.config/gtk-3.0/settings.ini
ls /usr/share/glib-2.0/schemas/ | grep -i "desktop.interface"    # ¿hay esquemas de GNOME?

sudo apt-get install -y --no-install-recommends libglib2.0-bin
sudo tee /usr/share/glib-2.0/schemas/90_xaraoke.gschema.override >/dev/null <<'EOF'
[org.gnome.desktop.interface]
cursor-theme='default'
cursor-size=24
EOF
sudo glib-compile-schemas /usr/share/glib-2.0/schemas/
gsettings get org.gnome.desktop.interface cursor-theme       # debe decir 'default'
sudo systemctl restart xaraoke-kiosk.service
```

`XCURSOR_THEME` y `XCURSOR_PATH` no sirven: ni `cage` ni Chromium los respetan en esta combinación.

## El QR lleva la IP equivocada, o `localhost`

* Si la pantalla se abre como `localhost`, el servidor arma el QR con la primera IP de la red local, y esa es la que ves escrita bajo el código. Es la configuración recomendada para la pantalla principal.
* El servidor pone primero la IP del adaptador que da salida a la red (la ruta por defecto en Linux). Si el equipo tiene varias redes (VPN, contenedores, o Wi-Fi y cable) y aun así elige mal, fija la correcta en `/opt/xaraoke/.env` con `LAN_IP=192.168.0.72` y reinicia el servidor: `sudo systemctl restart xaraoke-server.service`.
* Con el servidor en otra máquina y la pantalla apuntando a su IP, el QR lleva esa IP tal cual.
* Al pasar de Wi-Fi a cable cambia la IP, y el QR la sigue solo, sin reiniciar el servidor (la pantalla lo actualiza al recargarse o al crear otra sala). Lo que hay que actualizar a mano es cualquier pantalla que apunte al equipo por su IP vieja, o un `LAN_IP` que hayas fijado.

## No suena por HDMI

El instalador fuerza el sink por defecto a la primera salida cuyo nombre contenga `hdmi`, al 100 % y sin silencio. Comprueba qué ve el sistema:

```bash
sudo -u kiosk XDG_RUNTIME_DIR=/run/user/$(id -u kiosk) wpctl status | sed -n '/Sinks:/,/Sources:/p'
journalctl -u xaraoke-kiosk-prepare.service -b --no-pager
```

* Si no aparece ninguna salida con `hdmi` (algunos miniPC llaman `DisplayPort` o solo `HDA Intel`), fija la que corresponda a mano con `wpctl set-default <id>` como el usuario `kiosk`; el ajuste automático solo reconoce `hdmi` en el nombre.
* En equipos con varias salidas HDMI puede elegir la primera, no la del TV: `wpctl set-default <id>` con la buena.
* Si el sonido se queda mudo a media sesión y en el log hay `snd_pcm_mmap_commit error: Broken pipe`, falta `rtkit` (lo instala el script).

## El servidor no responde, o arranca "sin biblioteca"

* `No se encontró la base de datos (./karaoke.db)` es normal en una instalación nueva: la biblioteca local queda vacía y solo se pueden agregar canciones desde YouTube. Con un `songs.csv`, `cd /opt/xaraoke && sudo -u kiosk npm run import` y reinicia el servidor.
* El servicio del servidor se reinicia solo, pero conviene que `StartLimitIntervalSec=0` esté en `[Unit]`. Si tu `xaraoke-server.service` lo tiene en `[Service]`, systemd avisa `Unknown key` en cada arranque y usa el límite por defecto; muévelo con `sudo nano /etc/systemd/system/xaraoke-server.service` y `sudo systemctl daemon-reload`.
* Descargas de YouTube lentas en una Pi: son las microSD, no la app.

## Se cortó la red durante la instalación

Síntoma: `curl: (56) Recv failure: Network is unreachable`, y el script se detiene a medias. Las descargas del script reintentan hasta 5 veces cada una; si aun así falla, mejora la red (acerca el equipo al router o usa cable) y **repite el mismo comando**: el script se puede correr de nuevo sin duplicar nada. En un Raspberry Pi no hagas `sudo reboot` a medias: con el arranque ya silenciado y el kiosko sin instalar solo verías una pantalla negra.

## Mensajes que se pueden ignorar

| Mensaje | Por qué es inofensivo |
|---|---|
| `Cannot find Xwayland binary` / `Cannot create XWayland server` | `cage` intenta arrancar la capa de X11; no hace falta, Chromium habla Wayland directo |
| `W: plymouth: The plugin label-pango.so is missing` | Es un plugin de texto; el tema del logo solo dibuja una imagen |
| `Input device vc4-hdmi-0 cannot be mapped to an output device` | Son las salidas HDMI, que se ven como teclados para el control por CEC |
| `apt-listchanges: Reading changelogs...` | Salida normal de `apt` |
