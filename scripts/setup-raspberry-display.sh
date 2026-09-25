#!/usr/bin/env bash
set -euo pipefail

# Convierte una instalación limpia de Raspberry Pi OS Lite (la más básica, sin
# escritorio) en una pantalla dedicada de XaraokeURL: al encender, abre la sala
# a pantalla completa por HDMI (video y audio) apuntando a un servidor que corre
# en OTRA máquina de la red. No hace falta teclado ni mouse después de instalar.
#
# Hace la parte propia del Raspberry Pi (actualizar, driver de video, forzar la
# salida HDMI, Wi-Fi sin ahorro de energía, etc.) y luego delega el kiosko en
# sí a scripts/install-kiosk.sh: Chromium con la pantalla web, o el reproductor
# nativo con mpv en placas de menos de 1 GB de RAM (una Pi Zero 2 W), donde un
# navegador no alcanza a reproducir video.
#
# Uso, con el repo clonado en el Pi:
#   sudo ./scripts/setup-raspberry-display.sh http://192.168.1.50:8081/
#
# O directo en un Pi recién instalado, sin clonar nada:
#   curl -fsSL https://raw.githubusercontent.com/Xalcker/XaraokeURL/main/scripts/setup-raspberry-display.sh \
#     | sudo bash -s -- http://192.168.1.50:8081/
#
# Variables de entorno (todas opcionales):
#   KIOSK_URL       URL del servidor (también se puede pasar como primer argumento)
#   DISPLAY_MODE    Resolución forzada en HDMI, p. ej. "1280x720@60". Por defecto
#                   1920x1080@60, o 1280x720@60 en placas con menos de 1.5 GB de RAM.
#                   "auto" deja que el TV decida (ojo: un TV 4K hace que Chromium
#                   dibuje en 4K, y el Pi no da para eso).
#   KIOSK_PLAYER    chromium o mpv. Por defecto mpv en placas con menos de 1 GB de RAM y
#                   chromium en las demás (ver install-kiosk.sh).
#   KIOSK_HOSTNAME  Nombre del equipo en la red (p. ej. "xaraoke-tv"). Sin cambios si no se da.
#   BOOT_SPLASH     "false" para ver los mensajes de Linux al arrancar (útil para depurar). Por
#                   defecto se ocultan: el TV muestra el logo (Plymouth) desde que enciende hasta
#                   que aparece la sala, sin pantalla de colores, mensajes ni cursor.
#   SKIP_UPGRADE    "true" para no correr apt full-upgrade (más rápido, menos recomendable).
#   READ_ONLY       "true" para activar el sistema de archivos de solo lectura (overlayfs):
#                   protege la microSD si desconectan el Pi de golpe, pero cualquier cambio
#                   se pierde al reiniciar. Desactívalo con "sudo raspi-config nonint do_overlayfs 1".
#   INSTALL_NODE_SERVICE  "true" para que el servidor corra en este mismo Pi (servicio systemd que
#                   ejecuta "node server.js" desde APP_DIR). La app tiene que estar ya instalada
#                   ahí (Node, "npm ci" y el .env); este script no la instala.
#   APP_DIR         Carpeta de la app si INSTALL_NODE_SERVICE=true (/opt/xaraoke).
#   REBOOT          "true" para reiniciar solo al terminar.
#   XARAOKE_REF     Rama/tag de GitHub de donde bajar install-kiosk.sh (y el reproductor
#                   nativo) si no están junto a este script (main).

