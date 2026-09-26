#!/usr/bin/env bash
set -euo pipefail

# Instala un kiosko de pantalla completa que arranca solo al encender el equipo y
# muestra la pantalla host de XaraokeURL por HDMI (video y audio). Sirve igual en
# Raspberry Pi OS (arm64) y en Debian/Ubuntu de un miniPC x86 — ambos son
# Debian-based, mismos paquetes, misma unidad systemd.
#
# Dos formas de mostrar la pantalla (KIOSK_PLAYER):
#   chromium  La pantalla web completa: Wayland "cage" + Chromium en modo kiosko.
#             Para Raspberry Pi 4/5 y miniPC.
#   mpv       El reproductor nativo (player/xaraoke-player.js): mpv con el
#             decodificador por hardware y, encima, quién canta, quién sigue y el
#             QR. Para placas donde un navegador no alcanza (Raspberry Pi Zero 2 W).
#
# Uso:
#   sudo ./scripts/install-kiosk.sh
#   sudo KIOSK_URL="http://192.168.1.50:8081/" ./scripts/install-kiosk.sh
#   sudo INSTALL_NODE_SERVICE=true APP_DIR=/opt/xaraoke ./scripts/install-kiosk.sh
#   sudo ./scripts/install-kiosk.sh --uninstall
#
# Variables de entorno (todas opcionales):
#   KIOSK_URL             URL del servidor (http://localhost:8081/)
#   KIOSK_PLAYER          chromium o mpv (chromium)
#   KIOSK_USER            Usuario del sistema que corre la sesión kiosko (kiosk)
#   KIOSK_LANG            Idioma de la interfaz en pantalla (es). XaraokeURL toma el
#                         idioma del navegador, y Chromium en Raspberry Pi OS sale en inglés.
#   MPV_ARGS              Solo con mpv: opciones de video para mpv. Por defecto usa
#                         el decodificador por hardware del Raspberry Pi, o el que
#                         mpv detecte en otro equipo.
#   PLAYER_SRC_DIR        Solo con mpv: carpeta del repo de donde copiar el
#                         reproductor. Si no se da y el script no está dentro del
#                         repo, se descarga de GitHub (rama XARAOKE_REF).
#   XARAOKE_REF           Rama o tag de GitHub para esa descarga (main)
#   INSTALL_NODE_SERVICE  "true" para instalar además un servicio systemd que
#                         corre "node server.js" en este mismo equipo (false)
#   APP_DIR               Carpeta del proyecto, si INSTALL_NODE_SERVICE=true
#                         (/opt/xaraoke)
#   APP_USER              Usuario que corre el server Node (por defecto, el
#                         mismo que KIOSK_USER)
#
# Después de instalar: "sudo reboot". Logs con:
#   journalctl -u xaraoke-kiosk.service -f

KIOSK_URL="${KIOSK_URL:-http://localhost:8081/}"
KIOSK_PLAYER="${KIOSK_PLAYER:-chromium}"
KIOSK_USER="${KIOSK_USER:-kiosk}"
KIOSK_LANG="${KIOSK_LANG:-es}"
MPV_ARGS="${MPV_ARGS:-}"
PLAYER_SRC_DIR="${PLAYER_SRC_DIR:-}"
XARAOKE_REF="${XARAOKE_REF:-main}"
INSTALL_NODE_SERVICE="${INSTALL_NODE_SERVICE:-false}"
APP_DIR="${APP_DIR:-/opt/xaraoke}"
APP_USER="${APP_USER:-$KIOSK_USER}"

WAIT_SCRIPT=/usr/local/bin/xaraoke-wait-for-server.sh
AUDIO_SCRIPT=/usr/local/bin/xaraoke-set-hdmi-audio.sh
KIOSK_UNIT=/etc/systemd/system/xaraoke-kiosk.service
SERVER_UNIT=/etc/systemd/system/xaraoke-server.service
PREPARE_UNIT=/etc/systemd/system/xaraoke-kiosk-prepare.service
PLAYER_DIR=/opt/xaraoke-player
PLYMOUTH_DROPIN=/etc/systemd/system/plymouth-quit.service.d/xaraoke.conf
# Tema de cursor "default" del usuario del kiosko (~/.icons/default), ver más abajo.
blank_cursor_dir() { echo "$(getent passwd "$KIOSK_USER" | cut -d: -f6)/.icons/default"; }

