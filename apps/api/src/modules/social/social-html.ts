/**
 * Email and page HTML for social posts. Every platform's text is shown
 * exactly as it will be posted, with the Instagram card image, so the owner
 * approves what is really sent.
 */
import { Platform, PLATFORMS, SocialPost } from "./social.types";
import { PlatformHealth } from "./token-health";
import { PlatformResult, PublishMode } from "./social-publisher";

export const PLATFORM_LABEL: Record<Platform, string> = {
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X",
};

export function esc(s: string | undefined): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const PAGE_STYLE = "font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:24px auto;padding:0 16px;color:#1f2937;line-height:1.5";
const BOX = "background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px 14px;white-space:pre-wrap;word-break:break-word;font-size:14px";

function modeNote(mode: PublishMode): string {
  if (mode === "live") return "Posting is live. Pressing publish sends these posts.";
  if (mode === "dry_run") return "Posting is in dry-run mode. Pressing publish records exactly what would be sent and sends nothing.";
  return "Posting is switched off. Nothing will be sent.";
}

function platformBlock(post: SocialPost, p: Platform, withCheckbox: boolean): string {
  const r = post.platforms[p];
  if (!r) return "";
  if (r.state === "held") {
    return `<h3 style="margin:24px 0 6px">${PLATFORM_LABEL[p]} <span style="color:#b45309;font-weight:normal">(held, will not be posted)</span></h3>
<p style="font-size:13px;color:#92400e;margin:0 0 6px">The draft broke the voice rules after every attempt.</p>
<ul style="font-size:13px;color:#92400e;margin:0 0 8px">${(r.voice?.violations ?? []).map((v) => `<li>${esc(v)}</li>`).join("")}</ul>
${r.text ? `<div style="${BOX};opacity:.7">${esc(r.text)}</div>` : ""}`;
  }
  if (r.state === "skipped") {
    return `<h3 style="margin:24px 0 6px;color:#6b7280">${PLATFORM_LABEL[p]} <span style="font-weight:normal">(not offered)</span></h3>`;
  }
  const image = p === "instagram" && r.imageUrl
    ? `<p style="margin:8px 0 4px;font-size:12px;color:#6b7280">Card image</p><img src="${esc(r.imageUrl)}" alt="${esc(r.cardText)}" width="320" style="max-width:100%;border:1px solid #e5e7eb;border-radius:6px"><p style="font-size:12px;color:#6b7280;margin:4px 0 8px">Card text: ${esc(r.cardText)}</p>`
    : "";
  const box = withCheckbox && r.state === "offered"
    ? `<label style="display:block;margin:8px 0 0;font-size:14px"><input type="checkbox" name="platforms" value="${p}" checked> Post this to ${PLATFORM_LABEL[p]}</label>`
    : "";
  const score = r.voice ? `<span style="font-size:12px;color:#6b7280;font-weight:normal"> editorial score ${r.voice.score}</span>` : "";
  return `<h3 style="margin:24px 0 6px">${PLATFORM_LABEL[p]}${score}</h3>${image}<div style="${BOX}">${esc(r.text)}</div>${box}`;
}

function sourcesBlock(post: SocialPost): string {
  const unique = [...new Map(post.sources.map((s) => [s.url, s])).values()];
  return `<h3 style="margin:28px 0 6px">Sources</h3><ul style="font-size:13px;padding-left:18px">${unique.map((s) => `<li><a href="${esc(s.url)}">${esc(s.url)}</a> (read ${esc(s.fetchedOn)})</li>`).join("")}</ul>`;
}

export function approvalEmailHtml(post: SocialPost, reviewUrl: string, mode: PublishMode, expiresAt: Date): string {
  return `<!DOCTYPE html><html><body style="${PAGE_STYLE}">
<h2 style="margin-bottom:4px">Social post for your approval</h2>
<p style="margin-top:0;color:#4b5563">${esc(post.title)}${post.date ? `, planned for ${esc(post.date)}` : ""}</p>
<p style="font-size:14px">Below is each platform's text exactly as it will appear. Nothing is posted from this email. The button opens a page where you tick the platforms and press publish.</p>
<p style="font-size:13px;color:#4b5563">${esc(modeNote(mode))}</p>
${PLATFORMS.map((p) => platformBlock(post, p, false)).join("\n")}
${sourcesBlock(post)}
<p style="margin:28px 0"><a href="${esc(reviewUrl)}" style="background:#0f766e;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-size:15px">Open the review page</a></p>
<p style="font-size:12px;color:#6b7280">The link works once and stops working on ${esc(expiresAt.toUTCString())}. If you do nothing, nothing is posted.</p>
</body></html>`;
}

