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
  // artista y el resto (unido de nuevo) es el titulo. Si no hay separador se usa
  // `unknownArtist` (el texto ya traducido, que pasa quien llama) como artista.
  function parseSongFilename(fullFilename, unknownArtist = "Desconocido") {
    const parts = fullFilename.replace(/\.mp4$/, "").split(" - ");
    if (parts.length >= 2) {
      return {
        artist: parts[0].trim(),
        songTitle: parts.slice(1).join(" - ").trim(),
      };
    }
    return { artist: unknownArtist, songTitle: fullFilename.replace(/\.mp4$/, "") };
  }

  // Nombre para mostrar de un ítem de la cola (o del payload de timeUpdate).
  // Las descargas de YouTube traen un `title` con el título del video, porque
  // su filename es un UUID sin significado; las del catálogo se derivan del
  // filename "Artista - Titulo.mp4".
  function getSongDisplay(item, unknownArtist) {
    if (typeof item.title === "string" && item.title.trim()) {
      return { artist: "YouTube", songTitle: item.title.trim() };
    }
    return parseSongFilename(item.song, unknownArtist);
  }

  // Cuenta regresiva de la pantalla principal antes de cada canción (SONG_COUNTDOWN_SECONDS), la misma
  // en el navegador (karaoke.js) y en el reproductor nativo (player/lib/hostLogic.js). Baja de uno en
  // uno cada segundo: onTick(restantes, enPausa) cada vez que hay que redibujarla, y onDone() al
  // llegar a cero. Se puede pausar y reanudar (el segundo en curso vuelve a empezar al reanudar).
  // `timers` se inyecta para las pruebas. Los de verdad se llaman sueltos, no como métodos de otro
  // objeto: el setTimeout del navegador lanza "Illegal invocation" si `this` no es window.
  const globalTimers = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };

  function createCountdown({ onTick, onDone, timers = globalTimers }) {
    let remaining = 0;
    let active = false;
    let paused = false;
    let timer = null;

    function clear() {
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    }

    function schedule() {
      clear();
      timer = timers.setTimeout(tick, 1000);
    }

    function tick() {
      timer = null;
      remaining -= 1;
      if (remaining <= 0) {
        active = false;
        onDone();
        return;
      }
      onTick(remaining, false);
      schedule();
    }

    return {
      get active() {
        return active;
      },
      get paused() {
        return paused;
      },
      get remaining() {
        return remaining;
      },
      start(seconds) {
        remaining = Math.max(1, Math.round(seconds));
        active = true;
        paused = false;
        onTick(remaining, false);
        schedule();
      },
      pause() {
        if (!active || paused) return;
        paused = true;
        clear();
        onTick(remaining, true);
      },
      resume() {
        if (!active || !paused) return;
        paused = false;
        onTick(remaining, false);
        schedule();
      },
      cancel() {
        clear();
        active = false;
        paused = false;
      },
    };
  }

  return { escapeHtml, parseSongFilename, getSongDisplay, createCountdown };
});