case "$KIOSK_PLAYER" in
  chromium|mpv) ;;
  *) echo "KIOSK_PLAYER debe ser chromium o mpv (recibí: '$KIOSK_PLAYER')." >&2; exit 1 ;;
esac

# El reproductor nativo quiere la dirección del servidor tal cual; el navegador, la página con
# ?autostart=1 (ver abajo).
SERVER_URL="$KIOSK_URL"

# Sin teclado ni mouse nadie puede pulsar "Comenzar": ?autostart=1 hace que la pantalla principal
# cree (o recupere) la sala sola al abrir.
case "$KIOSK_URL" in
  *autostart*) ;;
  *\?*) KIOSK_URL="$KIOSK_URL&autostart=1" ;;
  *) KIOSK_URL="$KIOSK_URL?autostart=1" ;;
esac

if [ "$(id -u)" -ne 0 ]; then
  echo "Este script necesita ejecutarse como root (sudo)." >&2
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "Este script asume una distro basada en Debian/Ubuntu (necesita apt-get)." >&2
  exit 1
fi

uninstall() {
  systemctl disable --now xaraoke-kiosk.service 2>/dev/null || true
  systemctl disable --now xaraoke-server.service 2>/dev/null || true
  rm -f "$KIOSK_UNIT" "$PREPARE_UNIT" "$SERVER_UNIT" "$WAIT_SCRIPT" "$AUDIO_SCRIPT" "$PLYMOUTH_DROPIN"
  # Solo si el tema "default" del kiosko es el nuestro.
  if grep -qs "xaraoke-blank" "$(blank_cursor_dir)/index.theme"; then rm -rf "$(blank_cursor_dir)"; fi
  if [ -f /usr/share/glib-2.0/schemas/90_xaraoke.gschema.override ]; then
    rm -f /usr/share/glib-2.0/schemas/90_xaraoke.gschema.override
    glib-compile-schemas /usr/share/glib-2.0/schemas/ 2>/dev/null || true
  fi
  rm -rf "$PLAYER_DIR"
  systemctl daemon-reload
  systemctl enable --now getty@tty1.service 2>/dev/null || true
  echo "Kiosko desinstalado. El usuario '$KIOSK_USER' no se borró a propósito (userdel -r $KIOSK_USER si ya no lo quieres)."
  exit 0
}

if [ "${1:-}" = "--uninstall" ]; then
  uninstall
fi

echo "==> Actualizando índice de paquetes"
apt-get update -qq

if [ "$KIOSK_PLAYER" = "chromium" ]; then
  CHROMIUM_BIN=/usr/bin/chromium
  if apt-cache show chromium >/dev/null 2>&1; then
    CHROMIUM_PKG=chromium
  else
    CHROMIUM_PKG=chromium-browser
    CHROMIUM_BIN=/usr/bin/chromium-browser
  fi
  # seatd le da a cage el acceso a la pantalla: en Raspberry Pi OS (Debian 13) logind no le asigna
  # seat a esta sesión y cage se cae a los 10 s con "Timeout waiting session to become active".
  # libglib2.0-bin trae glib-compile-schemas, para fijar el cursor (ver más abajo).
  PKGS="cage seatd curl libglib2.0-bin $CHROMIUM_PKG"
else
  # El reproductor nativo no usa paquetes de npm: con Node y mpv del sistema alcanza.
  PKGS="curl mpv nodejs fonts-dejavu-core"
fi
if ! command -v pactl >/dev/null 2>&1 && ! command -v wpctl >/dev/null 2>&1; then
  PKGS="$PKGS pipewire-audio"