# Todo va dentro de main() para que bash lea el script completo antes de ejecutarlo:
# con "curl | sudo bash", un comando que leyera stdin (apt, raspi-config) se comería
# el resto del script.
main() {
  KIOSK_URL="${1:-${KIOSK_URL:-}}"
  DISPLAY_MODE="${DISPLAY_MODE:-}"
  KIOSK_PLAYER="${KIOSK_PLAYER:-}"
  KIOSK_HOSTNAME="${KIOSK_HOSTNAME:-}"
  BOOT_SPLASH="${BOOT_SPLASH:-true}"
  SKIP_UPGRADE="${SKIP_UPGRADE:-false}"
  READ_ONLY="${READ_ONLY:-false}"
  REBOOT="${REBOOT:-false}"
  XARAOKE_REF="${XARAOKE_REF:-main}"
  INSTALL_NODE_SERVICE="${INSTALL_NODE_SERVICE:-false}"
  APP_DIR="${APP_DIR:-/opt/xaraoke}"

  KIOSK_INSTALLER=/usr/local/sbin/xaraoke-install-kiosk.sh
  NM_WIFI_CONF=/etc/NetworkManager/conf.d/xaraoke-wifi-powersave.conf
  PLYMOUTH_THEME_DIR=/usr/share/plymouth/themes/xaraoke
  # Vacío si el script llegó por "curl | bash": entonces lo que falte se baja de GitHub.
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"

  warn() { echo "⚠️  $*" >&2; }
  die() { echo "❌ $*" >&2; exit 1; }

  if [ "$(id -u)" -ne 0 ]; then
    die "Este script necesita ejecutarse como root (sudo)."
  fi

  # --- ¿Es un Raspberry Pi con Raspberry Pi OS? ---------------------------------
  MODEL="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || true)"
  case "$MODEL" in
    *"Raspberry Pi"*) ;;
    *) die "No parece un Raspberry Pi (modelo: '${MODEL:-desconocido}'). En un miniPC usa scripts/install-kiosk.sh directamente." ;;
  esac

  if [ -d /boot/firmware ]; then
    BOOT_DIR=/boot/firmware
  else
    BOOT_DIR=/boot
  fi
  CONFIG_TXT="$BOOT_DIR/config.txt"
  CMDLINE_TXT="$BOOT_DIR/cmdline.txt"
  [ -f "$CONFIG_TXT" ] && [ -f "$CMDLINE_TXT" ] || die "No encontré config.txt/cmdline.txt en $BOOT_DIR. ¿Es Raspberry Pi OS?"

  RAM_MB="$(awk '/MemTotal/ {print int($2 / 1024)}' /proc/meminfo)"
  ARCH="$(dpkg --print-architecture)"
  echo "==> Equipo: $MODEL, ${RAM_MB} MB de RAM, $ARCH"

  # Con menos de 1 GB, Chromium no alcanza a dibujar ni a reproducir video (probado en una Pi Zero 2 W):
  # ahí va el reproductor nativo.
  if [ -z "$KIOSK_PLAYER" ]; then
    if [ "$RAM_MB" -lt 900 ]; then
      KIOSK_PLAYER=mpv
    else
      KIOSK_PLAYER=chromium
    fi
  fi
  echo "==> Pantalla: $KIOSK_PLAYER"
  if [ "$RAM_MB" -lt 900 ] && [ "$KIOSK_PLAYER" = "chromium" ]; then
    warn "Esta placa tiene menos de 1 GB de RAM: Chromium no alcanza a reproducir video aquí."
    warn "Usa KIOSK_PLAYER=mpv, o una Raspberry Pi 4 (2 GB o más) o Pi 5."
  fi
  if [ "$ARCH" != "arm64" ]; then
    warn "Estás en Raspberry Pi OS de 32 bits ($ARCH). Funciona, pero se recomienda la versión de 64 bits."
  fi

  # --- URL del servidor ---------------------------------------------------------
  if [ -z "$KIOSK_URL" ]; then
    if [ -t 0 ]; then
      read -rp "URL del servidor XaraokeURL (p. ej. http://192.168.1.50:8081/): " KIOSK_URL
    else
      die "Falta la URL del servidor. Pásala como argumento: ... | sudo bash -s -- http://192.168.1.50:8081/"
    fi
  fi
  case "$KIOSK_URL" in
    http://*|https://*) ;;
    *) die "La URL debe empezar con http:// o https:// (recibí: '$KIOSK_URL')." ;;
  esac
  case "$KIOSK_URL" in
    *://localhost*|*://127.*)
      if [ "$INSTALL_NODE_SERVICE" != "true" ]; then
        warn "La URL apunta a este mismo equipo. Este script instala solo la pantalla; si también quieres"
        warn "correr el servidor aquí, vuelve a correrlo con INSTALL_NODE_SERVICE=true (ver arriba)."
      fi ;;
  esac

  if [ -z "$DISPLAY_MODE" ]; then
    if [ "$RAM_MB" -lt 1500 ]; then
      DISPLAY_MODE="1280x720@60"
    else
      DISPLAY_MODE="1920x1080@60"
    fi
  fi

  # --- Sistema al día -----------------------------------------------------------
  export DEBIAN_FRONTEND=noninteractive
  echo "==> Actualizando índice de paquetes"
  apt-get update -qq
  if [ "$SKIP_UPGRADE" != "true" ]; then
    echo "==> Actualizando el sistema (puede tardar varios minutos en una instalación nueva)"
    apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold full-upgrade
  fi

  # Raspberry Pi OS Lite trae muy pocas fuentes: sin estas, los títulos con emojis
  # o acentos raros se ven como cuadritos.
  echo "==> Instalando fuentes"
  apt-get install -y --no-install-recommends fonts-dejavu-core fonts-noto-color-emoji curl

  # --- Driver de video KMS (lo necesitan cage/Wayland y el audio por HDMI) -------
  if ! grep -qE '^[[:space:]]*dtoverlay=vc4-kms-v3d' "$CONFIG_TXT"; then
    echo "==> Activando el driver de video KMS en $CONFIG_TXT"
    [ -f "$CONFIG_TXT.xaraoke.bak" ] || cp "$CONFIG_TXT" "$CONFIG_TXT.xaraoke.bak"
    # [all] para que no quede dentro de una sección condicional ([pi4], [cm4]...).
    printf '\n[all]\n# Agregado por XaraokeURL: driver KMS para la pantalla kiosko\ndtoverlay=vc4-kms-v3d\n' >> "$CONFIG_TXT"
  fi

  # --- Forzar la salida HDMI ----------------------------------------------------
  # La "D" final fuerza la salida encendida aunque el TV esté apagado o en otra
  # entrada al arrancar el Pi; sin eso, cage no encuentra pantalla y el kiosko no
  # aparece hasta el siguiente reinicio.
  [ -f "$CMDLINE_TXT.xaraoke.bak" ] || cp "$CMDLINE_TXT" "$CMDLINE_TXT.xaraoke.bak"
  sed -i -E 's/[[:space:]]*video=HDMI-A-1:[^[:space:]]*//g' "$CMDLINE_TXT"
  if [ "$DISPLAY_MODE" != "auto" ]; then
    echo "==> Forzando HDMI a $DISPLAY_MODE"
    sed -i -E "1 s/[[:space:]]*\$/ video=HDMI-A-1:${DISPLAY_MODE}D/" "$CMDLINE_TXT"
  else
    echo "==> Resolución HDMI: la que elija el TV"
  fi

  # --- Arranque sin textos de Linux ---------------------------------------------
  # Sin esto, el TV muestra la pantalla de colores del firmware, los mensajes del
  # kernel y de systemd y el cursor de la consola hasta que el kiosko toma la
  # pantalla. Lo poco que queda sale en tty3 (Ctrl+Alt+F3 con un teclado); SSH
  # sigue igual. Se reaplica de cero cada vez, para no duplicar parámetros.
  # splash enciende el logo de Plymouth (ver abajo); plymouth.ignore-serial-consoles
  # hace falta porque con console=serial0 Plymouth se pasaría a modo texto.
  BOOT_QUIET_KEYS="quiet splash plymouth.ignore-serial-consoles loglevel logo.nologo vt.global_cursor_default systemd.show_status rd.udev.log_level"
  if [ "$BOOT_SPLASH" = "true" ]; then
    echo "==> Ocultando los textos de arranque"
    boot_console=console=tty3
  else
    echo "==> Dejando visibles los textos de arranque (BOOT_SPLASH=false)"
    boot_console=console=tty1
  fi
  # Raspberry Pi Imager deja cmdline.txt sin salto de línea al final: read lo lee
  # igual, pero devuelve error y set -e cortaría el script aquí.
  read -ra cmdline_words < "$CMDLINE_TXT" || true
  kept_words=()
  for word in "${cmdline_words[@]}"; do
    case " $BOOT_QUIET_KEYS " in *" ${word%%=*} "*) continue ;; esac
    case "$word" in console=tty1|console=tty3) word="$boot_console" ;; esac
    kept_words+=("$word")
  done
  if [ "$BOOT_SPLASH" = "true" ]; then
    kept_words+=(quiet splash plymouth.ignore-serial-consoles loglevel=3 logo.nologo vt.global_cursor_default=0 systemd.show_status=false rd.udev.log_level=3)
  fi
  # cmdline.txt debe quedar en una sola línea.
  printf '%s\n' "${kept_words[*]}" > "$CMDLINE_TXT"

  # disable_splash=1 quita la pantalla de colores del firmware. La marca permite
  # quitarlo después sin tocar un disable_splash que ya hubiera puesto alguien más.
  SPLASH_MARK="# Agregado por XaraokeURL: sin la pantalla de colores al encender"
  [ -f "$CONFIG_TXT.xaraoke.bak" ] || cp "$CONFIG_TXT" "$CONFIG_TXT.xaraoke.bak"
  if [ "$BOOT_SPLASH" != "true" ]; then
    sed -i "/^$SPLASH_MARK\$/,+2d" "$CONFIG_TXT"
  elif ! grep -qE '^[[:space:]]*disable_splash=1' "$CONFIG_TXT"; then
    [ -z "$(tail -c1 "$CONFIG_TXT")" ] || echo >> "$CONFIG_TXT"
    printf '%s\n[all]\ndisable_splash=1\n' "$SPLASH_MARK" >> "$CONFIG_TXT"
  fi

  # --- Logo mientras arranca (Plymouth) -----------------------------------------
  # Plymouth dibuja el logo desde el initramfs, casi desde que se enciende, hasta
  # que el kiosko toma la pantalla: install-kiosk.sh le pide que se quite dejando
  # la imagen, para que no quede un negro en medio. Con BOOT_SPLASH=false basta
  # con quitar "splash" del cmdline (arriba); el tema se queda instalado.
  if [ "$BOOT_SPLASH" = "true" ]; then
    echo "==> Instalando el logo de arranque (Plymouth)"
    initramfs_stale=false
    # Copia src en dest solo si cambió, y anota que hay que regenerar el initramfs.
    install_theme_file() {
      if ! cmp -s "$1" "$2"; then
        install -D -m 644 "$1" "$2"
        initramfs_stale=true
      fi
    }
    tmp="$(mktemp)"
    if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/../public/img/icon-512.png" ]; then
      cp "$SCRIPT_DIR/../public/img/icon-512.png" "$tmp"
    else
      curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors "https://raw.githubusercontent.com/Xalcker/XaraokeURL/$XARAOKE_REF/public/img/icon-512.png" -o "$tmp"
    fi
    install_theme_file "$tmp" "$PLYMOUTH_THEME_DIR/logo.png"

    cat > "$tmp" <<EOF
