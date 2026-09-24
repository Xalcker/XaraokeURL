// La capa de tiempo real: el WebSocket, el despacho de mensajes y todo lo que se difunde a
// una sala (la cola, quién puede controlar la reproducción, las calificaciones pendientes).
//
// Recibe sus dependencias en vez de buscarlas: las salas, las descargas, el catálogo y el
// middleware de sesión. Así no hay requires circulares (las descargas avisan de sus cambios
// con un callback, no llamando aquí) y cada pieza se puede sustituir en una prueba.
const WebSocket = require("ws");
const crypto = require("crypto");
const { URL } = require("url");

const { moveOwnSong } = require("../lib/queuePolicy");
const { checkCanEnqueue } = require("../lib/queueLimits");
const { createMessageLimiter } = require("../lib/wsRateLimit");
const { claimName } = require("../lib/nameClaims");
const {
  isAllowed,
  presentNames,
  pruneLeftAt,
  canControlPlayback,
  sanitizeControlAction,
  sanitizePlaybackState,
  sanitizePlayNext,
  sanitizeMoveSong,
  sanitizeRating,
  sanitizeVoteSkip,
  SKIP_VOTE_THRESHOLD,
} = require("../lib/wsPolicy");

// Cuántas calificaciones pendientes se recuerdan por sala (las más viejas se olvidan): son las
// de canciones que terminaron y cuya persona aún no ha respondido.
const MAX_PENDING_RATINGS = 20;

// Mensajes que se guardan mientras carga la sesión. Es un tope de cortesía: en ese instante
// solo caben los que el cliente manda nada más abrir, y con esto nadie puede llenar memoria
// mandando sin parar antes de que el servidor sepa siquiera quién es.
const MAX_MENSAJES_EN_ESPERA = 32;

const HEARTBEAT_MS = 30 * 1000;

