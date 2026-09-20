document.addEventListener("DOMContentLoaded", () => {
    const roomModal = document.getElementById("room-modal");
    const roomForm = document.getElementById("room-form");
    const roomCodeInput = document.getElementById("roomCodeInput");
    const joinRoomBtn = document.getElementById("joinRoomBtn");
    const roomError = document.getElementById("room-error");
    const mainContent = document.getElementById("main-content");
    const userNameDisplay = document.getElementById("userNameDisplay");
    const songQueueContainer = document.getElementById("songQueue");
    const songBrowser = document.getElementById("songBrowser");
    const songSearch = document.getElementById("songSearch");
    const currentSongTitle = document.getElementById("current-song-title");
    const currentSongTime = document.getElementById("current-song-time");
    const playPauseBtn = document.getElementById("playPauseBtn");
    const skipBtn = document.getElementById("skipBtn");
    const remoteRoomCodeDisplay = document.getElementById("remote-room-code");
    const hostStatusBanner = document.getElementById("host-status-banner");
    const confirmModal = document.getElementById("confirm-modal");
    const confirmModalText = document.getElementById("confirm-modal-text");
    const confirmModalYes = document.getElementById("confirm-modal-yes");
    const confirmModalCancel = document.getElementById("confirm-modal-cancel");
    const turnBanner = document.getElementById("turn-notification-banner");
    const ytDownloadModal = document.getElementById("yt-download-modal");

    let songData = {};
    let flatSongList = [];
    let ws;
    let myName = "";
    let upNextSongId = null;
    let currentQueue = [];
    let turnBannerTimeoutId = null;
    let lastYtQuery = "";
    let lastYtSuffix = "karaoke";
    let lastYtResults = [];

    // El audio de notificación se crea una sola vez y se "desbloquea" en la
    // primera interacción real del usuario (tap/click). Los navegadores
    // (sobre todo mobile) bloquean silenciosamente el play() automático que
    // dispara el WebSocket si nunca hubo un gesto del usuario de por medio.
    const notificationAudio = new Audio("/notification.mp3");
    notificationAudio.preload = "auto";
    let audioUnlocked = false;

    function unlockAudio() {
        if (audioUnlocked) return;
        notificationAudio
            .play()
            .then(() => {
                audioUnlocked = true;
                notificationAudio.pause();
                notificationAudio.currentTime = 0;
            })
            .catch(() => {
                // No se pudo desbloquear con este gesto; se reintenta con el
                // próximo click/tap (el listener sigue activo hasta lograrlo).
            });
    }
    document.addEventListener("click", unlockAudio);
    document.addEventListener("touchend", unlockAudio);

    roomCodeInput.addEventListener("input", () => {
        const cursorPos = roomCodeInput.selectionStart;
        roomCodeInput.value = roomCodeInput.value.toUpperCase();
        roomCodeInput.setSelectionRange(cursorPos, cursorPos);
    });

    async function initializeAppFlow() {
        try {
            const userRes = await fetch('/api/me');
            if (!userRes.ok) throw new Error('No autenticado');
            const userData = await userRes.json();
            myName = userData.name;
            userNameDisplay.textContent = `Usuario: ${myName}`;
        } catch {
            window.location.href = '/login';
        }
    }

    roomForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (joinRoomBtn.disabled) return;
        const roomCode = roomCodeInput.value.trim().toUpperCase();
        if (roomCode.length !== 4) {
            roomError.textContent = "El código debe tener 4 letras.";
            return;
        }

        roomError.textContent = "";
        joinRoomBtn.disabled = true;
        joinRoomBtn.textContent = "Verificando...";
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
        } catch {
            roomError.textContent = "Error al verificar la sala.";
        } finally {
            joinRoomBtn.disabled = false;
            joinRoomBtn.textContent = "Unirse";
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
            if (message.type === "hostStatus") {
                updateHostStatusBanner(message.payload?.connected !== false);
            }
        };
    }

    async function initializeMainApp(roomId) {
        remoteRoomCodeDisplay.textContent = `SALA: ${roomId}`;
        connectWebSocket(roomId);
        await loadSongs();
    }

    async function loadSongs() {
        try {
            const songsRes = await fetch("/api/songs");
            if (!songsRes.ok) throw new Error(`HTTP ${songsRes.status}`);
            songData = await songsRes.json();
            flatSongList = Object.values(songData)
                .flatMap((artists) => Object.values(artists))
                .flat();
            renderAlphabet();
        } catch (error) {
            console.error("Error cargando la lista de canciones:", error);
            songBrowser.innerHTML = "";
            const errorMsg = document.createElement("p");
            errorMsg.textContent = "No se pudieron cargar las canciones.";
            const retryBtn = document.createElement("button");
            retryBtn.type = "button";
            retryBtn.className = "back-btn";
            retryBtn.textContent = "🔄 Reintentar";
            retryBtn.onclick = loadSongs;
            songBrowser.appendChild(errorMsg);
            songBrowser.appendChild(retryBtn);
        }
    }

    function updateHostStatusBanner(connected) {
        if (!hostStatusBanner) return;
        hostStatusBanner.classList.toggle("hidden", connected);
    }

    function renderQueue(queue) {
        currentQueue = queue;
        songQueueContainer.innerHTML = "";
        queue.slice(1).forEach((item) => {
            const { songTitle } = parseSongFilename(item.song);
            const isMine = myName !== "" && item.name === myName;
            const div = document.createElement("div");
            div.className = isMine ? "queue-item mine" : "queue-item";
            div.innerHTML = `<span><b>${escapeHtml(songTitle)}</b> (${escapeHtml(isMine ? "tú" : item.name)})</span>`;
            if (isMine) {
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
            hideTurnBanner();
        }
    }

    function updateNowPlaying(data) {
        if (!data || !data.song) {
            currentSongTitle.textContent = "La cola está vacía";
            currentSongTime.textContent = "";
            return;
        }
        const remainingTime = data.duration - data.currentTime;
        const { artist, songTitle } = parseSongFilename(data.song);
        currentSongTitle.textContent = `Ahora suena: 🎵 ${artist} - ${songTitle}`;
        currentSongTime.textContent = `${formatTime(data.currentTime)} / ${formatTime(data.duration)} (Faltan ${formatTime(remainingTime)})`;
    }

    function notifyUser() {
        if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
        notificationAudio.currentTime = 0;
        notificationAudio.play().catch(e => console.error("No se pudo reproducir el sonido.", e));
        showTurnBanner();
    }

    function showTurnBanner() {
        if (!turnBanner) return;
        turnBanner.classList.remove("hidden");
        clearTimeout(turnBannerTimeoutId);
        // Red de seguridad por si el próximo queueUpdate no llega a limpiarlo
        // (por ejemplo, si se pierde la conexión justo después del aviso).
        turnBannerTimeoutId = setTimeout(hideTurnBanner, 15000);
    }

    function hideTurnBanner() {
        if (!turnBanner) return;
        turnBanner.classList.add("hidden");
        clearTimeout(turnBannerTimeoutId);
        turnBannerTimeoutId = null;
    }

    function formatTime(seconds) {
        if (isNaN(seconds) || seconds < 0) return "0:00";
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
        return `${mins}:${secs}`;
    }

    function renderAlphabet() {
        songBrowser.innerHTML = "";
        if (flatSongList.length === 0) {
            const emptyHint = document.createElement("p");
            emptyHint.textContent = "La biblioteca local está vacía. Escribe el nombre de una canción en el buscador para buscarla en YouTube.";
            songBrowser.appendChild(emptyHint);
            return;
        }
        const container = document.createElement("div");
        container.className = "alphabet-container";
        "#ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach(letter => {
            if (songData[letter]) {
                const letterEl = document.createElement("button");
                letterEl.type = "button";
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
            const artistEl = document.createElement("button");
            artistEl.type = "button";
            artistEl.className = "browser-item";
            artistEl.textContent = `🎤 ${artist}`;
            artistEl.onclick = () => renderSongs(letter, artist);
            songBrowser.appendChild(artistEl);
        });
    }

    function renderSongs(letter, artist) {
        songBrowser.innerHTML = "";
        addBackButton(() => renderArtists(letter));
        songData[letter][artist].forEach((filename) => {
            songBrowser.appendChild(createSongItem(filename));
        });
    }

    function createSongItem(filename) {
        const { songTitle } = parseSongFilename(filename);
        const songEl = document.createElement("button");
        songEl.type = "button";
        songEl.className = "browser-item";
        songEl.textContent = `🎵 ${songTitle}`;
        songEl.onclick = async () => {
            const confirmed = await showConfirm(`¿Añadir "${songTitle}" a la cola?`);
            if (confirmed) {
                ws.send(JSON.stringify({ type: "addSong", payload: { song: filename } }));
                songSearch.value = "";
                renderAlphabet();
            }
        };
        return songEl;
    }

    function addBackButton(onClickAction) {
        const backBtn = document.createElement("button");
        backBtn.type = "button";
        backBtn.className = "back-btn";
        backBtn.textContent = "← Volver";
        backBtn.onclick = onClickAction;
        songBrowser.appendChild(backBtn);
    }

    function normalizeForSearch(str) {
        return str.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    }

    function renderSearchResults(query) {
        const normalizedQuery = normalizeForSearch(query);
        songBrowser.innerHTML = "";
        const matches = flatSongList.filter((filename) => {
            const { artist, songTitle } = parseSongFilename(filename);
            return (
                normalizeForSearch(artist).includes(normalizedQuery) ||
                normalizeForSearch(songTitle).includes(normalizedQuery)
            );
        });
        if (matches.length === 0) {
            renderYoutubeSearchPrompt(query);
            return;
        }
        matches.slice(0, 50).forEach((filename) => {
            songBrowser.appendChild(createSongItem(filename));
        });
    }

    function renderYoutubeSearchPrompt(query) {
        songBrowser.innerHTML = "";

        const emptyMsg = document.createElement("p");
        emptyMsg.textContent = "No se encontraron canciones en la biblioteca.";
        songBrowser.appendChild(emptyMsg);

        const suffixLabel = document.createElement("label");
        suffixLabel.setAttribute("for", "ytSuffixSelect");
        suffixLabel.textContent = "Buscar en YouTube como:";
        songBrowser.appendChild(suffixLabel);

        const suffixSelect = document.createElement("select");
        suffixSelect.id = "ytSuffixSelect";
        [
            ["karaoke", "Karaoke"],
            ["instrumental", "Instrumental"],
            ["pista", "Pista"],
            ["none", "Sin sufijo"],
        ].forEach(([value, label]) => {
            const opt = document.createElement("option");
            opt.value = value;
            opt.textContent = label;
            suffixSelect.appendChild(opt);
        });
        songBrowser.appendChild(suffixSelect);

        const searchBtn = document.createElement("button");
        searchBtn.type = "button";
        searchBtn.className = "back-btn";
        searchBtn.textContent = "🔎 Buscar en YouTube";
        searchBtn.onclick = () => searchYoutubeUI(query, suffixSelect.value);
        songBrowser.appendChild(searchBtn);
    }

    async function searchYoutubeUI(query, suffix) {
        songBrowser.innerHTML = "";
        const loadingMsg = document.createElement("p");
        loadingMsg.textContent = "Buscando en YouTube...";
        songBrowser.appendChild(loadingMsg);

        try {
            const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}&suffix=${encodeURIComponent(suffix)}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Error de búsqueda");
            renderYoutubeResults(data.results, query, suffix);
        } catch (error) {
            songBrowser.innerHTML = "";
            const errMsg = document.createElement("p");
            errMsg.className = "yt-error";
            errMsg.textContent = error.message || "No se pudo buscar en YouTube. Intenta de nuevo.";
            songBrowser.appendChild(errMsg);
            const retryBtn = document.createElement("button");
            retryBtn.type = "button";
            retryBtn.className = "back-btn";
            retryBtn.textContent = "🔄 Reintentar";
            retryBtn.onclick = () => searchYoutubeUI(query, suffix);
            songBrowser.appendChild(retryBtn);
        }
    }

    function renderYoutubeResults(results, query, suffix) {
        lastYtQuery = query;
        lastYtSuffix = suffix;
        lastYtResults = results || [];

        songBrowser.innerHTML = "";
        addBackButton(() => renderYoutubeSearchPrompt(query));

        if (lastYtResults.length === 0) {
            const noResults = document.createElement("p");
            noResults.textContent = "No se encontraron resultados en YouTube.";
            songBrowser.appendChild(noResults);
            return;
        }

        lastYtResults.forEach((video) => {
            songBrowser.appendChild(createYoutubeResultItem(video));
        });
    }

    function createYoutubeResultItem(video) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "yt-result-item";

        if (video.thumbnail) {
            const thumb = document.createElement("img");
            thumb.src = video.thumbnail;
            thumb.alt = "";
            thumb.className = "yt-result-thumb";
            item.appendChild(thumb);
        }

        const info = document.createElement("div");
        info.className = "yt-result-info";

        const titleEl = document.createElement("span");
        titleEl.className = "yt-result-title";
        titleEl.textContent = video.title;
        info.appendChild(titleEl);

        const metaEl = document.createElement("span");
        metaEl.className = "yt-result-meta";
        const durationText = video.duration ? formatTime(video.duration) : "";
        metaEl.textContent = [video.channel, durationText].filter(Boolean).join(" · ");
        info.appendChild(metaEl);

        item.appendChild(info);

        item.onclick = async () => {
            const confirmed = await showConfirm(`¿Descargar "${video.title}" desde YouTube y agregarla a la cola? Puede tardar unos segundos.`);
            if (confirmed) {
                downloadAndQueueYoutube(video);
            }
        };

        return item;
    }

    async function downloadAndQueueYoutube(video) {
        ytDownloadModal.classList.remove("hidden");
        try {
            const res = await fetch("/api/youtube/download", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ videoId: video.id, title: video.title }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "No se pudo descargar el video.");
            ws.send(JSON.stringify({ type: "addSong", payload: { song: data.filename } }));
            songSearch.value = "";
            renderAlphabet();
        } catch (error) {
            renderYoutubeResults(lastYtResults, lastYtQuery, lastYtSuffix);
            const errMsg = document.createElement("p");
            errMsg.className = "yt-error";
            errMsg.textContent = error.message || "No se pudo descargar el video. Intenta de nuevo.";
            songBrowser.insertBefore(errMsg, songBrowser.firstChild);
        } finally {
            ytDownloadModal.classList.add("hidden");
        }
    }

    songSearch.addEventListener("input", () => {
        const query = songSearch.value.trim();
        if (!query) {
            renderAlphabet();
            return;
        }
        renderSearchResults(query);
    });

    function showConfirm(message) {
        return new Promise((resolve) => {
            confirmModalText.textContent = message;
            confirmModal.classList.remove("hidden");

            function cleanup(result) {
                confirmModal.classList.add("hidden");
                confirmModalYes.removeEventListener("click", onYes);
                confirmModalCancel.removeEventListener("click", onCancel);
                resolve(result);
            }
            function onYes() { cleanup(true); }
            function onCancel() { cleanup(false); }

            confirmModalYes.addEventListener("click", onYes);
            confirmModalCancel.addEventListener("click", onCancel);
        });
    }

    playPauseBtn.addEventListener("click", () => {
        if (currentQueue.length > 0) ws.send(JSON.stringify({ type: "controlAction", payload: { action: "playPause" } }));
    });

    skipBtn.addEventListener("click", () => {
        if (currentQueue.length > 0) ws.send(JSON.stringify({ type: "controlAction", payload: { action: "skip" } }));
    });

    initializeAppFlow();
});
