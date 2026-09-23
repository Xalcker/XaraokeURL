// Arranca mpv y le habla por su socket JSON (--input-ipc-server): una línea JSON por mensaje, con
// request_id para emparejar cada respuesta con su orden. Ver https://mpv.io/manual/stable/#json-ipc
const { spawn } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");

// Opciones que el reproductor necesita siempre, en cualquier equipo:
const BASE_ARGS = [
  "--idle=yes", // sin canción sigue abierto, esperando la siguiente
  "--force-window=yes", // y con la pantalla tomada, para dibujar el QR y los textos
  "--keep-open=no",
  "--osc=no", // sin los controles en pantalla de mpv
  "--osd-bar=no",
  "--osd-on-seek=no",
  "--no-input-default-bindings", // un teclado conectado no hace nada
  "--input-vo-keyboard=no",
  "--input-terminal=no", // en el servicio corre sobre tty1: que no lea teclas de la terminal
  "--msg-level=all=warn",
  // El búfer por defecto es de 150 MiB: en una placa de 512 MB de RAM no cabe. Con esto alcanza para
  // varios minutos de un video de 720p.
  "--demuxer-max-bytes=32MiB",
  "--demuxer-max-back-bytes=8MiB",
];

function waitForSocket(socketPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection(socketPath);
      socket.once("connect", () => resolve(socket));
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`mpv no abrió su socket (${socketPath})`));
        else setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

// Devuelve { command(...args), commandNamed(obj), observe(name, cb), on(event, cb), close() }.
// onExit se llama si mpv se cierra (el servicio de systemd se encarga de reiniciar todo).
async function startMpv({ bin = "mpv", extraArgs = [], socketPath, onExit = () => {}, log = console }) {
  try {
    fs.rmSync(socketPath, { force: true });
  } catch {
    /* no había socket viejo */
  }
  const child = spawn(bin, [...BASE_ARGS, `--input-ipc-server=${socketPath}`, ...extraArgs], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  let exited = false;
  child.once("exit", (code, signal) => {
    exited = true;
    onExit(code, signal);
  });
  child.once("error", (error) => log.error("No se pudo ejecutar mpv:", error.message));

  const socket = await waitForSocket(socketPath, 15000);
  const pending = new Map();
  const listeners = new Map();
  const observers = new Map();
  let nextId = 1;
  let buffered = "";

  const emit = (event, data) => (listeners.get(event) ?? []).forEach((cb) => cb(data));

  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffered += chunk;
    let newline;
    while ((newline = buffered.indexOf("\n")) !== -1) {
      const raw = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (!raw.trim()) continue;
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        continue;
      }
      if (message.request_id !== undefined && pending.has(message.request_id)) {
        const { resolve, reject } = pending.get(message.request_id);
        pending.delete(message.request_id);
        if (message.error === "success") resolve(message.data);
        else reject(new Error(`mpv: ${message.error}`));
      } else if (message.event === "property-change") {
        observers.get(message.id)?.(message.data);
      } else if (message.event) {
        emit(message.event, message);
      }
    }
  });
  socket.on("close", () => {
    for (const { reject } of pending.values()) reject(new Error("se cerró la conexión con mpv"));
    pending.clear();
  });

  const send = (command) =>
    new Promise((resolve, reject) => {
      const request_id = nextId++;
      pending.set(request_id, { resolve, reject });
      socket.write(`${JSON.stringify({ command, request_id })}\n`);
    });

  let nextObserver = 1;
  return {
    command: (...args) => send(args),
    // Órdenes con argumentos por nombre (osd-overlay los necesita).
    commandNamed: (named) => send(named),
    observe(name, cb) {
      const id = nextObserver++;
      observers.set(id, cb);
      return send(["observe_property", id, name]);
    },
    on(event, cb) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(cb);
    },
    close() {
      socket.destroy();
      if (!exited) child.kill("SIGTERM");
    },
  };
}

// Adapta mpv a lo que espera hostLogic: { loaded, paused, load, pause, resume, stop }, y le pasa
// los eventos (pausa, fin, error, avance) a quien escuche.
function createMpvPlayer(mpv, { onPauseChange, onEnded, onError, onTime, log = console }) {
  let loaded = false;
  let paused = false;
  let entry = null; // playlist_entry_id del archivo que está en curso
  let time = 0;
  let duration = 0;

  mpv.on("start-file", (e) => {
    entry = e.playlist_entry_id;
  });
  mpv.on("end-file", (e) => {
    // "stop" es cuando se carga otra o se detiene a propósito: eso lo decide quien llama.
    if (e.playlist_entry_id !== entry || (e.reason !== "eof" && e.reason !== "error")) return;
    loaded = false;
    if (e.reason === "eof") onEnded();
    else {
      log.warn("mpv no pudo reproducir el archivo:", e.file_error ?? "error desconocido");
      onError(time);
    }
  });
  mpv.observe("pause", (value) => {
    const changed = value !== paused;
    paused = !!value;
    if (changed && loaded) onPauseChange(paused);
  });
  mpv.observe("duration", (value) => {
    duration = typeof value === "number" ? value : 0;
  });
  // El avance se consulta una vez por segundo: observar time-pos manda un mensaje por cuadro, y en
  // una placa chica eso es CPU que le falta al video.
  const timer = setInterval(async () => {
    if (!loaded) return;
    try {
      const value = await mpv.command("get_property", "time-pos");
      if (typeof value !== "number") return;
      time = value;
      if (loaded) onTime(time, duration);
    } catch {
      /* todavía no hay posición (está abriendo el archivo) */
    }
  }, 1000);
  timer.unref();

  return {
    get loaded() {
      return loaded;
    },
    get paused() {
      return paused;
    },
    async load(url, startSeconds = 0) {
      loaded = true;
      time = 0;
      duration = 0;
      await mpv.command("set_property", "start", startSeconds > 0 ? String(startSeconds) : "none");
      await mpv.command("set_property", "pause", false);
      await mpv.command("loadfile", url, "replace");
    },
    pause: () => mpv.command("set_property", "pause", true).catch((e) => log.error(e.message)),
    resume: () => mpv.command("set_property", "pause", false).catch((e) => log.error(e.message)),
    stop() {
      loaded = false;
      return mpv.command("stop").catch((e) => log.error(e.message));
    },
  };
}

module.exports = { startMpv, createMpvPlayer, BASE_ARGS };
