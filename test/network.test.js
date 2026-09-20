const test = require("node:test");
const assert = require("node:assert/strict");
const { getLanAddresses, formatAccessLines } = require("../lib/network");

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
    Virtual: [v4("172.20.0.1")],
    "Wi-Fi": [v4("192.168.0.72")],
    Vpn: [v4("10.8.0.2")],
  });
  assert.deepEqual(
    result.map((r) => r.name),
    ["Virtual", "Wi-Fi", "Vpn", "Publica"]
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
