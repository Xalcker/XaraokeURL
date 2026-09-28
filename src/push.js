// Push a iOS con la app cerrada (Fase 5 de la app iOS). iOS suspende el WebSocket propio en
// segundo plano, así que el servidor manda un push cuando le toca cantar a alguien y actualiza su
// Live Activity de la sala. En Android no hacía falta (un servicio en primer plano mantenía el
// WebSocket vivo); esta es la única diferencia que obliga a tocar el servidor.
//
// Módulo autocontenido y aditivo: si no está configurado (sin key APNs), todo es no-op y el
// servidor se comporta igual que antes. Se engancha a realtime con dos callbacks (onQueue, onTime)
// que ya existen como puntos de difusión, sin reescribir realtime.
//
// La detección de turno replica lib/TurnTracker de la app:
//   - UP_NEXT:  a la que suena le quedan <=10 s y la siguiente es tuya.
//   - STARTING: tu canción pasó a ser la de arriba sin aviso previo.
//
// APNs se habla por HTTP/2 con el módulo http2 nativo (sin dependencia npm). La autenticación es un
// JWT ES256 firmado con la key .p8 (crypto nativo). Requiere config:
//   APNS_KEY_PATH, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID  (+ APNS_PRODUCTION opcional)

const fs = require("fs");
const http2 = require("http2");
const crypto = require("crypto");

const TURN_LEAD_SECONDS = 10;
const APNS_HOST_PROD = "https://api.push.apple.com";
const APNS_HOST_DEV = "https://api.sandbox.push.apple.com";

// --- utilidades APNs ---

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// JWT ES256 para el header authorization de APNs. Se cachea 50 min (APNs los acepta hasta 1 h).
function makeTokenFactory({ keyPath, keyId, teamId }) {
  let cached = null;
  let cachedAt = 0;
  const key = fs.readFileSync(keyPath, "utf8");
  return function providerToken() {
    const now = Math.floor(Date.now() / 1000);
    if (cached && now - cachedAt < 50 * 60) return cached;
    const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId }));
    const payload = base64url(JSON.stringify({ iss: teamId, iat: now }));
    const signer = crypto.createSign("SHA256");
    signer.update(`${header}.${payload}`);
    const der = signer.sign({ key, dsaEncoding: "ieee-p1363" });
    cached = `${header}.${payload}.${base64url(der)}`;
    cachedAt = now;
    return cached;
  };
}

