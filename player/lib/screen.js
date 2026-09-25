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
// Durante una canción, chico y arriba a la derecha: la letra de los karaokes suele ir en la mitad de abajo.
const QR_CORNER = { size: 0.12, right: MARGIN / WIDTH, top: MARGIN / HEIGHT };

// El logo durante una canción: abajo a la derecha y semitransparente, para no competir con el video.
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

// El recuadro semitransparente detrás de un texto: la misma línea, con el relleno invisible y un borde
// oscuro, grueso y difuminado. ASS no sabe medir un texto antes de dibujarlo, pero así el recuadro
// mide justo lo que mide el texto con cualquier fuente, y las líneas contiguas se funden en un panel.
const BACKDROP = `\\1a&HFF&\\bord22\\blur12\\3c&H000000&\\3a${assAlpha(0.6)}\\shad0`;

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

// Quién canta arriba a la izquierda; quién sigue abajo a la izquierda; el QR arriba a la derecha, con
// el código de sala debajo, y el logo abajo a la derecha. La letra de los karaokes suele ir al centro
// o en la mitad de abajo, así que lo que más ocupa va arriba.
function playingLines({ queue, roomId, paused, t, songDisplay, qrShown, logo }) {
  const [current, next] = queue;
  const lines = [];
  const left = MARGIN;
  // Quién canta y quién sigue van sobre un recuadro oscuro, para leerse aunque el video traiga
  // créditos o marcas de agua en esas esquinas. Los recuadros van primero, detrás de todos los textos.
  const info = [
    [left, MARGIN, 7, style(22, { color: "#d0d0d0" }), assEscape(t("host.nowPlaying"))],
    [left, MARGIN + 26, 7, style(38, { bold: true }), assEscape(clip(current.name, 30))],
    [left, MARGIN + 70, 7, style(24), songLine(current, songDisplay)],
  ];
  if (next) {
    const upNext = `${assEscape(t("host.upNext"))}: {\\b1}${assEscape(clip(next.name, 24))}{\\b0} · ${songLine(next, songDisplay, 45)}`;
    info.push([left, HEIGHT - MARGIN, 1, style(22, { color: "#d0d0d0" }), upNext]);
  }
  for (const [x, y, align, tags, text] of info) lines.push(line(x, y, align, `{${tags}${BACKDROP}}${text}`));
  for (const [x, y, align, tags, text] of info) lines.push(line(x, y, align, `{${tags}}${text}`));

  // El código de sala, debajo del QR (o solo en la esquina, si el QR no está disponible).
  const codeY = qrShown ? MARGIN + QR_CORNER.size * HEIGHT + 6 : MARGIN;
  const codeX = WIDTH - MARGIN - (qrShown ? (QR_CORNER.size * HEIGHT) / 2 : 0);
  const codeAlign = qrShown ? 8 : 9;
  lines.push(line(codeX, codeY, codeAlign, `{${style(26, { bold: true })}}${roomCode(t, roomId)}`));

  if (logo) {
    const { height, opacity } = LOGO_PLAYING;
    const y = HEIGHT - MARGIN - height;
    lines.push(logoLine(logo, { x: WIDTH - MARGIN - logoWidth(logo, height), y, height, opacity, outline: true }));
  }

  if (paused) {
    lines.push(line(WIDTH / 2, HEIGHT / 2, 5, `{${style(64, { bold: true })}}${assEscape(t("host.paused"))}`));
  }
  return lines;
}

// Un anillo: la elipse sin relleno, con solo el borde.
const ring = (cx, cy, r, width, opacity) =>
  `{\\an7\\pos(0,0)\\bord${width}\\3c${assColor(COLORS.white)}\\3a${assAlpha(opacity)}\\1a&HFF&\\shad0\\p1}${ellipse(cx, cy, r, r)}{\\p0}`;

// Cuenta regresiva antes de cada canción (SONG_COUNTDOWN_SECONDS), como la "cola de película" del
// cine: fondo gris con viñeta, la cruz de mira, dos anillos y el número grande; debajo, quién canta y
// qué. Tapa el video, que ya está cargado y en pausa en su primer cuadro. Es la misma de la pantalla
// web (#countdown-overlay en host.css), sin la aguja que barre: aquí se dibuja una vez por segundo.
function countdownLines({ queue, countdown, t, songDisplay }) {
  const current = queue[0];
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2 - 60;
  const r = 190;
  const rect = (x, y, w, h) => `m ${x} ${y} l ${x + w} ${y} l ${x + w} ${y + h} l ${x} ${y + h}`;
  const lines = [
    shape(rect(0, 0, WIDTH, HEIGHT), { color: "#1a1a1a" }),
    shape(ellipse(cx, cy, 620, 440), { color: "#5a5a5a", opacity: 0.85, blur: 90 }),
    shape(rect(0, cy - 1, WIDTH, 2), { color: COLORS.white, opacity: 0.35 }),
    shape(rect(cx - 1, 0, 2, HEIGHT), { color: COLORS.white, opacity: 0.35 }),
    shape(ellipse(cx, cy, r, r), { color: "#000000", opacity: 0.25 }),
    ring(cx, cy, r, 6, 0.85),
    ring(cx, cy, r - 24, 4, 0.6),
    line(cx, cy, 5, `{${style(260, { bold: true })}}${countdown.remaining}`),
  ];
  const info = [
    [cy + r + 30, style(20, { color: "#d0d0d0" }), assEscape(t("host.countdown.label"))],
    [cy + r + 54, style(46, { bold: true, color: COLORS.accent }), assEscape(clip(current.name, 30))],
    [cy + r + 108, style(26), songLine(current, songDisplay, 70)],
  ];
  if (countdown.paused) info.push([cy + r + 144, style(24, { bold: true }), assEscape(t("host.paused"))]);
  for (const [y, tags, text] of info) lines.push(line(cx, y, 8, `{${tags}${BACKDROP}}${text}`));
  for (const [y, tags, text] of info) lines.push(line(cx, y, 8, `{${tags}}${text}`));
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

// state: { status: "connecting" | "replaced" | "room", serverUrl, roomId, remoteUrl, queue, paused, qrAvailable,
//          countdown } (countdown: { remaining, paused } mientras corre la cuenta regresiva, o null)
// logo: el dibujo de svgPath.logoDrawing ({ drawing, width, height }), o null si no se pudo leer.
// Devuelve { ass, qr }, con qr = null (sin QR) o { size, centerX, top } / { size, right, top }.
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
  if (state.countdown) {
    return { ass: countdownLines({ ...state, queue, t, songDisplay }).join("\n"), qr: null };
  }
  return {
    ass: playingLines({ ...state, queue, t, songDisplay, qrShown, logo }).join("\n"),
    qr: qrShown ? QR_CORNER : null,
  };
}

// Pasa la posición del QR a píxeles de la pantalla real.
function qrPixels(qr, screenWidth, screenHeight) {
  const size = Math.max(16, Math.round(qr.size * screenHeight));
  const top = Math.round(qr.top * screenHeight);
  const left = qr.centerX !== undefined
    ? Math.round(qr.centerX * screenWidth - size / 2)
    : Math.round(screenWidth - qr.right * screenWidth - size);
  return { size, left, top };
}

module.exports = { buildScreen, qrPixels, assEscape, assColor, assAlpha, WIDTH, HEIGHT, COLORS };
