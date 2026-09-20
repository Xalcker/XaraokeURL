// Íconos de la interfaz (SVG en línea, trazo de 2 px, heredan el color del texto).
// Reemplazan a los emojis, que se dibujan distinto en cada sistema.
//
// - En HTML estático: <span data-icon="mic"></span> (se sustituye por el SVG al cargar).
// - Desde JavaScript: iconSvg("mic") devuelve el SVG como texto.
//
// Se carga como <script> plano en el navegador y también es requireable desde Node
// para las pruebas (mismo patrón que shared.js).
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = mod;
  }
  if (root) {
    Object.assign(root, { iconSvg: mod.iconSvg });
    const hydrate = () =>
      root.document.querySelectorAll("[data-icon]").forEach((el) => {
        const svg = mod.iconSvg(el.getAttribute("data-icon"));
        if (svg) el.outerHTML = svg;
      });
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", hydrate);
    } else {
      hydrate();
    }
  }
})(typeof window !== "undefined" ? window : undefined, function () {
  // Cada ícono es el contenido de un <svg viewBox="0 0 24 24">.
  const ICONS = {
    mic: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/><path d="M8.5 21h7"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
    next: '<path d="M5 4.5l10 7.5-10 7.5z"/><path d="M19 5v14"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    warning: '<path d="M12 3.5l10 17H2z"/><path d="M12 10v4.5"/><path d="M12 17.5h.01"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
    download: '<path d="M12 3v12"/><path d="M7 10.5l5 5 5-5"/><path d="M4 20h16"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 3.5v4.5H15"/>',
    "arrow-left": '<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>',
  };

  function iconSvg(name) {
    // hasOwnProperty: sin él, nombres como "constructor" o "toString" devolverían
    // propiedades heredadas de Object en lugar de "no existe".
    if (!Object.prototype.hasOwnProperty.call(ICONS, name)) return "";
    const body = ICONS[name];
    return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
  }

  return { iconSvg, ICON_NAMES: Object.keys(ICONS) };
});
