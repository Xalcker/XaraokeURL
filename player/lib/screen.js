// Lo que se ve en pantalla, como texto ASS (el formato de subtítulos que mpv dibuja encima del video
// con osd-overlay) más la posición del QR. Son funciones puras: reciben el estado y devuelven qué
// dibujar, sin tocar mpv, para poder probarlas.
//
// Las coordenadas del texto son de un lienzo virtual de 1280×720 que mpv escala a la pantalla. Las
// del QR van en fracciones de la pantalla, porque overlay-add trabaja en píxeles reales.
//
// Los colores son los de public/css/tokens.css. ASS los escribe al revés (&HBBGGRR&): usa assColor().

const WIDTH = 1280;
const HEIGHT = 720;
const MARGIN = 28;

const COLORS = {
  accent: "#49d6d8",
  brandDark: "#171124",
  textMuted: "#b3b3b3",
  white: "#ffffff",
  // El degradado de fondo de las pantallas (--bg-gradient).
  glowPurple: "#4e1f70",
  glowBlue: "#142142",
  glowDeep: "#1f0c2e",
};

// Tamaño y posición del QR, en fracciones del alto (tamaño) y de la pantalla (posición).
const QR_IDLE = { size: 0.44, centerX: 0.5, top: 0.22 };
const QR_CORNER = { size: 0.2, right: MARGIN / WIDTH, bottom: MARGIN / HEIGHT };

// El logo durante una canción: arriba a la derecha y semitransparente, para no competir con el video.
const LOGO_PLAYING = { height: 64, opacity: 0.6 };
const LOGO_IDLE = { height: 88, top: 14 };
const LOGO_MESSAGE = { height: 150, top: 170 };

const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

// Lo que escriben las personas (nombres, títulos de YouTube) no puede colarse como órdenes de ASS:
// una llave abre un bloque de estilo y la barra invertida, secuencias como \N. Es el mismo escape que
// usa mpv en sus propios scripts.
function assEscape(text) {
  return String(text ?? "")
    .replace(/\\/g, `\\${ZERO_WIDTH_SPACE}`)
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\s+/g, " ")
    .trim();
}

// "#49d6d8" → "&HD8D649&" (ASS escribe los colores en orden azul, verde, rojo).
function assColor(hex) {
  const [, r, g, b] = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return `&H${b}${g}${r}&`.toUpperCase();
}

// Opacidad de 0 a 1 → alfa de ASS ("&H00&" es opaco, "&HFF&" invisible).
function assAlpha(opacity) {
  const value = Math.round((1 - Math.min(1, Math.max(0, opacity))) * 255);
  return `&H${value.toString(16).padStart(2, "0").toUpperCase()}&`;
}

// Texto con borde negro: se lee sobre cualquier video.
const style = (size, { bold = false, color = COLORS.white } = {}) =>
  `\\fs${size}\\b${bold ? 1 : 0}\\bord3\\shad0\\3c&H000000&\\1c${assColor(color)}`;

const line = (x, y, align, text) => `{\\an${align}\\pos(${Math.round(x)},${Math.round(y)})}${text}`;

// Una figura rellena. `drawing` usa los comandos de dibujo de ASS (m, l, b). Con `outline`, lleva un
// contorno oscuro y translúcido, para que se distinga sobre un video claro.
const shape = (drawing, { color, opacity = 1, blur = 0, x = 0, y = 0, scale = 100, outline = false }) =>
  `{\\an7\\pos(${Math.round(x)},${Math.round(y)})\\fscx${scale}\\fscy${scale}` +
  `${outline ? `\\bord2\\3c&H000000&\\3a${assAlpha(0.45)}` : "\\bord0"}\\shad0` +
  `${blur ? `\\blur${blur}` : ""}\\1c${assColor(color)}\\1a${assAlpha(opacity)}\\p1}${drawing}{\\p0}`;

