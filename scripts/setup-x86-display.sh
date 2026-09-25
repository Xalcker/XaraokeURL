#!/usr/bin/env bash
set -euo pipefail

# Convierte una instalación limpia de Debian 13 (sin escritorio) en un miniPC x86 en una pantalla
# dedicada de XaraokeURL: al encender, abre la sala a pantalla completa por HDMI (video y audio),
# con el logo de XaraokeURL en el arranque y sin menú de GRUB ni textos de Linux.
#
# Hace la parte propia del x86 (sistema al día, fuentes, logo de arranque con Plymouth y GRUB
# silencioso) y luego delega el kiosko en sí a scripts/install-kiosk.sh. Igual que en el Raspberry Pi,
# el servidor (Node, la app y el .env) se instala antes a mano si va en este mismo equipo: ver
# docs/kiosko-x86.md.
#
# Uso, con el repo clonado:
#   sudo ./scripts/setup-x86-display.sh http://localhost:8081/
#
# O directo, sin clonar nada:
#   curl -fsSL https://raw.githubusercontent.com/Xalcker/XaraokeURL/main/scripts/setup-x86-display.sh \
#     | sudo INSTALL_NODE_SERVICE=true bash -s -- http://localhost:8081/
#
# Variables de entorno (todas opcionales):
#   KIOSK_URL       URL del servidor (también se puede pasar como primer argumento)
#   KIOSK_PLAYER    chromium o mpv (chromium). Ver install-kiosk.sh.
#   KIOSK_HOSTNAME  Nombre del equipo en la red (p. ej. "xaraoke-tv"). Sin cambios si no se da.
#   BOOT_SPLASH     "false" para ver el menú de GRUB y los mensajes de Linux al arrancar (útil para
#                   depurar) y quitar lo que puso una corrida anterior. Por defecto se ocultan y el
#                   TV muestra el logo (Plymouth) desde que enciende hasta que aparece la sala.
#   SKIP_UPGRADE    "true" para no correr apt full-upgrade (más rápido, menos recomendable).
#   INSTALL_NODE_SERVICE  "true" para que el servidor corra en este mismo equipo (servicio systemd que
#                   ejecuta "node server.js" desde APP_DIR). La app tiene que estar ya instalada
#                   ahí (Node, "npm ci" y el .env); este script no la instala.
#   APP_DIR         Carpeta de la app si INSTALL_NODE_SERVICE=true (/opt/xaraoke).
#   REBOOT          "true" para reiniciar solo al terminar.
#   XARAOKE_REF     Rama/tag de GitHub de donde bajar install-kiosk.sh si no está junto a este
#                   script (main).