fi
# rtkit le da prioridad de tiempo real a PipeWire. Sin él, cuando el video ocupa el CPU el audio
# espera su turno, el búfer del HDMI se vacía ("snd_pcm_mmap_commit error: Broken pipe") y en un
# Raspberry Pi el sonido puede quedarse mudo hasta reiniciar (pasó en una Pi Zero 2 W).
PKGS="$PKGS rtkit"

echo "==> Instalando paquetes: $PKGS"
apt-get install -y --no-install-recommends $PKGS

echo "==> Preparando el usuario de la sesión kiosko ($KIOSK_USER)"
KIOSK_GROUPS="video,audio"
if getent group render >/dev/null 2>&1; then
  KIOSK_GROUPS="$KIOSK_GROUPS,render"
fi
if id "$KIOSK_USER" >/dev/null 2>&1; then
  usermod -aG "$KIOSK_GROUPS" "$KIOSK_USER"
else
  useradd -m -G "$KIOSK_GROUPS" -s /bin/bash "$KIOSK_USER"
fi
# cage abre una sesión real vía PAMName=login (ver más abajo); "linger" evita
# que systemd tumbe esa sesión de usuario entre arranque y arranque.
loginctl enable-linger "$KIOSK_USER"
KIOSK_UID="$(id -u "$KIOSK_USER")"
KIOSK_HOME="$(getent passwd "$KIOSK_USER" | cut -d: -f6)"

# Audio por HDMI más estable: un búfer más grande (aguanta mejor cuando el CPU va justo) y sin
# suspender la salida a los 5 s de silencio. Al suspenderla y reactivarla entre canciones, el TV
# puede mostrar un recuadro con el formato de audio. La sintaxis cambia con la versión de WirePlumber.
if command -v wireplumber >/dev/null 2>&1; then
  echo "==> Ajustando el audio HDMI en WirePlumber"
  WP_VERSION="$(wireplumber --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -n1)"
  case "$WP_VERSION" in
    0.4)
      WP_CONF="$KIOSK_HOME/.config/wireplumber/main.lua.d/51-xaraoke-hdmi.lua"
      install -d -o "$KIOSK_USER" -g "$KIOSK_USER" "$(dirname "$WP_CONF")"
      cat > "$WP_CONF" <<'EOS'
-- Instalado por XaraokeURL (install-kiosk.sh): audio HDMI más estable.
table.insert(alsa_monitor.rules, {
  matches = { { { "node.name", "matches", "alsa_output.*hdmi*" } } },
  apply_properties = {
    ["api.alsa.period-size"] = 1024,
    ["api.alsa.headroom"] = 8192,
    ["session.suspend-timeout-seconds"] = 0,
  },
})
EOS
      ;;
    *)
      WP_CONF="$KIOSK_HOME/.config/wireplumber/wireplumber.conf.d/50-xaraoke-hdmi.conf"
      install -d -o "$KIOSK_USER" -g "$KIOSK_USER" "$(dirname "$WP_CONF")"
      cat > "$WP_CONF" <<'EOS'
# Instalado por XaraokeURL (install-kiosk.sh): audio HDMI más estable.
monitor.alsa.rules = [
  {
    matches = [ { node.name = "~alsa_output.*hdmi.*" } ]
    actions = {
      update-props = {
        api.alsa.period-size = 1024
        api.alsa.headroom = 8192
        session.suspend-timeout-seconds = 0
      }
    }
  }
]
EOS
      ;;
  esac
  # "install -d" solo le da dueño al último directorio: los intermedios (~/.config, ~/.config/wireplumber)
  # quedan como root y Chromium no puede crear su perfil ahí (se cae al arrancar).
  chown -R "$KIOSK_USER:$KIOSK_USER" "$KIOSK_HOME/.config"
fi

echo "==> Apagando el login de texto en tty1 (el kiosko toma esa terminal)"
systemctl disable --now getty@tty1.service 2>/dev/null || true

