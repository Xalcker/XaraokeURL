// El código del servidor, para las pruebas que lo revisan como texto.
//
// server.js dejó de ser un archivo y pasó a ser server.js + src/ (ver #36). Estas pruebas
// comprueban que ciertas reglas sigan cableadas donde deben, y son frágiles por naturaleza: un
// refactor correcto las rompe. Leyendo todo el servidor junto, al menos dejan de romperse solo
// porque el código se mueva de un módulo a otro.
//
// Lo que se pueda comprobar ejecutando el servidor debería probarse en test/httpApi.test.js,
// test/wsHandshake.test.js o test/wsQueue.test.js, que sí lo levantan de verdad. Aquí solo
// quedan las reglas que no se pueden observar desde fuera sin yt-dlp o sin Google.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

// Rutas (relativas a la raíz) de todos los .js del servidor.
function serverSourceFiles(dir = "src") {
  const base = path.join(ROOT, dir);
  const enSrc = fs.existsSync(base)
    ? fs.readdirSync(base, { withFileTypes: true }).flatMap((entrada) =>
        entrada.isDirectory()
          ? serverSourceFiles(path.join(dir, entrada.name))
          : entrada.name.endsWith(".js")
            ? [path.join(dir, entrada.name)]
            : []
      )
    : [];
  return dir === "src" ? ["server.js", ...enSrc] : enSrc;
}

// Todo el código del servidor concatenado, para buscar un patrón sin importar en qué módulo esté.
function serverSource() {
  return serverSourceFiles()
    .map((archivo) => fs.readFileSync(path.join(ROOT, archivo), "utf8"))
    .join("\n");
}

module.exports = { serverSourceFiles, serverSource, ROOT };
