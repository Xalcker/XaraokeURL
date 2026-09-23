// Convierte el logo (public/img/logo.svg) en un dibujo vectorial de ASS, el formato de los textos de
// mpv: así mpv lo dibuja nítido a cualquier tamaño y con la transparencia que se quiera, sin pasar
// por una imagen. ASS dibuja con "m" (mover), "l" (línea) y "b" (curva de Bézier cúbica), en
// coordenadas absolutas; el trazo SVG se pasa a eso.

// Lee el atributo d de un <path>: devuelve una lista de subtrazos, cada uno una lista de
// segmentos absolutos { type: "M" | "L" | "C", points: [[x, y], ...] }.
// Soporta M, L, H, V, C, S, Q, T y Z, en mayúsculas (absolutas) y minúsculas (relativas).
function parseSvgPath(d) {
  const tokens = String(d).match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const subpaths = [];
  let current = null;
  let i = 0;
  let command = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastControl = null; // para S/T: el último punto de control, reflejado
  let lastType = null;

  const isCommand = (token) => /^[A-Za-z]$/.test(token);
  const number = () => {
    if (i >= tokens.length || isCommand(tokens[i])) throw new Error(`faltan números tras "${command}"`);
    return Number(tokens[i++]);
  };
  const push = (type, points) => {
    if (!current) {
      current = [{ type: "M", points: [[x, y]] }];
      subpaths.push(current);
    }
    current.push({ type, points });
  };

  while (i < tokens.length) {
    if (isCommand(tokens[i])) command = tokens[i++];
    else if (!command) throw new Error("el trazo no empieza con un comando");
    const relative = command === command.toLowerCase();
    const ox = relative ? x : 0;
    const oy = relative ? y : 0;
    switch (command.toUpperCase()) {
      case "M": {
        x = ox + number();
        y = oy + number();
        startX = x;
        startY = y;
        current = [{ type: "M", points: [[x, y]] }];
        subpaths.push(current);
        // Los pares que siguen a un M son líneas (implícitas).
        command = relative ? "l" : "L";
        lastControl = null;
        lastType = "M";
        continue;
      }
      case "L":
        x = ox + number();
        y = oy + number();
        push("L", [[x, y]]);
        lastType = "L";
        break;
      case "H":
        x = ox + number();
        push("L", [[x, y]]);
        lastType = "L";
        break;
      case "V":
        y = oy + number();
        push("L", [[x, y]]);
        lastType = "L";
        break;
      case "C": {
        const c1 = [ox + number(), oy + number()];
        const c2 = [ox + number(), oy + number()];
        x = ox + number();
        y = oy + number();
        push("C", [c1, c2, [x, y]]);
        lastControl = c2;
        lastType = "C";
        continue;
      }
      case "S": {
        const c1 = lastType === "C" && lastControl ? [2 * x - lastControl[0], 2 * y - lastControl[1]] : [x, y];
        const c2 = [ox + number(), oy + number()];
        x = ox + number();
        y = oy + number();
        push("C", [c1, c2, [x, y]]);
        lastControl = c2;
        lastType = "C";
        continue;
      }
      case "Q":
      case "T": {
        const q = command.toUpperCase() === "Q"
          ? [ox + number(), oy + number()]
          : lastType === "Q" && lastControl ? [2 * x - lastControl[0], 2 * y - lastControl[1]] : [x, y];
        const x0 = x;
        const y0 = y;
        x = ox + number();
        y = oy + number();
        // Una cuadrática es una cúbica con los controles a 2/3 del camino hacia el suyo.
        const c1 = [x0 + (2 / 3) * (q[0] - x0), y0 + (2 / 3) * (q[1] - y0)];
        const c2 = [x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y)];
        push("C", [c1, c2, [x, y]]);
        lastControl = q;
        lastType = "Q";
        continue;
      }
      case "Z":
        x = startX;
        y = startY;
        current = null; // el próximo segmento, si no hay M, arranca otro subtrazo desde aquí
        lastType = "Z";
        continue;
      default:
        throw new Error(`comando de trazo no soportado: "${command}"`);
    }
    lastControl = null;
  }
  return subpaths;
}

function boundingBox(subpaths) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const sub of subpaths) {
    for (const segment of sub) {
      for (const [px, py] of segment.points) {
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
      }
    }
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

// Dibujo ASS con el trazo movido para que su esquina superior izquierda quede en (0, 0) y escalado
// para que el lado más largo mida `size` unidades. Así, con \an7\pos(x,y), el logo cae justo ahí.
function toAssDrawing(subpaths, size = 1000) {
  const box = boundingBox(subpaths);
  const scale = size / Math.max(box.width, box.height);
  const p = ([px, py]) => `${Math.round((px - box.minX) * scale)} ${Math.round((py - box.minY) * scale)}`;
  const parts = [];
  for (const sub of subpaths) {
    for (const segment of sub) {
      if (segment.type === "M") parts.push(`m ${p(segment.points[0])}`);
      else if (segment.type === "L") parts.push(`l ${p(segment.points[0])}`);
      else parts.push(`b ${segment.points.map(p).join(" ")}`);
    }
  }
  return {
    drawing: parts.join(" "),
    width: Math.round(box.width * scale),
    height: Math.round(box.height * scale),
  };
}

// Del SVG del logo toma el trazo de un color (el turquesa de la marca): es el dibujo del logo sin
// el cuadro oscuro de fondo, que es lo que se ve bien encima de un video.
function logoDrawing(svgText, fill = "#49d6d8", size = 1000) {
  for (const match of String(svgText).matchAll(/<path\b[^>]*>/g)) {
    const tag = match[0];
    const color = /\bfill="([^"]+)"/.exec(tag)?.[1];
    const d = /\bd="([^"]+)"/.exec(tag)?.[1];
    if (d && color?.toLowerCase() === fill.toLowerCase()) return toAssDrawing(parseSvgPath(d), size);
  }
  throw new Error(`el SVG no tiene un trazo con fill="${fill}"`);
}

module.exports = { parseSvgPath, boundingBox, toAssDrawing, logoDrawing };
