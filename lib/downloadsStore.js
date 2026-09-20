const sqlite3 = require("sqlite3");

// Base de datos propia de las descargas de YouTube, separada de karaoke.db (que
// nunca se modifica). Una fila por video descargado que sigue en disco. Las
// fechas se guardan en ISO 8601 UTC: se leen bien al abrir el archivo con
// cualquier visor de SQLite y se pueden comparar como texto.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS downloads (
    uuid             TEXT PRIMARY KEY,          -- id interno; también da nombre al archivo
    filename         TEXT NOT NULL UNIQUE,      -- <uuid>.mp4, dentro de DOWNLOADS_PATH
    video_id         TEXT NOT NULL UNIQUE,      -- id del video en YouTube (evita descargarlo dos veces)
    video_url        TEXT NOT NULL,             -- link al video original
    title            TEXT NOT NULL,             -- título original del video
    channel          TEXT,                      -- canal
    duration_seconds INTEGER,                   -- duración
    search_query     TEXT,                      -- lo que se buscó para encontrarlo
    search_suffix    TEXT,                      -- sufijo elegido (karaoke, instrumental, pista, none)
    requested_by     TEXT,                      -- quién lo descargó
    file_size_bytes  INTEGER,                   -- tamaño del archivo
    downloaded_at    TEXT NOT NULL,             -- fecha y hora de la descarga
    last_used_at     TEXT NOT NULL,             -- último uso (descarga o vez que se agregó a una cola)
    use_count        INTEGER NOT NULL DEFAULT 0 -- veces que se agregó a una cola
  )`;

function rowToEntry(row) {
  return {
    uuid: row.uuid,
    filename: row.filename,
    videoId: row.video_id,
    videoUrl: row.video_url,
    title: row.title,
    channel: row.channel,
    durationSeconds: row.duration_seconds,
    searchQuery: row.search_query,
    searchSuffix: row.search_suffix,
    requestedBy: row.requested_by,
    fileSizeBytes: row.file_size_bytes,
    downloadedAt: row.downloaded_at,
    lastUsedAt: row.last_used_at,
    useCount: row.use_count,
  };
}

// Abre (y crea si no existe) la base de descargas. `dbPath` puede ser ":memory:"
// (se usa así en las pruebas).
function openDownloadsStore(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (openError) => {
      if (openError) return reject(openError);

      const run = (sql, params = []) =>
        new Promise((res, rej) =>
          db.run(sql, params, function onRun(err) {
            if (err) rej(err);
            else res(this);
          })
        );
      const all = (sql, params = []) =>
        new Promise((res, rej) =>
          db.all(sql, params, (err, rows) => (err ? rej(err) : res(rows)))
        );
      const get = (sql, params = []) =>
        new Promise((res, rej) =>
          db.get(sql, params, (err, row) => (err ? rej(err) : res(row)))
        );

      db.configure("busyTimeout", 3000);
      run(SCHEMA)
        .then(() =>
          resolve({
            async insert(entry) {
              await run(
                `INSERT INTO downloads (
                   uuid, filename, video_id, video_url, title, channel, duration_seconds,
                   search_query, search_suffix, requested_by, file_size_bytes,
                   downloaded_at, last_used_at, use_count
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
                [
                  entry.uuid,
                  entry.filename,
                  entry.videoId,
                  entry.videoUrl,
                  entry.title,
                  entry.channel ?? null,
                  entry.durationSeconds ?? null,
                  entry.searchQuery ?? null,
                  entry.searchSuffix ?? null,
                  entry.requestedBy ?? null,
                  entry.fileSizeBytes ?? null,
                  entry.downloadedAt,
                  entry.downloadedAt,
                ]
              );
            },
            async findByVideoId(videoId) {
              const row = await get("SELECT * FROM downloads WHERE video_id = ?", [videoId]);
              return row ? rowToEntry(row) : null;
            },
            async list() {
              const rows = await all("SELECT * FROM downloads ORDER BY downloaded_at DESC");
              return rows.map(rowToEntry);
            },
            // Registra un uso (se agregó a una cola): renueva su vida útil.
            async touch(filename, isoDate) {
              await run(
                "UPDATE downloads SET last_used_at = ?, use_count = use_count + 1 WHERE filename = ?",
                [isoDate, filename]
              );
            },
            // Descargas cuyo último uso es anterior a `cutoffIso`.
            async listUnusedSince(cutoffIso) {
              const rows = await all(
                "SELECT * FROM downloads WHERE last_used_at < ? ORDER BY last_used_at ASC",
                [cutoffIso]
              );
              return rows.map(rowToEntry);
            },
            async remove(filename) {
              await run("DELETE FROM downloads WHERE filename = ?", [filename]);
            },
            close() {
              return new Promise((res, rej) => db.close((err) => (err ? rej(err) : res())));
            },
          })
        )
        .catch(reject);
    });
  });
}

module.exports = { openDownloadsStore };
