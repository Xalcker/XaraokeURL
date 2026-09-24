// Las reglas de la pantalla principal, las mismas que sigue public/karaoke.js, sin nada de pantalla
// ni de red: qué canción cargar cuando cambia la cola, qué hacer con las órdenes de los remotos y qué
// avisarle al servidor. Así se pueden probar con un reproductor y un WebSocket de mentira.
//
// Si cambia el comportamiento del host en karaoke.js (pausas, saltos, reanudar tras un error), hay que
// reflejarlo aquí también: el servidor y los remotos no distinguen entre las dos pantallas.
//
//   player: { loaded, paused, load(url, startSeconds, { paused }), pause(), resume(), stop() }
//   send(message): manda un mensaje al servidor (se ignora si no hay conexión).
//   resolveSongUrl(song): la URL del video de esa canción (lo que devuelve /api/song-url).
//   onChange(): algo de lo que se muestra en pantalla cambió (la cola, la pausa o la cuenta regresiva).
//   timers: { setTimeout, clearTimeout } para la cuenta regresiva (se inyecta en las pruebas).
const { createCountdown } = require("../../public/js/shared.js");

function createHostLogic({ player, send, resolveSongUrl, onChange = () => {}, log = console, timers }) {
  let queue = [];
  // Id (de la cola) de la canción cargada en el reproductor, suene o esté en pausa.
  let currentSongId = null;
  // Dónde iba la canción cuando un error (por ejemplo, un corte de red) la tiró: para retomarla ahí.
  let resumeAt = null;
  let lastTimeUpdate = 0;
  // Cuenta regresiva antes de cada canción (SONG_COUNTDOWN_SECONDS, la manda el servidor al conectar;
  // 0 = sin cuenta). Mientras corre, el video ya está cargado y en pausa en el principio, y las
  // órdenes de pausa de los remotos la detienen a ella.
  let countdownSeconds = 0;
  let countdownLoading = false; // se está abriendo en pausa un video que va a llevar cuenta
  let countdownReported = null; // lo último que se dijo a los remotos durante la cuenta (¿en pausa?)
  const countdown = createCountdown({
    onTick(remaining, paused) {
      // A los remotos (solo cuando cambia): la cuenta vale como "sonando", salvo que alguien la detenga.
      if (countdownReported !== paused) {
        countdownReported = paused;
        send({ type: "playbackState", payload: { paused } });
      }
      onChange();
    },
    onDone() {
      player.resume();
      onChange();
    },
    ...(timers ? { timers } : {}),
  });

  const isPaused = () => (countdown.active ? countdown.paused : player.loaded && player.paused);

  function stopCountdown() {
    if (!countdown.active) return;
    countdown.cancel();
    onChange();
  }

  async function playSong(item) {
    try {
      const url = await resolveSongUrl(item.song);
      // Mientras se pedía la URL pudo cambiar la cola (la saltaron, terminó): ya no toca cargarla.
      if (currentSongId !== item.id) return;
      const start = resumeAt?.song === item.song ? resumeAt.time : 0;
      resumeAt = null;
      // Al retomar tras un error la canción ya había empezado: no se vuelve a contar.
      const withCountdown = countdownSeconds > 0 && start === 0;
      countdownLoading = withCountdown;
      try {
        await player.load(url, start, { paused: withCountdown });
      } finally {
        countdownLoading = false;
      }
      if (withCountdown && currentSongId === item.id) {
        countdownReported = null;
        countdown.start(countdownSeconds);
      }
    } catch (error) {
      log.error("No se pudo reproducir la canción:", error);
      if (currentSongId === item.id) currentSongId = null; // el próximo cambio de la cola lo reintenta
    }
  }

  // Si la canción de arriba es otra que la cargada, se reproduce. Si es la misma (alguien agregó una
  // canción mientras esta suena o está en pausa), no se toca.
  function checkAndPlayNext() {
    const head = queue[0];
    if (!head) {
      currentSongId = null;
      stopCountdown();
      if (player.loaded) player.stop();
      return;
    }
    if (head.id === currentSongId) return;
    currentSongId = head.id;
    stopCountdown(); // era la cuenta de otra canción (la saltaron o la quitaron mientras corría)
    if (resumeAt?.song !== head.song) resumeAt = null;
    playSong(head);
  }

  function handleControlAction(payload = {}) {
    switch (payload.action) {
      case "play":
        if (countdown.active) countdown.resume();
        else if (player.loaded && player.paused) player.resume();
        break;
      case "pause":
        if (countdown.active) countdown.pause();
        else if (player.loaded && !player.paused) player.pause();
        break;
      case "playPause": // orden de alternar de versiones anteriores del remoto
        if (countdown.active) {
          if (countdown.paused) countdown.resume();
          else countdown.pause();
        } else if (player.loaded) {
          if (player.paused) player.resume();
          else player.pause();
        }
        break;
      case "skip":
        // El remoto indica cuál canción vio al confirmar: si ya cambió, no se salta la siguiente.
        if (payload.id && queue[0]?.id !== payload.id) break;
        currentSongId = null;
        countdown.cancel();
        player.stop();
        send({ type: "playNext" });
        onChange();
        break;
    }
  }

  return {
    get queue() {
      return queue;
    },
    isPaused,
    // La cuenta regresiva en curso, para dibujarla: { remaining, paused }, o null si no hay.
    get countdown() {
      return countdown.active ? { remaining: countdown.remaining, paused: countdown.paused } : null;
    },

    // Mensajes del servidor.
    handleMessage(message) {
      if (message?.type === "hostConfig") {
        const seconds = Number(message.payload?.countdownSeconds);
        countdownSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
      } else if (message?.type === "queueUpdate" && Array.isArray(message.payload)) {
        queue = message.payload;
        onChange();
        checkAndPlayNext();
      } else if (message?.type === "controlAction") {
        handleControlAction(message.payload);
      }
    },

    // Al (re)conectar: los remotos necesitan saber si el video está en pausa.
    onConnected() {
      send({ type: "playbackState", payload: { paused: isPaused() } });
    },

    // Eventos del reproductor.
    onPauseChange(paused) {
      // Durante la cuenta el video está en pausa a propósito: lo que se informa es la cuenta.
      if (countdown.active || countdownLoading) return;
      send({ type: "playbackState", payload: { paused } });
      onChange();
    },
    // Terminó por sí sola (no la saltó nadie): se dice cuál era para que el servidor pida calificarla.
    onEnded() {
      send({ type: "playNext", payload: { ended: true, id: currentSongId } });
    },
    // No siempre es que el archivo esté roto: un corte de red momentáneo también la tira. Si es la que
    // estaba sonando, se guarda por dónde iba para retomarla ahí cuando se vuelva a intentar.
    onError(currentTime) {
      const head = queue[0];
      if (head?.id === currentSongId && currentTime > 0) {
        resumeAt = { song: head.song, time: currentTime };
      }
      currentSongId = null;
    },
    // Como mucho una vez por segundo (con algo de holgura: el reproductor lo consulta cada segundo y
    // un intervalo de 999 ms no debe saltarse un aviso).
    onTime(currentTime, duration, now = Date.now()) {
      if (!duration || now - lastTimeUpdate < 900) return;
      lastTimeUpdate = now;
      const head = queue[0];
      send({
        type: "timeUpdate",
        payload: {
          currentTime,
          duration,
          song: head ? head.song : null,
          title: head ? head.title ?? null : null,
        },
      });
    },
  };
}

module.exports = { createHostLogic };
