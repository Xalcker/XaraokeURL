document.addEventListener("DOMContentLoaded", () => {
  const welcomeModal = document.getElementById("welcome-modal");
  const startBtn = document.getElementById("start-btn");
  const resumeBtn = document.getElementById("resume-btn");
  const resumeHint = document.getElementById("resume-hint");
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
  const countdownOverlay = document.getElementById("countdown-overlay");
  const countdownNumber = document.getElementById("countdown-number");
  const countdownSinger = document.getElementById("countdown-singer");
  const countdownSong = document.getElementById("countdown-song");

  let currentQueue = [], ws, lastTimeUpdate = 0;
  let roomId = null;
  let hostToken = null;
  // Id (de la cola) de la canción que ya se cargó en el reproductor, suene, esté en pausa o no.
  let currentSongId = null;
  // Dónde iba la canción cuando un error de red la tiró (por ejemplo, mientras el
  // servidor descargaba otra de YouTube): para retomarla ahí en vez de reiniciarla.
  let resumeAt = null;
  // Cuenta regresiva antes de cada canción, como en el cine: la duración la manda el servidor al
  // conectar (SONG_COUNTDOWN_SECONDS; 0 = sin cuenta). Mientras corre, el video ya está cargado y
  // detenido en el principio, y las órdenes de pausa de los remotos la detienen a ella.
  let countdownSeconds = 0;
  let countdownReported = null; // lo último que se dijo a los remotos durante la cuenta (¿en pausa?)
  const countdown = createCountdown({
    onTick: showCountdown,
    onDone: finishCountdown,
  });

  const songDisplay = (item) => getSongDisplay(item, t("song.unknownArtist"));

  // Mantiene la pantalla encendida durante la sesión. Solo funciona en HTTPS o en localhost.
  const wakeLock = createWakeLock({
    nav: navigator,
    doc: document,
    onChange: (active, error) => {
      if (error) console.warn("No se pudo mantener la pantalla encendida:", error.name);
    },
  });

  // La sala y su token de host se recuerdan en este navegador: si el host cierra el reproductor sin
  // querer, al volver puede recuperar la sala (mientras el servidor la conserve, ver ROOM_GRACE_MINUTES)
  // con su cola. Es un dato del navegador, no un secreto nuevo: el token ya vivía en esta pantalla.
  const SAVED_ROOM_KEY = "xaraoke.hostRoom";

  function loadSavedRoom() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVED_ROOM_KEY));
      if (saved && typeof saved.roomId === "string" && typeof saved.hostToken === "string") return saved;
    } catch {
      /* sin almacenamiento o dato dañado: es como si no hubiera nada guardado */
    }
    return null;
  }

  function saveRoom(room) {
    try {
      localStorage.setItem(SAVED_ROOM_KEY, JSON.stringify(room));
    } catch {
      /* sin almacenamiento: la sala funciona igual, solo que no se podrá recuperar */
    }
  }

  function forgetSavedRoom() {
    try {
      localStorage.removeItem(SAVED_ROOM_KEY);
    } catch {
      /* nada que olvidar */
    }
  }

  // Modo kiosko (?autostart=1): una pantalla sin teclado ni mouse no puede pulsar "Comenzar", así que
  // recupera sola la sala guardada o crea una nueva, y en vez de alert() (un diálogo que nadie puede
  // cerrar y que congela la página) deja el aviso en consola y reintenta.
  const autostart = new URLSearchParams(location.search).has("autostart");
  const AUTOSTART_RETRY_MS = 5000;

  function notify(message) {
    if (autostart) console.warn(message);
    else alert(message);
  }

  function retryAutostart() {
    if (autostart) setTimeout(autoStartSession, AUTOSTART_RETRY_MS);
  }

  // Con una sala por recuperar, el botón de siempre pasa a "Crear una sala nueva".
  let savedRoomOffered = false;
  const startLabel = () => t(savedRoomOffered ? "host.startNew" : "host.start");

  // El navegador solo deja reproducir audio tras un gesto de la persona: se aprovecha el clic.
  function primeAudio() {
    player.play().catch(() => console.log("Permiso de audio concedido."));
    player.pause();
  }

  // Entra a la sala (recién creada o recuperada): guarda sus datos, muestra la pantalla principal y
  // se conecta. Al conectarse, el servidor manda la cola que la sala tenía.
  function enterRoom(id, token) {
    roomId = id;
    hostToken = token;
    saveRoom({ roomId, hostToken });
    roomCodeDisplay.textContent = roomId;
    idleRoomCode.textContent = roomId;
    if (wakeLock.supported) wakeLock.enable();
    else console.info("La pantalla puede apagarse por inactividad: el navegador solo permite evitarlo en HTTPS o en localhost.");
    welcomeModal.classList.add("hidden");
    mainContainer.classList.remove("hidden");
    connectWebSocket();
    initialize();
  }

  // Pregunta al servidor si la sala guardada sigue existiendo y el token es el de esta pantalla.
  // Devuelve { queueLength }, o null si ya no existe. Lanza si no se pudo consultar (sin red).
  async function checkSavedRoom(saved) {
    const response = await fetch(`/api/rooms/${encodeURIComponent(saved.roomId)}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostToken: saved.hostToken }),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function showSavedRoomOffer(saved, queueLength) {
    savedRoomOffered = true;
    resumeBtn.textContent = t("host.resume", { code: saved.roomId });
    resumeHint.textContent = t("host.resumeQueue", { n: queueLength });
    resumeBtn.classList.remove("hidden");
    resumeHint.classList.remove("hidden");
    welcomeModal.classList.add("has-saved-room");
    startBtn.dataset.i18n = "host.startNew";
    startBtn.textContent = startLabel();
  }

  function hideSavedRoomOffer() {
    savedRoomOffered = false;
    resumeBtn.classList.add("hidden");
    resumeHint.classList.add("hidden");
    welcomeModal.classList.remove("has-saved-room");
    startBtn.dataset.i18n = "host.start";
    startBtn.textContent = startLabel();
  }

  // Al abrir la página: si quedó una sala guardada que el servidor todavía conserva, se ofrece
  // recuperarla. Si ya no existe (venció el tiempo de espera o el servidor se reinició), se olvida.
  // Devuelve false si no se pudo consultar (sin red).
  async function offerSavedRoom() {
    const saved = loadSavedRoom();
    if (!saved) return true;
    try {
      const room = await checkSavedRoom(saved);
      if (room) showSavedRoomOffer(saved, room.queueLength);
      else forgetSavedRoom();
      return true;
    } catch (error) {
      console.warn("No se pudo consultar la sala guardada:", error);
      return false;
    }
  }

  // En modo kiosko, pulsa sola el botón que corresponda. Si no se pudo consultar la sala guardada, se
  // reintenta en vez de crear una nueva: así no se pierde la cola por un corte de red al arrancar.
  async function autoStartSession() {
    if (!(await offerSavedRoom())) return retryAutostart();
    (savedRoomOffered ? resumeBtn : startBtn).click();
  }

  if (autostart) autoStartSession();
  else offerSavedRoom();

  resumeBtn.addEventListener("click", async () => {
    if (resumeBtn.disabled) return;
    const saved = loadSavedRoom();
    if (!saved) return hideSavedRoomOffer();
    resumeBtn.disabled = true;
    startBtn.disabled = true;
    resumeBtn.textContent = t("host.resuming");
    primeAudio();
    try {
      // Se consulta otra vez: pudo pasar tiempo desde que se cargó la página y la sala pudo vencer.
      if (!(await checkSavedRoom(saved))) {
        forgetSavedRoom();
        hideSavedRoomOffer();
        notify(t("host.resumeFailed"));
        resumeBtn.disabled = false;
        startBtn.disabled = false;
        retryAutostart();
        return;
      }
      enterRoom(saved.roomId, saved.hostToken);
    } catch (error) {
      console.error("No se pudo recuperar la sala:", error);
      notify(t("host.resumeError"));
      resumeBtn.textContent = t("host.resume", { code: saved.roomId });
      resumeBtn.disabled = false;
      startBtn.disabled = false;
      retryAutostart();
    }
  });

  startBtn.addEventListener("click", async () => {
    if (startBtn.disabled) return;
    startBtn.disabled = true;
    startBtn.textContent = t("host.creating");
    primeAudio();
    try {
      const response = await fetch("/api/rooms", { method: "POST" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      enterRoom(data.roomId, data.hostToken);
    } catch (error) {
      console.error("No se pudo crear la sala:", error);
      notify(t("host.createFailed"));
      startBtn.disabled = false;
      startBtn.textContent = startLabel();
      retryAutostart();
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
    ws.onclose = (event) => {
      // La sala ya no existe en el servidor (venció el tiempo de espera o se reinició): reintentar
      // no serviría de nada. Se vuelve a la pantalla de inicio para crear otra.
      if (event.code === 4004) {
        forgetSavedRoom();
        notify(t("host.roomLost"));
        location.reload();
        return;
      }
      // Otra pantalla recuperó la sala con el mismo token y el servidor cerró esta: si reconectara,
      // las dos se estarían quitando el control una a la otra.
      if (event.code === 4006) {
        player.pause();
        notify(t("host.replaced"));
        return;
      }
      setTimeout(connectWebSocket, 3000);
    };
    ws.onerror = (err) => console.error("Error de WebSocket en Host:", err);
    ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return; // el servidor no debería mandar esto, pero no vale la pena romper por ello
      }
      if (message.type === "hostConfig") {
        const seconds = Number(message.payload?.countdownSeconds);
        countdownSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
      }
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
    if (countdown.active) return countdown.paused;
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
        if (countdown.active) countdown.resume();
        else if (loaded && player.paused) player.play().catch((e) => console.error("No se pudo reanudar:", e));
        break;
      case "pause":
        if (countdown.active) countdown.pause();
        else if (loaded && !player.paused) player.pause();
        break;
      case "playPause": // orden de alternar de versiones anteriores del remoto
        if (countdown.active) {
          if (countdown.paused) countdown.resume();
          else countdown.pause();
        } else if (loaded) {
          if (player.paused) player.play().catch((e) => console.error("No se pudo reanudar:", e));
          else player.pause();
        }
        break;
      case "skip":
        // El remoto indica cuál canción vio al confirmar: si ya cambió (terminó sola, la saltó otra
        // persona o llegó una confirmación repetida), no se salta la siguiente por error.
        if (payload.id && currentQueue[0]?.id !== payload.id) break;
        currentSongId = null;
        stopCountdown();
        player.pause();
        // Se vacía quitando el atributo, no con src = "": eso dispara un "error" unos milisegundos
        // después que, si la cola nueva ya llegó, cancelaba la carga de la siguiente canción y la
        // pantalla se quedaba en negro.
        player.removeAttribute("src");
        player.load();
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
      stopCountdown();
      return;
    }
    if (head.id === currentSongId) return;
    currentSongId = head.id;
    stopCountdown(); // era la cuenta de otra canción (la saltaron o la quitaron mientras corría)
    // Si el que se cae es este mismo (mismo archivo) se retoma donde iba; si es otra
    // canción, el resumeAt que haya quedado guardado no le corresponde.
    if (resumeAt?.song !== head.song) resumeAt = null;
    playSong(head);
  }

  async function playSong(item) {
    try {
      const res = await fetch(`/api/song-url?song=${encodeURIComponent(item.song)}`);
      const data = await res.json();
      // Mientras se pedía la URL pudo cambiar la cola (la saltaron, terminó): ya no toca cargarla.
      if (currentSongId !== item.id) return;
      player.src = data.url;
      const resuming = resumeAt?.song === item.song;
      if (resuming) player.currentTime = resumeAt.time;
      resumeAt = null;
      // Al retomar tras un error la canción ya había empezado: no se vuelve a contar.
      if (countdownSeconds > 0 && !resuming) {
        showCountdownSong(item);
        countdownReported = null;
        countdown.start(countdownSeconds);
        return;
      }
      await player.play();
    } catch (e) {
      console.error("Error al reproducir la canción:", e);
      currentSongId = null; // no se cargó: el próximo cambio de la cola lo vuelve a intentar
    }
  }

  // Quién canta y qué, bajo la cuenta regresiva.
  function showCountdownSong(item) {
    const { artist, songTitle } = songDisplay(item);
    countdownSinger.textContent = item.name;
    countdownSong.textContent = `${artist} — ${songTitle}`;
  }

  // Cada segundo: el número nuevo, y la aguja del círculo vuelve a dar una vuelta (se reinicia la
  // animación quitando la clase y volviéndola a poner tras forzar el cálculo del estilo).
  function showCountdown(remaining, paused) {
    countdownOverlay.classList.remove("hidden");
    countdownOverlay.classList.toggle("is-paused", paused);
    countdownNumber.textContent = String(remaining);
    if (!paused) {
      countdownOverlay.classList.remove("tick");
      void countdownOverlay.offsetWidth;
      countdownOverlay.classList.add("tick");
    }
    // A los remotos (solo cuando cambia): la cuenta vale como "sonando", salvo que alguien la detenga.
    if (countdownReported !== paused) {
      countdownReported = paused;
      send({ type: "playbackState", payload: { paused } });
    }
  }

  function finishCountdown() {
    countdownOverlay.classList.add("hidden");
    player.play().catch((e) => console.error("No se pudo empezar la canción:", e));
  }

  function stopCountdown() {
    countdown.cancel();
    countdownOverlay.classList.add("hidden");
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

  // Terminó por sí sola (no la saltó nadie): se indica cuál era para que el servidor pida calificarla.
  player.addEventListener("ended", () => send({ type: "playNext", payload: { ended: true, id: currentSongId } }));
  player.addEventListener("play", () => reportPlayback(false));
  // La pausa que importa es la de una persona: al terminar la canción o al vaciar el reproductor
  // para pasar a otra, el video también "se pausa", pero no es una pausa.
  player.addEventListener("pause", () => {
    if (player.ended || !player.getAttribute("src")) return;
    reportPlayback(true);
  });
  player.addEventListener("error", () => {
    // Sin archivo cargado (se acaba de vaciar al saltar) no hay nada que reintentar.
    if (!player.getAttribute("src")) return;
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

  // Estaba como oncontextmenu="return false" en el <video>; se movió aquí porque CSP bloquea
  // los manejadores puestos en atributos (script-src-attr 'none'). Ver #37.
  player.addEventListener("contextmenu", (event) => event.preventDefault());

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
