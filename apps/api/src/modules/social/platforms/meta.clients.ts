/**
 * Facebook Page and Instagram publishing through the Graph API.
 *
 * Facebook: POST /{page-id}/feed with `message`. Needs a Page access token
 * with pages_manage_posts (developers.facebook.com/docs/pages-api/posts/).
 *
 * Instagram: POST /{ig-user-id}/media with image_url and caption, then
 * POST /{ig-user-id}/media_publish with creation_id. The image must be a
 * public JPEG (the only format the API accepts), 320 to 1440 pixels wide,
 * aspect ratio 4:5 to 1.91:1, at most 8 MB. The token needs
 * instagram_basic and instagram_content_publish, and the Instagram
 * professional account must be linked to the Page
 * (developers.facebook.com/docs/instagram-platform/content-publishing/).
 *
 * Graph error code 190 means the token is invalid or expired.
 */
import {
  FetchLike, fetchWithTimeout, httpOutcome, networkOutcome, PlatformClient, PlatformPayload, PublishOutcome, readBody,
} from "./platform-client";

export const GRAPH_VERSION = "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

interface GraphError { error?: { message?: string; code?: number } }

function graphDetail(json: unknown): { message: string; tokenProblem: boolean } {
  const e = (json as GraphError | undefined)?.error;
  return { message: e?.message ?? "", tokenProblem: e?.code === 190 };
}

function form(fields: Record<string, string>): URLSearchParams {
  return new URLSearchParams(fields);
}

export class FacebookClient implements PlatformClient {
  readonly platform = "facebook" as const;
  constructor(private readonly fetchFn: FetchLike = fetch) {}

  isConfigured(): boolean {
    return Boolean(process.env.META_PAGE_ID && process.env.META_PAGE_ACCESS_TOKEN);
  }

  render(p: PlatformPayload) {
    return { method: "POST", url: `${GRAPH}/${process.env.META_PAGE_ID ?? "{META_PAGE_ID}"}/feed`, body: { message: p.text } };
  }

  async publish(p: PlatformPayload): Promise<PublishOutcome> {
    const pageId = process.env.META_PAGE_ID;
    const token = process.env.META_PAGE_ACCESS_TOKEN;
    if (!pageId || !token) return { kind: "not_configured", error: "META_PAGE_ID or META_PAGE_ACCESS_TOKEN is not set" };
    let res: Response;
    try {
      res = await fetchWithTimeout(this.fetchFn, `${GRAPH}/${pageId}/feed`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ message: p.text, access_token: token }),
      });
    } catch (err) {
      return networkOutcome(err);
    }
    const { text, json } = await readBody(res);
    if (!res.ok) {
      const d = graphDetail(json);
      return httpOutcome(res.status, d.message || text, d.tokenProblem);
    }
    const id = (json as { id?: string } | undefined)?.id;
    if (!id) return { kind: "uncertain", error: "Facebook answered without a post id", httpStatus: res.status };
    const [page, post] = id.split("_");
    return { kind: "published", postId: id, permalink: post ? `https://www.facebook.com/${page}/posts/${post}` : undefined, httpStatus: res.status };
  }
}

export class InstagramClient implements PlatformClient {
  readonly platform = "instagram" as const;
  constructor(private readonly fetchFn: FetchLike = fetch, private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {}

  isConfigured(): boolean {
    return Boolean(process.env.META_IG_USER_ID && process.env.META_PAGE_ACCESS_TOKEN);
  }

  render(p: PlatformPayload) {
    const ig = process.env.META_IG_USER_ID ?? "{META_IG_USER_ID}";
    return {
      steps: [
        { method: "POST", url: `${GRAPH}/${ig}/media`, body: { image_url: p.imageUrl, caption: p.text } },
        { method: "POST", url: `${GRAPH}/${ig}/media_publish`, body: { creation_id: "{container id from step 1}" } },
      ],
    };
  }

  async publish(p: PlatformPayload): Promise<PublishOutcome> {
    const ig = process.env.META_IG_USER_ID;
    const token = process.env.META_PAGE_ACCESS_TOKEN;
    if (!ig || !token) return { kind: "not_configured", error: "META_IG_USER_ID or META_PAGE_ACCESS_TOKEN is not set" };
    if (!p.imageUrl || !/^https:\/\/\S+\.jpe?g$/i.test(p.imageUrl)) {
      return { kind: "rejected", error: "Instagram needs a public JPEG image URL", retryable: false };
    }

    // Step 1. A failed container is never published, so any failure here is safe to retry.
    let container: string;
    try {
      const res = await fetchWithTimeout(this.fetchFn, `${GRAPH}/${ig}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ image_url: p.imageUrl, caption: p.text, access_token: token }),
      });
      const { text, json } = await readBody(res);
      if (!res.ok) {
        const d = graphDetail(json);
        return { kind: "rejected", error: `container: HTTP ${res.status} ${(d.message || text).slice(0, 200)}`, httpStatus: res.status, retryable: res.status >= 500 || res.status === 429, tokenProblem: d.tokenProblem || res.status === 401 };
      }
      const id = (json as { id?: string } | undefined)?.id;
      if (!id) return { kind: "rejected", error: "container: no id returned", retryable: true };
      container = id;
    } catch (err) {
      return { kind: "rejected", error: `container: ${(err as Error).message ?? err}`, retryable: true };
    }

    // Wait for the container to be ready (images are usually ready at once).
    for (let i = 0; i < 5; i++) {
      try {
        const res = await fetchWithTimeout(this.fetchFn, `${GRAPH}/${container}?fields=status_code&access_token=${encodeURIComponent(token)}`, { method: "GET" });
        const { json } = await readBody(res);
        const status = (json as { status_code?: string } | undefined)?.status_code;
        if (status === "FINISHED") break;
        if (status === "ERROR" || status === "EXPIRED") return { kind: "rejected", error: `container status ${status}`, retryable: false };
      } catch {
        // fall through to another try
      }
      if (i === 4) return { kind: "rejected", error: "container was not ready in time", retryable: true };
      await this.sleep(2000);
    }

    // Step 2. From here a failure may or may not have published.
    let res: Response;
    try {
      res = await fetchWithTimeout(this.fetchFn, `${GRAPH}/${ig}/media_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ creation_id: container, access_token: token }),
      });
    } catch (err) {
      return networkOutcome(err);
    }
    const { text, json } = await readBody(res);
    if (!res.ok) {
      const d = graphDetail(json);
      return httpOutcome(res.status, d.message || text, d.tokenProblem);
    }
    const id = (json as { id?: string } | undefined)?.id;
    if (!id) return { kind: "uncertain", error: "Instagram answered without a media id", httpStatus: res.status };
    return { kind: "published", postId: id, httpStatus: res.status };
  }
}