// Una elipse con cuatro curvas de Bézier (la aproximación de siempre, con k ≈ 0,5523).
function ellipse(cx, cy, rx, ry) {
  const kx = Math.round(rx * 0.5523);
  const ky = Math.round(ry * 0.5523);
  const r = Math.round;
  return (
    `m ${r(cx)} ${r(cy - ry)} ` +
    `b ${r(cx + kx)} ${r(cy - ry)} ${r(cx + rx)} ${r(cy - ky)} ${r(cx + rx)} ${r(cy)} ` +
    `b ${r(cx + rx)} ${r(cy + ky)} ${r(cx + kx)} ${r(cy + ry)} ${r(cx)} ${r(cy + ry)} ` +
    `b ${r(cx - kx)} ${r(cy + ry)} ${r(cx - rx)} ${r(cy + ky)} ${r(cx - rx)} ${r(cy)} ` +
    `b ${r(cx - rx)} ${r(cy - ky)} ${r(cx - kx)} ${r(cy - ry)} ${r(cx)} ${r(cy - ry)}`
  );
}

// El fondo de las pantallas sin video: el morado oscuro de la marca con dos resplandores difusos,
// a la manera del degradado de la pantalla web (ASS no tiene degradados; el desenfoque lo imita).
function backgroundLines() {
  const full = `m 0 0 l ${WIDTH} 0 l ${WIDTH} ${HEIGHT} l 0 ${HEIGHT}`;
  return [
    shape(full, { color: COLORS.brandDark }),
    shape(ellipse(180, 120, 520, 360), { color: COLORS.glowPurple, opacity: 0.55, blur: 60 }),
    shape(ellipse(1120, 640, 560, 340), { color: COLORS.glowBlue, opacity: 0.7, blur: 60 }),
    shape(ellipse(1180, 40, 300, 200), { color: COLORS.glowDeep, opacity: 0.6, blur: 50 }),
  ];
}

// El logo (el dibujo de svgPath.logoDrawing) con su esquina superior izquierda en (x, y).
function logoLine(logo, { x, y, height, opacity = 1, outline = false }) {
  const scale = Math.round((height / logo.height) * 10000) / 100;
  return shape(logo.drawing, { color: COLORS.accent, opacity, x, y, scale, outline });
}
const logoWidth = (logo, height) => (logo.width / logo.height) * height;

// Un título larguísimo pasaría por debajo del QR de la esquina: se recorta antes de escapar, para no
// partir una secuencia de escape por la mitad.
function clip(text, max) {
  const chars = [...String(text ?? "").replace(/\s+/g, " ").trim()];
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : chars.join("");
}

function songLine(item, songDisplay, max = 60) {
  const { artist, songTitle } = songDisplay(item);
  return assEscape(clip(`${artist} — ${songTitle}`, max));
}

// "Sala: " en blanco y el código en el turquesa de la marca, como en la pantalla web.
function roomCode(t, roomId) {
  return `${assEscape(t("host.room"))} {\\1c${assColor(COLORS.accent)}}${assEscape(roomId)}`;
}

// Quién canta arriba a la izquierda; quién sigue abajo a la izquierda; el QR abajo a la derecha, con
// el código de sala encima, y el logo arriba a la derecha. La letra de los karaokes suele ir al
// centro, lejos de las esquinas.
function playingLines({ queue, roomId, paused, t, songDisplay, qrShown, logo }) {
  const [current, next] = queue;
  const lines = [];
  const left = MARGIN;
  lines.push(line(left, MARGIN, 7, `{${style(22, { color: "#d0d0d0" })}}${assEscape(t("host.nowPlaying"))}`));
  lines.push(line(left, MARGIN + 26, 7, `{${style(38, { bold: true })}}${assEscape(clip(current.name, 30))}`));
  lines.push(line(left, MARGIN + 70, 7, `{${style(24)}}${songLine(current, songDisplay)}`));
  if (next) {
    const upNext = `${assEscape(t("host.upNext"))}: {\\b1}${assEscape(clip(next.name, 24))}{\\b0} · ${songLine(next, songDisplay, 45)}`;
    lines.push(line(left, HEIGHT - MARGIN, 1, `{${style(22, { color: "#d0d0d0" })}}${upNext}`));
  }

  // El código de sala, sobre el QR (o solo en la esquina, si el QR no está disponible).
  const codeY = qrShown ? HEIGHT - MARGIN - QR_CORNER.size * HEIGHT - 6 : HEIGHT - MARGIN;
  const codeX = WIDTH - MARGIN - (qrShown ? (QR_CORNER.size * HEIGHT) / 2 : 0);
  const codeAlign = qrShown ? 2 : 3;
  lines.push(line(codeX, codeY, codeAlign, `{${style(26, { bold: true })}}${roomCode(t, roomId)}`));

  if (logo) {
    const { height, opacity } = LOGO_PLAYING;
    lines.push(logoLine(logo, { x: WIDTH - MARGIN - logoWidth(logo, height), y: MARGIN, height, opacity, outline: true }));
  }

  if (paused) {
    lines.push(line(WIDTH / 2, HEIGHT / 2, 5, `{${style(64, { bold: true })}}${assEscape(t("host.paused"))}`));
  }
  return lines;
}

