const test = require("node:test");
const assert = require("node:assert/strict");
const { openRatingsStore } = require("../lib/ratingsStore");

const rating = (overrides = {}) => ({
  songKey: "yt:9Lxm0iSnKNc",
  rater: "Ana",
  value: 1,
  title: "Queen - Bohemian Rhapsody (Karaoke Version)",
  ratedAt: "2026-09-20T10:00:00.000Z",
  ...overrides,
});

test("una canción sin calificaciones tiene cero pulgares", async () => {
  const store = await openRatingsStore(":memory:");
  assert.deepEqual(await store.summary("yt:nadie"), { up: 0, down: 0 });
  await store.close();
});

test("cuenta los pulgares arriba y abajo de cada canción por separado", async () => {
  const store = await openRatingsStore(":memory:");
  await store.upsert(rating({ rater: "Ana", value: 1 }));
  await store.upsert(rating({ rater: "Beto", value: 1 }));
  await store.upsert(rating({ rater: "Carla", value: -1 }));
  await store.upsert(rating({ songKey: "lib:Queen - Radio Ga Ga.mp4", rater: "Ana", value: -1 }));
  assert.deepEqual(await store.summary("yt:9Lxm0iSnKNc"), { up: 2, down: 1 });
  assert.deepEqual(await store.summary("lib:Queen - Radio Ga Ga.mp4"), { up: 0, down: 1 });
  await store.close();
});

test("calificar de nuevo la misma canción reemplaza la calificación de esa persona, no la suma", async () => {
  const store = await openRatingsStore(":memory:");
  await store.upsert(rating({ value: 1 }));
  await store.upsert(rating({ value: -1, ratedAt: "2026-09-21T10:00:00.000Z" }));
  assert.deepEqual(await store.summary("yt:9Lxm0iSnKNc"), { up: 0, down: 1 });
  await store.close();
});

test("rechaza valores que no sean pulgar arriba (1) ni abajo (-1)", async () => {
  const store = await openRatingsStore(":memory:");
  for (const value of [0, 2, -2, 5]) {
    await assert.rejects(store.upsert(rating({ value })), /CHECK constraint/, String(value));
  }
  assert.deepEqual(await store.summary("yt:9Lxm0iSnKNc"), { up: 0, down: 0 });
  await store.close();
});

test("el título es opcional", async () => {
  const store = await openRatingsStore(":memory:");
  await store.upsert(rating({ title: undefined }));
  assert.deepEqual(await store.summary("yt:9Lxm0iSnKNc"), { up: 1, down: 0 });
  await store.close();
});
