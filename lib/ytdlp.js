const { execFile } = require("child_process");

const YTDLP_BIN = process.env.YTDLP_PATH || "yt-dlp";
const SEARCH_TIMEOUT_MS = 20_000;
const METADATA_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_FILESIZE = "200M";

// IDs de video de YouTube: siempre 11 caracteres alfanuméricos (+ "-"/"_").
// Se valida ANTES de interpolar en la URL que se le pasa a yt-dlp, como
// defensa adicional aunque execFile ya evita inyección de shell.
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const SEARCH_SUFFIXES = {
  karaoke: "karaoke",
  instrumental: "instrumental",
  pista: "pista",
  none: "",
};

function buildSearchQuery(query, suffix) {
  const extra = Object.prototype.hasOwnProperty.call(SEARCH_SUFFIXES, suffix)
    ? SEARCH_SUFFIXES[suffix]
    : SEARCH_SUFFIXES.karaoke;
  return extra ? `${query} ${extra}` : query;
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

// Chequeo autoritativo de duración: nunca confiar en el dato (posiblemente
// ausente o desactualizado) que vino del listado de búsqueda en flat-playlist.
async function getVideoDurationSeconds(videoId) {
  if (!YOUTUBE_ID_RE.test(videoId)) {
    throw new Error("ID de video inválido.");
  }
  const stdout = await execYtdlp(
    [
      "--no-warnings",
      "--skip-download",
      "--print",
      "%(duration)s",
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    { timeout: METADATA_TIMEOUT_MS }
  );
  const duration = Number(stdout.trim());
  return Number.isFinite(duration) ? duration : null;
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
      "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4]/best",
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
  buildSearchQuery,
  parseSearchOutput,
  checkYtdlpAvailable,
  searchYoutube,
  getVideoDurationSeconds,
  downloadYoutubeVideo,
};
