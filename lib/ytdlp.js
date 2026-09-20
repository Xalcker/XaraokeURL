const { execFile } = require("child_process");

const YTDLP_BIN = process.env.YTDLP_PATH || "yt-dlp";
const SEARCH_TIMEOUT_MS = 20_000;
const METADATA_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_FILESIZE = "200M";

// Selector de formato de la descarga, en orden de preferencia (hasta 720p):
// 1. H.264 (avc1): lo decodifican por hardware casi todos los dispositivos
//    (TVs, Safari/iOS, navegadores sin la extensión de AV1). Con un video de
//    karaoke real de 720p pesó menos que la versión AV1 y la letra se veía
//    igual de nítida.
// 2. Cualquier MP4 de hasta 720p (por ejemplo AV1), si el video no tiene H.264.
// 3. Lo mejor disponible, como último recurso.
const VIDEO_FORMAT = [
  "bestvideo[vcodec^=avc1][height<=720]+bestaudio[ext=m4a]",
  "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]",
  "best[ext=mp4]",
  "best",
].join("/");

// IDs de video de YouTube: siempre 11 caracteres alfanuméricos (+ "-"/"_").
// Se valida ANTES de interpolar en la URL que se le pasa a yt-dlp, como
// defensa adicional aunque execFile ya evita inyección de shell.
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const SEARCH_SUFFIXES = {
  karaoke: "karaoke",
  instrumental: "instrumental",
  pista: "pista",
  // El equivalente en inglés de "pista": el selector ofrece uno u otro según el idioma.
  backing: "backing track",
  none: "",
};

function buildSearchQuery(query, suffix) {
  const extra = Object.prototype.hasOwnProperty.call(SEARCH_SUFFIXES, suffix)
    ? SEARCH_SUFFIXES[suffix]
    : SEARCH_SUFFIXES.karaoke;
  return extra ? `${query} ${extra}` : query;
}

// Devuelve el sufijo si es uno de los válidos (karaoke, instrumental, pista,
// backing, none); si no, null. Sirve para validar lo que manda el cliente antes de guardarlo.
function normalizeSearchSuffix(suffix) {
  return typeof suffix === "string" && Object.prototype.hasOwnProperty.call(SEARCH_SUFFIXES, suffix)
    ? suffix
    : null;
}

function pickThumbnail(entry) {
  if (typeof entry.thumbnail === "string") return entry.thumbnail;
  if (Array.isArray(entry.thumbnails) && entry.thumbnails.length > 0) {
    return entry.thumbnails[entry.thumbnails.length - 1].url || null;
  }
  return null;
}

function parseSearchOutput(stdout) {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((entry) => entry && typeof entry.id === "string")
    .filter((entry) => YOUTUBE_ID_RE.test(entry.id))
    .map((entry) => ({
      id: entry.id,
      title: typeof entry.title === "string" && entry.title ? entry.title : "Sin título",
      channel: entry.channel || entry.uploader || "",
      duration: typeof entry.duration === "number" ? entry.duration : null,
      thumbnail: pickThumbnail(entry),
    }));
}

function execYtdlp(args, { timeout }) {
  return new Promise((resolve, reject) => {
    execFile(
      YTDLP_BIN,
      args,
      { timeout, killSignal: "SIGKILL", maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(stderr?.trim() || err.message));
        }
        resolve(stdout);
      }
    );
  });
}

async function checkYtdlpAvailable() {
  try {
    await execYtdlp(["--version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function searchYoutube(query, { limit = 4, suffix = "karaoke" } = {}) {
  const searchTerm = buildSearchQuery(query, suffix);
  const stdout = await execYtdlp(
    [
      "--no-warnings",
      "--skip-download",
      "--dump-json",
      "--flat-playlist",
      `ytsearch${limit}:${searchTerm}`,
    ],
    { timeout: SEARCH_TIMEOUT_MS }
  );
  return parseSearchOutput(stdout);
}

// Interpreta la salida de `--print %(duration)j --print %(title)j --print
// %(channel)j`: tres líneas, cada una un valor JSON (`354`, `"Título"`, `null`).
// Se pide en JSON porque el texto crudo por una tubería puede salir en la
// página de códigos de Windows y corromper los acentos del título.
function parseVideoInfoOutput(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const valueAt = (index) => {
    try {
      return JSON.parse(lines[index]);
    } catch {
      return null;
    }
  };
  const duration = valueAt(0);
  const title = valueAt(1);
  const channel = valueAt(2);
  return {
    duration: typeof duration === "number" && Number.isFinite(duration) ? duration : null,
    title: typeof title === "string" && title.trim() ? title.trim() : null,
    channel: typeof channel === "string" && channel.trim() ? channel.trim() : null,
  };
}

// Metadatos autoritativos del video (duración, título y canal), consultados
// directo a YouTube: nunca se confía en lo que traiga el cliente ni en el dato
// (posiblemente ausente) del listado de búsqueda en modo flat-playlist.
async function getVideoInfo(videoId) {
  if (!YOUTUBE_ID_RE.test(videoId)) {
    throw new Error("ID de video inválido.");
  }
  const stdout = await execYtdlp(
    [
      "--no-warnings",
      "--skip-download",
      "--print",
      "%(duration)j",
      "--print",
      "%(title)j",
      "--print",
      "%(channel)j",
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    { timeout: METADATA_TIMEOUT_MS }
  );
  return parseVideoInfoOutput(stdout);
}

async function downloadYoutubeVideo(videoId, destPath) {
  if (!YOUTUBE_ID_RE.test(videoId)) {
    throw new Error("ID de video inválido.");
  }
  await execYtdlp(
    [
      "--no-warnings",
      "--no-playlist",
      "-f",
      VIDEO_FORMAT,
      "--merge-output-format",
      "mp4",
      "--max-filesize",
      MAX_FILESIZE,
      "-o",
      destPath,
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    { timeout: DOWNLOAD_TIMEOUT_MS }
  );
}

module.exports = {
  YOUTUBE_ID_RE,
  VIDEO_FORMAT,
  buildSearchQuery,
  normalizeSearchSuffix,
  parseSearchOutput,
  parseVideoInfoOutput,
  checkYtdlpAvailable,
  searchYoutube,
  getVideoInfo,
  downloadYoutubeVideo,
};
