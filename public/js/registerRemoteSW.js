// Registra el service worker del control remoto (cachea sus assets estáticos para que
// Android/Chrome lo ofrezca como app instalable). Va en un archivo aparte y no inline
// para poder activar CSP sin 'unsafe-inline' (ver #37, mismo motivo que mobileRedirect.js).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw-remote.js", { scope: "/remote.html" }).catch(() => {});
  });
}
