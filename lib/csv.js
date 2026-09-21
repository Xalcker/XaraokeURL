// Lectura de songs.csv.
//
// Antes se hacía con row.split(","), que parte mal cualquier campo con coma: "Tyler, The
// Creator" quedaba como artista "Tyler" y título "The Creator", y la URL se corría un lugar.
// Aquí se lee según RFC 4180: campos entre comillas que pueden llevar comas, saltos de línea y
// comillas escapadas duplicándolas ("").

// Divide el texto en filas de campos. No interpreta nada: solo separa.
function parseCsv(text) {
  if (typeof text !== "string") return [];
  const rows = [];
  let row = [];
  let field = "";
  let entreComillas = false;
  // El BOM que dejan Excel y algunos editores no es parte del primer campo.
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const cerrarCampo = () => {
    row.push(field);
    field = "";
  };
  const cerrarFila = () => {
    cerrarCampo();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];
    if (entreComillas) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // comilla escapada
          i += 2;
          continue;
        }
        entreComillas = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === "") {
      entreComillas = true;
      i++;
      continue;
    }
    if (c === ",") {
      cerrarCampo();
      i++;
      continue;
    }
    if (c === "\r" || c === "\n") {
      cerrarFila();
      i += c === "\r" && text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += c;
    i++;
  }
  // Un archivo que termina en salto de línea no añade una fila vacía.
  if (field !== "" || row.length > 0) cerrarFila();
  return rows;
}

// Nombres de columna típicos de una cabecera, sin acentos y en minúsculas.
const NOMBRES_DE_CABECERA = new Set([
  "artist", "artista", "title", "titulo", "cancion", "song",
  "url", "link", "enlace", "filename", "archivo",
]);

const normalizar = (s) =>
  String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

// ¿La primera fila son nombres de columna y no una canción? Se pide que al menos dos de sus
// campos lo parezcan, para no confundir con una canción que se llame "Link" o "Song".
function pareceCabecera(row) {
  if (!row) return false;
  return row.filter((campo) => NOMBRES_DE_CABECERA.has(normalizar(campo))).length >= 2;
}

// ¿Esto parece una URL o una ruta? Sirve para avisar de la única corrupción que el formato no
// permite arreglar: si alguien escribe "Tyler, The Creator" SIN comillas, el CSV es ambiguo y no
// hay forma de saber que la coma era parte del nombre. Los campos se corren y la URL acaba
// siendo "EARFQUAKE,http://...". Detectarlo no lo arregla, pero al menos deja de ser silencioso.
function pareceUrl(valor) {
  return /^(https?:|file:|\/|\.{1,2}\/)/i.test(valor);
}

// Interpreta songs.csv. Devuelve { songs, cabecera, descartadas }:
//  - songs: { artist, title, url, filename } por cada fila utilizable.
//  - cabecera: true si la primera fila eran nombres de columna y se saltó.
//  - descartadas: { linea, motivo, texto } de las que no se pudieron usar, para poder avisar.
//
// La URL se arma uniendo el tercer campo y los siguientes: una URL puede llevar comas, y así se
// conserva el comportamiento de siempre para ese caso. Para que un artista o un título lleven
// coma hay que entrecomillarlos, que es justo lo que ahora sí funciona.
function parseSongsCsv(text) {
  const rows = parseCsv(text);
  const songs = [];
  const descartadas = [];
  const cabecera = pareceCabecera(rows[0]);

  rows.forEach((row, indice) => {
    const linea = indice + 1;
    if (indice === 0 && cabecera) return;
    if (row.length === 1 && row[0].trim() === "") return; // línea en blanco

    const texto = row.join(",");
    if (row.length < 3) {
      descartadas.push({ linea, motivo: "hacen falta tres campos (artista, título, URL)", texto });
      return;
    }
    const artist = row[0].trim();
    const title = row[1].trim();
    const url = row.slice(2).join(",").trim();
    if (!artist || !title || !url) {
      descartadas.push({ linea, motivo: "artista, título o URL vacío", texto });
      return;
    }
    const song = { artist, title, url, filename: `${artist} - ${title}.mp4`, linea };
    // Se importa igual (puede ser un esquema raro pero válido); solo se marca para avisar.
    if (!pareceUrl(url)) song.urlSospechosa = true;
    songs.push(song);
  });

  return { songs, cabecera, descartadas };
}

module.exports = { parseCsv, parseSongsCsv, pareceCabecera, pareceUrl };