# Todo va dentro de main() para que bash lea el script completo antes de ejecutarlo:
# con "curl | sudo bash", un comando que leyera stdin (apt) se comería el resto del script.
main() {
  KIOSK_URL="${1:-${KIOSK_URL:-}}"
  KIOSK_PLAYER="${KIOSK_PLAYER:-chromium}"
  KIOSK_HOSTNAME="${KIOSK_HOSTNAME:-}"
  BOOT_SPLASH="${BOOT_SPLASH:-true}"
  SKIP_UPGRADE="${SKIP_UPGRADE:-false}"
  REBOOT="${REBOOT:-false}"
  XARAOKE_REF="${XARAOKE_REF:-main}"
  INSTALL_NODE_SERVICE="${INSTALL_NODE_SERVICE:-false}"
  APP_DIR="${APP_DIR:-/opt/xaraoke}"

  KIOSK_INSTALLER=/usr/local/sbin/xaraoke-install-kiosk.sh
  PLYMOUTH_THEME_DIR=/usr/share/plymouth/themes/xaraoke
  PLYMOUTH_CONF=/etc/plymouth/plymouthd.conf
  GRUB_DROPIN=/etc/default/grub.d/99-xaraoke.cfg
  # Vacío si el script llegó por "curl | bash": entonces lo que falte se baja de GitHub.
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"

  warn() { echo "⚠️  $*" >&2; }
  die() { echo "❌ $*" >&2; exit 1; }

  if [ "$(id -u)" -ne 0 ]; then
    die "Este script necesita ejecutarse como root (sudo)."
  fi

  # --- ¿Es un x86 con Debian/Ubuntu? --------------------------------------------
  MODEL="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || true)"
  case "$MODEL" in
    *"Raspberry Pi"*) die "Esto es un Raspberry Pi ($MODEL). Usa scripts/setup-raspberry-display.sh." ;;
  esac
  command -v apt-get >/dev/null 2>&1 || die "Este script asume Debian o Ubuntu (necesita apt-get)."
  ARCH="$(dpkg --print-architecture)"
  [ "$ARCH" = "amd64" ] || die "Este script es para x86 de 64 bits (amd64); este equipo es $ARCH."

  DISTRO="$(sed -n 's/^PRETTY_NAME="\(.*\)"$/\1/p' /etc/os-release 2>/dev/null || true)"
  DISTRO="${DISTRO:-desconocida}"
  RAM_MB="$(awk '/MemTotal/ {print int($2 / 1024)}' /proc/meminfo)"
  echo "==> Equipo: $DISTRO, ${RAM_MB} MB de RAM, $ARCH"
  if [ -f /etc/os-release ] && grep -qi '^ID=ubuntu' /etc/os-release && [ "$KIOSK_PLAYER" = "chromium" ]; then
    warn "En Ubuntu 'chromium' es un paquete snap, que con cage suele dar problemas de permisos."
    warn "La guía recomienda Debian 13; en Ubuntu puede que tengas que resolverlo a mano."
  fi

  # --- URL del servidor ---------------------------------------------------------
  if [ -z "$KIOSK_URL" ]; then
    if [ -t 0 ]; then
      read -rp "URL del servidor XaraokeURL (p. ej. http://localhost:8081/): " KIOSK_URL
    else
      die "Falta la URL del servidor. Pásala como argumento: ... | sudo bash -s -- http://localhost:8081/"
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

  # --- Sistema al día -----------------------------------------------------------
  export DEBIAN_FRONTEND=noninteractive
  echo "==> Actualizando índice de paquetes"
  apt-get update -qq
  if [ "$SKIP_UPGRADE" != "true" ]; then
    echo "==> Actualizando el sistema (puede tardar varios minutos en una instalación nueva)"
    apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold full-upgrade
  fi

  # Una instalación sin escritorio trae muy pocas fuentes: sin estas, los títulos con emojis o
  # acentos raros se ven como cuadritos.
  echo "==> Instalando fuentes"
  apt-get install -y --no-install-recommends fonts-dejavu-core fonts-noto-color-emoji curl

  # --- Logo mientras arranca (Plymouth) -----------------------------------------
  # Plymouth dibuja el logo desde el initramfs, casi desde que se enciende, hasta que el kiosko toma
  # la pantalla: install-kiosk.sh le pide que se quite dejando la imagen, para que no quede un negro
  # en medio. Tiene que quedar instalado ANTES de correr install-kiosk.sh, que solo enlaza el logo con
  # la sala si encuentra Plymouth.
  initramfs_stale=false
  theme_in_initramfs() {
    local f
    for f in /boot/initrd.img-*; do
      [ -e "$f" ] || continue
      lsinitramfs "$f" 2>/dev/null | grep -q 'themes/xaraoke/xaraoke.script' || return 1
    done
  }
  # En Ubuntu 26.04 el paquete plymouth ya no trae plymouth-set-default-theme: el tema se fija en
  # plymouthd.conf, que es lo que ese comando hace de todos modos.
  current_plymouth_theme() {
    if command -v plymouth-set-default-theme >/dev/null 2>&1; then
      plymouth-set-default-theme
    else
      sed -n 's/^Theme=//p' "$PLYMOUTH_CONF" 2>/dev/null | tail -n1
    fi
  }
  set_plymouth_theme() {
    if command -v plymouth-set-default-theme >/dev/null 2>&1; then
      plymouth-set-default-theme xaraoke
      return
    fi
    mkdir -p "$(dirname "$PLYMOUTH_CONF")"
    touch "$PLYMOUTH_CONF"
    sed -i '/^Theme=/d' "$PLYMOUTH_CONF"
    if grep -q '^\[Daemon\]' "$PLYMOUTH_CONF"; then
      sed -i '/^\[Daemon\]/a Theme=xaraoke' "$PLYMOUTH_CONF"
    else
      printf '\n[Daemon]\nTheme=xaraoke\n' >> "$PLYMOUTH_CONF"
    fi
  }

  if [ "$BOOT_SPLASH" = "true" ]; then
    echo "==> Instalando el logo de arranque (Plymouth)"
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

    # Mismo tema que setup-raspberry-display.sh: logo.png es public/img/icon-512.png, el logo sobre el
    # fondo de la marca (#171124), así que pintando la pantalla de ese color no se nota el cuadro.
    cat > "$tmp" <<'EOF'
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

    if ! dpkg -s plymouth >/dev/null 2>&1; then
      apt-get install -y --no-install-recommends plymouth
      initramfs_stale=true
    fi
    if [ "$(current_plymouth_theme)" != "xaraoke" ]; then
      set_plymouth_theme
      initramfs_stale=true
    fi
  fi

  # --- GRUB silencioso ----------------------------------------------------------
  # Sin menú, sin los mensajes de Linux y con el logo. Va en un archivo aparte
  # (/etc/default/grub.d/), que update-grub lee después de /etc/default/grub y le gana, así que no se
  # toca el archivo original y BOOT_SPLASH=false lo deshace quitando ese archivo. En una consola
  # normal, los mensajes que quedan salen en tty3 (Ctrl+Alt+F3); SSH sigue igual.
  if command -v update-grub >/dev/null 2>&1; then
    if [ "$BOOT_SPLASH" = "true" ]; then
      echo "==> Ocultando el menú de GRUB y los textos de arranque"
      mkdir -p "$(dirname "$GRUB_DROPIN")"
      cat > "$GRUB_DROPIN" <<'EOF'