echo "==> Instalando script de espera al server"
cat > "$WAIT_SCRIPT" <<'EOS'
#!/usr/bin/env bash
# Reintenta hasta 60s a que la URL responda, para no ganarle la carrera al
# arranque del server Node. Si sigue sin responder, sigue igual (mejor mostrar
# el error de conexión en pantalla que dejar el kiosko colgado para siempre).
#
# Se cuenta por reloj y cada intento tiene tope (-m): sin eso, si la máquina del server
# no contesta, cada curl tarda lo que tarde la conexión en rendirse, la espera pasa de
# los 90 s que systemd da para arrancar, y el kiosko falla y se reintenta sin fin.
url="$1"
# Con el servidor en este mismo equipo la respuesta llega aunque no haya red, y la pantalla se abriría
# antes de que el Wi-Fi conecte: el QR saldría con "localhost", porque el servidor no encontraría ninguna
# IP. Antes se espera (hasta 30 s) a que exista una ruta por defecto.
case "$url" in
  *://localhost*|*://127.*)
    if command -v ip >/dev/null 2>&1; then
      until [ -n "$(ip route show default 2>/dev/null)" ]; do
        if [ "$SECONDS" -ge 30 ]; then
          echo "xaraoke-wait-for-server: sin ruta de red tras 30s, continúo igual" >&2
          break
        fi
        sleep 1
      done
    fi ;;
esac
until curl -fsS -m 3 -o /dev/null "$url" 2>/dev/null; do
  if [ "$SECONDS" -ge 60 ]; then
    echo "xaraoke-wait-for-server: sin respuesta de $url tras 60s, continúo igual" >&2
    break
  fi
  sleep 1
done
exit 0
EOS
chmod +x "$WAIT_SCRIPT"

echo "==> Instalando script de audio por HDMI"
cat > "$AUDIO_SCRIPT" <<'EOS'
#!/usr/bin/env bash
# Fuerza el sink de audio "default" del usuario a la salida HDMI, para que
# Chromium o mpv (que usan el default del sistema) suenen por ahí. También lo
# deja al 100 % y sin silencio: WirePlumber arranca una salida nueva al 40 %,
# que en la escala del audio casi no se oye. El volumen se maneja desde el TV.
#
# PipeWire y WirePlumber del usuario arrancan casi a la vez que este servicio: al principio la salida
# HDMI puede no existir todavía (en un miniPC x86 el sonido salía por la salida analógica, la que
# tiene prioridad, porque el ajuste se intentaba una sola vez), así que se reintenta hasta 20 s.
set_hdmi() {
  if command -v wpctl >/dev/null 2>&1; then
    id=$(wpctl status 2>/dev/null | awk '/Sinks:/{f=1} /Sources:/{f=0} f' | grep -i hdmi | head -n1 | grep -oE '[0-9]+' | head -n1)
    [ -n "$id" ] || return 1
    wpctl set-default "$id"
    wpctl set-volume "$id" 1.0
    wpctl set-mute "$id" 0
    echo "xaraoke-set-hdmi-audio: salida HDMI $id fijada como predeterminada"
  else
    sink=$(pactl list short sinks 2>/dev/null | awk 'tolower($0) ~ /hdmi/ {print $2; exit}')
    [ -n "$sink" ] || return 1
    pactl set-default-sink "$sink"
    pactl set-sink-volume "$sink" 100%
    pactl set-sink-mute "$sink" 0
    echo "xaraoke-set-hdmi-audio: salida HDMI $sink fijada como predeterminada"
  fi
}
if command -v wpctl >/dev/null 2>&1 || command -v pactl >/dev/null 2>&1; then
  until set_hdmi; do
    if [ "$SECONDS" -ge 20 ]; then
      echo "xaraoke-set-hdmi-audio: no encontré ninguna salida HDMI tras 20s, dejo la predeterminada" >&2
      break
    fi
    sleep 1
  done
fi
exit 0
EOS
chmod +x "$AUDIO_SCRIPT"

KIOSK_AFTER="network-online.target"
KIOSK_WANTS="network-online.target"

if [ "$INSTALL_NODE_SERVICE" = "true" ]; then
  echo "==> Instalando servicio del server Node ($APP_DIR)"
  cat > "$SERVER_UNIT" <<EOF
