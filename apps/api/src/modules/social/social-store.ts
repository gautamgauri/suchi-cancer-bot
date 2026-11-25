/**
 * Where social posts are recorded.
 *
 * Each post is one JSON object in the queue bucket, under social/posts/. Every
 * write is conditional on the object's generation (GCS ifGenerationMatch), so
 * two writers can never both move a post from one state to the next. That is
 * what makes publishing idempotent: a platform is claimed by one successful
 * conditional write before any request goes to the platform.
 *
 * Without QUEUE_GCS_BUCKET (local development, tests) an in-memory store with
 * the same compare-and-swap rule is used.
 */
import { Logger } from "@nestjs/common";
import { SocialPost } from "./social.types";

export interface Versioned<T> {
  value: T;
  version: string;
}

export interface SocialStore {
  /** True only for the shared GCS store. Live posting is refused otherwise. */
  readonly durable: boolean;
  getPost(id: string): Promise<Versioned<SocialPost> | null>;
  /** Create only if absent. False when a post with this id exists. */
  createPost(post: SocialPost): Promise<boolean>;
  /** Write only if the stored version is still `version`. False on conflict. */
  updatePost(post: SocialPost, version: string): Promise<boolean>;
  listPosts(): Promise<SocialPost[]>;
  getState<T>(name: string): Promise<Versioned<T> | null>;
  putState<T>(name: string, value: T, version: string | null): Promise<boolean>;
  isPaused(): Promise<boolean>;
  setPaused(paused: boolean): Promise<void>;
}

const POSTS = "social/posts/";
const STATE = "social/state/";
export const PAUSE_OBJECT = "social/PAUSED";

export class MemorySocialStore implements SocialStore {
  readonly durable: boolean;
  /** `durable` may be set true in tests that exercise live mode. */
  constructor(opts: { durable?: boolean } = {}) {
    this.durable = opts.durable ?? false;
  }
  private objects = new Map<string, { body: string; gen: number }>();
  private gen = 0;

  private read(name: string): Versioned<string> | null {
    const o = this.objects.get(name);
    return o ? { value: o.body, version: String(o.gen) } : null;
  }

  private write(name: string, body: string, version: string | null): boolean {
    const cur = this.objects.get(name);
    if (version === null ? cur !== undefined : !cur || String(cur.gen) !== version) return false;
    this.objects.set(name, { body, gen: ++this.gen });
    return true;
  }

