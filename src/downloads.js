// Descargas de YouTube: el registro en memoria, la orquestación de yt-dlp y la limpieza.
//
// El registro es un Map y no un objeto a propósito: en un objeto, las claves heredadas de
// Object.prototype ("__proto__", "constructor", "toString"...) devuelven un valor truthy en una
// consulta directa, así que un nombre de archivo inventado por el cliente pasaba por descarga
// válida y se colaba en la cola; peor aún, escribir en esa "entrada" modificaba el prototipo de
// todo el proceso. Un Map no tiene cadena de prototipos, así que no puede volver a pasar.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { getVideoInfo, downloadYoutubeVideo } = require("../lib/ytdlp");
const { openDownloadsStore } = require("../lib/downloadsStore");
const { sweepIntervalMs } = require("../lib/downloadPolicy");

const MAX_CONCURRENT_DOWNLOADS = 3;
const MAX_YOUTUBE_DURATION_SECONDS = 10 * 60;
const UUID_PREFIX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

// Error con el código HTTP con el que se debe responder al cliente. Lleva la clave del mensaje
// (y sus parámetros), no el texto: se traduce al responder, en el idioma de quien pidió.
class DownloadError extends Error {
  constructor(status, messageKey, params) {
    super(messageKey);
    this.status = status;
    this.messageKey = messageKey;
    this.params = params;
  }
}