[Unit]
Description=XaraokeURL server
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=-$APP_DIR/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
  KIOSK_AFTER="network-online.target xaraoke-server.service"
  KIOSK_WANTS="network-online.target xaraoke-server.service"
fi

KIOSK_ENV=""
# Chromium espera al servidor antes de abrir, para no mostrar una página de error. El reproductor
# nativo no: arranca de inmediato con "Conectando…" en pantalla y reintenta solo.
WAIT_PRE=""
if [ "$KIOSK_PLAYER" = "chromium" ]; then
  WAIT_PRE="ExecStart=$WAIT_SCRIPT $KIOSK_URL"
  # cage dibuja su cursor por defecto aunque no haya ratón (en un kiosko sin periféricos queda un
  # puntero fijo en el centro). Un tema de cursor transparente de 24x24 lo hace invisible (de 1x1
  # lo aceptaba cage, pero Chromium lo descartaba y dibujaba el suyo).
  # Tiene que llamarse "default" y vivir en el home del usuario: XCURSOR_THEME/XCURSOR_PATH no le
  # hacen efecto a cage (probado en un Pi 4 con Raspberry Pi OS basado en Debian 13).
  # Es un archivo Xcursor mínimo: cabecera, una entrada y una imagen con todos los píxeles en cero.
  BLANK_CURSOR_DIR="$(blank_cursor_dir)"
  le32() { printf "$(printf '\\%03o\\%03o\\%03o\\%03o' $(($1 & 255)) $((($1 >> 8) & 255)) $((($1 >> 16) & 255)) $((($1 >> 24) & 255)))"; }
  mkdir -p "$BLANK_CURSOR_DIR/cursors"
  {
    printf 'Xcur'
    le32 16; le32 65536; le32 1
    le32 4294770690; le32 24; le32 28
    le32 36; le32 4294770690; le32 24; le32 1; le32 24; le32 24; le32 0; le32 0; le32 0
    head -c $((24 * 24 * 4)) /dev/zero
  } > "$BLANK_CURSOR_DIR/cursors/left_ptr"
  for name in default arrow top_left_arrow pointer hand2 text xterm watch wait; do
    ln -sf left_ptr "$BLANK_CURSOR_DIR/cursors/$name"
  done
  printf '[Icon Theme]\nName=Default\nComment=xaraoke-blank: cursor transparente para el kiosko\n' > "$BLANK_CURSOR_DIR/index.theme"
  chown -R "$KIOSK_USER:$KIOSK_USER" "$KIOSK_HOME/.icons"
  # Chromium no lee ese tema directo: elige su cursor con la configuración de GTK, y sin ella usa
  # Adwaita (la flecha negra con borde blanco). Se le indica también el tema "default".
  for gtk_ver in 3.0 4.0; do
    install -d -o "$KIOSK_USER" -g "$KIOSK_USER" "$KIOSK_HOME/.config" "$KIOSK_HOME/.config/gtk-$gtk_ver"
    printf '[Settings]\ngtk-cursor-theme-name=default\ngtk-cursor-theme-size=24\n' > "$KIOSK_HOME/.config/gtk-$gtk_ver/settings.ini"
  done
  chown -R "$KIOSK_USER:$KIOSK_USER" "$KIOSK_HOME/.config"
  # Si el equipo trae los esquemas de GNOME (los arrastran paquetes como ffmpeg), GTK toma el tema del
  # cursor de ahí (Adwaita por defecto) antes que de settings.ini: hay que fijarlo también ahí.
  if [ -f /usr/share/glib-2.0/schemas/org.gnome.desktop.interface.gschema.xml ]; then
    printf "[org.gnome.desktop.interface]\ncursor-theme='default'\ncursor-size=24\n" \
      > /usr/share/glib-2.0/schemas/90_xaraoke.gschema.override
    glib-compile-schemas /usr/share/glib-2.0/schemas/
  fi

  KIOSK_ENV="Environment=LIBSEAT_BACKEND=seatd"
  KIOSK_AFTER="$KIOSK_AFTER seatd.service"
  KIOSK_WANTS="$KIOSK_WANTS seatd.service"
  KIOSK_EXEC="/usr/bin/cage -- $CHROMIUM_BIN --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --disable-translate --check-for-update-interval=31536000 --autoplay-policy=no-user-gesture-required --ozone-platform=wayland --lang=$KIOSK_LANG $KIOSK_URL"
