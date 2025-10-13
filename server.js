const express = require("express");
const path = require("path");
const http = require("http");
const os = require("os");
const { URL } = require("url");
const WebSocket = require("ws");
const QRCode = require("qrcode");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = "./karaoke.db";

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error(
      "Error al conectar con la base de datos. ¿Ejecutaste 'npm run import'?"
    );
    console.error(err.message);
    process.exit(1);
  } else {
    console.log("Conectado a la base de datos de canciones en modo lectura.");
  }
});

let rooms = {};

function generateRoomId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let result = "";
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  if (rooms[result]) return generateRoomId();
  return result;
}

app.get("/api/songs", async (req, res) => {
  const sql = "SELECT artist, filename FROM songs ORDER BY artist, title";
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error("Error al obtener canciones:", err);
      return res
        .status(500)
        .json({ error: "No se pudieron obtener las canciones." });
    }

    const structuredSongs = {};
    rows.forEach(({ artist, filename }) => {
      let firstLetter = artist.charAt(0).toUpperCase();
      if (!isNaN(parseInt(firstLetter))) firstLetter = "#";
      if (!structuredSongs[firstLetter]) structuredSongs[firstLetter] = {};
      if (!structuredSongs[firstLetter][artist])
        structuredSongs[firstLetter][artist] = [];
      structuredSongs[firstLetter][artist].push(filename);
    });
    res.json(structuredSongs);
  });
});

app.get("/api/song-url", async (req, res) => {
  const { song } = req.query;
  if (!song)
    return res
      .status(400)
      .json({ error: "Nombre de la canción no especificado." });

  const sql = "SELECT url FROM songs WHERE filename = ?";
  db.get(sql, [song], (err, row) => {
    if (err) {
      console.error("Error al obtener URL de la canción:", err);
      return res.status(500).json({ error: "Error interno del servidor." });
    }
    if (row) {
      res.json({ url: row.url });
    } else {
      res.status(404).json({ error: "Canción no encontrada." });
    }
  });
});

app.post("/api/rooms", (req, res) => {
  const roomId = generateRoomId();
  rooms[roomId] = { songQueue: [], clients: new Set() };
  console.log(`Sala creada: ${roomId}`);
  res.json({ roomId });
});

app.get("/api/rooms/:roomId", (req, res) => {
  const { roomId } = req.params;
  if (rooms[roomId.toUpperCase()]) {
    res.json({ exists: true });
  } else {
    res.json({ exists: false });
  }
});

app.get("/api/qr", (req, res) => {
  const { sala } = req.query;
  if (!sala) return res.status(400).send("Falta el ID de la sala");

  let baseUrl;
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && req.headers.host) {
    baseUrl = `https://${req.headers.host}`;
  } else {
    const networkInterfaces = os.networkInterfaces();
    let localIp = "localhost";
    const candidates = [];
    for (const name of Object.keys(networkInterfaces)) {
      for (const net of networkInterfaces[name]) {
        if (net.family === "IPv4" && !net.internal)
          candidates.push(net.address);
      }
    }
    if (candidates.length > 0) {
      localIp =
        candidates.find((ip) => ip.startsWith("192.168.")) ||
        candidates.find((ip) => ip.startsWith("10.")) ||
        candidates[0];
    }
    baseUrl = `http://${localIp}:${PORT}`;
  }

  const remoteUrl = `${baseUrl}/remote.html?sala=${sala}`;
  console.log(
    `✅ URL del control remoto generada para la sala ${sala}: ${remoteUrl}`
  );
  QRCode.toDataURL(remoteUrl, (err, url) => {
    if (err) res.status(500).send("Error generando QR");
    else res.send({ qrUrl: url, remoteUrl });
  });
});

app.get("/favicon.ico", (req, res) => res.status(204).send());
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function broadcastToRoom(roomId, data) {
  const room = rooms[roomId];
  if (room) {
    room.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    });
  }
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomId = url.searchParams.get("sala")?.toUpperCase();
  const room = rooms[roomId];

  if (!room) {
    ws.close(4004, "Room not found");
    return;
  }

  ws.roomId = roomId;
  room.clients.add(ws);
  console.log(
    `Cliente conectado a la sala: ${roomId}. Total en sala: ${room.clients.size}`
  );

  ws.send(JSON.stringify({ type: "queueUpdate", payload: room.songQueue }));

  ws.on("message", (message) => {
    const data = JSON.parse(message);
    const currentRoom = rooms[ws.roomId];
    if (!currentRoom) return;

    let updateQueue = false;

    switch (data.type) {
      case "addSong":
        currentRoom.songQueue.push({ ...data.payload, id: Date.now() });
        updateQueue = true;
        break;
      case "removeSong":
        currentRoom.songQueue = currentRoom.songQueue.filter(
          (song) =>
            !(song.id === data.payload.id && song.name === data.payload.name)
        );
        updateQueue = true;
        break;
      case "playNext":
        if (currentRoom.songQueue.length > 0) currentRoom.songQueue.shift();
        updateQueue = true;
        break;
      case "controlAction":
      case "timeUpdate":
        broadcastToRoom(ws.roomId, JSON.stringify(data));
        break;
      case "getQueue":
        ws.send(
          JSON.stringify({
            type: "queueUpdate",
            payload: currentRoom.songQueue,
          })
        );
        break;
    }
    if (updateQueue) {
      broadcastToRoom(
        ws.roomId,
        JSON.stringify({ type: "queueUpdate", payload: currentRoom.songQueue })
      );
    }
  });

  ws.on("close", () => {
    const room = rooms[ws.roomId];
    if (room) {
      room.clients.delete(ws);
      console.log(
        `Cliente desconectado de la sala: ${ws.roomId}. Clientes restantes: ${room.clients.size}`
      );
      if (room.clients.size === 0) {
        console.log(`Sala ${ws.roomId} vacía. Eliminando sala.`);
        delete rooms[ws.roomId];
      }
    }
  });
});

server.listen(PORT, () =>
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`)
);
