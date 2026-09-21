document.addEventListener("DOMContentLoaded", () => {
    const roomModal = document.getElementById("room-modal");
    const roomForm = document.getElementById("room-form");
    const roomCodeInput = document.getElementById("roomCodeInput");
    const joinRoomBtn = document.getElementById("joinRoomBtn");
    const devNameField = document.getElementById("dev-name-field");
    const devNameInput = document.getElementById("devNameInput");
    const roomError = document.getElementById("room-error");
    const mainContent = document.getElementById("main-content");
    const userNameDisplay = document.getElementById("userNameDisplay");
    const songQueueContainer = document.getElementById("songQueue");
    const songBrowser = document.getElementById("songBrowser");
    const songSearch = document.getElementById("songSearch");
    const songSearchForm = document.getElementById("song-search-form");
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
    const stickyTop = document.getElementById("sticky-top");
    const progressBar = document.getElementById("progress-bar");
    const tabsBar = document.getElementById("tabs");
    const tabSearch = document.getElementById("tab-search");
    const tabQueue = document.getElementById("tab-queue");
    const searchPanel = document.getElementById("search-panel");
    const queuePanel = document.getElementById("queue-container");
    const queueBadge = document.getElementById("queue-badge");
    const queueSummary = document.getElementById("queue-summary");
    const toast = document.getElementById("toast");
    const miniPlayer = document.getElementById("mini-player");
    const pausedTag = document.getElementById("paused-tag");

    let songData = {};
    let flatSongList = [];
    // Videos de YouTube ya descargados en el servidor: también son buscables.
    let downloadList = [];
    let ws;
    let myName = "";
    let devMode = false;
    let upNextSongId = null;
    let currentQueue = [];
    let turnBannerTimeoutId = null;
    let selectedYtSuffix = "karaoke";
    let lastYtQuery = "";
    let lastYtSuffix = "karaoke";
    let lastYtResults = [];
    let lastProgress = null;
    let shownHeadId = null;
    let lastMineCount = 0;
    let queueSeen = false;
    let toastTimeoutId = null;
    let playbackPaused = false;   // lo informa el host
    let hostConnected = true;
    let confirmSkipId = null;     // canción por la que se está pidiendo confirmación para saltar
    let skipPendingId = null;     // canción cuyo salto ya se pidió y aún no se ve reflejado en la cola
    let skipPendingTimerId = null;

    const songDisplay = (item) => getSongDisplay(item, t("song.unknownArtist"));

    // Error de una respuesta de la API: su `error` ya viene en el idioma de la
    // persona (el servidor lo elige con Accept-Language). Si la petición ni llegó
    // (sin red) o la respuesta no tiene mensaje, quien lo muestre usa un texto
    // propio en lugar del "Failed to fetch" del navegador.
    // Envía por el WebSocket. Devuelve false si no hay conexión en este momento (por ejemplo, mientras
    // reconecta): enviar entonces lanzaría una excepción y la persona creería que se hizo.
    function sendMessage(type, payload) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return false;
        ws.send(JSON.stringify({ type, payload }));
        return true;
    }

    function failedRequest(data) {
        const err = new Error(data && data.error ? data.error : "request failed");
        err.fromServer = !!(data && data.error);
        return err;
    }

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
            if (userData.devMode) {
                // Modo desarrollo (sin login de Google): cada dispositivo elige
                // su nombre. Se sugiere el guardado en su sesión, o el de .env.
                devMode = true;
                devNameField.classList.remove('hidden');
                devNameInput.value = userData.name || userData.suggestedName || "";
                myName = userData.name || "";
            } else {
                myName = userData.name;
                userNameDisplay.textContent = t("remote.user", { name: myName });
            }
        } catch {
            window.location.href = '/login';
        }
    }

    roomForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (joinRoomBtn.disabled) return;
        const roomCode = roomCodeInput.value.trim().toUpperCase();
        if (roomCode.length !== 4) {
            roomError.textContent = t("remote.join.codeLength");
            return;
        }
        if (devMode && !devNameInput.value.trim()) {
            roomError.textContent = t("remote.join.nameRequired");
            return;
        }

        roomError.textContent = "";
        joinRoomBtn.disabled = true;
        joinRoomBtn.textContent = t("remote.join.verifying");
        try {
            if (devMode) {
                const nameRes = await fetch('/api/dev-name', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: devNameInput.value }),
                });
                const nameData = await nameRes.json();
                if (!nameRes.ok) {
                    roomError.textContent = nameData.error || t("remote.join.nameSaveFailed");
                    return;
                }
                myName = nameData.name;
                devNameInput.value = myName;
                userNameDisplay.textContent = t("remote.user", { name: myName });
            }
            const response = await fetch(`/api/rooms/${roomCode}`);
            const data = await response.json();
            if (data.exists) {
                roomModal.classList.add('hidden');
                mainContent.classList.remove('hidden');
                initializeMainApp(roomCode);
            } else {
                roomError.textContent = t("remote.join.roomMissing", { code: roomCode });
            }
        } catch {
            roomError.textContent = t("remote.join.verifyFailed");
        } finally {
            joinRoomBtn.disabled = false;
            joinRoomBtn.textContent = t("remote.join.button");
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
                if (message.payload.length === 0) showEmptyNowPlaying();
                else showQueueHead(message.payload[0]);
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
            if (message.type === "playbackState") {
                playbackPaused = message.payload?.paused === true;
                updateControls();
            }
        };
    }

    async function initializeMainApp(roomId) {
        remoteRoomCodeDisplay.textContent = t("remote.room", { code: roomId });
        connectWebSocket(roomId);
        await loadDownloads();
        await loadSongs();
    }

    // Si falla se conserva la última lista conocida: es un extra de la búsqueda,
    // no debe impedir usar el resto.
    // Devuelve true si la lista cambió respecto a la que ya se tenía.
    async function loadDownloads() {
        try {
            const res = await fetch("/api/downloads");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const fresh = await res.json();
            const changed =
                fresh.map((d) => d.filename).join("|") !== downloadList.map((d) => d.filename).join("|");
            downloadList = fresh;
            return changed;
        } catch (error) {
            console.error("No se pudo cargar la lista de descargas:", error);
            return false;
        }
    }

    // ¿Está en pantalla la búsqueda local (con coincidencias o con el aviso de
    // "buscar en YouTube")? Se reconoce por el selector de sufijo, que siempre la acompaña.
    function showingLocalSearch() {
        return !!songBrowser.querySelector("#ytSuffixSelect");
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
            errorMsg.textContent = t("library.loadFailed");
            const retryBtn = document.createElement("button");
            retryBtn.type = "button";
            retryBtn.className = "back-btn";
            setLabel(retryBtn, "refresh", t("remote.retry"));
            retryBtn.onclick = loadSongs;
            songBrowser.appendChild(errorMsg);
            songBrowser.appendChild(retryBtn);
        }
    }

    function updateHostStatusBanner(connected) {
        if (!hostStatusBanner) return;
        hostStatusBanner.classList.toggle("hidden", connected);
        hostConnected = connected;
        updateControls();
    }

    // Los botones y la etiqueta de pausa reflejan el estado real: play/pausa según lo que informó el
    // host, y sin nada que controlar (cola vacía o host desconectado) quedan deshabilitados.
    function updateControls() {
        const active = hostConnected && currentQueue.length > 0;
        const paused = active && playbackPaused;
        playPauseBtn.disabled = !active;
        skipBtn.disabled = !active || skipPendingId !== null;
        playPauseBtn.dataset.state = paused ? "paused" : "playing";
        const label = t(paused ? "remote.play" : "remote.pause");
        playPauseBtn.setAttribute("aria-label", label);
        playPauseBtn.title = label;
        miniPlayer.classList.toggle("is-paused", paused);
        pausedTag.classList.toggle("hidden", !paused);
    }

    function clearSkipPending() {
        clearTimeout(skipPendingTimerId);
        skipPendingId = null;
        updateControls();
    }

    function renderQueue(queue) {
        currentQueue = queue;
        songQueueContainer.innerHTML = "";
        queue.slice(1).forEach((item) => {
            const { songTitle } = songDisplay(item);
            const isMine = myName !== "" && item.name === myName;
            const div = document.createElement("div");
            div.className = isMine ? "queue-item mine" : "queue-item";
            div.innerHTML = `<span><b>${escapeHtml(songTitle)}</b> (${escapeHtml(isMine ? t("remote.queue.you") : item.name)})</span>`;
            if (isMine) {
                const removeBtn = document.createElement("button");
                removeBtn.textContent = t("remote.queue.remove");
                removeBtn.className = "remove-btn";
                removeBtn.onclick = () => {
                    if (!sendMessage("removeSong", { id: item.id })) showToast("toast.offline");
                };
                div.appendChild(removeBtn);
            }
            songQueueContainer.appendChild(div);
        });
        if (queue.length <= 1) {
            const hint = document.createElement("p");
            hint.className = "empty-hint";
            hint.textContent = t("queue.emptyList");
            songQueueContainer.appendChild(hint);
        }
        updateQueueTab();
        // Si la canción de arriba ya no es aquella por la que se pidió saltar, el salto ya ocurrió (o
        // ya no aplica): se libera el botón y se cierra la confirmación que quedara abierta.
        if (skipPendingId && queue[0]?.id !== skipPendingId) clearSkipPending();
        if (confirmSkipId && queue[0]?.id !== confirmSkipId) confirmModalCancel.click();
        updateControls();
        const nextSongIsMine = queue.length > 1 && queue[1].name === myName;
        if (!nextSongIsMine) {
            upNextSongId = null;
            hideTurnBanner();
        }
    }

    function updateNowPlaying(data) {
        if (!data || !data.song) {
            showEmptyNowPlaying();
            return;
        }
        const remainingTime = data.duration - data.currentTime;
        const { artist, songTitle } = songDisplay(data);
        setLabel(currentSongTitle, "music", t("remote.nowPlaying", { artist, title: songTitle }));
        currentSongTime.textContent = t("remote.timeLeft", {
            elapsed: formatTime(data.currentTime),
            total: formatTime(data.duration),
            remaining: formatTime(remainingTime),
        });
        setProgress(data.duration > 0 ? (data.currentTime / data.duration) * 100 : 0);
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

    function showEmptyNowPlaying() {
        currentSongTitle.textContent = t("remote.queue.empty");
        currentSongTime.textContent = "";
        setProgress(0);
        lastProgress = null; // sin canción: la próxima posición que llegue se coloca de golpe
        shownHeadId = null;
    }

    // El mini-reproductor sigue a la cola: cuando cambia la canción de arriba (se añadió la primera
    // o se saltó) se muestra de inmediato, sin esperar a que el host mande el tiempo. Mientras sea la
    // misma, el título y el tiempo los mantiene la actualización del host.
    function showQueueHead(head) {
        if (head.id === shownHeadId) return;
        shownHeadId = head.id;
        const { artist, songTitle } = songDisplay(head);
        setLabel(currentSongTitle, "music", t("remote.nowPlaying", { artist, title: songTitle }));
        currentSongTime.textContent = "";
        setProgress(0);
        lastProgress = null;
    }

    // La barra avanza con una transición suave, pero la primera vez y cuando retrocede (canción
    // nueva) se coloca de golpe, para que no recorra todo el camino de vuelta.
    function setProgress(percent) {
        const value = Math.min(100, Math.max(0, percent));
        progressBar.style.transition = lastProgress === null || value < lastProgress ? "none" : "";
        progressBar.style.width = value + "%";
        lastProgress = value;
    }

    // Contador de "Mi cola" (cuántas canciones tuyas hay en la cola, la que suena incluida) y
    // resumen de cuánto falta para tu turno. El contador se anima cuando sube, salvo en la
    // primera lista que llega (por ejemplo, al reconectar con canciones que ya estaban).
    function updateQueueTab() {
        const mine = (item) => myName !== "" && item.name === myName;
        const mineCount = currentQueue.filter(mine).length;
        queueBadge.textContent = String(mineCount);
        queueBadge.classList.toggle("hidden", mineCount === 0);
        if (queueSeen && mineCount > lastMineCount) {
            queueBadge.classList.remove("bump");
            void queueBadge.offsetWidth; // reinicia la animación si ya estaba en marcha
            queueBadge.classList.add("bump");
        }
        lastMineCount = mineCount;
        queueSeen = true;

        const firstMine = currentQueue.findIndex(mine);
        if (firstMine === -1) queueSummary.textContent = t("queue.summary.none");
        else if (firstMine === 0) queueSummary.textContent = t("queue.summary.playing");
        else if (firstMine === 1) queueSummary.textContent = t("queue.summary.next");
        else queueSummary.textContent = t("queue.summary.ahead", { n: firstMine });
    }

    function selectTab(name, { focus = false } = {}) {
        const showQueue = name === "queue";
        tabSearch.setAttribute("aria-selected", String(!showQueue));
        tabQueue.setAttribute("aria-selected", String(showQueue));
        tabSearch.tabIndex = showQueue ? -1 : 0;
        tabQueue.tabIndex = showQueue ? 0 : -1;
        searchPanel.classList.toggle("hidden", showQueue);
        queuePanel.classList.toggle("hidden", !showQueue);
        if (focus) (showQueue ? tabQueue : tabSearch).focus();
        // Si se había bajado por la lista, se vuelve al inicio del panel nuevo (justo bajo la barra fija).
        const panel = showQueue ? queuePanel : searchPanel;
        const top = panel.getBoundingClientRect().top + window.scrollY - stickyTop.offsetHeight;
        if (window.scrollY > top) window.scrollTo(0, Math.max(0, top));
    }

    function showToast(messageKey) {
        toast.textContent = t(messageKey);
        toast.classList.remove("hidden");
        clearTimeout(toastTimeoutId);
        toastTimeoutId = setTimeout(() => toast.classList.add("hidden"), 2500);
    }

    // Pone un ícono seguido del texto. El texto se agrega como nodo de texto (no
    // por innerHTML), así que lo que venga de YouTube o de otros usuarios no puede
    // inyectar HTML.
    function setLabel(el, iconName, text) {
        el.textContent = "";
        el.insertAdjacentHTML("beforeend", iconSvg(iconName));
        el.appendChild(document.createTextNode(text));
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
            emptyHint.textContent = t("library.empty");
            songBrowser.appendChild(emptyHint);
            if (downloadList.length > 0) {
                const downloadsHint = document.createElement("p");
                downloadsHint.textContent = t("library.downloads", { n: downloadList.length });
                songBrowser.appendChild(downloadsHint);
            }
            appendYoutubeSuffixSelect();
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
            setLabel(artistEl, "mic", artist);
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

    async function confirmAndQueue(filename, title) {
        const confirmed = await showConfirm(t("confirm.addSong", { title }));
        if (confirmed) {
            if (!sendMessage("addSong", { song: filename })) {
                showToast("toast.offline");
                return;
            }
            showToast("toast.added");
            songSearch.value = "";
            renderAlphabet();
        }
    }

    function createSongItem(filename) {
        const { songTitle } = parseSongFilename(filename);
        const songEl = document.createElement("button");
        songEl.type = "button";
        songEl.className = "browser-item";
        setLabel(songEl, "music", songTitle);
        songEl.onclick = () => confirmAndQueue(filename, songTitle);
        return songEl;
    }

    // Video de YouTube que ya se descargó antes: se agrega directo, sin volver a bajarlo.
    function createDownloadItem(download) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "browser-item";
        const title = document.createElement("span");
        setLabel(title, "download", download.title);
        item.appendChild(title);
        const meta = document.createElement("small");
        meta.textContent = [t("library.alreadyDownloaded"), download.channel].filter(Boolean).join(" · ");
        item.appendChild(meta);
        item.onclick = () => confirmAndQueue(download.filename, download.title);
        return item;
    }

    function addBackButton(onClickAction) {
        const backBtn = document.createElement("button");
        backBtn.type = "button";
        backBtn.className = "back-btn";
        setLabel(backBtn, "arrow-left", t("remote.back"));
        backBtn.onclick = onClickAction;
        songBrowser.appendChild(backBtn);
    }

    function normalizeForSearch(str) {
        return str.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    }

    // Coincidencias locales: canciones del catálogo y videos ya descargados de
    // YouTube (estos últimos también por su canal y por la búsqueda original con
    // la que se encontraron).
    function findLocalMatches(query) {
        const normalizedQuery = normalizeForSearch(query);
        const songs = flatSongList.filter((filename) => {
            const { artist, songTitle } = parseSongFilename(filename);
            return (
                normalizeForSearch(artist).includes(normalizedQuery) ||
                normalizeForSearch(songTitle).includes(normalizedQuery)
            );
        });
        const downloads = downloadList.filter((download) =>
            [download.title, download.channel, download.query].some(
                (text) => text && normalizeForSearch(text).includes(normalizedQuery)
            )
        );
        return { songs, downloads };
    }

    function renderSearchResults(query) {
        songBrowser.innerHTML = "";
        const { songs, downloads } = findLocalMatches(query);
        if (songs.length === 0 && downloads.length === 0) {
            renderYoutubeSearchPrompt(query);
            return;
        }
        // Arriba de la lista, para no tener que recorrerla entera: aunque haya
        // coincidencias, puede que la que se busca no esté (otra versión, otro canal).
        appendYoutubeSearchControls(query);
        songs.slice(0, 50).forEach((filename) => {
            songBrowser.appendChild(createSongItem(filename));
        });
        downloads.slice(0, 20).forEach((download) => {
            songBrowser.appendChild(createDownloadItem(download));
        });
    }

    // Selector de sufijo (Karaoke / Instrumental / Pista / Sin sufijo). La
    // opción elegida se recuerda en `selectedYtSuffix`, porque el panel se
    // vuelve a dibujar con cada tecla y si no se reiniciaría a "Karaoke".
    function appendYoutubeSuffixSelect() {
        const suffixLabel = document.createElement("label");
        suffixLabel.setAttribute("for", "ytSuffixSelect");
        suffixLabel.textContent = t("yt.suffixLabel");
        songBrowser.appendChild(suffixLabel);

        const suffixSelect = document.createElement("select");
        suffixSelect.id = "ytSuffixSelect";
        t("yt.suffixOptions").split(",").forEach((value) => {
            const opt = document.createElement("option");
            opt.value = value;
            opt.textContent = t(`yt.suffix.${value}`);
            suffixSelect.appendChild(opt);
        });
        suffixSelect.value = selectedYtSuffix;
        suffixSelect.onchange = () => { selectedYtSuffix = suffixSelect.value; };
        songBrowser.appendChild(suffixSelect);
    }

    function renderYoutubeSearchPrompt(query) {
        songBrowser.innerHTML = "";

        const emptyMsg = document.createElement("p");
        emptyMsg.textContent = flatSongList.length === 0 && downloadList.length === 0
            ? t("yt.pressEnter")
            : t("yt.noLocalMatches");
        songBrowser.appendChild(emptyMsg);
        appendYoutubeSearchControls(query);
    }

    function appendYoutubeSearchControls(query) {
        appendYoutubeSuffixSelect();

        const searchBtn = document.createElement("button");
        searchBtn.type = "button";
        searchBtn.className = "back-btn";
        setLabel(searchBtn, "search", t("yt.searchButton"));
        searchBtn.onclick = () => searchYoutubeUI(query, selectedYtSuffix);
        songBrowser.appendChild(searchBtn);
    }

    async function searchYoutubeUI(query, suffix) {
        songBrowser.innerHTML = "";
        const loadingMsg = document.createElement("p");
        loadingMsg.textContent = t("yt.searching");
        songBrowser.appendChild(loadingMsg);

        try {
            const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}&suffix=${encodeURIComponent(suffix)}`);
            const data = await res.json();
            if (!res.ok) throw failedRequest(data);
            renderYoutubeResults(data.results, query, suffix);
        } catch (error) {
            songBrowser.innerHTML = "";
            const errMsg = document.createElement("p");
            errMsg.className = "yt-error";
            errMsg.textContent = error.fromServer ? error.message : t("yt.searchFailed");
            songBrowser.appendChild(errMsg);
            const retryBtn = document.createElement("button");
            retryBtn.type = "button";
            retryBtn.className = "back-btn";
            setLabel(retryBtn, "refresh", t("remote.retry"));
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
            noResults.textContent = t("yt.noResults");
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
            const confirmed = await showConfirm(t("confirm.download", { title: video.title }));
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
                // El servidor guarda la búsqueda original junto a la descarga (el
                // título y el canal los consulta él mismo a YouTube).
                body: JSON.stringify({ videoId: video.id, query: lastYtQuery, suffix: lastYtSuffix }),
            });
            const data = await res.json();
            if (!res.ok) throw failedRequest(data);
            showToast(sendMessage("addSong", { song: data.filename }) ? "toast.added" : "toast.offline");
            loadDownloads();
            songSearch.value = "";
            renderAlphabet();
        } catch (error) {
            renderYoutubeResults(lastYtResults, lastYtQuery, lastYtSuffix);
            const errMsg = document.createElement("p");
            errMsg.className = "yt-error";
            errMsg.textContent = error.fromServer ? error.message : t("yt.downloadFailed");
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

    // Otras personas pueden haber descargado videos desde que se abrió esta
    // pantalla: al ir a buscar se refresca la lista. Si la respuesta llega
    // cuando ya se buscó (por ejemplo, al pegar el texto) y en pantalla está la
    // búsqueda local, se vuelve a dibujar para incluir las descargas nuevas.
    songSearch.addEventListener("focus", async () => {
        const changed = await loadDownloads();
        const query = songSearch.value.trim();
        if (changed && query && showingLocalSearch()) renderSearchResults(query);
    });

    // Enter (o la tecla "Ir/Buscar" del teclado del celular) busca directo en
    // YouTube cuando no hay coincidencias locales (ni en el catálogo ni entre
    // los videos ya descargados); con la biblioteca vacía eso ocurre siempre.
    // Si hay coincidencias locales no hace nada. Antes de decidir se actualiza la
    // lista de descargas, para no mandar a YouTube algo que otra persona ya bajó.
    songSearchForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const query = songSearch.value.trim();
        if (!query) return;
        await loadDownloads();
        const { songs, downloads } = findLocalMatches(query);
        if (songs.length === 0 && downloads.length === 0) {
            searchYoutubeUI(query, selectedYtSuffix);
        } else if (showingLocalSearch()) {
            renderSearchResults(query);
        }
    });

    // `danger`: el botón de confirmar va en rojo (acciones que afectan a todos, como saltar una canción).
    function showConfirm(message, { confirmKey = "confirm.add", danger = false } = {}) {
        return new Promise((resolve) => {
            confirmModalText.textContent = message;
            confirmModalYes.textContent = t(confirmKey);
            confirmModalYes.classList.toggle("confirm-btn-danger", danger);
            confirmModalYes.classList.toggle("confirm-btn-yes", !danger);
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

    // Se pide la acción explícita según el estado que se ve ("pause" o "play"), no "alternar": si dos
    // personas pulsan a la vez, las dos piden lo mismo y no se cancelan entre sí.
    playPauseBtn.addEventListener("click", () => {
        if (playPauseBtn.disabled) return;
        if (!sendMessage("controlAction", { action: playbackPaused ? "play" : "pause" })) showToast("toast.offline");
    });

    // Saltar afecta a todos (se salta la canción de quien esté cantando): antes de hacerlo se confirma,
    // diciendo cuál es y de quién. Se pide saltar esa canción concreta (por su id): si mientras se
    // decidía ya cambió, no se salta la siguiente por error.
    skipBtn.addEventListener("click", async () => {
        const head = currentQueue[0];
        if (!head || skipBtn.disabled) return;
        const { artist, songTitle } = songDisplay(head);
        const song = t("remote.nowPlaying", { artist, title: songTitle });
        const mine = myName !== "" && head.name === myName;
        confirmSkipId = head.id;
        const confirmed = await showConfirm(
            mine ? t("confirm.skipMine", { song }) : t("confirm.skipOther", { song, name: head.name }),
            { confirmKey: "confirm.skipYes", danger: true }
        );
        confirmSkipId = null;
        if (!confirmed || currentQueue[0]?.id !== head.id) return;
        if (!sendMessage("controlAction", { action: "skip", id: head.id })) {
            showToast("toast.offline");
            return;
        }
        // Hasta que la cola refleje el salto, el botón queda deshabilitado (evita el doble toque);
        // si el host no responde, se libera solo a los pocos segundos.
        skipPendingId = head.id;
        clearTimeout(skipPendingTimerId);
        skipPendingTimerId = setTimeout(clearSkipPending, 4000);
        updateControls();
    });

    tabSearch.addEventListener("click", () => selectTab("search"));
    tabQueue.addEventListener("click", () => selectTab("queue"));

    // Con el teclado: flechas para pasar de una pestaña a otra, Inicio y Fin para ir a la primera o a la última.
    const tabKeyTargets = { ArrowLeft: "search", Home: "search", ArrowRight: "queue", End: "queue" };
    tabsBar.addEventListener("keydown", (e) => {
        if (!(e.key in tabKeyTargets)) return;
        e.preventDefault();
        selectTab(tabKeyTargets[e.key], { focus: true });
    });

    updateControls();
    initializeAppFlow();
});