# Instalado por XaraokeURL (setup-x86-display.sh): arranque limpio para el kiosko.
GRUB_TIMEOUT=0
GRUB_TIMEOUT_STYLE=hidden
GRUB_RECORDFAIL_TIMEOUT=0
GRUB_GFXPAYLOAD_LINUX=keep
GRUB_CMDLINE_LINUX_DEFAULT="quiet splash plymouth.ignore-serial-consoles loglevel=3 logo.nologo vt.global_cursor_default=0 systemd.show_status=false rd.udev.log_level=3 console=tty3"
EOF
    else
      echo "==> Dejando visibles el menú de GRUB y los textos de arranque (BOOT_SPLASH=false)"
      rm -f "$GRUB_DROPIN"
    fi
  else
    warn "No encontré update-grub: este equipo no arranca con GRUB. El kiosko funciona igual, pero el"
    warn "arranque limpio (sin menú ni textos) hay que dejarlo a mano en tu gestor de arranque."
  fi

  # El tema va dentro del initramfs, para que el logo salga desde el principio, y en el de todos los
  # kernels instalados, no solo el que corre ahora: tras el full-upgrade de arriba, el kernel que
  # arrancará es el nuevo y "uname -r" todavía apunta al viejo. No basta con fiarse de
  # "initramfs_stale": si se repite el script tras una corrida que se cortó, o apt regeneró el
  # initramfs por su cuenta antes de fijar el tema, la bandera queda en falso y el initramfs se queda
  # sin el logo. Por eso se mira también el contenido real de cada initramfs.
  if [ "$BOOT_SPLASH" = "true" ]; then
    if [ "$initramfs_stale" = "true" ] || ! theme_in_initramfs; then
      echo "==> Regenerando el initramfs con el logo"
      update-initramfs -u -k all
    fi
    theme_in_initramfs || warn "El initramfs no quedó con el tema del logo: el arranque mostrará el de emergencia (gris con puntos)."
  fi
  if command -v update-grub >/dev/null 2>&1; then
    update-grub
  fi

  # --- Nombre del equipo --------------------------------------------------------
  if [ -n "$KIOSK_HOSTNAME" ]; then
    echo "==> Cambiando el nombre del equipo a $KIOSK_HOSTNAME"
    hostnamectl set-hostname "$KIOSK_HOSTNAME"
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
    warn "El servidor no responde ahora en $KIOSK_URL. No es grave si está apagado o acaba de arrancar,"
    warn "pero revisa la IP y el puerto: el kiosko va a mostrar un error de conexión hasta que responda."
  fi

  cat <<EOF

✅ Listo. El equipo va a abrir $KIOSK_URL a pantalla completa al encender.

Para desinstalar el kiosko:  sudo $KIOSK_INSTALLER --uninstall
Logs si algo falla:          journalctl -u xaraoke-kiosk.service -f
Para ver GRUB otra vez:      vuelve a correr este script con BOOT_SPLASH=false
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
