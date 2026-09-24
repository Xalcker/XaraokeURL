const test = require("node:test");
const assert = require("node:assert/strict");
const { getLanAddresses, parseDefaultRouteInterface, formatAccessLines } = require("../lib/network");

const v4 = (address, internal = false, family = "IPv4") => ({ address, family, internal });

test("getLanAddresses descarta loopback, link-local (169.254) e IPv6", () => {
  const result = getLanAddresses({
    Loopback: [v4("127.0.0.1", true)],
    "Wi-Fi": [v4("192.168.0.72"), { address: "fe80::1", family: "IPv6", internal: false }],
    Ethernet: [v4("169.254.103.123")],
  });
  assert.deepEqual(result, [{ name: "Wi-Fi", address: "192.168.0.72" }]);
});

test("getLanAddresses acepta family numérico (Node 18.0-18.3)", () => {
  const result = getLanAddresses({ eth0: [v4("10.0.0.5", false, 4)] });
  assert.deepEqual(result, [{ name: "eth0", address: "10.0.0.5" }]);
});

test("getLanAddresses pone primero las redes privadas y conserva el nombre del adaptador", () => {
  const result = getLanAddresses({
    Publica: [v4("203.0.113.9")],
    Oficina: [v4("172.20.0.1")],
    "Wi-Fi": [v4("192.168.0.72")],
    Vpn: [v4("10.8.0.2")],
  });
  assert.deepEqual(
    result.map((r) => r.name),
    ["Oficina", "Wi-Fi", "Vpn", "Publica"]
  );
});

test("getLanAddresses trata 172.16-31 como privada y 172.32 como pública", () => {
  const result = getLanAddresses({ a: [v4("172.32.0.1")], b: [v4("172.31.0.1")] });
  assert.deepEqual(
    result.map((r) => r.address),
    ["172.31.0.1", "172.32.0.1"]
  );
});

test("getLanAddresses devuelve [] si no hay red", () => {
  assert.deepEqual(getLanAddresses({ lo: [v4("127.0.0.1", true)] }), []);
  assert.deepEqual(getLanAddresses({}), []);
});

test("formatAccessLines lista cada dirección con su puerto y adaptador", () => {
  const lines = formatAccessLines(8081, [{ name: "Wi-Fi", address: "192.168.0.72" }]);
  assert.ok(lines.some((l) => l.includes("http://192.168.0.72:8081") && l.includes("(Wi-Fi)")));
  assert.ok(lines.some((l) => l.includes("http://localhost:8081")));
});

test("formatAccessLines avisa cuando no hay ninguna red local", () => {
  const lines = formatAccessLines(3000, []);
  assert.ok(lines[0].includes("No se detectó ninguna red local"));
  assert.ok(lines.some((l) => l.includes("http://localhost:3000")));
});

// ---------- dirección del control remoto (la del QR)

const { remoteBaseUrl } = require("../lib/network");
const LAN = [{ name: "Wi-Fi", address: "192.168.0.72" }, { name: "Ethernet", address: "10.0.0.5" }];

test("remoteBaseUrl: con localhost usa la primera dirección de la red local y conserva el puerto", () => {
  assert.equal(remoteBaseUrl({ protocol: "http", host: "localhost:8081", addresses: LAN }), "http://192.168.0.72:8081");
});

test("remoteBaseUrl: también reemplaza 127.0.0.1, ::1 y 0.0.0.0", () => {
  for (const host of ["127.0.0.1:8081", "127.0.1.1:8081", "[::1]:8081", "0.0.0.0:8081", "LOCALHOST:8081"]) {
    assert.equal(remoteBaseUrl({ protocol: "http", host, addresses: LAN }), "http://192.168.0.72:8081", host);
  }
});

test("remoteBaseUrl: conserva el protocolo y no añade puerto si no lo había", () => {
  assert.equal(remoteBaseUrl({ protocol: "https", host: "localhost", addresses: LAN }), "https://192.168.0.72");
  assert.equal(remoteBaseUrl({ protocol: "https", host: "localhost:8443", addresses: LAN }), "https://192.168.0.72:8443");
});

