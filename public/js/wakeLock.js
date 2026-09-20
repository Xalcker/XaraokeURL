// Mantiene la pantalla del host encendida mientras dura la sesión, con la Screen Wake Lock API.
// Se carga como <script> plano en el navegador (define createWakeLock) y también es requireable
// desde Node para las pruebas (mismo patrón que shared.js).
//
// Limitaciones de la API, que este módulo respeta:
//  - Solo existe en contextos seguros: HTTPS o localhost. Abriendo la pantalla con la IP de la
//    red por HTTP, navigator.wakeLock no está definido y todo esto no hace nada (`supported` es false).
//  - El navegador la libera solo cuando la pestaña deja de verse; hay que volver a pedirla al regresar.
//  - Puede negarse (por ejemplo, con el ahorro de batería): se avisa, no se insiste en bucle.
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = mod;
  }
  if (root) {
    Object.assign(root, mod);
  }
})(typeof window !== "undefined" ? window : undefined, function () {
  // `nav` y `doc` son navigator y document (se inyectan para poder probarlo).
  // onChange(activo, error?) se llama cada vez que el bloqueo se obtiene, se pierde o se niega.
  function createWakeLock({ nav, doc, onChange = () => {} }) {
    const supported = !!(nav && nav.wakeLock && typeof nav.wakeLock.request === "function");
    let wanted = false;
    let sentinel = null;
    let requesting = false;

    async function acquire() {
      if (!supported || !wanted || sentinel || requesting) return;
      if (doc.visibilityState !== "visible") return; // se pedirá al volver a verse
      requesting = true;
      try {
        const lock = await nav.wakeLock.request("screen");
        if (!wanted) {
          // Se desactivó mientras se esperaba la respuesta: se suelta enseguida.
          await lock.release().catch(() => {});
          return;
        }
        sentinel = lock;
        lock.addEventListener("release", () => {
          // El navegador lo soltó (pestaña oculta, ahorro de batería...). Se vuelve a pedir
          // al regresar a la pestaña, no aquí, para no entrar en un bucle si lo sigue negando.
          if (sentinel === lock) {
            sentinel = null;
            onChange(false);
          }
        });
        onChange(true);
      } catch (error) {
        onChange(false, error);
      } finally {
        requesting = false;
      }
    }

    doc.addEventListener("visibilitychange", () => {
      if (doc.visibilityState === "visible") acquire();
    });

    return {
      supported,
      isActive: () => sentinel !== null,
      enable() {
        wanted = true;
        return acquire();
      },
      async disable() {
        wanted = false;
        const lock = sentinel;
        sentinel = null;
        if (lock) {
          await lock.release().catch(() => {});
          onChange(false);
        }
      },
    };
  }

  return { createWakeLock };
});
