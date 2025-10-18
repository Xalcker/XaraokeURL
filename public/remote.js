document.addEventListener("DOMContentLoaded", () => {
    const roomModal = document.getElementById("room-modal");
    const roomForm = document.getElementById("room-form");
    const roomCodeInput = document.getElementById("roomCodeInput");
    const roomError = document.getElementById("room-error");
    const mainContent = document.getElementById("main-content");
    const userNameDisplay = document.getElementById("userNameDisplay");
    const songQueueContainer = document.getElementById("songQueue");
    const songBrowser = document.getElementById("songBrowser");
    const currentSongTitle = document.getElementById("current-song-title");
    const currentSongTime = document.getElementById("current-song-time");
    const playPauseBtn = document.getElementById("playPauseBtn");
    const skipBtn = document.getElementById("skipBtn");
    const remoteRoomCodeDisplay = document.getElementById("remote-room-code");

    let songData = {};
    let ws;
    let myName = "";
    let upNextSongId = null;
    let currentQueue = [];

    async function initializeAppFlow() {
        try {
            const userRes = await fetch('/api/me');
            if (!userRes.ok) throw new Error('No autenticado');
            const userData = await userRes.json();
            myName = userData.name;
            userNameDisplay.textContent = `Usuario: ${myName}`;
        } catch (error) {
            window.location.href = '/login';
        }
    }

    roomForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const roomCode = roomCodeInput.value.trim().toUpperCase();
        if (roomCode.length !== 4) {
            roomError.textContent = "El código debe tener 4 letras.";
            return;
        }

        try {
            const response = await fetch(`/api/rooms/${roomCode}`);
            const data = await response.json();
            if (data.exists) {
                roomModal.classList.add('hidden');
                mainContent.classList.remove('hidden');
                initializeMainApp(roomCode);
            } else {
                roomError.textContent = `La sala "${roomCode}" no existe.`;
            }
        } catch (error) {
            roomError.textContent = "Error al verificar la sala.";
        }
    });

    function connectWebSocket(roomId) {
        const protocol = window.location.protocol === "https:" ? "wss" : "ws";
        ws = new WebSocket(`${protocol}://${window.location.host}?sala=${roomId}`);

        ws.onopen = () => console.log(`Remoto conectado a la sala: ${roomId}`);
        ws.onclose = () => setTimeout(() => connectWebSocket(roomId), 3000);
        ws.onerror = (error) => console.error("Error de WebSocket:", error);

        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === "queueUpdate") {
                renderQueue(message.payload);
                if (message.payload.length === 0) {
                    currentSongTitle.textContent = "La cola está vacía";
                    currentSongTime.textContent = "";
                }
            }
            if (message.type === "timeUpdate") {
                updateNowPlaying(message.payload);
                const data = message.payload;
                if (!data || !data.duration) return;
                const remainingTime = data.duration - data.currentTime;
                if (remainingTime > 0 && remainingTime <= 10 && currentQueue.length > 1 && currentQueue[1].name === myName && currentQueue[1].id !== upNextSongId) {
                    upNextSongId = currentQueue[1].id;
                    notifyUser();
                }
            }
        };
    }

    async function initializeMainApp(roomId) {
        remoteRoomCodeDisplay.textContent = `SALA: ${roomId}`;
        connectWebSocket(roomId);
        try {
            const songsRes = await fetch("/api/songs");
            songData = await songsRes.json();
            renderAlphabet();
        } catch (error) {
            console.error("Error cargando la lista de canciones:", error);
            songBrowser.innerHTML = "No se pudieron cargar las canciones.";
        }
    }

    function renderQueue(queue) {
        currentQueue = queue;
        songQueueContainer.innerHTML = "";
        queue.slice(1).forEach((item) => {
            const div = document.createElement("div");
            div.className = "queue-item";
            div.innerHTML = `<span><b>${item.song.replace(".mp4", "")}</b> (${item.name})</span>`;
            if (item.name === myName && myName !== "") {
                const removeBtn = document.createElement("button");
                removeBtn.textContent = "Quitar";
                removeBtn.className = "remove-btn";
                removeBtn.onclick = () => {
                    ws.send(JSON.stringify({ type: "removeSong", payload: { id: item.id } }));
                };
                div.appendChild(removeBtn);
            }
            songQueueContainer.appendChild(div);
        });
        const nextSongIsMine = queue.length > 1 && queue[1].name === myName;
        if (!nextSongIsMine) {
            upNextSongId = null;
        }
    }

    function updateNowPlaying(data) {
        if (!data || !data.song) {
            currentSongTitle.textContent = "La cola está vacía";
            currentSongTime.textContent = "";
            return;
        }
        const remainingTime = data.duration - data.currentTime;
        currentSongTitle.textContent = `Ahora suena: 🎵 ${data.song.replace(".mp4", "")}`;
        currentSongTime.textContent = `${formatTime(data.currentTime)} / ${formatTime(data.duration)} (Faltan ${formatTime(remainingTime)})`;
    }

    function notifyUser() {
        if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
        const audio = new Audio("/notification.mp3");
        audio.play().catch(e => console.error("No se pudo reproducir el sonido.", e));
    }

    function formatTime(seconds) {
        if (isNaN(seconds) || seconds < 0) return "0:00";
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
        return `${mins}:${secs}`;
    }

    function renderAlphabet() {
        songBrowser.innerHTML = "";
        const container = document.createElement("div");
        container.className = "alphabet-container";
        "#ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach(letter => {
            if (songData[letter]) {
                const letterEl = document.createElement("div");
                letterEl.className = "alphabet-item";
                letterEl.textContent = letter;
                letterEl.onclick = () => renderArtists(letter);
                container.appendChild(letterEl);
            }
        });
        songBrowser.appendChild(container);
    }

    function renderArtists(letter) {
        songBrowser.innerHTML = "";
        addBackButton(renderAlphabet);
        Object.keys(songData[letter]).sort().forEach(artist => {
            const artistEl = document.createElement("div");
            artistEl.className = "browser-item";
            artistEl.textContent = `🎤 ${artist}`;
            artistEl.onclick = () => renderSongs(letter, artist);
            songBrowser.appendChild(artistEl);
        });
    }

    function renderSongs(letter, artist) {
        songBrowser.innerHTML = "";
        addBackButton(() => renderArtists(letter));
        songData[letter][artist].forEach(filename => {
            const songTitle = filename.split(" - ")[1].replace(".mp4", "");
            const songEl = document.createElement("div");
            songEl.className = "browser-item";
            songEl.textContent = `🎵 ${songTitle}`;
            songEl.onclick = () => {
                if (confirm(`¿Añadir "${songTitle}" a la cola?`)) {
                    ws.send(JSON.stringify({ type: "addSong", payload: { song: filename } }));
                    renderAlphabet();
                }
            };
            songBrowser.appendChild(songEl);
        });
    }

    function addBackButton(onClickAction) {
        const backBtn = document.createElement("div");
        backBtn.className = "back-btn";
        backBtn.textContent = "← Volver";
        backBtn.onclick = onClickAction;
        songBrowser.appendChild(backBtn);
    }

    playPauseBtn.addEventListener("click", () => {
        if (currentQueue.length > 0) ws.send(JSON.stringify({ type: "controlAction", payload: { action: "playPause" } }));
    });

    skipBtn.addEventListener("click", () => {
        if (currentQueue.length > 0) ws.send(JSON.stringify({ type: "controlAction", payload: { action: "skip" } }));
    });

    initializeAppFlow();
});