test("remoteBaseUrl: una IP de la red o un dominio se dejan tal cual", () => {
  for (const host of ["192.168.0.10:8081", "karaoke.example.com", "karaoke.example.com:3000", "mi-pc.local:8081"]) {
    assert.equal(remoteBaseUrl({ protocol: "http", host, addresses: LAN }), `http://${host}`, host);
  }
});

test("remoteBaseUrl: sin ninguna red local no hay nada mejor que localhost", () => {
  assert.equal(remoteBaseUrl({ protocol: "http", host: "localhost:8081", addresses: [] }), "http://localhost:8081");
  assert.equal(remoteBaseUrl({ protocol: "http", host: "localhost:8081" }), "http://localhost:8081");
});

test("remoteBaseUrl: un host inválido no rompe nada", () => {
  assert.equal(remoteBaseUrl({ protocol: "http", host: "", addresses: LAN }), "http://");
  assert.equal(remoteBaseUrl({ protocol: "http", host: "a b:80", addresses: LAN }), "http://a b:80");
});

test("remoteBaseUrl: un dominio que solo empieza como localhost no se confunde con él", () => {
  for (const host of ["localhost.example.com:8081", "127.example.com:8081", "notlocalhost:8081"]) {
    assert.equal(remoteBaseUrl({ protocol: "http", host, addresses: LAN }), `http://${host}`, host);
  }
});

// ---------- elección de la dirección: adaptadores virtuales y LAN_IP

const { getServerAddresses, parseLanIpOverride } = require("../lib/network");

test("getLanAddresses deja al final los adaptadores virtuales, se note por el nombre o por el rango", () => {
  const result = getLanAddresses({
    "Ethernet 3": [v4("192.168.56.1")], // VirtualBox host-only: el nombre no lo delata, el rango sí
    "vEthernet (WSL)": [v4("172.28.0.1")], // el nombre lo delata
    "Docker Network": [v4("10.5.0.1")],
    "Wi-Fi 2": [v4("192.168.0.72")],
  });
  assert.equal(result[0].address, "192.168.0.72");
  assert.deepEqual(result.slice(1).map((r) => r.name).sort(), ["Docker Network", "Ethernet 3", "vEthernet (WSL)"]);
});

test("getLanAddresses: una red real pública va antes que una virtual privada", () => {
  const result = getLanAddresses({ vbox: [v4("192.168.56.1")], Ethernet: [v4("200.10.20.30")] });
  assert.deepEqual(result.map((r) => r.address), ["200.10.20.30", "192.168.56.1"]);
});

test("getLanAddresses: si solo hay una virtual, sigue siendo mejor que nada", () => {
  assert.deepEqual(getLanAddresses({ "Ethernet 3": [v4("192.168.56.1")] }).map((r) => r.address), ["192.168.56.1"]);
});

test("parseLanIpOverride acepta una IPv4 y rechaza lo demás", () => {
  assert.equal(parseLanIpOverride("192.168.0.72"), "192.168.0.72");
  assert.equal(parseLanIpOverride("  10.0.0.5 "), "10.0.0.5");
  for (const bad of ["", "localhost", "192.168.0", "192.168.0.256", "192.168.0.1.5", "a.b.c.d", "192.168.0.72:8081", "http://192.168.0.72", undefined, null, 42]) {
    assert.equal(parseLanIpOverride(bad), null, String(bad));
  }
});

test("getServerAddresses: LAN_IP manda sobre los adaptadores; si es inválida se ignora", () => {
  const interfaces = { "Wi-Fi": [v4("192.168.0.72")] };
  assert.deepEqual(getServerAddresses("10.1.2.3", interfaces), [{ name: "LAN_IP", address: "10.1.2.3" }]);
  assert.deepEqual(getServerAddresses("nope", interfaces), [{ name: "Wi-Fi", address: "192.168.0.72" }]);
  assert.deepEqual(getServerAddresses(undefined, interfaces), [{ name: "Wi-Fi", address: "192.168.0.72" }]);
});

