// Sesiones, Google OAuth y las pantallas de acceso.
//
// Todo lo que decide "quién es quien pide esto" vive aquí: el almacén de sesiones, la
// estrategia de Google, los guardas de las rutas y las páginas de login y acceso denegado.
// El WebSocket también usa `sessionMiddleware` para saber quién se conecta.
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const FileStore = require("session-file-store")(session);

const { normalizeRoomId } = require("../lib/roomId");
const { hardenSessionStore } = require("../lib/sessionStore");
const { escapeHtml } = require("../public/js/shared");
const { translate } = require("../public/js/i18n");

const AVISO_SESION_CADA_MS = 10 * 60 * 1000;
const COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Página completa (con viewport, título e iconos) para las pantallas de acceso. Antes eran un
// <div> suelto sin <head>, que en un celular se veía diminuto. Viven aquí y no en public/
// porque el contenido depende de la configuración; los estilos sí están en un archivo, para
// que CSP pueda quedarse en style-src 'self'.
function simplePage(lang, title, contentHtml) {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#171124">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="/img/logo.svg" type="image/svg+xml" sizes="any">
<link rel="icon" href="/img/favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/css/tokens.css">
<link rel="stylesheet" href="/css/simple-page.css">
</head>
<body>
<main>
<img src="/img/logo.svg" alt="" width="96" height="96">
${contentHtml}
</main>
</body>
</html>`;
}

// Monta las sesiones y la autenticación sobre `app`, y devuelve lo que necesitan los demás
// módulos: el middleware de sesión (que reutiliza el WebSocket) y los dos guardas.
function setupAuth(app, { config, tr, langOf }) {
  // Renovar una sesión puede fallar en Windows si otro programa (antivirus, sincronizador de la
  // nube) tiene abierto su archivo justo entonces. No afecta a nadie: se reintenta en la
  // siguiente petición. Se avisa como mucho una vez cada 10 minutos, por si es persistente.
  let ultimoAviso = 0;
  const warnSessionTouchFailed = (err) => {
    if (Date.now() - ultimoAviso < AVISO_SESION_CADA_MS) return;
    ultimoAviso = Date.now();
    console.warn(
      `⚠️  No se pudo renovar una sesión (${err.code || err.message}). Suele ser un antivirus o un sincronizador usando la carpeta ${config.sessionsPath}; se reintenta solo.`
    );
  };

  const sessionMiddleware = session({
    store: hardenSessionStore(
      new FileStore({ path: config.sessionsPath, ttl: 86400, logFn: function () {} }),
      { onTouchError: warnSessionTouchFailed }
    ),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: config.isProduction, // Secure solo con HTTPS, o el navegador descarta la cookie
      httpOnly: true,
      maxAge: COOKIE_MAX_AGE_MS,
    },
  });
  app.use(sessionMiddleware);
  app.use(passport.initialize());
  app.use(passport.session());

  if (!config.authDisabled) {
    // Construir la estrategia requiere GOOGLE_CLIENT_ID/SECRET; por eso se omite por completo
    // cuando la auth está desactivada, así no hace falta tener credenciales para levantar el
    // server en local.
    passport.use(
      new GoogleStrategy(
        {
          clientID: config.googleClientId,
          clientSecret: config.googleClientSecret,
          callbackURL: "/auth/google/callback",
        },
        (accessToken, refreshToken, profile, done) => {
          const userEmail = profile.emails?.[0]?.value;
          if (userEmail && userEmail.endsWith(`@${config.allowedDomain}`)) {
            return done(null, profile);
          }
          return done(null, false, { message: "Acceso denegado." });
        }
      )
    );

    app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

    app.get(
      "/auth/google/callback",
      // keepSessionInfo: al iniciar sesión, passport renueva la sesión y borraría la sala que
      // se guardó antes de ir a Google (ver ensureAuthenticatedRemote).
      passport.authenticate("google", { failureRedirect: "/login-failed", keepSessionInfo: true }),
      (req, res) => {
        // Quien escaneó el QR sin haber iniciado sesión vuelve al control remoto con su sala puesta.
        const roomId = normalizeRoomId(req.session.joinRoomId);
        delete req.session.joinRoomId;
        res.redirect(roomId ? `/remote.html?sala=${roomId}` : "/remote.html");
      }
    );
  }

  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((obj, done) => done(null, obj));

  function ensureAuthenticated(req, res, next) {
    if (config.authDisabled || req.isAuthenticated()) return next();
    res.redirect("/login");
  }

  // Igual que ensureAuthenticated, pero para /remote.html: si el enlace del QR trae la sala y
  // falta iniciar sesión, la sala se guarda en la sesión para no perderla en el viaje a Google.
  function ensureAuthenticatedRemote(req, res, next) {
    if (!config.authDisabled && !req.isAuthenticated()) {
      const roomId = normalizeRoomId(req.query.sala);
      if (roomId) req.session.joinRoomId = roomId;
    }
    ensureAuthenticated(req, res, next);
  }

  app.get("/login", (req, res) => {
    if (config.authDisabled) return res.redirect("/remote.html");
    const lang = langOf(req);
    res
      .vary("Accept-Language")
      .send(
        simplePage(
          lang,
          "XaraokeURL",
          `<h1>XaraokeURL</h1><p>${escapeHtml(translate(lang, "login.prompt"))}</p><a class="btn" href="/auth/google">${escapeHtml(translate(lang, "login.google"))}</a>`
        )
      );
  });

  app.get("/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.redirect("/");
    });
  });

  app.get("/login-failed", (req, res) => {
    const lang = langOf(req);
    const title = escapeHtml(translate(lang, "login.deniedTitle"));
    res
      .status(403)
      .vary("Accept-Language")
      .send(
        simplePage(
          lang,
          translate(lang, "login.deniedTitle"),
          `<h1>${title}</h1><p>${escapeHtml(translate(lang, "login.deniedBody", { domain: config.allowedDomain }))}</p><a class="btn" href="/login">${escapeHtml(translate(lang, "login.retry"))}</a>`
        )
      );
  });

  // Quién hace la petición, para dejarlo registrado junto a una descarga o una canción.
  function requestUserName(req) {
    if (config.authDisabled) return req.session?.devName || defaultDevName(req);
    return req.user?.displayName || tr(req, "user.default");
  }

  const defaultDevName = (req) => config.devUserName || tr(req, "dev.defaultName");

  return {
    sessionMiddleware,
    ensureAuthenticated,
    ensureAuthenticatedRemote,
    requestUserName,
    defaultDevName,
  };
}

module.exports = { setupAuth, simplePage };
