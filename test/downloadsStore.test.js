const test = require("node:test");
const assert = require("node:assert/strict");
const { openDownloadsStore } = require("../lib/downloadsStore");

function sampleEntry(overrides = {}) {
  return {
    uuid: "11111111-1111-4111-8111-111111111111",
    filename: "11111111-1111-4111-8111-111111111111.mp4",
    videoId: "9Lxm0iSnKNc",
    videoUrl: "https://www.youtube.com/watch?v=9Lxm0iSnKNc",
    title: "Queen - Bohemian Rhapsody (Karaoke Version)",
    channel: "Sing King",
    durationSeconds: 375,
    searchQuery: "bohemian rhapsody",
    searchSuffix: "karaoke",
    requestedBy: "Ana",
    fileSizeBytes: 8735000,
    downloadedAt: "2026-09-20T10:00:00.000Z",
    ...overrides,
  };
}

test("guarda y devuelve todos los datos de una descarga", async () => {
  const store = await openDownloadsStore(":memory:");
  await store.insert(sampleEntry());
  const found = await store.findByVideoId("9Lxm0iSnKNc");
  assert.deepEqual(found, {
    ...sampleEntry(),
    lastUsedAt: "2026-09-20T10:00:00.000Z",
    useCount: 0,
  });
  await store.close();
});

test("findByVideoId devuelve null si el video no se ha descargado", async () => {
  const store = await openDownloadsStore(":memory:");
  assert.equal(await store.findByVideoId("aaaaaaaaaaa"), null);
  await store.close();
});

test("no permite registrar dos veces el mismo video de YouTube", async () => {
  const store = await openDownloadsStore(":memory:");
  await store.insert(sampleEntry());
  await assert.rejects(
    store.insert(
      sampleEntry({
        uuid: "22222222-2222-4222-8222-222222222222",
        filename: "22222222-2222-4222-8222-222222222222.mp4",
      })
    ),
    /UNIQUE/
  );
  await store.close();
});

test("admite campos opcionales vacíos", async () => {
  const store = await openDownloadsStore(":memory:");
  await store.insert(
    sampleEntry({ channel: null, durationSeconds: undefined, searchQuery: null, searchSuffix: null, requestedBy: null })
  );
  const found = await store.findByVideoId("9Lxm0iSnKNc");
  assert.equal(found.channel, null);
  assert.equal(found.durationSeconds, null);
  assert.equal(found.searchQuery, null);
  await store.close();
});

test("list devuelve primero las descargas más recientes", async () => {
  const store = await openDownloadsStore(":memory:");
  await store.insert(sampleEntry({ downloadedAt: "2026-09-20T10:00:00.000Z" }));
  await store.insert(
    sampleEntry({
      uuid: "33333333-3333-4333-8333-333333333333",
      filename: "33333333-3333-4333-8333-333333333333.mp4",
      videoId: "jNQXAC9IVRw",
      title: "Me at the zoo",
      downloadedAt: "2026-09-20T12:00:00.000Z",
    })
  );
  const titles = (await store.list()).map((e) => e.title);
  assert.deepEqual(titles, ["Me at the zoo", "Queen - Bohemian Rhapsody (Karaoke Version)"]);
  await store.close();
});

test("touch suma un uso y renueva la fecha de último uso", async () => {
  const store = await openDownloadsStore(":memory:");
  await store.insert(sampleEntry());
  await store.touch(sampleEntry().filename, "2026-09-20T15:30:00.000Z");
  await store.touch(sampleEntry().filename, "2026-09-20T16:00:00.000Z");
  const found = await store.findByVideoId("9Lxm0iSnKNc");
  assert.equal(found.useCount, 2);
  assert.equal(found.lastUsedAt, "2026-09-20T16:00:00.000Z");
  assert.equal(found.downloadedAt, "2026-09-20T10:00:00.000Z");
  await store.close();
});

test("listUnusedSince devuelve solo las descargas sin uso desde antes del corte", async () => {
  const store = await openDownloadsStore(":memory:");
  await store.insert(sampleEntry({ downloadedAt: "2026-09-20T08:00:00.000Z" }));
  await store.insert(
    sampleEntry({
      uuid: "33333333-3333-4333-8333-333333333333",
      filename: "33333333-3333-4333-8333-333333333333.mp4",
      videoId: "jNQXAC9IVRw",
      downloadedAt: "2026-09-20T12:00:00.000Z",
    })
  );
  const expired = await store.listUnusedSince("2026-09-20T10:00:00.000Z");
  assert.deepEqual(expired.map((e) => e.videoId), ["9Lxm0iSnKNc"]);

  // Usarla la renueva: ya no aparece como vencida.
  await store.touch(sampleEntry().filename, "2026-09-20T11:00:00.000Z");
  assert.deepEqual(await store.listUnusedSince("2026-09-20T10:00:00.000Z"), []);
  await store.close();
});

test("remove borra el registro y permite volver a descargar el mismo video", async () => {
  const store = await openDownloadsStore(":memory:");
  await store.insert(sampleEntry());
  await store.remove(sampleEntry().filename);
  assert.equal(await store.findByVideoId("9Lxm0iSnKNc"), null);
  await store.insert(sampleEntry());
  assert.ok(await store.findByVideoId("9Lxm0iSnKNc"));
  await store.close();
});
