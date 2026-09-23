// Lector mínimo de PNG, solo para el QR que genera el servidor (/api/qr lo manda como data URL).
//
// mpv dibuja imágenes encima del video con overlay-add, pero solo a partir de píxeles crudos: hay que
// decodificar el PNG. Se hace aquí a mano, con el zlib de Node, para que el reproductor no necesite
// dependencias de npm (en una Raspberry Pi Zero, instalar npm y compilar paquetes es lo que más cuesta).
// Soporta lo que usa un QR: 8 bits por canal, sin entrelazado, en gris, RGB, RGBA o con paleta.
const zlib = require("node:zlib");

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// Devuelve { width, height, rgba }, con rgba = 4 bytes por píxel (R, G, B, A).
function decodePng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("no es un PNG");
  let offset = 8;
  let header = null;
  let palette = null;
  let transparency = null;
  const idat = [];
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("latin1", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") transparency = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (!header) throw new Error("PNG sin IHDR");
  const { width, height, bitDepth, colorType, interlace } = header;
  const channels = CHANNELS[colorType];
  if (bitDepth !== 8 || !channels || interlace !== 0) {
    throw new Error(`PNG no soportado (profundidad ${bitDepth}, tipo ${colorType}, entrelazado ${interlace})`);
  }
  if (colorType === 3 && !palette) throw new Error("PNG con paleta pero sin PLTE");

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error("PNG truncado");

  // Deshace el filtro de cada fila (cada una empieza con un byte que dice cuál se usó).
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[src + x];
      const left = x >= channels ? pixels[dst + x - channels] : 0;
      const up = y > 0 ? pixels[dst - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[dst - stride + x - channels] : 0;
      let out;
      switch (filter) {
        case 0: out = value; break;
        case 1: out = value + left; break;
        case 2: out = value + up; break;
        case 3: out = value + ((left + up) >> 1); break;
        case 4: out = value + paeth(left, up, upLeft); break;
        default: throw new Error(`filtro PNG desconocido: ${filter}`);
      }
      pixels[dst + x] = out & 0xff;
    }
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const p = i * channels;
    let r, g, b, a = 255;
    if (colorType === 0) r = g = b = pixels[p];
    else if (colorType === 4) { r = g = b = pixels[p]; a = pixels[p + 1]; }
    else if (colorType === 2) { r = pixels[p]; g = pixels[p + 1]; b = pixels[p + 2]; }
    else if (colorType === 6) { r = pixels[p]; g = pixels[p + 1]; b = pixels[p + 2]; a = pixels[p + 3]; }
    else {
      const index = pixels[p];
      r = palette[index * 3]; g = palette[index * 3 + 1]; b = palette[index * 3 + 2];
      if (transparency && index < transparency.length) a = transparency[index];
    }
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = a;
  }
  return { width, height, rgba };
}

// Escala la imagen a size×size (vecino más cercano: un QR tiene que quedar con bordes nítidos) y la
// convierte al formato que pide overlay-add de mpv: BGRA con el alfa premultiplicado.
function toBgraSquare(image, size) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const sy = Math.min(image.height - 1, Math.floor((y * image.height) / size));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(image.width - 1, Math.floor((x * image.width) / size));
      const s = (sy * image.width + sx) * 4;
      const d = (y * size + x) * 4;
      const a = image.rgba[s + 3];
      out[d] = Math.round((image.rgba[s + 2] * a) / 255);
      out[d + 1] = Math.round((image.rgba[s + 1] * a) / 255);
      out[d + 2] = Math.round((image.rgba[s] * a) / 255);
      out[d + 3] = a;
    }
  }
  return out;
}

// El QR llega como "data:image/png;base64,...".
function decodePngDataUrl(dataUrl) {
  const match = /^data:image\/png;base64,(.+)$/.exec(String(dataUrl));
  if (!match) throw new Error("se esperaba un data URL de PNG");
  return decodePng(Buffer.from(match[1], "base64"));
}

module.exports = { decodePng, decodePngDataUrl, toBgraSquare };
