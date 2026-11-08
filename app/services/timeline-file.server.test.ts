import assert from "node:assert/strict";
import test from "node:test";
import { createReservedTimelineFile, createTimelineFileChecked, ensureTimelineDriveFile, reserveTimelineFileId, saveNewTimelineFile, timelineFileDependencies, TimelineFileConflictError } from "./timeline-file.server";
import { writeTimelineDriveSnapshot } from "./timeline-drive-snapshot.server";
import type { Firestore } from "@google-cloud/firestore";
import { parseTimeline } from "./timeline-format";
import { buildEntryBlock, serializeMemoFile } from "../dashboard/memo/memoTimeline";
import type { DriveFile } from "./google-drive.server";

const name = "Dashboards/Timeline/Timeline/2026-11-08.md";
const signal = () => new AbortController().signal;
const content = (id: string, body = id) => serializeMemoFile("timeline:Timeline", [buildEntryBlock({ id, body, createdAt: "2026-11-08T00:00:00.000Z" })]);

function fixture() {
  const files = new Map<string, { file: DriveFile; content: string; revision: number }>();
  let loseCreate = false, loseWrite = false;
  const ids: string[] = [];
  const deps: typeof timelineFileDependencies = {
    find: async () => [...files.values()].map(value => value.file),
    reserve: async () => "canonical-id",
    create: async (_token, root, path, id) => {
      ids.push(id);
      if (!files.has(id)) files.set(id, { file: { id, name: path, mimeType: "text/markdown", parents: [root] }, content: "", revision: 0 });
      if (loseCreate) { loseCreate = false; throw new Error("create response lost"); }
      return files.get(id)!.file;
    },
    read: async (_token, file) => {
      const value = files.get(file.id)!;
      return { file: { ...value.file }, name: file.name, content: value.content, etag: String(value.revision) };
    },
    write: async (_token, snapshot, text) => {
      const value = files.get(snapshot.file.id)!;
      if (snapshot.etag !== String(value.revision)) return null;
      value.content = text; value.revision++;
      value.file = { ...value.file, md5Checksum: `revision-${value.revision}` };
      if (loseWrite) { loseWrite = false; throw new Error("write response lost"); }
      return value.file;
    },
  };
  return { files, deps, ids,
    loseCreate: () => { loseCreate = true; }, loseWrite: () => { loseWrite = true; },
    save: (text: string) => saveNewTimelineFile("token", "root", name, text, signal(), deps),
  };
}

test("two browsers creating a day concurrently elect one file and retain both posts", async () => {
  const setup = fixture();
  await Promise.all([setup.save(content("one")), setup.save(content("two"))]);
  assert.equal(setup.files.size, 1);
  assert.equal(new Set(setup.ids).size, 1);
  assert.deepEqual(parseTimeline([...setup.files.values()][0].content, name).map(entry => entry.id).sort(), ["one", "two"]);
});

test("a stale browser joins the existing daily file without replacing other posts", async () => {
  const setup = fixture();
  await setup.save(content("server"));
  const result = await setup.save(content("browser"));
  assert.equal(result.file.id, "canonical-id");
  assert.equal(setup.files.size, 1);
  assert.deepEqual(parseTimeline(result.content, name).map(entry => entry.id).sort(), ["browser", "server"]);
});

test("a create accepted by Drive before its response is lost is safe to retry", async () => {
  const setup = fixture(); setup.loseCreate();
  await assert.rejects(setup.save(content("one")), /create response lost/);
  await setup.save(content("one"));
  assert.equal(setup.files.size, 1);
  assert.equal(parseTimeline([...setup.files.values()][0].content, name).length, 1);
});