// Sin canciones: el logo, el QR grande con el código de sala debajo y cómo entrar sin QR, sobre el
// fondo de la marca, como la pantalla de espera del navegador.
function idleLines({ roomId, remoteUrl, t, qrShown, logo }) {
  const lines = backgroundLines();
  let titleY = 60;
  if (logo) {
    const { height, top } = LOGO_IDLE;
    lines.push(logoLine(logo, { x: WIDTH / 2 - logoWidth(logo, height) / 2, y: top, height }));
    titleY = top + height + 8;
  }
  lines.push(line(WIDTH / 2, titleY, 8, `{${style(38, { bold: true })}}${assEscape(t("host.idle.title"))}`));
  const codeY = qrShown ? Math.round((QR_IDLE.top + QR_IDLE.size) * HEIGHT) + 14 : HEIGHT / 2 - 40;
  lines.push(line(WIDTH / 2, codeY, 8, `{${style(72, { bold: true, color: COLORS.accent })}\\fsp18}${assEscape(roomId)}`));
  if (remoteUrl) {
    const shown = String(remoteUrl).replace(/^https?:\/\//, "");
    lines.push(line(WIDTH / 2, HEIGHT - MARGIN, 2, `{${style(24, { color: COLORS.textMuted })}}${assEscape(t("host.idle.hint", { url: shown }))}`));
  }
  return lines;
}

// Un aviso centrado, sin QR (conectando, o esta pantalla ya no controla la sala), con el logo grande.
function messageLines(text, logo) {
  const lines = backgroundLines();
  let textY = HEIGHT / 2;
  if (logo) {
    const { height, top } = LOGO_MESSAGE;
    lines.push(logoLine(logo, { x: WIDTH / 2 - logoWidth(logo, height) / 2, y: top, height }));
    textY = top + height + 60;
  }
  lines.push(line(WIDTH / 2, textY, 8, `{${style(34, { bold: true })}}${assEscape(text)}`));
  return lines;
}

// state: { status: "connecting" | "replaced" | "room", serverUrl, roomId, remoteUrl, queue, paused, qrAvailable }
// logo: el dibujo de svgPath.logoDrawing ({ drawing, width, height }), o null si no se pudo leer.
// Devuelve { ass, qr }, con qr = null (sin QR) o { size, centerX, top } / { size, right, bottom }.
function buildScreen(state, { t, songDisplay, logo = null }) {
  if (state.status === "connecting") {
    return { ass: messageLines(t("player.connecting", { url: state.serverUrl }), logo).join("\n"), qr: null };
  }
  if (state.status === "replaced") {
    return { ass: messageLines(t("player.replaced"), logo).join("\n"), qr: null };
  }
  const queue = state.queue ?? [];
  const qrShown = !!state.qrAvailable;
  if (queue.length === 0) {
    return { ass: idleLines({ ...state, t, qrShown, logo }).join("\n"), qr: qrShown ? QR_IDLE : null };
  }
  return {
    ass: playingLines({ ...state, queue, t, songDisplay, qrShown, logo }).join("\n"),
    qr: qrShown ? QR_CORNER : null,
  };
}

// Pasa la posición del QR a píxeles de la pantalla real.
function qrPixels(qr, screenWidth, screenHeight) {
  const size = Math.max(16, Math.round(qr.size * screenHeight));
  const top = qr.bottom !== undefined
    ? Math.round(screenHeight - qr.bottom * screenHeight - size)
    : Math.round(qr.top * screenHeight);
  const left = qr.centerX !== undefined
    ? Math.round(qr.centerX * screenWidth - size / 2)
    : Math.round(screenWidth - qr.right * screenWidth - size);
  return { size, left, top };
}

module.exports = { buildScreen, qrPixels, assEscape, assColor, assAlpha, WIDTH, HEIGHT, COLORS };
