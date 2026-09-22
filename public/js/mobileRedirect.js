// Un teléfono que abre la pantalla principal quiere el control remoto, no el reproductor.
//
// Va en un archivo aparte y no inline para poder activar CSP sin 'unsafe-inline' (ver #37).
// Se carga en el <head> sin defer, a propósito: tiene que decidir antes de que se pinte nada,
// o en el teléfono se vería un instante la pantalla del host antes de saltar.
//
// No basta con buscar "Android": Fire OS (Fire TV Stick, Silk Browser) también lo incluye en su
// user agent, y ese es justamente un host, no un remoto. Los teléfonos Android sí agregan "Mobile"
// a su user agent (ya cubierto por "Mobi"); las Android TV / Fire TV no lo hacen.
(function () {
  if (/Mobi|iPhone/i.test(navigator.userAgent)) {
    window.location.href = "/remote.html";
  }
})();
