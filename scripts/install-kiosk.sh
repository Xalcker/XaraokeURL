#!/usr/bin/env bash
set -euo pipefail

# Instala un kiosko de pantalla completa (Wayland "cage" + Chromium) que arranca
# solo al encender el equipo y muestra la pantalla host de XaraokeURL por HDMI
# (video y audio). Sirve igual en Raspberry Pi OS (arm64) y en Debian/Ubuntu de
# un miniPC x86 — ambos son Debian-based, mismos paquetes, misma unidad systemd.
#
# Uso:
#   sudo ./scripts/install-kiosk.sh
#   sudo KIOSK_URL="http://192.168.1.50:8081/" ./scripts/install-kiosk.sh
#   sudo INSTALL_NODE_SERVICE=true APP_DIR=/opt/xaraoke ./scripts/install-kiosk.sh
#   sudo ./scripts/install-kiosk.sh --uninstall
#
# Variables de entorno (todas opcionales):
#   KIOSK_URL             URL que muestra el navegador (http://localhost:8081/)
#   KIOSK_USER            Usuario del sistema que corre la sesión kiosko (kiosk)
#   KIOSK_LANG            Idioma de la interfaz en pantalla (es). XaraokeURL toma el
#                         idioma del navegador, y Chromium en Raspberry Pi OS sale en inglés.
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
KIOSK_USER="${KIOSK_USER:-kiosk}"
KIOSK_LANG="${KIOSK_LANG:-es}"
INSTALL_NODE_SERVICE="${INSTALL_NODE_SERVICE:-false}"
APP_DIR="${APP_DIR:-/opt/xaraoke}"
APP_USER="${APP_USER:-$KIOSK_USER}"

WAIT_SCRIPT=/usr/local/bin/xaraoke-wait-for-server.sh
AUDIO_SCRIPT=/usr/local/bin/xaraoke-set-hdmi-audio.sh
KIOSK_UNIT=/etc/systemd/system/xaraoke-kiosk.service
SERVER_UNIT=/etc/systemd/system/xaraoke-server.service

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

CHROMIUM_BIN=/usr/bin/chromium
if apt-cache show chromium >/dev/null 2>&1; then
  CHROMIUM_PKG=chromium
else
  CHROMIUM_PKG=chromium-browser
  CHROMIUM_BIN=/usr/bin/chromium-browser
fi

PKGS="cage curl $CHROMIUM_PKG"
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
# Chromium (que siempre usa el default del sistema) suene por ahí.
if command -v wpctl >/dev/null 2>&1; then
  id=$(wpctl status 2>/dev/null | awk '/Sinks:/{f=1} /Sources:/{f=0} f' | grep -i hdmi | head -n1 | grep -oE '[0-9]+' | head -n1)
  [ -n "$id" ] && wpctl set-default "$id"
elif command -v pactl >/dev/null 2>&1; then
  sink=$(pactl list short sinks | awk 'tolower($0) ~ /hdmi/ {print $2; exit}')
  [ -n "$sink" ] && pactl set-default-sink "$sink"
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

echo "==> Instalando servicio del kiosko (cage + $CHROMIUM_BIN)"
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
ExecStartPre=$WAIT_SCRIPT $KIOSK_URL
ExecStartPre=-$AUDIO_SCRIPT
ExecStart=/usr/bin/cage -- $CHROMIUM_BIN --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --disable-translate --check-for-update-interval=31536000 --autoplay-policy=no-user-gesture-required --ozone-platform=wayland --lang=$KIOSK_LANG $KIOSK_URL
Restart=always
RestartSec=2

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
