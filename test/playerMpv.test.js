// El adaptador entre mpv y la lógica del host (createMpvPlayer), con un mpv de mentira que emite los
// mismos eventos que el socket JSON de mpv. Lo delicado es no confundir el fin de una canción con
// el "fin" que mpv avisa cuando se carga otra encima o se detiene a propósito.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createMpvPlayer } = require("../player/lib/mpv");

function fakeMpv() {
  const listeners = {};
  const observers = {};
  const commands = [];
  return {
    commands,
    command: async (...args) => {
      commands.push(args);
      return args[0] === "get_property" ? 12.5 : undefined;
    },
    observe: async (name, cb) => {
      observers[name] = cb;
    },
    on: (event, cb) => {
      (listeners[event] ??= []).push(cb);
    },
    emit: (event, data) => (listeners[event] ?? []).forEach((cb) => cb({ event, ...data })),
    property: (name, value) => observers[name]?.(value),
  };
}

function setup() {
  const mpv = fakeMpv();
  const events = [];
  const player = createMpvPlayer(mpv, {
    onPauseChange: (p) => events.push(["pause", p]),
    onEnded: () => events.push(["ended"]),
    onError: (time) => events.push(["error", time]),
    onTime: () => {},
    log: { warn() {}, error() {} },
  });
  return { mpv, events, player };
}

test("load quita la pausa, fija el inicio y carga el archivo", async () => {
  const { mpv, player } = setup();
  await player.load("http://x/a.mp4", 42);
  assert.deepEqual(mpv.commands, [
    ["set_property", "start", "42"],
    ["set_property", "pause", false],
    ["loadfile", "http://x/a.mp4", "replace"],
  ]);
  assert.equal(player.loaded, true);
  await player.load("http://x/b.mp4", 0);
  assert.deepEqual(mpv.commands[3], ["set_property", "start", "none"], "sin inicio, desde el principio");
});

test("solo el fin natural del archivo en curso cuenta como terminado", async () => {
  const { mpv, events, player } = setup();
  await player.load("http://x/a.mp4");
  mpv.emit("start-file", { playlist_entry_id: 1 });
  await player.load("http://x/b.mp4");
  // mpv avisa que el primero terminó porque se cargó otro encima: no es un fin.
  mpv.emit("end-file", { playlist_entry_id: 1, reason: "stop" });
  mpv.emit("start-file", { playlist_entry_id: 2 });
  assert.deepEqual(events, []);
  assert.equal(player.loaded, true);
  mpv.emit("end-file", { playlist_entry_id: 2, reason: "eof" });
  assert.deepEqual(events, [["ended"]]);
  assert.equal(player.loaded, false);
});

test("un error del archivo en curso avisa por dónde iba", async () => {
  const { mpv, events, player } = setup();
  await player.load("http://x/a.mp4");
  mpv.emit("start-file", { playlist_entry_id: 7 });
  mpv.emit("end-file", { playlist_entry_id: 7, reason: "error", file_error: "loading failed" });
  assert.deepEqual(events, [["error", 0]]);
  assert.equal(player.loaded, false);
});

test("los cambios de pausa se avisan solo con algo cargado y solo si cambian", async () => {
  const { mpv, events, player } = setup();
  mpv.property("pause", true); // sin archivo: no le importa a nadie
  assert.deepEqual(events, []);
  await player.load("http://x/a.mp4");
  mpv.property("pause", false);
  mpv.property("pause", false);
  mpv.property("pause", true);
  assert.deepEqual(events, [["pause", false], ["pause", true]]);
  assert.equal(player.paused, true);
});

test("stop deja de contar el archivo como cargado", async () => {
  const { mpv, player } = setup();
  await player.load("http://x/a.mp4");
  await player.stop();
  assert.equal(player.loaded, false);
  assert.deepEqual(mpv.commands.at(-1), ["stop"]);
});
