const os = require("os");

function isPrivateIPv4(address) {
  const [a, b] = address.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// Direcciones IPv4 desde las que otro dispositivo de la misma red (por
// ejemplo, un teléfono) podría llegar al servidor. Se descartan las de
// loopback y las link-local (169.254.x.x), que Windows asigna a un adaptador
// cuando no consigue IP por DHCP y no sirven para conectarse.
function getLanAddresses(interfaces = os.networkInterfaces()) {
  const result = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      // `family` es "IPv4" o 4 (número) según la versión de Node.
      const isIPv4 = entry.family === "IPv4" || entry.family === 4;
      if (!isIPv4 || entry.internal) continue;
      if (entry.address.startsWith("169.254.")) continue;
      result.push({ name, address: entry.address });
    }
  }
  // Las redes privadas (las de una LAN doméstica o de oficina) primero.
  return result.sort(
    (a, b) => Number(isPrivateIPv4(b.address)) - Number(isPrivateIPv4(a.address))
  );
}

// Líneas para mostrar al arrancar el servidor. Con "localhost" el código QR
// apuntaría al propio teléfono, por eso se listan las direcciones de red.
function formatAccessLines(port, addresses) {
  if (addresses.length === 0) {
    return [
      "⚠️  No se detectó ninguna red local: los teléfonos no podrán conectarse al servidor.",
      `   Solo en este equipo: http://localhost:${port}`,
    ];
  }
  return [
    "🌐 Abre la pantalla principal con una de estas direcciones (con localhost, el QR no funcionaría en los teléfonos):",
    ...addresses.map(({ name, address }) => `   http://${address}:${port}   (${name})`),
    `   Solo en este equipo: http://localhost:${port}`,
  ];
}

module.exports = { getLanAddresses, formatAccessLines };
