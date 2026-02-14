export interface DeliveryGuardConfig {
  allowedSlackChannelIds: string[];
  allowedEmailRecipients: string[];
  allowedEmailDomains: string[];
  blockExternalDelivery: boolean;
}

export function parseCsvList(value?: string): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeEmailDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^@+/, "");
}

export function parseDeliveryGuardConfig(
  env: Partial<Record<string, string | undefined>>,
): DeliveryGuardConfig {
  return {
    allowedSlackChannelIds: parseCsvList(env.FUNDING_ALLOWED_SLACK_CHANNEL_IDS),
    allowedEmailRecipients: parseCsvList(env.FUNDING_ALLOWED_EMAIL_RECIPIENTS).map((email) =>
      email.toLowerCase(),
    ),
    allowedEmailDomains: parseCsvList(env.FUNDING_ALLOWED_EMAIL_DOMAINS).map(normalizeEmailDomain),
    blockExternalDelivery: (env.FUNDING_BLOCK_EXTERNAL_DELIVERY || "false").toLowerCase() === "true",
  };
}
