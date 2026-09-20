const MAX_DISPLAY_NAME_LENGTH = 30;

// Caracteres invisibles que podrían engañar a quien lee el nombre: el espacio
// de ancho cero (U+200B) y los controles de dirección de texto (U+202A-U+202E
// y U+2066-U+2069), que permiten invertir visualmente lo que se muestra
// alrededor. Se identifican por código para que el archivo no contenga
// caracteres invisibles literales.
function isInvisibleControl(char) {
  const code = char.codePointAt(0);
  return (
    code === 0x200b ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

// Normaliza el nombre que elige una persona en modo desarrollo. Devuelve null
// si no queda nada utilizable. También convierte en espacio los caracteres de
// control (saltos de línea, tabuladores) y colapsa los espacios repetidos.
function sanitizeDisplayName(input) {
  if (typeof input !== "string") return null;
  const cleaned = Array.from(input.replace(/\p{Cc}/gu, " "))
    .filter((char) => !isInvisibleControl(char))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  // Se corta por caracteres (no por unidades UTF-16) para no partir un emoji a la mitad.
  const name = Array.from(cleaned).slice(0, MAX_DISPLAY_NAME_LENGTH).join("").trim();
  return name || null;
}

module.exports = { sanitizeDisplayName, MAX_DISPLAY_NAME_LENGTH };
