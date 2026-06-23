/**
 * LinkedIn publisher — UGC Posts API (official).
 *
 * Required env vars:
 *   SCCF_LINKEDIN_ACCESS_TOKEN  — OAuth 2.0 bearer token (w_organization_social scope)
 *   SCCF_LINKEDIN_ORG_ID        — numeric org ID (default: 71580340)
 */

const LINKEDIN_API = "https://api.linkedin.com/v2/ugcPosts";

export async function postToLinkedIn(content: string): Promise<void> {
  const token = process.env.SCCF_LINKEDIN_ACCESS_TOKEN;
  const orgId = process.env.SCCF_LINKEDIN_ORG_ID ?? "71580340";

  if (!token) {
    throw new Error("SCCF_LINKEDIN_ACCESS_TOKEN must be set");
  }

  const body = {
    author: `urn:li:organization:${orgId}`,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text: content },
        shareMediaCategory: "NONE",
      },
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
    },
  };

  const res = await fetch(LINKEDIN_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`LinkedIn API error ${res.status}: ${detail}`);
  }

  console.log("[linkedin] Post published via UGC Posts API");
}
