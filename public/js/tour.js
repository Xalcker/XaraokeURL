// Tutorial guiado del control remoto: recorre la pantalla resaltando un elemento a la vez y
// explicando para qué sirve. Los textos viven en el diccionario (js/i18n.js), claves "tour.*".
//
// Se carga como <script> plano en el navegador (define `createTour` y `REMOTE_TOUR_STEPS`) y
// también es requireable desde Node para las pruebas (mismo patrón que shared.js).
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = mod;
  }
  if (root) {
    Object.assign(root, { createTour: mod.createTour, REMOTE_TOUR_STEPS: mod.REMOTE_TOUR_STEPS });
  }
})(typeof window !== "undefined" ? window : undefined, function () {
  // Pasos del control remoto, en orden. `target` es el id del elemento que se resalta (sin él, la
  // tarjeta va centrada, para lo que no tiene un lugar en pantalla). `key` da los textos:
  // "tour.<key>.title" y "tour.<key>.text". Un paso cuyo elemento no se ve en ese momento se omite.
  const REMOTE_TOUR_STEPS = [
    { target: "remote-room-code", key: "room" },
    { target: "now-playing-info", key: "nowPlaying" },
    { target: "playPauseBtn", key: "playPause" },
    { target: "skipBtn", key: "skip" },
    { target: "song-search-form", key: "search" },
    { target: "songBrowser", key: "browse" },
    { target: "tab-queue", key: "queue" },
    { target: null, key: "alerts" },
    { target: "help-btn", key: "help" },
  ];

  // Dónde poner la tarjeta con la explicación. `target` es el recuadro resaltado ({ top, left,
  // width, height }, o null para centrarla); `card` y `viewport` son { width, height }. Va debajo del
  // elemento si cabe, y si no arriba; si no cabe en ninguno de los dos lados, del lado con más
  // espacio (puede tapar parte del elemento, pero nunca se sale de la pantalla).
  function cardPosition(target, card, viewport, { gap = 12, margin = 12 } = {}) {
    const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
    const maxLeft = viewport.width - card.width - margin;
    const maxTop = viewport.height - card.height - margin;
    if (!target) {
      return {
        top: clamp((viewport.height - card.height) / 2, margin, maxTop),
        left: clamp((viewport.width - card.width) / 2, margin, maxLeft),
        placement: "center",
      };
    }
    const spaceBelow = viewport.height - (target.top + target.height) - gap - margin;
    const spaceAbove = target.top - gap - margin;
    const below = card.height <= spaceBelow || (card.height > spaceAbove && spaceBelow >= spaceAbove);
    const top = below ? target.top + target.height + gap : target.top - gap - card.height;
    const centered = target.left + target.width / 2 - card.width / 2;
    return {
      top: clamp(top, margin, maxTop),
      left: clamp(centered, margin, maxLeft),
      placement: below ? "below" : "above",
    };
  }

  // Arma el tutorial sobre los elementos #tour* de la página. `steps` es una lista como
  // REMOTE_TOUR_STEPS y `t` el traductor. Devuelve { start, close }.
  function createTour({ steps, t }) {
    const byId = (id) => document.getElementById(id);
    const overlay = byId("tour");
    const spot = byId("tour-spot");
    const card = byId("tour-card");
    const counter = byId("tour-counter");
    const title = byId("tour-title");
    const text = byId("tour-text");
    const skipBtn = byId("tour-skip");
    const backBtn = byId("tour-back");
    const nextBtn = byId("tour-next");
    const SPOT_PADDING = 6;

    let active = [];      // pasos que se pueden mostrar ahora
    let index = 0;
    let returnFocus = null;
    let resizeObserver = null;

    const isShown = (id) => {
      const node = byId(id);
      return !!node && node.getClientRects().length > 0;
    };

    // Coloca el resaltado y la tarjeta según dónde está ahora el elemento del paso actual.
    function place() {
      const step = active[index];
      const node = step.target ? byId(step.target) : null;
      let box = null;
      if (node) {
        const rect = node.getBoundingClientRect();
        box = {
          top: rect.top - SPOT_PADDING,
          left: rect.left - SPOT_PADDING,
          width: rect.width + SPOT_PADDING * 2,
          height: rect.height + SPOT_PADDING * 2,
        };
      }
      const viewport = { width: document.documentElement.clientWidth, height: window.innerHeight };
      // Sin elemento, el resaltado es un punto en el centro: solo queda el fondo oscuro.
      const shown = box || { top: viewport.height / 2, left: viewport.width / 2, width: 0, height: 0 };
      spot.style.top = `${shown.top}px`;
      spot.style.left = `${shown.left}px`;
      spot.style.width = `${shown.width}px`;
      spot.style.height = `${shown.height}px`;
      overlay.classList.toggle("is-centered", !box);
      const position = cardPosition(box, { width: card.offsetWidth, height: card.offsetHeight }, viewport);
      card.style.top = `${position.top}px`;
      card.style.left = `${position.left}px`;
    }

    // `instant`: sin animar el resaltado (la primera vez no viene de ningún lado).
    function show(i, { instant = false } = {}) {
      index = i;
      const step = active[i];
      const last = i === active.length - 1;
      counter.textContent = t("tour.counter", { current: i + 1, total: active.length });
      title.textContent = t(`tour.${step.key}.title`);
      text.textContent = t(`tour.${step.key}.text`);
      backBtn.classList.toggle("hidden", i === 0);
      skipBtn.classList.toggle("hidden", last);
      nextBtn.textContent = t(last ? "tour.done" : "tour.next");
      const node = step.target ? byId(step.target) : null;
      if (node) {
        const rect = node.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > window.innerHeight) node.scrollIntoView({ block: "center" });
      }
      overlay.classList.toggle("no-motion", instant);
      place();
      if (instant) {
        void spot.offsetWidth;   // fija la posición inicial antes de volver a permitir la animación
        overlay.classList.remove("no-motion");
      }
      nextBtn.focus();
    }

    function next() {
      if (index >= active.length - 1) close();
      else show(index + 1);
    }

    function back() {
      if (index > 0) show(index - 1);
    }

    // Tab no sale de la tarjeta: del último botón vuelve al primero, y al revés con Mayús.
    function keepFocusInside(e) {
      const buttons = [skipBtn, backBtn, nextBtn].filter((btn) => !btn.classList.contains("hidden"));
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (!card.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    // Esc cierra, las flechas navegan y Tab se queda dentro de la tarjeta.
    const runInstead = (action) => (e) => {
      e.preventDefault();   // que la tecla no haga además lo suyo en la página de atrás
      action();
    };
    const keyHandlers = {
      Escape: runInstead(close),
      ArrowRight: runInstead(next),
      ArrowLeft: runInstead(back),
      Tab: keepFocusInside,
    };

    function onKeydown(e) {
      if (Object.hasOwn(keyHandlers, e.key)) keyHandlers[e.key](e);
    }

    function start() {
      if (!overlay.classList.contains("hidden")) return;
      active = steps.filter((step) => !step.target || isShown(step.target));
      if (active.length === 0) return;
      returnFocus = document.activeElement;
      overlay.classList.remove("hidden");
      document.addEventListener("keydown", onKeydown);
      window.addEventListener("resize", place);
      window.addEventListener("scroll", place, { passive: true });
      // La pantalla cambia de alto mientras se mira (llega la cola, cambia el título): se recoloca.
      if (typeof ResizeObserver === "function") {
        resizeObserver = new ResizeObserver(place);
        resizeObserver.observe(document.body);
      }
      show(0, { instant: true });
    }

    function close() {
      overlay.classList.add("hidden");
      document.removeEventListener("keydown", onKeydown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place);
      if (resizeObserver) resizeObserver.disconnect();
      resizeObserver = null;
      if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
      returnFocus = null;
    }

    nextBtn.addEventListener("click", next);
    backBtn.addEventListener("click", back);
    skipBtn.addEventListener("click", close);

    return { start, close };
  }

  return { REMOTE_TOUR_STEPS, cardPosition, createTour };
});
