// Lo que se ve en pantalla, como texto ASS (el formato de subtítulos que mpv dibuja encima del video
// con osd-overlay) más la posición del QR. Son funciones puras: reciben el estado y devuelven qué
// dibujar, sin tocar mpv, para poder probarlas.
//
// Las coordenadas del texto son de un lienzo virtual de 1280×720 que mpv escala a la pantalla. Las
// del QR van en fracciones de la pantalla, porque overlay-add trabaja en píxeles reales.

const WIDTH = 1280;
const HEIGHT = 720;
const MARGIN = 28;

// Tamaño y posición del QR, en fracciones del alto (tamaño) y de la pantalla (posición).
const QR_IDLE = { size: 0.46, centerX: 0.5, top: 0.2 };
const QR_CORNER = { size: 0.2, right: MARGIN / WIDTH, top: MARGIN / HEIGHT };

// Lo que escriben las personas (nombres, títulos de YouTube) no puede colarse como órdenes de ASS:
// una llave abre un bloque de estilo y la barra invertida, secuencias como \N. Es el mismo escape que
// usa mpv en sus propios scripts.
function assEscape(text) {
  return String(text ?? "")
    .replace(/\\/g, "\\​")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\s+/g, " ")
    .trim();
}

// Texto con borde negro: se lee sobre cualquier video.
const style = (size, { bold = false, color = "FFFFFF" } = {}) =>
  `\\fs${size}\\b${bold ? 1 : 0}\\bord3\\shad0\\3c&H000000&\\1c&H${color}&`;

const line = (x, y, align, text) => `{\\an${align}\\pos(${x},${y})}${text}`;

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

// Quién canta, quién sigue y el código de sala bajo el QR de la esquina. Todo arriba: la letra de los
// karaokes suele ir en el centro y abajo.
function playingLines({ queue, roomId, paused, t, songDisplay, qrShown }) {
  const [current, next] = queue;
  const lines = [];
  const left = MARGIN;
  lines.push(line(left, MARGIN, 7, `{${style(22, { color: "D0D0D0" })}}${assEscape(t("host.nowPlaying"))}`));
  lines.push(line(left, MARGIN + 26, 7, `{${style(38, { bold: true })}}${assEscape(clip(current.name, 30))}`));
  lines.push(line(left, MARGIN + 70, 7, `{${style(24)}}${songLine(current, songDisplay)}`));
  if (next) {
    const upNext = `${assEscape(t("host.upNext"))}: {\\b1}${assEscape(clip(next.name, 24))}{\\b0} · ${songLine(next, songDisplay, 45)}`;
    lines.push(line(left, MARGIN + 108, 7, `{${style(22, { color: "D0D0D0" })}}${upNext}`));
  }

  // El código de sala, bajo el QR (o solo, si el QR no está disponible).
  const qrBottom = qrShown ? MARGIN + QR_CORNER.size * HEIGHT + 6 : MARGIN;
  const codeX = WIDTH - MARGIN - (qrShown ? (QR_CORNER.size * HEIGHT) / 2 : 0);
  const codeAlign = qrShown ? 8 : 9;
  lines.push(line(Math.round(codeX), Math.round(qrBottom), codeAlign, `{${style(26, { bold: true })}}${assEscape(`${t("host.room")} ${roomId}`)}`));

  if (paused) {
    lines.push(line(WIDTH / 2, HEIGHT / 2, 5, `{${style(64, { bold: true })}}${assEscape(t("host.paused"))}`));
  }
  return lines;
}

// Sin canciones: el QR grande con el código de sala debajo, como la pantalla de espera del navegador.
function idleLines({ roomId, remoteUrl, t, qrShown }) {
  const lines = [line(WIDTH / 2, 60, 8, `{${style(40, { bold: true })}}${assEscape(t("host.idle.title"))}`)];
  const codeY = qrShown ? Math.round((QR_IDLE.top + QR_IDLE.size) * HEIGHT) + 16 : HEIGHT / 2 - 40;
  lines.push(line(WIDTH / 2, codeY, 8, `{${style(72, { bold: true })}}${assEscape(roomId)}`));
  if (remoteUrl) {
    const shown = String(remoteUrl).replace(/^https?:\/\//, "");
    lines.push(line(WIDTH / 2, HEIGHT - MARGIN, 2, `{${style(24, { color: "D0D0D0" })}}${assEscape(t("host.idle.hint", { url: shown }))}`));
  }
  return lines;
}

// Un aviso centrado, sin QR: conectando, o esta pantalla ya no controla la sala.
function messageLines(text) {
  return [line(WIDTH / 2, HEIGHT / 2, 5, `{${style(36, { bold: true })}}${assEscape(text)}`)];
}

// state: { status: "connecting" | "replaced" | "room", serverUrl, roomId, remoteUrl, queue, paused, qrAvailable }
// Devuelve { ass, qr }, con qr = null (sin QR) o { size, centerX, top } / { size, right, top }.
function buildScreen(state, { t, songDisplay }) {
  if (state.status === "connecting") {
    return { ass: messageLines(t("player.connecting", { url: state.serverUrl })).join("\n"), qr: null };
  }
  if (state.status === "replaced") {
    return { ass: messageLines(t("player.replaced")).join("\n"), qr: null };
  }
  const queue = state.queue ?? [];
  const qrShown = !!state.qrAvailable;
  if (queue.length === 0) {
    return { ass: idleLines({ ...state, t, qrShown }).join("\n"), qr: qrShown ? QR_IDLE : null };
  }
  return {
    ass: playingLines({ ...state, queue, t, songDisplay, qrShown }).join("\n"),
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

module.exports = { buildScreen, qrPixels, assEscape, WIDTH, HEIGHT };