export function heldEmailHtml(post: SocialPost): string {
  return `<!DOCTYPE html><html><body style="${PAGE_STYLE}">
<h2 style="margin-bottom:4px">Social post held</h2>
<p style="margin-top:0;color:#4b5563">${esc(post.title)}${post.date ? `, planned for ${esc(post.date)}` : ""}</p>
<p style="font-size:14px">No platform draft passed the checks, so nothing was offered for approval and nothing will be posted.</p>
${(post.heldReasons ?? []).length ? `<ul style="font-size:13px">${post.heldReasons!.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
${PLATFORMS.map((p) => platformBlock(post, p, false)).join("\n")}
</body></html>`;
}

export function reviewPageHtml(post: SocialPost, token: string, actionUrl: string, mode: PublishMode): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review social post</title></head><body style="${PAGE_STYLE}">
<h2 style="margin-bottom:4px">${esc(post.title)}</h2>
<p style="margin-top:0;color:#4b5563">${esc(modeNote(mode))}</p>
<form method="post" action="${esc(actionUrl)}">
<input type="hidden" name="t" value="${esc(token)}">
${PLATFORMS.map((p) => platformBlock(post, p, true)).join("\n")}
${sourcesBlock(post)}
<p style="margin:28px 0 8px">
<button type="submit" name="decision" value="approve" style="background:#0f766e;color:#fff;border:0;padding:12px 20px;border-radius:6px;font-size:15px;cursor:pointer">Publish the ticked posts</button>
<button type="submit" name="decision" value="reject" style="background:#fff;color:#b91c1c;border:1px solid #b91c1c;padding:11px 18px;border-radius:6px;font-size:15px;cursor:pointer;margin-left:8px">Do not post</button>
</p>
<p style="font-size:12px;color:#6b7280">One press decides. The page cannot publish twice.</p>
</form>
</body></html>`;
}

export function messagePageHtml(heading: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(heading)}</title></head><body style="${PAGE_STYLE};text-align:center;margin-top:60px">
<h2>${esc(heading)}</h2><p>${body}</p><p style="color:#9ca3af;font-size:12px">You can close this tab.</p></body></html>`;
}

function resultLine(r: PlatformResult): string {
  const label = PLATFORM_LABEL[r.platform];
  switch (r.state) {
    case "published": return `${label}: posted${r.permalink ? ` <a href="${esc(r.permalink)}">${esc(r.permalink)}</a>` : ""}`;
    case "dry_run": return `${label}: dry run, recorded and not sent`;
    case "failed": return `${label}: not posted. ${esc(r.attempt?.error)}`;
    case "uncertain": return `${label}: outcome unknown. ${esc(r.attempt?.error)}. Check the page before posting it again by hand. It will not be retried.`;
    case "approved": return `${label}: waiting. ${esc(r.attempt?.error)}`;
    default: return `${label}: ${esc(r.state)}`;
  }
}

export function resultHtml(post: SocialPost, results: PlatformResult[]): string {
  return `<!DOCTYPE html><html><body style="${PAGE_STYLE}">
<h2 style="margin-bottom:4px">Social post result</h2>
<p style="margin-top:0;color:#4b5563">${esc(post.title)}</p>
<ul style="font-size:14px">${results.map((r) => `<li>${resultLine(r)}</li>`).join("")}</ul>
</body></html>`;
}

export function tokenAlertHtml(items: PlatformHealth[]): string {
  const renew: Record<Platform, string> = {
    linkedin: "Renew with a browser sign-in by a page administrator. The steps are in docs/LINKEDIN_ORG_POSTING.md and take about ten minutes.",
    facebook: "Generate a new long-lived Page token for the SCCF Page and add it as a new version of META_PAGE_ACCESS_TOKEN. Steps in docs/OPERATIONS.md, section 12.",
    instagram: "The same Meta token serves Instagram. It needs instagram_basic and instagram_content_publish, and the Instagram professional account must be linked to the Page. Steps in docs/OPERATIONS.md, section 12.",
    x: "Create the four X keys in the X developer console and add them as secrets. Steps in docs/OPERATIONS.md, section 12.",
  };
  return `<!DOCTYPE html><html><body style="${PAGE_STYLE}">
<h2>Social posting credentials need attention</h2>
${items.map((h) => `<h3 style="margin:20px 0 4px">${PLATFORM_LABEL[h.platform]}</h3><p style="margin:0 0 4px">${esc(h.detail)}</p><p style="margin:0;font-size:13px;color:#4b5563">${esc(renew[h.platform])}</p>`).join("\n")}
<p style="font-size:12px;color:#6b7280;margin-top:24px">Other platforms keep posting. You will hear about each stage once.</p>
</body></html>`;
}