function createPush({ config }) {
  const cfg = pushConfig(config);
  // token de dispositivo -> { name, room }. Un mismo dispositivo tiene un token; se reescribe al reentrar.
  const devices = new Map();
  // token de Live Activity -> { room }. Se actualiza la actividad de la sala en segundo plano.
  const activities = new Map();

  const enabled = !!cfg;
  const providerToken = enabled ? makeTokenFactory(cfg) : null;
  const apnsHost = enabled && cfg.production ? APNS_HOST_PROD : APNS_HOST_DEV;
  let client = null;

  // Recuerda qué canción ya avisó a cada persona, para no repetir (como TurnTracker.alerted).
  // room -> Set(songId)  y  room -> Set(personas ya "primadas" al conectar).
  const alerted = new Map();
  const primed = new Map();

  function alertedSet(room) {
    if (!alerted.has(room)) alerted.set(room, new Set());
    return alerted.get(room);
  }

  // --- registro de tokens (lo llaman las rutas /api/push/*) ---

  function registerDevice(token, name, room) {
    if (!enabled || !token || !name || !room) return;
    devices.set(token, { name, room });
  }

  function unregisterDevice(token) {
    devices.delete(token);
  }

  function registerActivity(token, room) {
    if (!enabled || !token || !room) return;
    activities.set(token, { room });
  }

  // --- detección de turno (replica lib/TurnTracker de la app) ---

  // Se llama cada vez que cambia la cola de una sala (desde realtime.broadcastQueue).
  function onQueue(roomId, queue) {
    if (!enabled) return;
    const set = alertedSet(roomId);
    const first = !primed.get(roomId);
    primed.set(roomId, true);
    const head = queue[0];
    if (!head || !head.name || set.has(head.id)) return;
    // La primera cola tras (re)primar no dispara STARTING (igual que la app).
    set.add(head.id);
    if (!first) notifyTurn(roomId, head, "starting");
  }

  // Se llama con cada timeUpdate del host (desde realtime).
  function onTime(roomId, payload) {
    if (!enabled || !payload) return;
    const remaining = Number(payload.duration) - Number(payload.currentTime);
    if (!(remaining > 0) || remaining > TURN_LEAD_SECONDS) return;
    const room = payload.__queue; // realtime adjunta la cola actual (ver hook)
    const next = room && room[1];
    if (!next || !next.name) return;
    const set = alertedSet(roomId);
    if (set.has(next.id)) return;
    set.add(next.id);
    notifyTurn(roomId, next, "upNext");
  }

  // Al vaciarse la sala se olvida lo avisado, para no crecer sin fin.
  function onRoomGone(roomId) {
    alerted.delete(roomId);
    primed.delete(roomId);
  }

  function notifyTurn(roomId, item, kind) {
    const title = kind === "upNext"
      ? "¡Te toca cantar en unos segundos!"
      : "¡Tu canción está empezando!";
    const body = songLabel(item);
    for (const [token, info] of devices) {
      if (info.room === roomId && info.name === item.name) {
        sendAlert(token, title, body).catch(() => {});
      }
    }
  }

  // --- envío APNs ---

  function ensureClient() {
    if (client && !client.destroyed && !client.closed) return client;
    client = http2.connect(apnsHost);
    client.on("error", () => { client = null; });
    return client;
  }

  function post(token, payload, extraHeaders) {
    return new Promise((resolve) => {
      const session = ensureClient();
      const headers = {
        ":method": "POST",
        ":path": `/3/device/${token}`,
        authorization: `bearer ${providerToken()}`,
        "apns-topic": cfg.bundleId,
        ...extraHeaders,
      };
      const req = session.request(headers);
      let status = 0;
      req.on("response", (h) => { status = h[":status"]; });
      let data = "";
      req.on("data", (chunk) => { data += chunk; });
      req.on("end", () => {
        // 410 = token ya no válido: se olvida.
        if (status === 410 || (status === 400 && /BadDeviceToken/.test(data))) {
          devices.delete(token);
          activities.delete(token);
        }
        resolve({ status, data });
      });
      req.on("error", () => resolve({ status: 0, data: "" }));
      req.end(JSON.stringify(payload));
    });
  }

  // Aviso de turno: alerta visible + sonido + time-sensitive.
  function sendAlert(token, title, body) {
    return post(
      token,
      { aps: { alert: { title, body }, sound: "turn_alert.caf", "interruption-level": "time-sensitive" } },
      { "apns-push-type": "alert", "apns-priority": "10" }
    );
  }

  // Actualiza la Live Activity de una sala (lo llama realtime al cambiar la cola/tiempo).
  function updateActivities(roomId, contentState) {
    if (!enabled) return;
    for (const [token, info] of activities) {
      if (info.room !== roomId) continue;
      post(
        token,
        {
          aps: {
            timestamp: Math.floor(Date.now() / 1000),
            event: "update",
            "content-state": contentState,
          },
        },
        { "apns-push-type": "liveactivity", "apns-priority": "10", "apns-topic": `${cfg.bundleId}.push-type.liveactivity` }
      ).catch(() => {});
    }
  }

  function close() {
    if (client && !client.destroyed) client.close();
  }

  return {
    enabled,
    registerDevice,
    unregisterDevice,
    registerActivity,
    onQueue,
    onTime,
    onRoomGone,
    updateActivities,
    close,
  };
}

function songLabel(item) {
  if (item.title) return `YouTube - ${item.title}`;
  const base = String(item.song || "").replace(/\.mp4$/, "");
  const idx = base.indexOf(" - ");
  return idx > 0 ? `${base.slice(0, idx)} - ${base.slice(idx + 3)}` : base;
}

// Lee la config de APNs del entorno; nil si falta algo (todo queda no-op).
function pushConfig(config) {
  const c = config.apns || {};
  const keyPath = c.keyPath || process.env.APNS_KEY_PATH;
  const keyId = c.keyId || process.env.APNS_KEY_ID;
  const teamId = c.teamId || process.env.APNS_TEAM_ID;
  const bundleId = c.bundleId || process.env.APNS_BUNDLE_ID;
  if (!keyPath || !keyId || !teamId || !bundleId) return null;
  if (!fs.existsSync(keyPath)) return null;
  const production = (c.production ?? process.env.APNS_PRODUCTION) === true || process.env.APNS_PRODUCTION === "true";
  return { keyPath, keyId, teamId, bundleId, production };
}

module.exports = { createPush, TURN_LEAD_SECONDS };
