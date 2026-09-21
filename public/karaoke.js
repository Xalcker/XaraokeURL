document.addEventListener("DOMContentLoaded", () => {
  const welcomeModal = document.getElementById("welcome-modal");
  const startBtn = document.getElementById("start-btn");
  const mainContainer = document.querySelector(".main-container");
  const player = document.getElementById("karaokePlayer");
  const nowPlayingContent = document.getElementById("now-playing-content");
  const upNextContent = document.getElementById("up-next-content");
  const songQueueContainer = document.getElementById("songQueue");
  const qrCodeImg = document.getElementById("qrCode");
  const qrContainer = document.getElementById("qr-container");
  const qrError = document.getElementById("qr-error");
  const roomCodeDisplay = document.getElementById("room-code");
  const idleScreen = document.getElementById("idle-screen");
  const idleRoomCode = document.getElementById("idle-room-code");
  const idleQr = document.getElementById("idle-qr");
  const idleHint = document.getElementById("idle-hint");
  const remoteUrlEl = document.getElementById("remote-url");
  const fullscreenBtn = document.getElementById("fullscreen-btn");
  const pausedOverlay = document.getElementById("paused-overlay");

  let currentQueue = [], ws, lastTimeUpdate = 0;
  let roomId = null;
  let hostToken = null;
  // Id (de la cola) de la canción que ya se cargó en el reproductor, suene, esté en pausa o no.
  let currentSongId = null;
  // Dónde iba la canción cuando un error de red la tiró (por ejemplo, mientras el
  // servidor descargaba otra de YouTube): para retomarla ahí en vez de reiniciarla.
  let resumeAt = null;

  const songDisplay = (item) => getSongDisplay(item, t("song.unknownArtist"));

  // Mantiene la pantalla encendida durante la sesión. Solo funciona en HTTPS o en localhost.
  const wakeLock = createWakeLock({
    nav: navigator,
    doc: document,
    onChange: (active, error) => {
      if (error) console.warn("No se pudo mantener la pantalla encendida:", error.name);
    },
  });

  startBtn.addEventListener("click", async () => {
    if (startBtn.disabled) return;
    startBtn.disabled = true;
    startBtn.textContent = t("host.creating");
    player.play().catch(() => console.log("Permiso de audio concedido."));
    player.pause();
    try {
      const response = await fetch("/api/rooms", { method: "POST" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      roomId = data.roomId;
      hostToken = data.hostToken;
      roomCodeDisplay.textContent = roomId;
      idleRoomCode.textContent = roomId;
      if (wakeLock.supported) wakeLock.enable();
      else console.info("La pantalla puede apagarse por inactividad: el navegador solo permite evitarlo en HTTPS o en localhost.");
      welcomeModal.classList.add("hidden");
      mainContainer.classList.remove("hidden");
      connectWebSocket();
      initialize();
    } catch (error) {
      console.error("No se pudo crear la sala:", error);
      alert(t("host.createFailed"));
      startBtn.disabled = false;
      startBtn.textContent = t("host.start");
    }
  });

  function send(message) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    else console.warn("Sin conexión con el servidor: no se envió", message.type);
  }

  function connectWebSocket() {
    if (!roomId || !hostToken) return;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${protocol}://${window.location.host}?sala=${roomId}&hostToken=${hostToken}`);
    ws.onopen = () => {
      console.log(`Host conectado a la sala: ${roomId}`);
      // Los remotos que ya estaban (o entran ahora) necesitan saber si el video está en pausa.
      send({ type: "playbackState", payload: { paused: isPaused() } });
    };
    ws.onclose = () => setTimeout(connectWebSocket, 3000);
    ws.onerror = (err) => console.error("Error de WebSocket en Host:", err);
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "queueUpdate") {
        currentQueue = message.payload;
        renderAllSections();
        checkAndPlayNext();
      }
      if (message.type === "controlAction") {
        handleControlAction(message.payload);
      }
    };
  }

  async function initialize() {
    if (!roomId) return;
    try {
      const qrRes = await fetch(`/api/qr?sala=${roomId}`);
      if (!qrRes.ok) throw new Error(`HTTP ${qrRes.status}`);
      const qrData = await qrRes.json();
      qrCodeImg.src = qrData.qrUrl;
      qrCodeImg.classList.remove("hidden");
      qrError.classList.add("hidden");
      idleQr.src = qrData.qrUrl;
      idleQr.classList.remove("hidden");
      showRemoteUrl(qrData.remoteUrl);
    } catch (error) {
      console.error("Error durante la inicialización:", error);
      showQrError();
    }
  }

  function showQrError() {
    qrCodeImg.classList.add("hidden");
    qrError.classList.remove("hidden");
    idleQr.classList.add("hidden");
    showRemoteUrl(window.location.origin + "/remote.html");
  }

  // La dirección del control remoto, sin "http://", bajo el QR y en la pista de la pantalla de espera.
  function showRemoteUrl(url) {
    const shown = String(url).replace(/^https?:\/\//, "");
    remoteUrlEl.textContent = shown;
    idleHint.textContent = t("host.idle.hint", { url: shown });
  }

  // Sin canciones en la cola no hay nada que ver en el video: se muestra el QR grande.
  // El de la barra lateral se oculta mientras tanto para no repetirlo (el grande ya
  // cumple esa función); vuelve en cuanto hay algo sonando.
  function updateIdleScreen() {
    const idle = currentQueue.length === 0;
    idleScreen.classList.toggle("hidden", !idle);
    qrContainer.classList.toggle("hidden", idle);
  }

  qrCodeImg.addEventListener("error", showQrError);

  function renderAllSections() {
    updateIdleScreen();
    renderNowPlaying();
    renderUpNext();
    renderUpcomingQueue();
  }

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  }

  function renderNowPlaying() {
    const nowPlaying = currentQueue.length > 0 ? currentQueue[0] : null;
    if (nowPlaying) {
      const { artist, songTitle } = songDisplay(nowPlaying);
      nowPlayingContent.innerHTML = `<div class="info-card-title">${escapeHtml(artist)}</div><div class="info-card-subtitle">${escapeHtml(songTitle)}</div><div class="info-card-user">${escapeHtml(t("host.by", { name: nowPlaying.name }))}</div><div class="info-card-subtitle" id="song-duration"></div>`;
    } else {
      nowPlayingContent.innerHTML = `<div class="info-card-title">${escapeHtml(t("host.queueEmpty"))}</div>`;
      const durationEl = document.getElementById("song-duration");
      if (durationEl) durationEl.textContent = "";
    }
  }

  function renderUpNext() {
    const upNext = currentQueue.length > 1 ? currentQueue[1] : null;
    if (upNext) {
      const { artist, songTitle } = songDisplay(upNext);
      upNextContent.innerHTML = `<div class="info-card-title">${escapeHtml(artist)}</div><div class="info-card-subtitle">${escapeHtml(songTitle)}</div><div class="info-card-user">${escapeHtml(t("host.by", { name: upNext.name }))}</div>`;
    } else {
      upNextContent.innerHTML = `<div class="info-card-title">${escapeHtml(t("host.nobodyWaiting"))}</div>`;
    }
  }

  function renderUpcomingQueue() {
    songQueueContainer.innerHTML = "";
    const upcoming = currentQueue.slice(2, 7);
    upcoming.forEach((item) => {
      const { artist, songTitle } = songDisplay(item);
      const div = document.createElement("div");
      div.className = "queue-item";
      div.innerHTML = `<span class="song-name">${escapeHtml(songTitle)}</span><span class="user-name">(${escapeHtml(artist)}) ${escapeHtml(t("host.by", { name: item.name }))}</span>`;
      songQueueContainer.appendChild(div);
    });
    if (upcoming.length === 0 && currentQueue.length <= 2) {
      const div = document.createElement("div");
      div.className = "queue-item";
      div.textContent = t("host.noMoreSongs");
      songQueueContainer.appendChild(div);
    }
  }

  // ¿Hay una canción cargada y detenida por una pausa (no por haber terminado)?
  function isPaused() {
    return !!player.getAttribute("src") && player.paused && !player.ended;
  }

  // Avisa a los remotos (y muestra en la pantalla) que el video se pausó o se reanudó.
  function reportPlayback(paused) {
    pausedOverlay.classList.toggle("hidden", !paused);
    send({ type: "playbackState", payload: { paused } });
  }

  function handleControlAction(payload) {
    const loaded = !!player.getAttribute("src");
    switch (payload.action) {
      case "play":
        if (loaded && player.paused) player.play().catch((e) => console.error("No se pudo reanudar:", e));
        break;
      case "pause":
        if (loaded && !player.paused) player.pause();
        break;
      case "playPause": // orden de alternar de versiones anteriores del remoto
        if (loaded) {
          if (player.paused) player.play().catch((e) => console.error("No se pudo reanudar:", e));
          else player.pause();
        }
        break;
      case "skip":
        // El remoto indica cuál canción vio al confirmar: si ya cambió (terminó sola, la saltó otra
        // persona o llegó una confirmación repetida), no se salta la siguiente por error.
        if (payload.id && currentQueue[0]?.id !== payload.id) break;
        currentSongId = null;
        player.pause();
        player.src = "";
        pausedOverlay.classList.add("hidden");
        send({ type: "playNext" });
        break;
    }
  }

  // Cada vez que cambia la cola: si la canción de arriba es otra que la cargada, se reproduce. Si es
  // la misma (alguien añadió una canción mientras esta suena o está en pausa) no se toca: antes se
  // volvía a cargar y la canción en pausa se reiniciaba sola desde el principio.
  function checkAndPlayNext() {
    const head = currentQueue[0];
    if (!head) {
      currentSongId = null;
      return;
    }
    if (head.id === currentSongId) return;
    currentSongId = head.id;
    // Si el que se cae es este mismo (mismo archivo) se retoma donde iba; si es otra
    // canción, el resumeAt que haya quedado guardado no le corresponde.
    if (resumeAt?.song !== head.song) resumeAt = null;
    playSong(head.song);
  }

  async function playSong(songFilename) {
    try {
      const res = await fetch(`/api/song-url?song=${encodeURIComponent(songFilename)}`);
      const data = await res.json();
      player.src = data.url;
      if (resumeAt?.song === songFilename) player.currentTime = resumeAt.time;
      resumeAt = null;
      await player.play();
    } catch (e) {
      console.error("Error al reproducir la canción:", e);
      currentSongId = null; // no se cargó: el próximo cambio de la cola lo vuelve a intentar
    }
  }

  // Pantalla completa de toda la página (no solo del video), para que sigan a la vista la cola y el QR.
  function updateFullscreenButton() {
    const active = !!document.fullscreenElement;
    const label = t(active ? "host.exitFullscreen" : "host.fullscreen");
    fullscreenBtn.innerHTML = iconSvg(active ? "fullscreen-exit" : "fullscreen");
    fullscreenBtn.setAttribute("aria-label", label);
    fullscreenBtn.title = label;
  }

  function toggleFullscreen() {
    const change = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    change.catch((error) => console.error("No se pudo cambiar la pantalla completa:", error));
  }

  if (document.fullscreenEnabled) {
    fullscreenBtn.classList.remove("hidden");
    updateFullscreenButton();
    fullscreenBtn.addEventListener("click", toggleFullscreen);
    document.addEventListener("fullscreenchange", updateFullscreenButton);
    document.addEventListener("keydown", (e) => {
      if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey && !e.altKey) toggleFullscreen();
    });
    document.querySelector(".player-column").addEventListener("dblclick", toggleFullscreen);
  }

  // Tras unos segundos sin mover el ratón ni tocar una tecla, se oculta el cursor y el botón.
  let idleUiTimer = null;
  function showUi() {
    document.body.classList.remove("ui-idle");
    clearTimeout(idleUiTimer);
    idleUiTimer = setTimeout(() => document.body.classList.add("ui-idle"), 3000);
  }
  ["mousemove", "mousedown", "keydown", "touchstart"].forEach((name) =>
    document.addEventListener(name, showUi, { passive: true })
  );
  showUi();

  player.addEventListener("ended", () => send({ type: "playNext" }));
  player.addEventListener("play", () => reportPlayback(false));
  // La pausa que importa es la de una persona: al terminar la canción o al vaciar el reproductor
  // para pasar a otra, el video también "se pausa", pero no es una pausa.
  player.addEventListener("pause", () => {
    if (player.ended || !player.getAttribute("src")) return;
    reportPlayback(true);
  });
  player.addEventListener("error", () => {
    // No siempre es que el archivo esté roto: un corte de red momentáneo (por ejemplo,
    // mientras el servidor descarga otra canción de YouTube) también dispara este evento.
    // Si la que se cayó es la que está sonando, se guarda por dónde iba para retomarla
    // ahí; si no, antes se recargaba desde cero y la canción en curso se reiniciaba sola.
    const head = currentQueue[0];
    if (head?.id === currentSongId && player.currentTime > 0) {
      resumeAt = { song: head.song, time: player.currentTime };
    }
    currentSongId = null; // no se cargó: el próximo cambio de la cola lo vuelve a intentar
  });
  player.addEventListener("loadedmetadata", () => {
    const durationEl = document.getElementById("song-duration");
    if (durationEl) {
      durationEl.textContent = t("host.duration", { time: formatTime(player.duration) });
    }
  });

  player.addEventListener("timeupdate", () => {
    const now = Date.now();
    if (now - lastTimeUpdate > 1000) {
      lastTimeUpdate = now;
      if (ws?.readyState === WebSocket.OPEN && player.duration) {
        ws.send(JSON.stringify({
          type: "timeUpdate",
          payload: {
            currentTime: player.currentTime,
            duration: player.duration,
            song: currentQueue.length > 0 ? currentQueue[0].song : null,
            title: currentQueue.length > 0 ? currentQueue[0].title ?? null : null,
          },
        }));
      }
    }
  });
});
