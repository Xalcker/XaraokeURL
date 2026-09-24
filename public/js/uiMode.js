// Vista minimalista de la pantalla principal (?ui=minimal): overlays de esquina sobre el video en vez
// de barras laterales, como el reproductor nativo (ver player/lib/screen.js). Se activa sola en
// televisores con navegador propio (Fire TV/Silk, Tizen, webOS, Android TV): ahí nadie navega una
// barra lateral con el control remoto de la TV, así que conviene de entrada. Se puede forzar con
// ?ui=minimal en cualquier navegador, o volver a la clásica en una TV con ?ui=classic.
//
// Se corre síncrono y temprano en <head>, antes de css/host.css, para que la clase ya esté puesta al
// primer pintado y no haya parpadeo del layout clásico (la CSP del proyecto no permite <script>
// inline en el HTML).
(function () {
  const mode = new URLSearchParams(location.search).get("ui");
  if (mode === "classic") return;
  // AFT (el código de modelo de un Fire TV) va en el user agent sin importar qué navegador se use ahí,
  // no solo Silk. Tizen y Web0S/WebOS son los sistemas de las TV de Samsung y LG, no de sus celulares
  // (salvo algún Tizen viejo de Samsung, ya discontinuado). El resto lo cubren "Android TV"/"GoogleTV".
  const isTv = /AFT[A-Z0-9]|Android TV|GoogleTV|Tizen|Web0S|WebOS|SmartTV|SMART-TV/i.test(navigator.userAgent);
  if (mode === "minimal" || isTv) {
    document.documentElement.classList.add("ui-minimal");
  }
})();