else
  echo "==> Instalando el reproductor nativo en $PLAYER_DIR"
  SCRIPT_REPO="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd || true)"
  if [ -z "$PLAYER_SRC_DIR" ] && [ -n "$SCRIPT_REPO" ] && [ -f "$SCRIPT_REPO/player/xaraoke-player.js" ]; then
    PLAYER_SRC_DIR="$SCRIPT_REPO"
  fi
  PLAYER_TMP="$(mktemp -d)"
  if [ -n "$PLAYER_SRC_DIR" ]; then
    mkdir -p "$PLAYER_TMP/public/js" "$PLAYER_TMP/public/img"
    cp -r "$PLAYER_SRC_DIR/player" "$PLAYER_TMP/"
    cp "$PLAYER_SRC_DIR/public/js/i18n.js" "$PLAYER_SRC_DIR/public/js/shared.js" "$PLAYER_TMP/public/js/"
    cp "$PLAYER_SRC_DIR/public/img/logo.svg" "$PLAYER_TMP/public/img/"
  else
    echo "    Descargando de GitHub ($XARAOKE_REF)"
    curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors "https://codeload.github.com/Xalcker/XaraokeURL/tar.gz/$XARAOKE_REF" \
      | tar -xz --strip-components=1 -C "$PLAYER_TMP" --wildcards '*/player/*' '*/public/js/i18n.js' '*/public/js/shared.js' '*/public/img/logo.svg'
  fi
  [ -f "$PLAYER_TMP/player/xaraoke-player.js" ] || { echo "No se pudo obtener el reproductor." >&2; exit 1; }
  rm -rf "$PLAYER_DIR"
  mv "$PLAYER_TMP" "$PLAYER_DIR"
  chmod -R a+rX "$PLAYER_DIR"

  # Node 22+ trae WebSocket; en Node 20 (el de Debian 13) hay que pedirlo con una opción.
  if node -e 'process.exit(typeof WebSocket === "function" ? 0 : 1)' 2>/dev/null; then
    NODE_FLAGS=""
  elif node --experimental-websocket -e 'process.exit(typeof WebSocket === "function" ? 0 : 1)' 2>/dev/null; then
    NODE_FLAGS="--experimental-websocket"
  else
    echo "Este Node ($(node --version)) no trae WebSocket: se necesita Node 20.10 o más nuevo." >&2
    exit 1
  fi

  if [ -z "$MPV_ARGS" ]; then
    if tr -d '\0' < /proc/device-tree/model 2>/dev/null | grep -q "Raspberry Pi"; then
      # Probado en una Pi Zero 2 W: el modo "-copy" es el que funciona con su GPU.
      # mpv dibuja a 1280×720 y la pantalla lo escala: la GPU de la Pi Zero 2 W no maneja texturas de
      # más de 2048×2048, y a 1080p los textos de la pantalla de espera no cabían en una (mpv no los
      # dibujaba). Además le ahorra trabajo a la GPU con el video.
      # "--profile=fast" usa filtros más simples al dibujar cada cuadro: en la Zero 2 W bajó los cuadros
      # tirados de un video de 720p del 11 % al 7-8 %, y los textos se ven igual.
      MPV_ARGS="--vo=gpu --gpu-context=drm --drm-draw-surface-size=1280x720 --hwdec=v4l2m2m-copy --profile=fast"
    else
      MPV_ARGS="--vo=gpu --gpu-context=drm --hwdec=auto-safe"
    fi
  fi
  KIOSK_EXEC="/usr/bin/node $NODE_FLAGS $PLAYER_DIR/player/xaraoke-player.js"
  KIOSK_ENV="Environment=XARAOKE_SERVER=$SERVER_URL
