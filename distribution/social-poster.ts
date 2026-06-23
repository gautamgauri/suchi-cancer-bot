import { GeneratedPack } from "./generator";
import { postToInstagram } from "./platforms/instagram";
import { postToTwitter } from "./platforms/twitter";
import { postToLinkedIn } from "./platforms/linkedin";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PostResult {
  platform: string;
  success: boolean;
  error?: string;
}

type PlatformKey = "instagram" | "twitter" | "linkedin";

// ---------------------------------------------------------------------------
// Platform registry
// ---------------------------------------------------------------------------

const PLATFORM_HANDLERS: Record<
  PlatformKey,
  (content: string) => Promise<void>
> = {
  instagram: postToInstagram,
  twitter: postToTwitter,
  linkedin: postToLinkedIn,
};

// Channel names as they appear in the pack JSON (GeneratedPack.channels)
const PLATFORM_TO_CHANNEL: Record<PlatformKey, keyof GeneratedPack["channels"]> = {
  instagram: "instagram",
  twitter: "twitter",
  linkedin: "linkedin",
};

function defaultPlatforms(): PlatformKey[] {
  const envVal = process.env.SCCF_POSTER_PLATFORMS;
  if (envVal) {
    return envVal
      .split(",")
      .map((p) => p.trim().toLowerCase())
      .filter((p): p is PlatformKey => p in PLATFORM_HANDLERS);
  }
  return ["instagram", "twitter", "linkedin"];
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Post `pack` to one or more social platforms.
 *
 * @param pack       The approved content pack (read from packs/*.json)
 * @param platforms  Which platforms to post to; defaults to SCCF_POSTER_PLATFORMS
 *                   env var or all three (instagram, twitter, linkedin).
 *
 * Platforms are run in sequence to avoid simultaneous logins triggering
 * security checks. A per-platform failure is logged and the loop continues.
 */
export async function postPack(
  pack: GeneratedPack,
  platforms?: string[]
): Promise<PostResult[]> {
  const targetPlatforms = (
    platforms
      ? platforms
          .map((p) => p.trim().toLowerCase())
          .filter((p): p is PlatformKey => p in PLATFORM_HANDLERS)
      : defaultPlatforms()
  );

  if (targetPlatforms.length === 0) {
    console.warn("[social-poster] No valid platforms specified — nothing to post");
    return [];
  }

  const results: PostResult[] = [];

  for (const platform of targetPlatforms) {
    const channelKey = PLATFORM_TO_CHANNEL[platform];
    const channelResult = pack.channels[channelKey];

    if (!channelResult || channelResult.status !== "ok") {
      const msg = channelResult
        ? `channel status is "${channelResult.status}" — skipping`
        : "channel missing from pack — skipping";
      console.warn(`[social-poster] [${platform}] ${msg}`);
      results.push({ platform, success: false, error: msg });
      continue;
    }

    const content = channelResult.content;
    console.log(`[social-poster] Posting to ${platform}...`);

    try {
      await PLATFORM_HANDLERS[platform](content);
      console.log(`[social-poster] [${platform}] SUCCESS`);
      results.push({ platform, success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[social-poster] [${platform}] FAILED — ${message}`);
      results.push({ platform, success: false, error: message });
    }
  }

  return results;
}
