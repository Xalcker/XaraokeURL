require("dotenv").config();
const express = require("express");
const path = require("path");
const http = require("http");
const { URL } = require("url");
const WebSocket = require("ws");
const QRCode = require("qrcode");
const sqlite3 = require("sqlite3").verbose();
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const FileStore = require('session-file-store')(session);

const app = express();
const PORT = process.env.PORT || 8081;
const DB_PATH = '/data/karaoke.db';

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        console.error("Error al conectar con la base de datos:", err.message);
        process.exit(1);
    } else {
        console.log("Conectado a la base de datos de canciones en modo lectura.");
    }
});

let rooms = {};

const sessionMiddleware = session({
    store: new FileStore({ path: '/data/sessions', ttl: 86400, logFn: function(){} }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);

app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback"
}, (accessToken, refreshToken, profile, done) => {
    const userEmail = profile.emails?.[0]?.value;
    if (userEmail && userEmail.endsWith('@xalcker.xyz')) {
        return done(null, profile);
    } else {
        return done(null, false, { message: 'Acceso denegado.' });
    }
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.redirect('/login');
}

app.get('/login', (req, res) => {
    res.send(`<div style="font-family: sans-serif; text-align: center; padding-top: 50px;"><h1>XaraokeURL</h1><p>Necesitas iniciar sesión para acceder al control remoto.</p><a href="/auth/google" style="background-color: #4285F4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Iniciar sesión con Google</a></div>`);
});

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login-failed' }), (req, res) => {
    res.redirect('/remote.html');
});

app.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        res.redirect('/');
    });
});

app.get('/login-failed', (req, res) => {
    res.status(403).send('<h1>Acceso denegado</h1><p>Debes usar una cuenta del dominio xalcker.xyz para acceder.</p>');
});

app.get('/api/me', ensureAuthenticated, (req, res) => {
    res.json({ name: req.user.displayName || 'Usuario' });
});

function generateRoomId() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let result = "";
    for (let i = 0; i < 4; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return rooms[result] ? generateRoomId() : result;
}

app.get("/api/songs", ensureAuthenticated, (req, res) => {
    db.all("SELECT artist, filename FROM songs ORDER BY artist, title", [], (err, rows) => {
        if (err) return res.status(500).json({ error: "No se pudieron obtener las canciones." });
        const structuredSongs = {};
        rows.forEach(({ artist, filename }) => {
            let firstLetter = artist.charAt(0).toUpperCase();
            if (!/\D/.test(firstLetter)) firstLetter = "#";
            if (!structuredSongs[firstLetter]) structuredSongs[firstLetter] = {};
            if (!structuredSongs[firstLetter][artist]) structuredSongs[firstLetter][artist] = [];
            structuredSongs[firstLetter][artist].push(filename);
        });
        res.json(structuredSongs);
    });
});

app.get("/api/song-url", (req, res) => {
    const { song } = req.query;
    if (!song) return res.status(400).json({ error: "Falta el nombre de la canción." });
    db.get("SELECT url FROM songs WHERE filename = ?", [song], (err, row) => {
        if (err || !row) return res.status(404).json({ error: "Canción no encontrada." });
        res.json({ url: row.url });
    });
});

app.post("/api/rooms", (req, res) => {
    const roomId = generateRoomId();
    rooms[roomId] = { songQueue: [], clients: new Set() };
    console.log(`Sala creada: ${roomId}`);
    res.json({ roomId });
});

app.get("/api/rooms/:roomId", (req, res) => {
    res.json({ exists: !!rooms[req.params.roomId.toUpperCase()] });
});

app.get("/api/qr", (req, res) => {
    const isProduction = process.env.NODE_ENV === "production";
    const baseUrl = isProduction ? `https://xaraokeurl.xalcker.xyz` : `http://${req.headers.host}`;
    const remoteUrl = `${baseUrl}/remote.html`;
    
    QRCode.toDataURL(remoteUrl, (err, url) => {
        if (err) {
            console.error("Error generando QR:", err);
            res.status(500).send("Error generando QR");
        } else {
            res.send({ qrUrl: url, remoteUrl });
        }
    });
});

app.get("/favicon.ico", (req, res) => res.status(204).send());
app.use('/remote.html', ensureAuthenticated);
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
    sessionMiddleware(req, {}, () => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const roomId = url.searchParams.get("sala")?.toUpperCase();
        const isHost = url.searchParams.get("isHost") === 'true';
        const isAuthenticated = req.session?.passport?.user;

        if (!isHost && !isAuthenticated) {
            return ws.close(4001, "Not authenticated");
        }
        
        if (!roomId) {
            return ws.close(4005, "Room ID not provided");
        }

        const room = rooms[roomId];
        if (!room) {
            return ws.close(4004, "Room not found");
        }
        
        ws.roomId = roomId;
        room.clients.add(ws);
        console.log(`Client connected to room ${roomId}. Total clients: ${room.clients.size}`);
        ws.send(JSON.stringify({ type: "queueUpdate", payload: room.songQueue }));

        ws.on("message", (message) => {
             const data = JSON.parse(message);
             const currentRoom = rooms[ws.roomId];
             if (!currentRoom) return;

             if (isAuthenticated && (data.type === "addSong" || data.type === "removeSong")) {
                 data.payload.name = req.session.passport.user.displayName;
             }
             
             let updateQueue = false;
             switch (data.type) {
                 case "addSong":
                     currentRoom.songQueue.push({ ...data.payload, id: Date.now() });
                     updateQueue = true;
                     break;
                 case "removeSong":
                     currentRoom.songQueue = currentRoom.songQueue.filter(song => 
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
                     return broadcastToRoom(ws.roomId, JSON.stringify(data));
                 case "getQueue":
                     return ws.send(JSON.stringify({ type: "queueUpdate", payload: currentRoom.songQueue }));
             }
             if (updateQueue) {
                 broadcastToRoom(ws.roomId, JSON.stringify({ type: "queueUpdate", payload: currentRoom.songQueue }));
             }
        });
        
        ws.on("close", () => {
             if (room) {
                 room.clients.delete(ws);
                 console.log(`Client disconnected from room ${roomId}. Remaining: ${room.clients.size}`);
                 if (room.clients.size === 0) {
                     delete rooms[roomId];
                     console.log(`Room ${roomId} deleted.`);
                 }
             }
        });
    });
});

server.listen(PORT, () => console.log(`🚀 Servidor corriendo en el puerto ${PORT}`));