// `salas` es el módulo de salas, `descargas` el de descargas, `catalogo()` devuelve la base de
// canciones (o null si no hay biblioteca) y `ratings()` el almacén de calificaciones (o null si
// no se pudo abrir). Los dos últimos son funciones porque se abren después de montar esto.
function createRealtime({ server, config, auth, salas, descargas, catalogo, ratings }) {
  // maxPayload: todo lo que manda un cliente es JSON pequeño (un nombre de archivo, una orden
  // de reproducción, una calificación). El tope por defecto de ws son 100 MB por mensaje.
  const wss = new WebSocket.Server({ server, maxPayload: 64 * 1024 });
  const sessionMiddleware = auth.sessionMiddleware;

  // Latido: una desconexión sucia (el celular se sale del alcance del WiFi, se queda sin
  // batería, se corta la red) no manda ningún "close", así que la conexión se quedaría viva
  // para siempre. Y con ella se quedaría trabada media sala: quien canta seguiría contando como
  // presente y nadie podría saltar su canción por mucho que venciera SINGER_GRACE_SECONDS, y la
  // sala nunca llegaría a tener cero clientes, así que el barrido no la borraría (fuga de memoria).
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      // No contestó al ping anterior: se da por muerta. terminate() dispara su "close", que es
      // donde ya está toda la lógica de salir de la sala; no hace falta duplicarla aquí.
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_MS);
  heartbeat.unref();
  wss.on("close", () => clearInterval(heartbeat));

  function broadcastToRoom(roomId, data) {
    const room = salas.get(roomId);
    if (room) {
      room.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) client.send(data);
      });
    }
  }

  // Nombres de las personas con algún control remoto conectado a la sala en este momento.
  function connectedNames(room) {
    const names = new Set();
    room.clients.forEach((client) => {
      if (!client.isHost && client.userName && client.readyState === WebSocket.OPEN) names.add(client.userName);
    });
    return names;
  }

  // Las personas que cuentan como presentes ahora: las conectadas y las que se fueron hace menos que el
  // tiempo de gracia (ver presentNames).
  function roomPresentNames(room) {
    return presentNames(connectedNames(room), room.leftAt, room.headSince, Date.now(), config.singerGraceMs);
  }

  // Vuelve a avisar quién puede controlar cuando termine un tiempo de gracia: pasar el tiempo no dispara
  // ningún otro evento, y sin esto los botones de los demás seguirían deshabilitados aunque ya se pueda.
  function scheduleAccessRecheck(roomId, room) {
    if (config.singerGraceMs === 0) return;
    setTimeout(() => {
      if (salas.get(roomId) === room) sendControlAccess(room);
    }, config.singerGraceMs + 100).unref();
  }

  // Le dice a cada control remoto si puede pausar, reanudar y saltar la canción que suena (ver
  // canControlPlayback): así deshabilita sus botones en lugar de dejarlos hacer algo que el servidor
  // rechazaría. Hay que llamarla cada vez que cambia la cola o quién está presente.
  function sendControlAccess(room) {
    const online = roomPresentNames(room);
    room.clients.forEach((client) => {
      if (client.isHost || client.readyState !== WebSocket.OPEN) return;
      const allowed = canControlPlayback(room.songQueue, client.userName, online);
      client.send(JSON.stringify({ type: "controlAccess", payload: { allowed } }));
    });
  }

  // Le dice a cada control remoto cuántos votos lleva saltar la canción que suena y si ya votó
  // (ver SKIP_VOTE_THRESHOLD): así puede mostrar "2 de 3" y deshabilitar su propio botón sin
  // esperar a volver a votar. Hay que llamarla cada vez que cambian los votos o la canción de arriba.
  function sendSkipVotes(room) {
    const headId = room.songQueue[0]?.id ?? null;
    const votes = room.skipVotes && room.skipVotes.id === headId ? room.skipVotes.voters : null;
    const count = votes ? votes.size : 0;
    room.clients.forEach((client) => {
      if (client.isHost || client.readyState !== WebSocket.OPEN) return;
      const voted = !!votes && !!client.userName && votes.has(client.userName);
      client.send(
        JSON.stringify({
          type: "skipVotes",
          payload: { id: headId, count, threshold: SKIP_VOTE_THRESHOLD, voted },
        })
      );
    });
  }

  // Difunde la cola a todos los de la sala, junto con quién puede controlar la reproducción ahora.
  function broadcastQueue(roomId) {
    const room = salas.get(roomId);
    if (!room) return;
    // Cuando cambia la canción que suena, su dueño empieza a contar desde ahora (ver presentNames).
    const headId = room.songQueue[0]?.id ?? null;
    if (headId !== room.headId) {
      room.headId = headId;
      room.headSince = Date.now();
      room.skipVotes = null; // los votos eran por la canción anterior
      scheduleAccessRecheck(roomId, room);
    }
    // Quien ya no tiene nada en la cola no necesita que se recuerde cuándo se fue (ver pruneLeftAt):
    // sin esto, leftAt acumula un nombre por cada persona que pasó por la sala y nunca se vacía.
    room.leftAt = pruneLeftAt(room.leftAt, room.songQueue);
    broadcastToRoom(roomId, JSON.stringify({ type: "queueUpdate", payload: room.songQueue }));
    sendControlAccess(room);
    sendSkipVotes(room);
  }

  // Avisa a los controles remotos de todas las salas (no al host, que no usa la lista) de que
  // cambió la lista de descargas: ellos la vuelven a pedir. Varios cambios seguidos (por ejemplo,
  // el barrido que borra varias descargas) se juntan en un solo aviso.
  let downloadsChangedTimer = null;
  function notifyDownloadsChanged() {
    if (downloadsChangedTimer) return;
    downloadsChangedTimer = setTimeout(() => {
      downloadsChangedTimer = null;
      const message = JSON.stringify({ type: "downloadsChanged" });
      for (const [, room] of salas.all()) {
        room.clients.forEach((client) => {
          if (!client.isHost && client.readyState === WebSocket.OPEN) client.send(message);
        });
      }
    }, 250);
    downloadsChangedTimer.unref();
  }

  // Agrega una canción a la cola de la sala y la difunde a todos los clientes.
  // El ítem se arma solo con los campos esperados (no se copia el payload
  // completo del cliente); `title` únicamente lo aporta el servidor.
  function enqueueSong(roomId, payload, title) {
    const room = salas.get(roomId);
    if (!room) return;
    room.songQueue.push({
      song: payload.song,
      name: payload.name,
      id: crypto.randomUUID(),
      ...(title ? { title } : {}),
    });
    broadcastQueue(roomId);
  }


  // Manda un mensaje a todos los controles remotos de esa persona en la sala (puede tener varios
  // dispositivos). Al host no: su pantalla no califica.
  function sendToUser(room, name, message) {
    const text = JSON.stringify(message);
    room.clients.forEach((client) => {
      if (!client.isHost && client.userName === name && client.readyState === WebSocket.OPEN) {
        client.send(text);
      }
    });
  }

  // Lo que se le dice a la persona de una calificación pendiente (sin datos internos como la clave).
  function ratingRequestMessage(pending) {
    return {
      type: "ratingRequest",
      payload: { id: pending.id, song: pending.song, ...(pending.title ? { title: pending.title } : {}) },
    };
  }

  // La canción se identifica por el video de YouTube (no por el archivo, que se borra con el tiempo) o,
  // si es del catálogo, por su nombre de archivo.
  function songKeyOf(filename) {
    const download = descargas.get(filename);
    return download ? `yt:${download.videoId}` : `lib:${filename}`;
  }

  // La canción terminó por sí sola: se le pide a quien la cantó que califique el karaoke.
  function requestRating(roomId, item) {
    const room = salas.get(roomId);
    if (!room || !ratings() || !item.name) return;
    const pending = {
      id: item.id,
      song: item.song,
      title: item.title,
      name: item.name,
      songKey: songKeyOf(item.song),
    };
    room.pendingRatings.push(pending);
    if (room.pendingRatings.length > MAX_PENDING_RATINGS) room.pendingRatings.shift();
    sendToUser(room, pending.name, ratingRequestMessage(pending));
  }

  // Respuesta de una persona a una calificación pendiente: solo puede responder quien cantó esa canción.
  // Con 0 ("ahora no") se descarta sin guardar nada.
  async function handleRating(ws, room, payload) {
    const rating = sanitizeRating(payload);
    if (!rating || !ws.userName) return;
    const findPending = () =>
      room.pendingRatings.findIndex((p) => p.id === rating.id && p.name === ws.userName);
    const pending = room.pendingRatings[findPending()];
    if (!pending) return;

    if (rating.value !== 0) {
      try {
        await ratings().upsert({
          songKey: pending.songKey,
          rater: pending.name,
          value: rating.value,
          title: pending.title || pending.song,
          ratedAt: new Date().toISOString(),
        });
      } catch (err) {
        // Sigue pendiente: se le vuelve a pedir si se reconecta.
        console.error(`No se pudo guardar la calificación de ${pending.songKey}:`, err.message);
        return;
      }
    }
    const index = findPending(); // la sala pudo cambiar mientras se guardaba
    if (index !== -1) room.pendingRatings.splice(index, 1);
    // Todos los dispositivos de esa persona cierran la petición, no solo el que respondió.
    sendToUser(room, pending.name, { type: "ratingResolved", payload: { id: pending.id } });
  }


  wss.on("connection", (ws, req) => {
    // Para el latido de arriba: se marca viva al conectar y cada vez que contesta un ping.
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    // El manejador de verdad se instala más abajo, cuando la sesión termina de cargar, y esa carga
    // es asíncrona si el handshake trae cookie (hay que leer su archivo del disco). Hasta entonces
    // la conexión ya está abierta y el cliente puede estar mandando: sin escuchar desde ya, todo
    // eso se perdía sin error ni registro. Le pasaba al host, que manda su playbackState nada más
    // abrir (public/karaoke.js), y por eso a veces los remotos no se enteraban de que el video
    // estaba en pausa.
    // Tope de mensajes de esta conexión: por WebSocket no había ninguno (ver lib/wsRateLimit.js).
    const limitadorMensajes = createMessageLimiter();

    const enEspera = [];
    let recibir = (message) => {
      if (enEspera.length < MAX_MENSAJES_EN_ESPERA) enEspera.push(message);
    };
    ws.on("message", (message) => recibir(message));

    // Cierra la conexión y deja de guardar nada: lo que hubiera llegado ya no le interesa a nadie.
    const rechazar = (code, reason) => {
      enEspera.length = 0;
      recibir = () => {};
      ws.close(code, reason);
    };

    // Reject cross-site WebSocket handshakes: browsers always send Origin,
    // so only same-origin connections (or non-browser clients with none) pass.
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) {
          return rechazar(4003, "Origin not allowed");
        }
      } catch {
        return rechazar(4003, "Invalid origin");
      }
    }

    sessionMiddleware(req, {}, () => {
      const url = new URL(req.url, `${req.protocol}://${req.headers.host}`); // Use req.protocol after trust proxy
      const roomId = url.searchParams.get("sala")?.toUpperCase();
      const hostToken = url.searchParams.get("hostToken");
      const isAuthenticated = config.authDisabled || !!req.session?.passport?.user;

      if (!roomId) {
        return rechazar(4005, "Room ID not provided");
      }

      const room = salas.get(roomId);
      if (!room) {
        return rechazar(4004, "Room not found");
      }

      // Only the client holding the room's secret hostToken (issued when the
      // room was created) may act as host; the old `isHost=true` query flag
      // let anyone impersonate the host without authenticating.
      const isHost = !!hostToken && hostToken === room.hostToken;

      if (!isHost && !isAuthenticated) {
        return rechazar(4001, "Not authenticated");
      }

      ws.roomId = roomId;
      ws.isHost = isHost;
      // Quién es esta conexión, decidido por el servidor (nunca por el cliente). En modo desarrollo es
      // el nombre que la persona eligió en su sesión.
      ws.userName = isAuthenticated
        ? config.authDisabled
          ? req.session?.devName || auth.defaultDevName(req)
          : req.session.passport.user.displayName
        : null;
      ws.sessionId = req.sessionID;
      // Sin login, el nombre es lo único que distingue a una persona de otra: si ya lo tiene otro
      // dispositivo de la sala, este tiene que elegir otro (ver lib/nameClaims.js). Con Google, el
      // nombre viene de la cuenta y varios dispositivos de la misma persona sí pueden compartirlo.
      if (config.authDisabled && !isHost && ws.userName && !claimName(room, ws.userName, ws.sessionId)) {
        return rechazar(4009, "Name taken");
      }
      room.clients.add(ws);
      room.emptySince = null; // ya hay alguien: si la sala estaba en su tiempo de gracia, se salva
      if (ws.userName) room.leftAt.delete(ws.userName); // volvió: ya no cuenta como ausente
      console.log(
        `Client connected to room ${roomId}. Total clients: ${room.clients.size}`
      );
      // Al host, antes que la cola: con ella ya decide si arranca la canción de arriba, y tiene que
      // saber de cuántos segundos es la cuenta regresiva previa (ver SONG_COUNTDOWN_SECONDS).
      if (isHost) {
        ws.send(JSON.stringify({ type: "hostConfig", payload: { countdownSeconds: config.songCountdownSeconds } }));
      }
      ws.send(JSON.stringify({ type: "queueUpdate", payload: room.songQueue }));
      // A todos, no solo a esta conexión: que vuelva quien canta cambia lo que pueden hacer los demás.
      sendControlAccess(room);
      sendSkipVotes(room);
      ws.send(
        JSON.stringify({
          type: "hostStatus",
          payload: { connected: !!room.hostWs },
        })
      );
      if (typeof room.paused === "boolean") {
        ws.send(JSON.stringify({ type: "playbackState", payload: { paused: room.paused } }));
      }
      // Si terminó una canción suya mientras no estaba conectada (o recargó la página), se le vuelve a pedir.
      if (ws.userName && !isHost) {
        room.pendingRatings
          .filter((pending) => pending.name === ws.userName)
          .forEach((pending) => ws.send(JSON.stringify(ratingRequestMessage(pending))));
      }

      if (isHost) {
        // Si ya había una pantalla de host conectada (por ejemplo, la que se abrió de nuevo para
        // recuperar la sala mientras la anterior seguía abierta), la anterior se desconecta: dos
        // hosts reproducirían el karaoke al mismo tiempo.
        const previousHost = room.hostWs;
        room.hostWs = ws;
        if (previousHost && previousHost !== ws) previousHost.close(4006, "Host replaced");
        broadcastToRoom(
          roomId,
          JSON.stringify({ type: "hostStatus", payload: { connected: true } })
        );
      }

      const manejarMensaje = (message) => {
        if (!limitadorMensajes.allow()) {
          // Se avisa una sola vez por conexión: si alguien está en un bucle, no tiene sentido
          // llenar el registro con una línea por mensaje.
          if (limitadorMensajes.dropped === 1) {
            console.warn(
              `⚠️  Demasiados mensajes desde una conexión de la sala ${roomId}` +
                `${ws.userName ? ` (${ws.userName})` : ""}: se descartan hasta que baje el ritmo.`
            );
          }
          return;
        }
        let data;
        try {
          data = JSON.parse(message);
        } catch {
          return; // Ignore malformed messages instead of crashing the process.
        }
        // Un JSON válido no garantiza la forma esperada: "null", un número o un
        // mensaje sin payload lanzaban un TypeError más abajo y tumbaban todo
        // el servidor.
        if (!data || typeof data !== "object") return;
        if (!data.payload || typeof data.payload !== "object") data.payload = {};

        const currentRoom = salas.get(ws.roomId);
        if (!currentRoom) return;

        if (!isAllowed(data.type, isHost)) return;

        if (
          isAuthenticated &&
          (data.type === "addSong" || data.type === "removeSong")
        ) {
          // El nombre lo pone siempre el servidor (nunca el cliente).
          data.payload.name = ws.userName;
        }

        let updateQueue = false;
        switch (data.type) {
          case "addSong": {
            const filename = data.payload?.song;
            if (typeof filename !== "string" || !filename) return;

            // Se comprueba antes de mirar la biblioteca: si la cola está llena, no hace falta
            // ni consultar la base. A quien lo pidió se le dice por qué, para que su pantalla
            // pueda explicarlo en vez de no hacer nada.
            const cabe = checkCanEnqueue(currentRoom.songQueue, ws.userName, {
              maxQueue: config.maxQueueLength,
              maxPerPerson: config.maxSongsPerPerson,
            });
            if (!cabe.ok) {
              ws.send(
                JSON.stringify({
                  type: "addSongRejected",
                  payload: { reason: cabe.reason, limit: cabe.limit },
                })
              );
              return;
            }

            // Se valida contra la DB (o el registro de descargas de YouTube)
            // para que un cliente no pueda meter en la cola un "filename"
            // arbitrario que no exista (rompería /api/song-url al intentar
            // reproducirlo para todos).
            const download = descargas.get(filename);
            if (download) {
              // El título de YouTube lo pone el servidor (nunca el cliente) para
              // mostrar algo legible en la cola en lugar del UUID del archivo.
              descargas.touch(filename);
              enqueueSong(ws.roomId, data.payload, download.title);
              return;
            }

            if (!catalogo()) return; // Sin biblioteca local: solo valen las descargas de YouTube.
            catalogo().get(
              "SELECT 1 FROM songs WHERE filename = ?",
              [filename],
              (err, row) => {
                if (err || !row) return;
                enqueueSong(ws.roomId, data.payload);
              }
            );
            return;
          }
          case "removeSong":
            currentRoom.songQueue = currentRoom.songQueue.filter(
              (song) =>
                !(song.id === data.payload.id && song.name === data.payload.name)
            );
            updateQueue = true;
            break;
          case "moveSong": {
            // Cada persona ordena solo sus canciones entre sí (ver lib/queuePolicy.js).
            const move = sanitizeMoveSong(data.payload);
            if (!move || !ws.userName) return;
            const moved = moveOwnSong(currentRoom.songQueue, move.id, ws.userName, move.direction);
            if (!moved) return;
            currentRoom.songQueue = moved;
            updateQueue = true;
            break;
          }
          case "playNext": {
            const { ended, id } = sanitizePlayNext(data.payload);
            const finished = currentRoom.songQueue.shift();
            // Solo si terminó por sí sola, y era la que el host tenía cargada, se pide calificarla.
            if (finished && ended && id === finished.id) requestRating(ws.roomId, finished);
            updateQueue = true;
            break;
          }
          case "rateSong":
            handleRating(ws, currentRoom, data.payload).catch((err) =>
              console.error("Error al procesar una calificación:", err.message)
            );
            return;
          case "controlAction": {
            // Al host solo le llega una orden válida y sin campos de más.
            const action = sanitizeControlAction(data.payload);
            if (!action) return;
            // Pausar, reanudar y saltar son solo de quien canta la canción que suena (el host, que es
            // la pantalla de la sala, queda fuera de la regla).
            if (!isHost && !canControlPlayback(currentRoom.songQueue, ws.userName, roomPresentNames(currentRoom))) return;
            return broadcastToRoom(ws.roomId, JSON.stringify({ type: "controlAction", payload: action }));
          }
          case "voteSkip": {
            // Solo de un control remoto identificado, y no por la propia canción (quien canta ya
            // tiene el botón de saltar directo, sin necesidad de votos).
            if (isHost || !ws.userName) return;
            const vote = sanitizeVoteSkip(data.payload);
            const head = currentRoom.songQueue[0];
            if (!vote || !head || head.id !== vote.id || head.name === ws.userName) return;

            if (!currentRoom.skipVotes || currentRoom.skipVotes.id !== head.id) {
              currentRoom.skipVotes = { id: head.id, voters: new Set() };
            }
            currentRoom.skipVotes.voters.add(ws.userName);

            if (currentRoom.skipVotes.voters.size >= SKIP_VOTE_THRESHOLD) {
              // Se reinicia antes de avisar: si llegara otro voto mientras el host todavía está
              // procesando este salto, que empiece a contar de cero en vez de saltar dos veces.
              currentRoom.skipVotes = null;
              broadcastToRoom(
                ws.roomId,
                JSON.stringify({ type: "controlAction", payload: { action: "skip", id: head.id } })
              );
            }
            sendSkipVotes(currentRoom);
            return;
          }
          case "playbackState":
            // Lo informa el host cuando el video se pausa o se reanuda; se recuerda para quien entre después.
            currentRoom.paused = sanitizePlaybackState(data.payload).paused;
            return broadcastToRoom(
              ws.roomId,
              JSON.stringify({ type: "playbackState", payload: { paused: currentRoom.paused } })
            );
          case "timeUpdate":
            return broadcastToRoom(ws.roomId, JSON.stringify(data));
          case "getQueue":
            return ws.send(
              JSON.stringify({
                type: "queueUpdate",
                payload: currentRoom.songQueue,
              })
            );
        }
        if (updateQueue) broadcastQueue(ws.roomId);
      };

      // A partir de aquí se atiende en directo; primero, lo que llegó mientras cargaba la sesión.
      recibir = manejarMensaje;
      for (const message of enEspera.splice(0)) manejarMensaje(message);

      ws.on("close", () => {
        const room = salas.get(ws.roomId);
        if (room) {
          room.clients.delete(ws);
          console.log(
            `Client disconnected from room ${roomId}. Remaining: ${room.clients.size}`
          );
          // Si se fue quien canta, empieza su tiempo de gracia; al terminar, los demás pasan a poder
          // controlar su canción. Si todavía le queda otro dispositivo conectado, no se fue.
          if (!ws.isHost && ws.userName && !connectedNames(room).has(ws.userName)) {
            room.leftAt.set(ws.userName, Date.now());
            scheduleAccessRecheck(roomId, room);
          }
          if (!ws.isHost) sendControlAccess(room);
          if (room.hostWs === ws) {
            room.hostWs = null;
            room.paused = undefined;
            broadcastToRoom(
              roomId,
              JSON.stringify({ type: "hostStatus", payload: { connected: false } })
            );
          }
          if (room.clients.size === 0) {
            // No se borra al momento: si el host cerró el reproductor sin querer, tiene el tiempo de
            // gracia para volver y recuperar la sala con su cola (el barrido de arriba la borra al vencer).
            if (config.roomGraceMs === 0) {
              salas.remove(roomId);
              console.log(`Room ${roomId} deleted.`);
            } else {
              room.emptySince = Date.now();
              console.log(`Room ${roomId} sin conexiones: se conserva ${config.roomGraceMs / 60000} min por si el host vuelve.`);
            }
          }
        }
      });
    });
  });

  return { wss, notifyDownloadsChanged, closeAll };

  // Cierra todas las conexiones y el servidor de WebSocket (lo usa el apagado ordenado).
  function closeAll() {
    for (const ws of wss.clients) ws.close(1001, "Server shutting down");
    return new Promise((resolve) => wss.close(resolve));
  }
}

module.exports = { createRealtime, MAX_MENSAJES_EN_ESPERA, HEARTBEAT_MS };