Environment=XARAOKE_LANG=$KIOSK_LANG
Environment=\"XARAOKE_MPV_ARGS=$MPV_ARGS\""
fi

# Si hay logo de arranque (Plymouth, lo instalan setup-raspberry-display.sh y setup-x86-display.sh), se queda en pantalla
# mientras se espera al servidor y se quita justo antes de arrancar: "--retain-splash" deja la
# imagen hasta que cage o mpv dibujan, sin un negro en medio. plymouth-quit.service lo quitaría
# antes y dejaría ver la consola, así que espera a que el kiosko arranque.
# El "+" lo corre como root: como el usuario del kiosko falla sin permiso, y entonces
# plymouth-quit.service lo cerraría en el mismo instante en que arranca mpv, que abre la
# pantalla mientras Plymouth la tiene tomada y se queda sin poder dibujar.
PLYMOUTH_PRE=""
if command -v plymouth >/dev/null 2>&1; then
  PLYMOUTH_PRE="ExecStartPre=-+$(command -v plymouth) quit --retain-splash"
  mkdir -p "$(dirname "$PLYMOUTH_DROPIN")"
  printf '[Unit]\nAfter=xaraoke-kiosk.service\n' > "$PLYMOUTH_DROPIN"
else
  rm -f "$PLYMOUTH_DROPIN"
fi

# La espera al servidor y el ajuste del audio van en un servicio aparte, sin PAMName ni TTYPath:
# como ExecStartPre del kiosko, cada uno abría su propia sesión de login sobre tty1 y le cortaba
# esa terminal a Plymouth (el logo desaparecía y aparecía texto antes de que cage tomara la pantalla).
echo "==> Instalando servicio de preparación del kiosko"
cat > "$PREPARE_UNIT" <<EOF
[Unit]
Description=XaraokeURL kiosk preparation (wait for server, HDMI audio)
After=$KIOSK_AFTER
Wants=$KIOSK_WANTS

[Service]
Type=oneshot
User=$KIOSK_USER
Environment=XDG_RUNTIME_DIR=/run/user/$KIOSK_UID
$WAIT_PRE
ExecStart=-$AUDIO_SCRIPT
EOF

echo "==> Instalando servicio del kiosko ($KIOSK_PLAYER)"
cat > "$KIOSK_UNIT" <<EOF
[Unit]
Description=XaraokeURL kiosk display
After=$KIOSK_AFTER xaraoke-kiosk-prepare.service
Wants=$KIOSK_WANTS xaraoke-kiosk-prepare.service
Conflicts=getty@tty1.service
StartLimitIntervalSec=0

[Service]
User=$KIOSK_USER
# TTYPath + PAMName=login hacen que systemd/logind traten esto como una
# sesión real en tty1 (necesario para que cage obtenga el "seat" y pueda
# usar /dev/dri directamente, sin gestor de sesiones gráfico de por medio).
PAMName=login
TTYPath=/dev/tty1
StandardInput=tty
StandardOutput=journal
StandardError=journal
UtmpIdentifier=tty1
Environment=XDG_RUNTIME_DIR=/run/user/$KIOSK_UID
$KIOSK_ENV
$PLYMOUTH_PRE
ExecStart=$KIOSK_EXEC
Restart=always
RestartSec=2
# Si algo no responde al apagado, no esperar los 90 s por defecto.
TimeoutStopSec=10

[Install]
WantedBy=multi-user.target
EOF

echo "==> Activando servicios"
systemctl daemon-reload
if [ "$INSTALL_NODE_SERVICE" = "true" ]; then
  systemctl enable --now xaraoke-server.service
fi
systemctl enable xaraoke-kiosk.service
if [ "$KIOSK_PLAYER" = "chromium" ]; then
  systemctl enable --now seatd.service
fi

cat <<EOF

Listo. Para probarlo:
  sudo reboot

Logs si algo falla:
  journalctl -u xaraoke-kiosk.service -f
$( [ "$INSTALL_NODE_SERVICE" = "true" ] && echo "  journalctl -u xaraoke-server.service -f" )

Para desinstalar:
  sudo $0 --uninstall
EOF