test("a lost conditional-write response and repeated retries do not duplicate posts or conflicts", async () => {
  const setup = fixture();
  await setup.save(content("same-id", "remote version"));
  setup.loseWrite();
  await assert.rejects(setup.save(content("same-id", "local version")), /write response lost/);
  for (let i = 0; i < 3; i++) await setup.save(content("same-id", "local version"));
  const posts = parseTimeline([...setup.files.values()][0].content, name);
  assert.equal(setup.files.size, 1);
  assert.equal(posts.length, 2);
  assert.deepEqual(posts.map(entry => entry.content).sort(), ["local version", "remote version"]);
});

test("existing duplicate names are preserved and reported instead of choosing a copy", async () => {
  const setup = fixture();
  setup.deps.find = async () => ["one", "two"].map(id => ({ id, name, mimeType: "text/markdown" }));
  await assert.rejects(setup.save(content("post")), /Duplicate Timeline files/);
  assert.deepEqual(setup.ids, []);
});

test("a stale reserved identity cannot overwrite a renamed or trashed file", async () => {
  const setup = fixture();
  setup.deps.create = async () => ({ id: "canonical-id", name: "moved.md", parents: ["root"], mimeType: "text/markdown" });
  await assert.rejects(ensureTimelineDriveFile("token", "root", name, signal(), setup.deps), /moved, renamed or deleted/);
});

test("a reserved-ID upload uses that ID and recovers an accepted retry on Drive 409", async t => {
  const requests: { url: string; init?: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    if (init?.method === "POST") return new Response(null, { status: 409 });
    return Response.json({ id: "reserved", name, parents: ["root"], mimeType: "text/markdown" });
  });
  const file = await createReservedTimelineFile("token", "root", name, "reserved", signal());
  assert.equal(file.id, "reserved");
  assert.match(String(requests[0].init?.body), /"id":"reserved"/);
  assert.match(String(requests[0].init?.body), /"kiokuflowSource":"timeline"/);
  assert.ok(requests[1].url.includes("/reserved"));
});

test("generic create refuses an existing daily body instead of acknowledging incomplete local content", async () => {
  const setup = fixture();
  await setup.save(content("remote"));
  await assert.rejects(createTimelineFileChecked("token", "root", name, content("local"), signal(), setup.deps), TimelineFileConflictError);
  assert.equal(parseTimeline([...setup.files.values()][0].content, name)[0].id, "remote");
});

test("a successful PUT followed by a competing writer is retried instead of adopting its checksum", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 200 }));
  const result = await writeTimelineDriveSnapshot("token", { name, content: "old", etag: "old", file: { id: "id", name, mimeType: "text/markdown" } }, "ours", signal(), async () => ({ id: "id", name, mimeType: "text/markdown", md5Checksum: "another-version" }));
  assert.equal(result, null);
});

test("separate server instances elect the same durable reserved ID before creating a file", async () => {
  const stored = new Map<string, { fileId: string }>();
  let queue = Promise.resolve();
  const database = {
    collection: () => ({ doc: (id: string) => ({ id, get: async () => ({ data: () => stored.get(id) }) }) }),
    runTransaction: (work: (transaction: { get(ref: { id: string }): Promise<{ data(): { fileId: string } | undefined }>; set(ref: { id: string }, value: { fileId: string }): void }) => Promise<string>) => {
      const run = queue.then(() => work({ get: async ref => ({ data: () => stored.get(ref.id) }), set: (ref, value) => { stored.set(ref.id, value); } }));
      queue = run.then(() => undefined);
      return run;
    },
  } as unknown as Firestore;
  let next = 0;
  const dependencies = () => ({ database: () => database, generate: async () => `reserved-${++next}` });
  const ids = await Promise.all(Array.from({ length: 8 }, () => reserveTimelineFileId("token", "root", name, signal(), dependencies())));
  assert.equal(new Set(ids).size, 1);
  assert.equal(stored.size, 1);
  assert.equal(await reserveTimelineFileId("token", "root", name, signal(), dependencies()), ids[0]);
  assert.equal(await reserveTimelineFileId("token", "other-root", name, signal(), dependencies()) === ids[0], false);
});
