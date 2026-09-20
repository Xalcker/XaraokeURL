// Utilidades compartidas entre karaoke.js (host) y remote.js (control remoto).
// Se cargan como <script> plano en el navegador (variables globales) y también
// son requireable desde Node para pruebas unitarias (patrón UMD simplificado).
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = mod;
  }
  if (root) {
    Object.assign(root, mod);
  }
})(typeof window !== "undefined" ? window : undefined, function () {
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  // Un filename tiene forma "Artista - Titulo.mp4". El titulo puede a su vez
  // contener " - " (ej. remasters), por lo que solo el primer segmento es el
  // artista y el resto (unido de nuevo) es el titulo.
  function parseSongFilename(fullFilename) {
    const parts = fullFilename.replace(/\.mp4$/, "").split(" - ");
    if (parts.length >= 2) {
      return {
        artist: parts[0].trim(),
        songTitle: parts.slice(1).join(" - ").trim(),
      };
    }
    return { artist: "Desconocido", songTitle: fullFilename.replace(/\.mp4$/, "") };
  }

  return { escapeHtml, parseSongFilename };
});
