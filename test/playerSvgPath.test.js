// El convertidor de trazos SVG a dibujos de ASS (player/lib/svgPath.js), con el que el reproductor
// nativo dibuja el logo encima del video.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseSvgPath, boundingBox, toAssDrawing, logoDrawing } = require("../player/lib/svgPath");

const points = (subpaths) => subpaths.map((sub) => sub.map((s) => `${s.type}${s.points.map((p) => p.join(",")).join(" ")}`));

test("comandos absolutos y relativos terminan en las mismas coordenadas", () => {
  const absolute = parseSvgPath("M 10 10 L 20 10 L 20 30 Z");
  const relative = parseSvgPath("m 10 10 l 10 0 l 0 20 z");
  assert.deepEqual(points(relative), points(absolute));
  assert.deepEqual(points(absolute), [["M10,10", "L20,10", "L20,30"]]);
});

test("los pares que siguen a un m son líneas, y tras z se sigue desde el inicio del subtrazo", () => {
  // Así viene el logo: "m x,y dx,dy ... z m dx,dy" (relativo al punto de inicio del anterior).
  const subpaths = parseSvgPath("m 100,100 10,0 0,10 z m 5,5 1,0");
  assert.deepEqual(points(subpaths), [["M100,100", "L110,100", "L110,110"], ["M105,105", "L106,105"]]);
});

test("H, V, S y Q se pasan a líneas y curvas cúbicas", () => {
  const [sub] = parseSvgPath("M0 0 H10 V10 h-5 v-5 C 0 10 10 10 10 0 S 20 -10 20 0 Q 30 10 40 0");
  assert.deepEqual(sub.slice(1, 5).map((s) => s.points[0]), [[10, 0], [10, 10], [5, 10], [5, 5]]);
  const smooth = sub[6];
  assert.equal(smooth.type, "C");
  assert.deepEqual(smooth.points[0], [10, -10], "S refleja el último control de la curva anterior");
  const quad = sub[7];
  assert.equal(quad.type, "C");
  assert.deepEqual(quad.points.at(-1), [40, 0]);
  assert.ok(Math.abs(quad.points[0][0] - 26.6667) < 0.001, "el control de la cuadrática queda a 2/3");
});

test("números pegados, sin espacios y con exponente", () => {
  const [sub] = parseSvgPath("M1.5-2L3e1,.5l-.5-.5");
  assert.deepEqual(sub.map((s) => s.points[0]), [[1.5, -2], [30, 0.5], [29.5, 0]]);
});

test("un comando que no se soporta (arcos) avisa en vez de dibujar mal", () => {
  assert.throws(() => parseSvgPath("M 0 0 A 5 5 0 0 1 10 10"), /no soportado: "A"/);
});

test("toAssDrawing lleva el dibujo a (0, 0) y escala el lado más largo al tamaño pedido", () => {
  const drawing = toAssDrawing(parseSvgPath("M 50 100 L 150 100 L 150 300 Z"), 1000);
  assert.equal(drawing.height, 1000);
  assert.equal(drawing.width, 500);
  assert.equal(drawing.drawing, "m 0 0 l 500 0 l 500 1000");
  const curve = toAssDrawing(parseSvgPath("M 0 0 C 0 10 10 10 10 0"), 10);
  assert.equal(curve.drawing, "m 0 0 b 0 10 10 10 10 0");
});

test("el logo de verdad: toma el trazo turquesa y lo deja listo para dibujar", () => {
  const svg = fs.readFileSync(path.join(__dirname, "..", "public", "img", "logo.svg"), "utf8");
  const logo = logoDrawing(svg);
  assert.equal(Math.max(logo.width, logo.height), 1000);
  assert.match(logo.drawing, /^m \d+ \d+ /);
  assert.ok(logo.drawing.split(" m ").length >= 3, "el logo tiene varios subtrazos (los huecos del dibujo)");
  // Todas las coordenadas caen dentro de la caja del dibujo.
  const numbers = logo.drawing.split(" ").filter((token) => /^\d+$/.test(token)).map(Number);
  assert.ok(Math.max(...numbers) <= 1000 && Math.min(...numbers) >= 0);
  assert.throws(() => logoDrawing(svg, "#ff00ff"), /no tiene un trazo con fill="#ff00ff"/);
  assert.ok(boundingBox(parseSvgPath("M 0 0 L 10 20")).height === 20);
});