[Plymouth Theme]
Name=XaraokeURL
Description=El logo de XaraokeURL mientras arranca la pantalla
ModuleName=script

[script]
ImageDir=$PLYMOUTH_THEME_DIR
ScriptFile=$PLYMOUTH_THEME_DIR/xaraoke.script
EOF
    install_theme_file "$tmp" "$PLYMOUTH_THEME_DIR/xaraoke.plymouth"

    # logo.png es public/img/icon-512.png: el logo sobre el fondo de la marca (#171124),
    # así que pintando la pantalla de ese color no se nota el cuadro del ícono.
    cat > "$tmp" <<'EOF'
# El logo queda del mismo tamaño y en el mismo lugar que el de "Conectando…" del
# reproductor nativo (player/lib/screen.js): 150/720 del alto, empezando en 170/720.
# En logo.png el trazo mide 270 px de alto, empieza en y=113 y se centra en x=271.
Window.SetBackgroundTopColor(0.0902, 0.0667, 0.1412);
Window.SetBackgroundBottomColor(0.0902, 0.0667, 0.1412);

scale = Window.GetHeight() * 150 / (720 * 270);
logo.image = Image("logo.png");
logo.image = logo.image.Scale(Math.Int(512 * scale), Math.Int(512 * scale));
logo.sprite = Sprite(logo.image);
logo.sprite.SetX(Window.GetX() + Window.GetWidth() / 2 - 271 * scale);
logo.sprite.SetY(Window.GetY() + Window.GetHeight() * 170 / 720 - 113 * scale);
EOF
    install_theme_file "$tmp" "$PLYMOUTH_THEME_DIR/xaraoke.script"
    rm -f "$tmp"

    # El hook de initramfs de Plymouth copia /etc/fonts/fonts.conf y llama a fc-match y fc-cache,
    # todo del paquete fontconfig. Raspberry Pi OS Lite no lo trae (en la Pi con servidor llega
    # con ffmpeg), así que en una Pi Zero 2 W recién instalada update-initramfs fallaba.
    if ! dpkg -s plymouth >/dev/null 2>&1 || ! dpkg -s fontconfig >/dev/null 2>&1; then
      apt-get install -y --no-install-recommends plymouth fontconfig
      initramfs_stale=true
    fi
    if [ "$(plymouth-set-default-theme)" != "xaraoke" ]; then
      plymouth-set-default-theme xaraoke
      initramfs_stale=true
    fi
    # El tema va dentro del initramfs, para que el logo salga desde el principio.
    # De todos los kernels instalados, no solo el que corre ahora: tras el full-upgrade de arriba,
    # el kernel que arrancará es el nuevo y "uname -r" todavía apunta al viejo, así que el
    # initramfs con el logo se generaba para un kernel que ya no se usa.
    # No basta con fiarse de "initramfs_stale": si se repite el script tras una corrida que se cortó, o
    # apt regeneró el initramfs por su cuenta (al instalar plymouth) antes de fijar el tema, la bandera
    # queda en falso y el initramfs se queda sin el logo (pasó en una Pi Zero 2 W: gris con puntos).
    # Por eso se mira también el contenido real de cada initramfs.
    theme_in_initramfs() {
      local f
      for f in /boot/initrd.img-*; do
        [ -e "$f" ] || continue
        lsinitramfs "$f" 2>/dev/null | grep -q 'themes/xaraoke/xaraoke.script' || return 1
      done
    }
    if [ "$initramfs_stale" = "true" ] || ! theme_in_initramfs; then
      echo "==> Regenerando el initramfs con el logo (en una Pi Zero 2 W tarda unos minutos)"
      # Si falla, update-initramfs deja el initramfs anterior: se avisa abajo y la instalación sigue.
      update-initramfs -u -k all || true
    fi
    theme_in_initramfs || warn "El initramfs no quedó con el tema del logo: el arranque mostrará el de emergencia (gris con puntos)."
  fi

  # --- Wi-Fi sin ahorro de energía ----------------------------------------------
  # El ahorro de energía del Wi-Fi del Pi duerme la antena entre paquetes: el
  # WebSocket con el servidor se corta y el video tartamudea.
  if [ -d /etc/NetworkManager/conf.d ]; then
    echo "==> Desactivando el ahorro de energía del Wi-Fi"
    printf '[connection]\nwifi.powersave = 2\n' > "$NM_WIFI_CONF"
    systemctl reload NetworkManager 2>/dev/null || true
  fi

  # --- Nombre del equipo --------------------------------------------------------
  if [ -n "$KIOSK_HOSTNAME" ]; then
    echo "==> Cambiando el nombre del equipo a $KIOSK_HOSTNAME"
    raspi-config nonint do_hostname "$KIOSK_HOSTNAME"
  fi

  # --- Kiosko (cage + Chromium + systemd) ---------------------------------------
  # Se guarda una copia fija del instalador para poder desinstalar después con
  # "sudo xaraoke-install-kiosk.sh --uninstall", aunque se haya corrido vía curl.
  if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/install-kiosk.sh" ]; then
    install -m 755 "$SCRIPT_DIR/install-kiosk.sh" "$KIOSK_INSTALLER"
  else
    echo "==> Descargando install-kiosk.sh ($XARAOKE_REF)"
    tmp="$(mktemp)"
    curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors "https://raw.githubusercontent.com/Xalcker/XaraokeURL/$XARAOKE_REF/scripts/install-kiosk.sh" -o "$tmp"
    install -m 755 "$tmp" "$KIOSK_INSTALLER"
    rm -f "$tmp"
  fi

  echo "==> Instalando el kiosko"
  # Si este script corre desde el repo clonado, el reproductor nativo se copia de ahí.
  PLAYER_SRC=""
  if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/../player/xaraoke-player.js" ]; then
    PLAYER_SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
  fi
  KIOSK_URL="$KIOSK_URL" KIOSK_PLAYER="$KIOSK_PLAYER" PLAYER_SRC_DIR="$PLAYER_SRC" XARAOKE_REF="$XARAOKE_REF" \
    INSTALL_NODE_SERVICE="$INSTALL_NODE_SERVICE" APP_DIR="$APP_DIR" "$KIOSK_INSTALLER"

  # --- Comprobación del servidor ------------------------------------------------
  if curl -fsS -m 5 -o /dev/null "$KIOSK_URL" 2>/dev/null; then
    echo "==> El servidor responde en $KIOSK_URL"
  else
    warn "El servidor no responde ahora en $KIOSK_URL. No es grave si está apagado, pero revisa la"
    warn "IP y el puerto: el kiosko va a mostrar un error de conexión hasta que responda."
  fi

  # --- Solo lectura (opcional, al final porque congela todo lo anterior) ---------
  if [ "$READ_ONLY" = "true" ]; then
    echo "==> Activando el sistema de archivos de solo lectura (overlayfs)"
    raspi-config nonint do_overlayfs 0
  fi

  cat <<EOF

✅ Listo. El Pi va a abrir $KIOSK_URL a pantalla completa al encender.

Para desinstalar el kiosko:  sudo $KIOSK_INSTALLER --uninstall
Logs si algo falla:          journalctl -u xaraoke-kiosk.service -f
Respaldos de arranque:       $CONFIG_TXT.xaraoke.bak, $CMDLINE_TXT.xaraoke.bak
EOF

  if [ "$REBOOT" = "true" ]; then
    echo "Reiniciando..."
    reboot
  else
    echo
    echo "Reinicia para aplicar todo:  sudo reboot"
  fi
}

main "$@"
