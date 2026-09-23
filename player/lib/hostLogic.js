// Las reglas de la pantalla principal, las mismas que sigue public/karaoke.js, sin nada de pantalla
// ni de red: qué canción cargar cuando cambia la cola, qué hacer con las órdenes de los remotos y qué
// avisarle al servidor. Así se pueden probar con un reproductor y un WebSocket de mentira.
//
// Si cambia el comportamiento del host en karaoke.js (pausas, saltos, reanudar tras un error), hay que
// reflejarlo aquí también: el servidor y los remotos no distinguen entre las dos pantallas.
//
//   player: { loaded, paused, load(url, startSeconds), pause(), resume(), stop() }
//   send(message): manda un mensaje al servidor (se ignora si no hay conexión).
//   resolveSongUrl(song): la URL del video de esa canción (lo que devuelve /api/song-url).
//   onChange(): algo de lo que se muestra en pantalla cambió (la cola o la pausa).
function createHostLogic({ player, send, resolveSongUrl, onChange = () => {}, log = console }) {
  let queue = [];
  // Id (de la cola) de la canción cargada en el reproductor, suene o esté en pausa.
  let currentSongId = null;
  // Dónde iba la canción cuando un error (por ejemplo, un corte de red) la tiró: para retomarla ahí.
  let resumeAt = null;
  let lastTimeUpdate = 0;

  const isPaused = () => player.loaded && player.paused;

  async function playSong(item) {
    try {
      const url = await resolveSongUrl(item.song);
      // Mientras se pedía la URL pudo cambiar la cola (la saltaron, terminó): ya no toca cargarla.
      if (currentSongId !== item.id) return;
      const start = resumeAt?.song === item.song ? resumeAt.time : 0;
      resumeAt = null;
      await player.load(url, start);
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
      if (player.loaded) player.stop();
      return;
    }
    if (head.id === currentSongId) return;
    currentSongId = head.id;
    if (resumeAt?.song !== head.song) resumeAt = null;
    playSong(head);
  }

  function handleControlAction(payload = {}) {
    switch (payload.action) {
      case "play":
        if (player.loaded && player.paused) player.resume();
        break;
      case "pause":
        if (player.loaded && !player.paused) player.pause();
        break;
      case "playPause": // orden de alternar de versiones anteriores del remoto
        if (player.loaded) {
          if (player.paused) player.resume();
          else player.pause();
        }
        break;
      case "skip":
        // El remoto indica cuál canción vio al confirmar: si ya cambió, no se salta la siguiente.
        if (payload.id && queue[0]?.id !== payload.id) break;
        currentSongId = null;
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

    // Mensajes del servidor.
    handleMessage(message) {
      if (message?.type === "queueUpdate" && Array.isArray(message.payload)) {
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
