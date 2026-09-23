// Los scripts de instalación corren con "set -u": una variable que se usa sin haberla definido corta
// la instalación a la mitad (pasó con KIOSK_LANG en install-kiosk.sh). Aquí no se pueden ejecutar,
// pero sí comprobar que cada variable en mayúsculas que usan esté asignada en el mismo script.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPTS_DIR = path.join(__dirname, "..", "scripts");
const scripts = fs.readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".sh"));

// Variables que pone el sistema o bash, no el script.
const FROM_ENVIRONMENT = new Set(["HOME", "PATH", "USER", "BASH_SOURCE", "EUID", "UID", "PWD"]);

// Lo que va entre comillas simples no se expande (por ejemplo, los scripts que se escriben con
// heredoc <<'EOS'), así que se quita antes de buscar variables.
function expandableText(source) {
  return source
    .replace(/<<'(\w+)'\n[\s\S]*?\n\1\n/g, "")
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n")
    .replace(/'[^'\n]*'/g, "''");
}

test("hay scripts de instalación que revisar", () => {
  assert.ok(scripts.includes("install-kiosk.sh"));
});

for (const script of scripts) {
  test(`${script}: toda variable que usa está definida en el script`, () => {
    const source = fs.readFileSync(path.join(SCRIPTS_DIR, script), "utf8").replace(/\r\n/g, "\n");
    const used = new Set([...expandableText(source).matchAll(/\$\{?([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]));
    const assigned = new Set([
      ...[...source.matchAll(/(?:^|[\s;(])(?:local\s+|export\s+)?([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]),
      ...[...source.matchAll(/\b(?:read|for)\s+(?:-\w+\s+(?:"[^"]*"\s+)?)*([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]),
    ]);
    const missing = [...used].filter((v) => !assigned.has(v) && !FROM_ENVIRONMENT.has(v));
    assert.deepEqual(missing, [], `${script} usa variables que nunca define: ${missing.join(", ")}`);
  });
}

const bash = spawnSync("bash", ["--version"]);
test("los scripts de instalación tienen sintaxis válida de bash", { skip: bash.status !== 0 && "no hay bash" }, () => {
  for (const script of scripts) {
    const result = spawnSync("bash", ["-n", path.join(SCRIPTS_DIR, script)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${script}: ${result.stderr}`);
  }
});
