/**
 * Cancer type detector - extracts cancer type from user queries
 * Used to make identify question responses cancer-type-specific
 */

const cancerKeywords: Record<string, string> = {
  'breast': 'breast',
  'lung': 'lung',
  'prostate': 'prostate',
  // Common misspelling of "prostate" — without it a typo'd question falls
  // through to the (possibly stale) session tag (issue #175).
  'prostrate': 'prostate',
  'colorectal': 'colorectal',
  'colon': 'colorectal',
  'pancreatic': 'pancreatic',
  'ovarian': 'ovarian',
  'leukemia': 'leukemia',
  'leukaemia': 'leukemia',
  'lymphoma': 'lymphoma',
  'melanoma': 'skin',
  'skin cancer': 'skin',
  'thyroid': 'thyroid',
  'liver': 'liver',
  'kidney': 'kidney',
  'stomach': 'stomach',
  'bladder': 'bladder',
  'cervical': 'cervical',
  'uterine': 'uterine',
  'endometrial': 'endometrial',
  'brain': 'brain',
  'esophageal': 'esophageal',
  'esophagus': 'esophageal',
  'oesophageal': 'esophageal',
  'oesophagus': 'esophageal',
  'laryngeal': 'laryngeal',
  'larynx': 'laryngeal',
  'head and neck': 'head and neck',
  'sarcoma': 'sarcoma'
};

/**
 * Every cancer type named anywhere in a piece of text, in first-match order.
 * Used to check that a deterministic addendum is about the same disease as the
 * answer it is being appended to.
 */
export function detectCancerTypes(text: string): string[] {
  const textLower = text.toLowerCase();
  const found: string[] = [];

  for (const [keyword, cancerType] of Object.entries(cancerKeywords)) {
    if (textLower.includes(keyword) && !found.includes(cancerType)) {
      found.push(cancerType);
    }
  }

  return found;
}

/**
 * Detect the cancer type a turn is about.
 *
 * The *current message* wins: if the user names a cancer type now, that beats
 * whatever the session was tagged with earlier. The session tag is only a
 * fallback for messages that name no type at all. (Before issue #175 the
 * session tag was returned first, so a session tagged `breast` answered a
 * prostate question with breast screening notes.)
 *
 * @param userText User message text
 * @param sessionCancerType Optional cancer type from session (fallback only)
 */
export function detectCancerType(userText: string, sessionCancerType?: string | null): string | null {
  const fromMessage = detectCancerTypes(userText)[0];
  if (fromMessage) {
    return fromMessage;
  }

  // Nothing named in this message — carry the session's type forward.
  return sessionCancerType || null;
}
