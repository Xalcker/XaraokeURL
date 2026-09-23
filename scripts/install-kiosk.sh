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
PLAYER_DIR=/opt/xaraoke-player

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
  rm -f "$KIOSK_UNIT" "$SERVER_UNIT" "$WAIT_SCRIPT" "$AUDIO_SCRIPT"
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
  PKGS="cage curl $CHROMIUM_PKG"
else
  # El reproductor nativo no usa paquetes de npm: con Node y mpv del sistema alcanza.
  PKGS="curl mpv nodejs fonts-dejavu-core"
fi
if ! command -v pactl >/dev/null 2>&1 && ! command -v wpctl >/dev/null 2>&1; then
  PKGS="$PKGS pipewire-audio"
fi

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

echo "==> Apagando el login de texto en tty1 (el kiosko toma esa terminal)"
systemctl disable --now getty@tty1.service 2>/dev/null || true

echo "==> Instalando script de espera al server"
cat > "$WAIT_SCRIPT" <<'EOS'
#!/usr/bin/env bash
# Reintenta hasta 60s a que la URL responda, para no ganarle la carrera al
# arranque del server Node. Si sigue sin responder, sigue igual (mejor mostrar
# el error de conexión en pantalla que dejar el kiosko colgado para siempre).
url="$1"
tries=0
until curl -fsS -o /dev/null "$url" 2>/dev/null; do
  tries=$((tries + 1))
  if [ "$tries" -ge 60 ]; then
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
if command -v wpctl >/dev/null 2>&1; then
  id=$(wpctl status 2>/dev/null | awk '/Sinks:/{f=1} /Sources:/{f=0} f' | grep -i hdmi | head -n1 | grep -oE '[0-9]+' | head -n1)
  if [ -n "$id" ]; then
    wpctl set-default "$id"
    wpctl set-volume "$id" 1.0
    wpctl set-mute "$id" 0
  fi
elif command -v pactl >/dev/null 2>&1; then
  sink=$(pactl list short sinks | awk 'tolower($0) ~ /hdmi/ {print $2; exit}')
  if [ -n "$sink" ]; then
    pactl set-default-sink "$sink"
    pactl set-sink-volume "$sink" 100%
    pactl set-sink-mute "$sink" 0
  fi
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

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=-$APP_DIR/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=2
StartLimitIntervalSec=0

[Install]
WantedBy=multi-user.target
EOF
  KIOSK_AFTER="network-online.target xaraoke-server.service"
  KIOSK_WANTS="network-online.target xaraoke-server.service"
fi

KIOSK_ENV=""
if [ "$KIOSK_PLAYER" = "chromium" ]; then
  KIOSK_EXEC="/usr/bin/cage -- $CHROMIUM_BIN --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --disable-translate --check-for-update-interval=31536000 --autoplay-policy=no-user-gesture-required --ozone-platform=wayland --lang=$KIOSK_LANG $KIOSK_URL"
else
  echo "==> Instalando el reproductor nativo en $PLAYER_DIR"
  SCRIPT_REPO="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd || true)"
  if [ -z "$PLAYER_SRC_DIR" ] && [ -n "$SCRIPT_REPO" ] && [ -f "$SCRIPT_REPO/player/xaraoke-player.js" ]; then
    PLAYER_SRC_DIR="$SCRIPT_REPO"
  fi
  PLAYER_TMP="$(mktemp -d)"
  if [ -n "$PLAYER_SRC_DIR" ]; then
    mkdir -p "$PLAYER_TMP/public/js"
    cp -r "$PLAYER_SRC_DIR/player" "$PLAYER_TMP/"
    cp "$PLAYER_SRC_DIR/public/js/i18n.js" "$PLAYER_SRC_DIR/public/js/shared.js" "$PLAYER_TMP/public/js/"
  else
    echo "    Descargando de GitHub ($XARAOKE_REF)"
    curl -fsSL "https://codeload.github.com/Xalcker/XaraokeURL/tar.gz/$XARAOKE_REF" \
      | tar -xz --strip-components=1 -C "$PLAYER_TMP" --wildcards '*/player/*' '*/public/js/i18n.js' '*/public/js/shared.js'
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
      MPV_ARGS="--vo=gpu --gpu-context=drm --hwdec=v4l2m2m-copy"
    else
      MPV_ARGS="--vo=gpu --gpu-context=drm --hwdec=auto-safe"
    fi
  fi
  KIOSK_EXEC="/usr/bin/node $NODE_FLAGS $PLAYER_DIR/player/xaraoke-player.js"
  KIOSK_ENV="Environment=XARAOKE_SERVER=$SERVER_URL
Environment=XARAOKE_LANG=$KIOSK_LANG
Environment=\"XARAOKE_MPV_ARGS=$MPV_ARGS\""
fi

echo "==> Instalando servicio del kiosko ($KIOSK_PLAYER)"
cat > "$KIOSK_UNIT" <<EOF
[Unit]
Description=XaraokeURL kiosk display
After=$KIOSK_AFTER
Wants=$KIOSK_WANTS
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
ExecStartPre=$WAIT_SCRIPT $KIOSK_URL
ExecStartPre=-$AUDIO_SCRIPT
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

cat <<EOF

Listo. Para probarlo:
  sudo reboot

Logs si algo falla:
  journalctl -u xaraoke-kiosk.service -f
$( [ "$INSTALL_NODE_SERVICE" = "true" ] && echo "  journalctl -u xaraoke-server.service -f" )

Para desinstalar:
  sudo $0 --uninstall
EOF
