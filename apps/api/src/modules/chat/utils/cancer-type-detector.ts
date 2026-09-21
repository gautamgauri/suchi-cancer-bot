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
  // Oral cancer is a supported type elsewhere in the pipeline (essential terms,
  // hospital departments, execution planner) but was missing here, so an
  // oral-cancer turn on a stale session got the other disease's notes (#177).
  'oral': 'oral',
  'mouth': 'oral',
  'sarcoma': 'sarcoma'
};

/**
 * Keywords that name a cancer by themselves — no "cancer" wording needed nearby.
 * Everything else in the map is an organ or an anatomical adjective, which only
 * identifies a disease when cancer wording sits next to it.
 */
const selfIdentifyingKeywords = new Set([
  'melanoma',
  'leukemia',
  'leukaemia',
  'lymphoma',
  'sarcoma',
  'skin cancer',
]);

/**
 * Keywords whose bare form is ordinary clinical vocabulary ("oral chemotherapy",
 * "mouth sores") — they never count as a cancer type on their own, not even as a
 * mention, only with cancer wording attached.
 */
const requiresCancerContext = new Set(['oral', 'mouth']);

const CANCER_WORD = String.raw`(?:cancers?|carcinomas?|tumou?rs?|malignanc(?:y|ies)|malignant|neoplasms?|\bca\b)`;
// "oral cavity cancer" is the clinical phrasing for oral cancer; allow that one
// bridging word between the organ and the cancer word.
const BRIDGE = String.raw`(?:cavity[\s-]+)?`;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * True when `keyword` is used to name a disease in `textLower` — i.e. cancer
 * wording sits next to it ("stomach cancer", "cancer of the stomach",
 * "Ca breast") rather than the organ merely being mentioned in passing
 * ("stomach pain after chemo").
 */
function namedWithCancerContext(textLower: string, keyword: string): boolean {
  const kw = `\\b${escapeRegExp(keyword)}\\b`;
  const organThenCancer = new RegExp(`${kw}[\\s-]*${BRIDGE}${CANCER_WORD}`);
  const cancerThenOrgan = new RegExp(`${CANCER_WORD}[\\s-]*(?:(?:of|in)[\\s-]+(?:the[\\s-]+)?)?${kw}`);
  return organThenCancer.test(textLower) || cancerThenOrgan.test(textLower);
}

/**
 * Every cancer type named anywhere in a piece of text, in first-match order.
 * Used to check that a deterministic addendum is about the same disease as the
 * answer it is being appended to.
 */
export function detectCancerTypes(text: string): string[] {
  const textLower = text.toLowerCase();
  const found: string[] = [];

  for (const [keyword, cancerType] of Object.entries(cancerKeywords)) {
    const mentioned = requiresCancerContext.has(keyword)
      ? namedWithCancerContext(textLower, keyword)
      : textLower.includes(keyword);
    if (mentioned && !found.includes(cancerType)) {
      found.push(cancerType);
    }
  }

  return found;
}

/**
 * The cancer types the text explicitly identifies as the disease under
 * discussion, in first-match order. A self-identifying disease name counts on
 * its own; an organ only counts with cancer wording next to it.
 */
function detectExplicitCancerTypes(textLower: string): string[] {
  const found: string[] = [];

  for (const [keyword, cancerType] of Object.entries(cancerKeywords)) {
    const explicit = selfIdentifyingKeywords.has(keyword)
      ? textLower.includes(keyword)
      : namedWithCancerContext(textLower, keyword);
    if (explicit && !found.includes(cancerType)) {
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
 * A session tag records a diagnosis, so it takes an *explicit* naming to
 * overturn it: "stomach cancer" replaces it, "stomach pain after chemo" does
 * not — otherwise ordinary symptom wording would reframe retrieval and the
 * answer around the wrong disease. With no session tag there is nothing to
 * protect, so a bare organ or a lone misspelling ("prostrate") still picks a
 * type.
 *
 * @param userText User message text
 * @param sessionCancerType Optional cancer type from session (fallback only)
 */
export function detectCancerType(userText: string, sessionCancerType?: string | null): string | null {
  const textLower = userText.toLowerCase();

  const explicit = detectExplicitCancerTypes(textLower)[0];
  if (explicit) {
    return explicit;
  }

  // Nothing explicitly named: keep the session's diagnosis rather than let an
  // incidental organ mention overwrite it.
  if (sessionCancerType) {
    return sessionCancerType;
  }

  return detectCancerTypes(userText)[0] || null;
}
