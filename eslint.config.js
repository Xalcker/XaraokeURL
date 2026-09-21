const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  js.configs.recommended,
  {
    files: [
      "server.js",
      "import_csv.js",
      "lib/**/*.js",
      "test/**/*.js",
      "eslint.config.js",
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
        module: "readonly",
        // Definidas por public/js/shared.js, cargado antes de estos scripts.
        escapeHtml: "readonly",
        parseSongFilename: "readonly",
        getSongDisplay: "readonly",
        // Definida por public/js/icons.js.
        iconSvg: "readonly",
        // Definida por public/js/wakeLock.js.
        createWakeLock: "readonly",
        // Definidas por public/js/tour.js: el tutorial guiado y sus pasos.
        createTour: "readonly",
        REMOTE_TOUR_STEPS: "readonly",
        // Definidas por public/js/i18n.js: traductor y idioma elegido.
        t: "readonly",
        currentLang: "readonly",
      },
    },
  },
  {
    ignores: ["node_modules/", "public/notification.mp3"],
  },
];
