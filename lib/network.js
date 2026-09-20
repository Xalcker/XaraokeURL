const os = require("os");

// Adaptadores de máquinas virtuales, contenedores y VPN: una red a la que los teléfonos no llegan.
// Por el nombre a veces se nota ("vEthernet", "VMware"...) y a veces no ("Ethernet 3"), así que también
// se reconocen los rangos que esos programas usan por defecto (VirtualBox 192.168.56.x, docker 172.17.x...).
const VIRTUAL_NAME = /virtual|vmware|vbox|vethernet|hyper-v|docker|wsl|tailscale|zerotier|bluetooth|npcap/i;
const VIRTUAL_RANGE = /^(192\.168\.(56|99)\.|172\.17\.|10\.0\.2\.)/;

function looksVirtual({ name, address }) {
  return VIRTUAL_NAME.test(name) || VIRTUAL_RANGE.test(address);
}

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
  // Primero las redes reales y, entre ellas, las privadas (las de una LAN doméstica o de oficina);
  // las de máquinas virtuales y similares al final.
  const score = (entry) => Number(!looksVirtual(entry)) * 2 + Number(isPrivateIPv4(entry.address));
  return result.sort((a, b) => score(b) - score(a));
}

// Valor de LAN_IP (una dirección IPv4 que se fija a mano para el código QR) o null si no es válida.
function parseLanIpOverride(value) {
  if (typeof value !== "string") return null;
  const address = value.trim();
  const parts = address.split(".");
  const valid = parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
  return valid ? address : null;
}

// Direcciones con las que se puede llegar al servidor desde otro dispositivo: la fijada con LAN_IP,
// si la hay, o las detectadas en los adaptadores de red.
function getServerAddresses(lanIp, interfaces) {
  const forced = parseLanIpOverride(lanIp);
  return forced ? [{ name: "LAN_IP", address: forced }] : getLanAddresses(interfaces);
}

// Nombres con los que un equipo se llama a sí mismo: desde un teléfono no llevan a este servidor.
function isLoopbackHost(hostname) {
  return hostname === "localhost" || hostname === "[::1]" || hostname === "0.0.0.0" || /^127(\.\d{1,3}){3}$/.test(hostname);
}

// Dirección con la que los teléfonos abren el control remoto (la que va en el código QR). Si la
// pantalla principal se abrió como "localhost", el QR apuntaría al propio teléfono y no funcionaría:
// en ese caso se usa la primera dirección de la red local, con el mismo puerto y protocolo. Con
// cualquier otra dirección (una IP de la red, un dominio) no se cambia nada.
function remoteBaseUrl({ protocol, host, addresses = [] }) {
  const original = `${protocol}://${host}`;
  let parsed;
  try {
    parsed = new URL(original);
  } catch {
    return original;
  }
  if (!isLoopbackHost(parsed.hostname) || addresses.length === 0) return original;
  parsed.hostname = addresses[0].address;
  return parsed.origin;
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
    "🌐 Direcciones de este servidor:",
    ...addresses.map(
      ({ name, address }, i) =>
        `   http://${address}:${port}   (${name})${i === 0 ? "   <- la que lleva el código QR si abres la pantalla como localhost" : ""}`
    ),
    `   En este equipo: http://localhost:${port}   (recomendada para la pantalla principal: así el navegador puede mantener la pantalla encendida)`,
    ...(addresses.length > 1 ? ["   ¿El QR usa la red equivocada? Fija LAN_IP=<dirección> en el .env."] : []),
  ];
}

module.exports = { getLanAddresses, getServerAddresses, parseLanIpOverride, formatAccessLines, remoteBaseUrl };
