import { GcsSocialStore, MemorySocialStore, mutatePost, PAUSE_OBJECT } from "./social-store";
import { SocialPost } from "./social.types";

const post = (id = "p1"): SocialPost => ({
  id, lane: "practical", topicId: "t", title: "T", createdAt: "2026-12-01T00:00:00Z", sources: [],
  platforms: {
    linkedin: { state: "approved", text: "a", attempts: [] },
    facebook: { state: "approved", text: "b", attempts: [] },
    instagram: { state: "skipped", text: "", attempts: [] },
    x: { state: "skipped", text: "", attempts: [] },
  },
  status: "approved", contentHash: "h",
});

describe("MemorySocialStore", () => {
  it("creates once and refuses a second create", async () => {
    const s = new MemorySocialStore();
    expect(await s.createPost(post())).toBe(true);
    expect(await s.createPost(post())).toBe(false);
  });

  it("refuses a write from a stale version", async () => {
    const s = new MemorySocialStore();
    await s.createPost(post());
    const a = await s.getPost("p1");
    const b = await s.getPost("p1");
    expect(await s.updatePost({ ...a!.value, title: "A" }, a!.version)).toBe(true);
    expect(await s.updatePost({ ...b!.value, title: "B" }, b!.version)).toBe(false);
    expect((await s.getPost("p1"))!.value.title).toBe("A");
  });

  it("lets exactly one of two concurrent claims win", async () => {
    const s = new MemorySocialStore();
    await s.createPost(post());
    let wins = 0;
    const claim = () => mutatePost(s, "p1", (p) => {
      if (p.platforms.linkedin.state !== "approved") return null;
      p.platforms.linkedin.state = "publishing";
      return p;
    }).then((r) => { if (r?.changed) wins++; });
    await Promise.all([claim(), claim(), claim()]);
    expect(wins).toBe(1);
  });

  it("keeps a pause switch", async () => {
    const s = new MemorySocialStore();
    expect(await s.isPaused()).toBe(false);
    await s.setPaused(true);
    expect(await s.isPaused()).toBe(true);
    await s.setPaused(false);
    expect(await s.isPaused()).toBe(false);
  });
});

/** A tiny fake of the GCS bucket API, with generation preconditions. */
function fakeBucket() {
  const objects = new Map<string, { body: string; gen: number }>();
  let gen = 100;
  const file = (name: string, opts?: { generation?: string }) => ({
    name,
    async getMetadata() {
      const o = objects.get(name);
      if (!o) throw Object.assign(new Error("not found"), { code: 404 });
      return [{ generation: String(o.gen) }];
    },
    async download() {
      const o = objects.get(name);
      if (!o || (opts?.generation && String(o.gen) !== opts.generation)) throw Object.assign(new Error("not found"), { code: 404 });
      return [Buffer.from(o.body)];
    },
    async save(body: string, o: { preconditionOpts?: { ifGenerationMatch?: number } }) {
      const want = o?.preconditionOpts?.ifGenerationMatch;
      const cur = objects.get(name);
      if (want !== undefined && (want === 0 ? cur !== undefined : cur?.gen !== want)) throw Object.assign(new Error("precondition"), { code: 412 });
      objects.set(name, { body, gen: ++gen });
    },
    async exists() { return [objects.has(name)]; },
    async delete() { objects.delete(name); },
  });
  return {
    objects,
    file,
    async getFiles({ prefix }: { prefix: string }) {
      return [[...objects.keys()].filter((k) => k.startsWith(prefix)).map((k) => file(k))];
    },
  };
}

describe("GcsSocialStore", () => {
  it("uses ifGenerationMatch so a stale writer loses", async () => {
    const b = fakeBucket();
    const s = new GcsSocialStore(b);
    expect(await s.createPost(post())).toBe(true);
    expect(await s.createPost(post())).toBe(false);
    const a = await s.getPost("p1");
    expect(await s.updatePost({ ...a!.value, title: "A" }, a!.version)).toBe(true);
    expect(await s.updatePost({ ...a!.value, title: "B" }, a!.version)).toBe(false);
    expect((await s.listPosts()).map((p) => p.title)).toEqual(["A"]);
  });

  it("returns null for a missing post and stores the pause switch as an object", async () => {
    const b = fakeBucket();
    const s = new GcsSocialStore(b);
    expect(await s.getPost("nope")).toBeNull();
    await s.setPaused(true);
    expect(b.objects.has(PAUSE_OBJECT)).toBe(true);
    expect(await s.isPaused()).toBe(true);
  });

  it("rethrows errors other than a failed precondition", async () => {
    const b = fakeBucket();
    b.file = () => ({ async save() { throw Object.assign(new Error("boom"), { code: 500 }); } }) as never;
    const s = new GcsSocialStore(b);
    await expect(s.createPost(post())).rejects.toThrow("boom");
  });
});