// `onChange` avisa de que la lista cambió (el WebSocket se lo dice a los remotos), y
// `queuedFilenames` dice qué canciones están en la cola de alguna sala, para no borrarlas
// mientras esperan su turno. Los dos se inyectan para no depender de las salas ni del
// WebSocket desde aquí.
function createDownloads({ config, onChange = () => {}, queuedFilenames = () => new Set() }) {
  const entries = new Map(); // filename -> entrada
  const inflight = new Map(); // videoId -> promesa, para no bajar dos veces lo mismo
  let store = null;
  let activeDownloads = 0;

  const toEntry = (row) => ({ ...row, url: `/downloads/${row.filename}` });
  const get = (filename) => entries.get(filename);
  const all = () => [...entries.values()];
  const findByVideoId = (videoId) => all().find((entry) => entry.videoId === videoId);

  // Archivos con nombre de uuid en la carpeta de descargas que no tienen registro: restos de
  // descargas fallidas, o de versiones anteriores que perdían el rastro al reiniciar.
  function findOrphanFiles() {
    const conocidos = new Set(Array.from(entries.values(), (entry) => entry.uuid));
    return fs.readdirSync(config.downloadsPath).filter((file) => {
      const match = UUID_PREFIX_RE.exec(file);
      return match && !conocidos.has(match[0].toLowerCase());
    });
  }

  // Borra el archivo, el registro en la base y la copia en memoria.
  async function remove(filename) {
    entries.delete(filename);
    onChange();
    try {
      fs.unlinkSync(path.join(config.downloadsPath, filename));
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.error(`No se pudo borrar la descarga ${filename}:`, err.message);
      }
    }
    await store.remove(filename);
  }

  // Si una descarga falla a medias, yt-dlp deja archivos temporales con el uuid (por ejemplo
  // <uuid>.f136.mp4 o <uuid>.mp4.part): se limpian todos.
  function removePartialFiles(uuid) {
    for (const file of fs.readdirSync(config.downloadsPath)) {
      if (!file.startsWith(uuid)) continue;
      try {
        fs.unlinkSync(path.join(config.downloadsPath, file));
      } catch {
        /* si no se puede borrar ahora, lo recoge el barrido de huérfanos */
      }
    }
  }

  async function downloadNew({ videoId, searchQuery, searchSuffix, requestedBy }) {
    // Metadatos autoritativos, pedidos a YouTube: la duración para aplicar el tope, y el título
    // y el canal que se guardan (no se confía en el cliente).
    const info = await getVideoInfo(videoId);
    if (info.duration !== null && info.duration > MAX_YOUTUBE_DURATION_SECONDS) {
      throw new DownloadError(400, "api.videoTooLong", {
        minutes: MAX_YOUTUBE_DURATION_SECONDS / 60,
      });
    }

    const uuid = crypto.randomUUID();
    const filename = `${uuid}.mp4`;
    const destPath = path.join(config.downloadsPath, filename);
    try {
      await downloadYoutubeVideo(videoId, destPath);
      const row = {
        uuid,
        filename,
        videoId,
        videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
        title: Array.from(info.title || "Video de YouTube").slice(0, 200).join(""),
        channel: info.channel,
        durationSeconds: info.duration === null ? null : Math.round(info.duration),
        searchQuery,
        searchSuffix,
        requestedBy,
        fileSizeBytes: fs.statSync(destPath).size,
        downloadedAt: new Date().toISOString(),
      };
      await store.insert(row);
      const entry = toEntry({ ...row, lastUsedAt: row.downloadedAt, useCount: 0 });
      entries.set(filename, entry);
      onChange();
      return entry;
    } catch (err) {
      removePartialFiles(uuid);
      throw err;
    }
  }

  // Devuelve la descarga de ese video, reutilizando el archivo si ya existe (o si otra persona
  // lo está descargando en este momento) para no bajarlo dos veces.
  async function ensureDownloaded(params) {
    const { videoId } = params;

    const existing = findByVideoId(videoId);
    if (existing) {
      if (fs.existsSync(path.join(config.downloadsPath, existing.filename))) {
        return { entry: existing, reused: true };
      }
      await remove(existing.filename); // el archivo desapareció: registro huérfano
    }

    const running = inflight.get(videoId);
    if (running) return { entry: await running, reused: true };

    if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
      throw new DownloadError(429, "api.downloadsBusy");
    }
    activeDownloads++;
    const promise = downloadNew(params).finally(() => {
      activeDownloads--;
      inflight.delete(videoId);
    });
    inflight.set(videoId, promise);
    return { entry: await promise, reused: false };
  }

  // Registra un uso (se agregó a una cola): suma al contador y renueva su vida útil.
  function touch(filename) {
    const entry = entries.get(filename);
    if (!entry) return;
    const now = new Date().toISOString();
    entry.lastUsedAt = now;
    entry.useCount += 1;
    store.touch(filename, now).catch((err) => {
      console.error(`No se pudo registrar el uso de ${filename}:`, err.message);
    });
  }

  // Borra las descargas que llevan DOWNLOAD_TTL_HOURS sin usarse, salvo las que están en la
  // cola de alguna sala (se borraría el archivo mientras espera su turno o suena). También
  // limpia los archivos huérfanos más viejos que la vida útil.
  async function sweep() {
    const cutoff = new Date(Date.now() - config.downloadTtlMs).toISOString();
    const enCola = queuedFilenames();
    for (const row of await store.listUnusedSince(cutoff)) {
      if (enCola.has(row.filename)) continue;
      await remove(row.filename);
      console.log(
        `Descarga "${row.title}" (${row.filename}) eliminada: ${row.lastUsedAt} fue su último uso.`
      );
    }

    const edadMinima = Math.max(ORPHAN_MIN_AGE_MS, config.downloadTtlMs);
    for (const file of findOrphanFiles()) {
      const filePath = path.join(config.downloadsPath, file);
      try {
        if (Date.now() - fs.statSync(filePath).mtimeMs < edadMinima) continue;
        fs.unlinkSync(filePath);
        console.log(`Archivo huérfano ${file} eliminado (sin registro).`);
      } catch {
        /* ya no existe o no se puede borrar: se reintenta en el próximo barrido */
      }
    }
  }

  // Abre la base y recupera lo que quedó registrado antes del último apagado: lo que sigue en
  // disco vuelve a estar disponible, y se limpian los registros cuyo archivo ya no existe.
  async function init() {
    store = await openDownloadsStore(config.downloadsDbPath);
    let restauradas = 0;
    for (const row of await store.list()) {
      if (fs.existsSync(path.join(config.downloadsPath, row.filename))) {
        entries.set(row.filename, toEntry(row));
        restauradas++;
      } else {
        await store.remove(row.filename);
      }
    }
    console.log(
      `Descargas de YouTube: ${restauradas} registrada(s) en ${config.downloadsDbPath}. ` +
        (config.downloadTtlMs === null
          ? "No se borran nunca (DOWNLOAD_TTL_HOURS lo desactiva)."
          : `Se borran tras ${config.downloadTtlMs / 3600000} h sin usarse.`)
    );

    if (config.downloadTtlMs !== null) {
      // Las descargas de versiones anteriores no tienen registro: se avisa antes de borrarlas.
      const huerfanos = findOrphanFiles();
      if (huerfanos.length > 0) {
        console.warn(
          `⚠️  Hay ${huerfanos.length} archivo(s) sin registro en ${config.downloadsPath} (descargas de una versión anterior o fallidas). ` +
            `Se borrarán cuando lleven más de ${Math.max(1, config.downloadTtlMs / 3600000)} h sin modificarse. ` +
            "Para conservarlos, usa DOWNLOAD_TTL_HOURS=0 (así no se borra nada)."
        );
      }
      const correrBarrido = () =>
        sweep().catch((err) => console.error("Error al limpiar las descargas:", err.message));
      correrBarrido();
      setInterval(correrBarrido, sweepIntervalMs(config.downloadTtlMs)).unref();
    }
  }

  return {
    init,
    get,
    all,
    findByVideoId,
    ensureDownloaded,
    touch,
    remove,
    sweep,
    close: () => (store ? store.close() : Promise.resolve()),
  };
}

module.exports = { createDownloads, DownloadError, MAX_YOUTUBE_DURATION_SECONDS };