  async getPost(id: string) {
    const r = this.read(POSTS + id + ".json");
    return r ? { value: JSON.parse(r.value) as SocialPost, version: r.version } : null;
  }
  async createPost(post: SocialPost) {
    return this.write(POSTS + post.id + ".json", JSON.stringify(post), null);
  }
  async updatePost(post: SocialPost, version: string) {
    return this.write(POSTS + post.id + ".json", JSON.stringify(post), version);
  }
  async listPosts() {
    return [...this.objects.entries()]
      .filter(([k]) => k.startsWith(POSTS))
      .map(([, v]) => JSON.parse(v.body) as SocialPost);
  }
  async getState<T>(name: string) {
    const r = this.read(STATE + name + ".json");
    return r ? { value: JSON.parse(r.value) as T, version: r.version } : null;
  }
  async putState<T>(name: string, value: T, version: string | null) {
    return this.write(STATE + name + ".json", JSON.stringify(value), version);
  }
  async isPaused() {
    return this.objects.has(PAUSE_OBJECT);
  }
  async setPaused(paused: boolean) {
    if (paused) this.objects.set(PAUSE_OBJECT, { body: "", gen: ++this.gen });
    else this.objects.delete(PAUSE_OBJECT);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Bucket = any;

function isPreconditionFailure(err: unknown): boolean {
  const e = err as { code?: number; response?: { status?: number } };
  return e?.code === 412 || e?.response?.status === 412;
}

function isNotFound(err: unknown): boolean {
  const e = err as { code?: number };
  return e?.code === 404;
}

export class GcsSocialStore implements SocialStore {
  readonly durable = true;
  private readonly logger = new Logger(GcsSocialStore.name);
  constructor(private readonly bucket: Bucket) {}

  private async read(name: string): Promise<Versioned<string> | null> {
    const file = this.bucket.file(name);
    try {
      const [meta] = await file.getMetadata();
      const generation = String(meta.generation);
      const [buf] = await this.bucket.file(name, { generation }).download();
      return { value: (buf as Buffer).toString("utf-8"), version: generation };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  private async write(name: string, body: string, version: string | null): Promise<boolean> {
    try {
      await this.bucket.file(name).save(body, {
        contentType: "application/json",
        resumable: false,
        preconditionOpts: { ifGenerationMatch: version === null ? 0 : Number(version) },
      });
      return true;
    } catch (err) {
      if (isPreconditionFailure(err)) return false;
      throw err;
    }
  }

  async getPost(id: string) {
    const r = await this.read(POSTS + id + ".json");
    return r ? { value: JSON.parse(r.value) as SocialPost, version: r.version } : null;
  }
  createPost(post: SocialPost) {
    return this.write(POSTS + post.id + ".json", JSON.stringify(post, null, 2), null);
  }
  updatePost(post: SocialPost, version: string) {
    return this.write(POSTS + post.id + ".json", JSON.stringify(post, null, 2), version);
  }
  async listPosts() {
    const [files] = await this.bucket.getFiles({ prefix: POSTS });
    const out: SocialPost[] = [];
    for (const f of files as Array<{ name: string; download: () => Promise<[Buffer]> }>) {
      try {
        const [buf] = await f.download();
        out.push(JSON.parse(buf.toString("utf-8")) as SocialPost);
      } catch (err) {
        this.logger.warn(`Could not read ${f.name}: ${(err as Error).message}`);
      }
    }
    return out;
  }
  async getState<T>(name: string) {
    const r = await this.read(STATE + name + ".json");
    return r ? { value: JSON.parse(r.value) as T, version: r.version } : null;
  }
  putState<T>(name: string, value: T, version: string | null) {
    return this.write(STATE + name + ".json", JSON.stringify(value, null, 2), version);
  }
  async isPaused() {
    const [exists] = await this.bucket.file(PAUSE_OBJECT).exists();
    return Boolean(exists);
  }
  async setPaused(paused: boolean) {
    if (paused) await this.bucket.file(PAUSE_OBJECT).save("paused\n", { contentType: "text/plain", resumable: false });
    else await this.bucket.file(PAUSE_OBJECT).delete({ ignoreNotFound: true });
  }
}

export function createSocialStore(): SocialStore {
  const bucketName = process.env.QUEUE_GCS_BUCKET;
  if (!bucketName) return new MemorySocialStore();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Storage } = require("@google-cloud/storage");
  const storage = new Storage({ projectId: process.env.GOOGLE_CLOUD_PROJECT ?? "gen-lang-client-0202543132" });
  return new GcsSocialStore(storage.bucket(bucketName));
}

/**
 * Read, change and write back with compare-and-swap, retrying on conflict.
 * `change` returns the new post, or null to leave it alone. Returns the
 * stored post after the write, or null when the post does not exist.
 */
export async function mutatePost(
  store: SocialStore,
  id: string,
  change: (post: SocialPost) => SocialPost | null,
  attempts = 6,
  jitter = false,
): Promise<{ post: SocialPost; changed: boolean } | null> {
  for (let i = 0; i < attempts; i++) {
    const cur = await store.getPost(id);
    if (!cur) return null;
    const next = change(structuredClone(cur.value));
    if (!next) return { post: cur.value, changed: false };
    if (await store.updatePost(next, cur.version)) return { post: next, changed: true };
    if (jitter) await new Promise((r) => setTimeout(r, 20 + Math.floor(Math.random() * 80) * (i + 1)));
  }
  throw new Error(`Could not update social post ${id}: too many concurrent writes`);
}
