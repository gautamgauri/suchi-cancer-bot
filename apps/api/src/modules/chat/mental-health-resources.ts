/**
 * Locale-aware mental health resources for cancer patients
 * Provides crisis helplines, support services, and cancer-specific resources
 */

export interface MentalHealthResource {
  name: string;
  phone: string;
  description: string;
  available: string; // e.g., "24/7" or "Mon-Sat 8am-10pm"
  website?: string;
  isCrisisLine?: boolean;
}

// India-focused mental health resources (verified official sources)
const INDIA_RESOURCES: MentalHealthResource[] = [
  {
    name: "iCall (TISS)",
    phone: "9152987821",
    description: "Psychosocial helpline by TISS - trained counselors",
    available: "Mon-Sat, 8am-10pm IST",
    website: "https://icallhelpline.org/",
    isCrisisLine: false,
  },
  {
    name: "Vandrevala Foundation",
    phone: "9999666555",
    description: "24/7 mental health support helpline",
    available: "24/7",
    website: "https://www.vandrevalafoundation.com/",
    isCrisisLine: true,
  },
  {
    name: "Muktaa Charitable Foundation",
    phone: "7887889882",
    description: "Mental health helpline",
    available: "Mon-Sat, 9:30am-5:30pm IST",
    website: "https://mcf.org.in/",
    isCrisisLine: false,
  },
  {
    name: "Indian Cancer Society",
    phone: "1800-22-1951",
    description: "Cancer helpline (toll-free)",
    available: "24/7",
    website: "https://www.indiancancersociety.org/",
    isCrisisLine: false,
  },
];

export const MENTAL_HEALTH_RESOURCES: Record<string, MentalHealthResource[]> = {
  IN: INDIA_RESOURCES,
  // Default to India resources for all locales
  DEFAULT: INDIA_RESOURCES,
};

// Emergency numbers (India-focused)
export const EMERGENCY_NUMBERS: Record<string, string> = {
  IN: "112",
  DEFAULT: "112", // Default to India emergency number
};

/**
 * Get mental health resources for a given locale
 * @param locale - Locale string (e.g., 'en-IN', 'en-US', 'IN', 'US')
 * @returns Array of mental health resources
 */
export function getResourcesForLocale(locale: string): MentalHealthResource[] {
  // Extract country code from locale (e.g., 'en-IN' -> 'IN', 'en-US' -> 'US')
  const parts = locale.split("-");
  const countryCode = parts.length > 1 ? parts[1].toUpperCase() : parts[0].toUpperCase();

  return MENTAL_HEALTH_RESOURCES[countryCode] || MENTAL_HEALTH_RESOURCES.DEFAULT;
}

/**
 * Get crisis-specific resources (24/7 helplines)
 * @param locale - Locale string
 * @returns Array of crisis helplines only
 */
export function getCrisisResourcesForLocale(locale: string): MentalHealthResource[] {
  const resources = getResourcesForLocale(locale);
  return resources.filter((r) => r.isCrisisLine);
}

/**
 * Get emergency number for a locale
 * @param locale - Locale string
 * @returns Emergency phone number
 */
export function getEmergencyNumber(locale: string): string {
  const parts = locale.split("-");
  const countryCode = parts.length > 1 ? parts[1].toUpperCase() : parts[0].toUpperCase();

  return EMERGENCY_NUMBERS[countryCode] || EMERGENCY_NUMBERS.DEFAULT;
}

/**
 * Format resources as markdown for chat response
 * @param resources - Array of resources to format
 * @returns Markdown formatted string
 */
export function formatResourcesAsMarkdown(resources: MentalHealthResource[]): string {
  return resources
    .map((r) => {
      let line = `- **${r.name}**: ${r.phone}`;
      if (r.description) {
        line += ` - ${r.description}`;
      }
      line += ` (${r.available})`;
      if (r.website) {
        line += ` [Website](${r.website})`;
      }
      return line;
    })
    .join("\n");
}
