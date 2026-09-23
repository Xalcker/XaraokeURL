// El lector de PNG del reproductor nativo contra el QR real del servidor (paquete qrcode) y contra
// pngjs como referencia: si los dos leen distinto, el QR se vería roto en la pantalla.
const test = require("node:test");
const assert = require("node:assert/strict");
const QRCode = require("qrcode");
const { PNG } = require("pngjs");
const { decodePng, decodePngDataUrl, toBgraSquare } = require("../player/lib/png");

const JOIN_URL = "http://192.168.1.50:8081/remote.html?sala=ABCD";

test("lee el QR que genera el servidor igual que pngjs", async () => {
  const dataUrl = await QRCode.toDataURL(JOIN_URL);
  const image = decodePngDataUrl(dataUrl);
  const reference = PNG.sync.read(Buffer.from(dataUrl.split(",")[1], "base64"));
  assert.equal(image.width, reference.width);
  assert.equal(image.height, reference.height);
  assert.ok(image.rgba.equals(reference.data), "los píxeles no coinciden con los de pngjs");
});

test("lee PNG con cada filtro de fila y en RGB, gris y paleta", () => {
  // pngjs escribe con el filtro que se le pida: se prueban los cinco y varios tipos de color.
  const width = 7;
  const height = 5;
  const source = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    source.data[i * 4] = (i * 37) & 0xff;
    source.data[i * 4 + 1] = (i * 91) & 0xff;
    source.data[i * 4 + 2] = (i * 13) & 0xff;
    source.data[i * 4 + 3] = 255;
  }
  for (const colorType of [2, 6]) {
    for (const filterType of [0, 1, 2, 3, 4]) {
      const buffer = PNG.sync.write(source, { colorType, filterType });
      const image = decodePng(buffer);
      assert.ok(image.rgba.equals(source.data), `tipo ${colorType}, filtro ${filterType}`);
    }
  }
  const gray = PNG.sync.write(source, { colorType: 0, inputHasAlpha: true });
  const decodedGray = decodePng(gray);
  assert.equal(decodedGray.rgba[0], decodedGray.rgba[1], "en gris, R y G son iguales");
});

test("rechaza lo que no es un PNG o no es un data URL de PNG", () => {
  assert.throws(() => decodePng(Buffer.from("hola")), /no es un PNG/);
  assert.throws(() => decodePngDataUrl("data:image/jpeg;base64,AAAA"), /data URL de PNG/);
});

test("toBgraSquare escala con bordes nítidos y deja el formato que pide mpv", () => {
  // Una imagen de 2×2: negro, blanco / blanco, rojo semitransparente.
  const image = {
    width: 2,
    height: 2,
    rgba: Buffer.from([0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 128]),
  };
  const out = toBgraSquare(image, 4);
  assert.equal(out.length, 4 * 4 * 4);
  const pixel = (x, y) => [...out.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4)];
  assert.deepEqual(pixel(0, 0), [0, 0, 0, 255]);
  assert.deepEqual(pixel(1, 1), [0, 0, 0, 255], "cada píxel de origen ocupa un bloque de 2×2");
  assert.deepEqual(pixel(2, 0), [255, 255, 255, 255]);
  // BGRA con alfa premultiplicado: el rojo va en el tercer byte y multiplicado por 128/255.
  assert.deepEqual(pixel(3, 3), [0, 0, 128, 128]);
});