test("formatAccessLines marca la dirección que usará el QR, recomienda localhost y sugiere LAN_IP si hay varias", () => {
  const two = formatAccessLines(8081, [{ name: "Wi-Fi", address: "192.168.0.72" }, { name: "Ethernet 3", address: "192.168.56.1" }]);
  const marked = two.filter((l) => l.includes("<- la que lleva el código QR"));
  assert.equal(marked.length, 1);
  assert.ok(marked[0].includes("192.168.0.72"), "la marcada es la primera");
  assert.ok(two.some((l) => l.includes("http://localhost:8081") && l.includes("recomendada")));
  assert.ok(two.some((l) => l.includes("LAN_IP=")));

  const one = formatAccessLines(8081, [{ name: "Wi-Fi", address: "192.168.0.72" }]);
  assert.ok(!one.some((l) => l.includes("LAN_IP=")), "con una sola no hace falta");
});

// Lo que muestra /proc/net/route en un equipo con cable (metric 100) y Wi-Fi (metric 600) a la vez.
const ROUTE_TABLE = [
  "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT",
  "wlan0\t00000000\t0100A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0",
  "eth0\t00000000\t0100A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0",
  "eth0\t0000A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0",
  "",
].join("\n");

test("parseDefaultRouteInterface devuelve el adaptador de la ruta por defecto con menor métrica", () => {
  assert.equal(parseDefaultRouteInterface(ROUTE_TABLE), "eth0");
});

test("parseDefaultRouteInterface ignora rutas que no son por defecto, sin puerta de enlace o caídas", () => {
  const header = "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask";
  // Solo la red local (sin puerta de enlace): no es una ruta por defecto.
  assert.equal(parseDefaultRouteInterface(`${header}\neth0\t0000A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF`), null);
  // Ruta por defecto pero sin el bit "activa" (0x1).
  assert.equal(parseDefaultRouteInterface(`${header}\neth0\t00000000\t0100A8C0\t0002\t0\t0\t100\t00000000`), null);
});

test("parseDefaultRouteInterface tolera texto vacío o que no se entiende", () => {
  assert.equal(parseDefaultRouteInterface(""), null);
  assert.equal(parseDefaultRouteInterface(undefined), null);
  assert.equal(parseDefaultRouteInterface("no es una tabla de rutas"), null);
});

test("getLanAddresses pone primero al adaptador de la ruta por defecto, aunque el orden del sistema sea otro", () => {
  const interfaces = { wlan0: [v4("192.168.0.99")], eth0: [v4("192.168.0.72")] };
  assert.deepEqual(
    getLanAddresses(interfaces, "eth0").map((r) => r.name),
    ["eth0", "wlan0"]
  );
  assert.deepEqual(
    getLanAddresses(interfaces, "wlan0").map((r) => r.name),
    ["wlan0", "eth0"]
  );
});

test("getLanAddresses sin ruta por defecto conserva el orden de siempre", () => {
  const interfaces = { wlan0: [v4("192.168.0.99")], eth0: [v4("192.168.0.72")] };
  assert.deepEqual(
    getLanAddresses(interfaces).map((r) => r.name),
    ["wlan0", "eth0"]
  );
});

test("la ruta por defecto no hace subir a una red virtual por encima de una real si no es la de salida", () => {
  const interfaces = { docker0: [v4("172.17.0.1")], eth0: [v4("192.168.0.72")] };
  assert.deepEqual(
    getLanAddresses(interfaces, "eth0").map((r) => r.name),
    ["eth0", "docker0"]
  );
});

test("getServerAddresses: LAN_IP manda sobre la ruta por defecto", () => {
  const interfaces = { wlan0: [v4("192.168.0.99")], eth0: [v4("192.168.0.72")] };
  assert.deepEqual(getServerAddresses("10.1.2.3", interfaces, "eth0"), [{ name: "LAN_IP", address: "10.1.2.3" }]);
});

test("getServerAddresses usa el adaptador de la ruta por defecto cuando se indica", () => {
  const interfaces = { wlan0: [v4("192.168.0.99")], eth0: [v4("192.168.0.72")] };
  assert.deepEqual(getServerAddresses(undefined, interfaces, "eth0")[0], { name: "eth0", address: "192.168.0.72" });
});
