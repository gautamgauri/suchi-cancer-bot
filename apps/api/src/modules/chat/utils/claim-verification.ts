/**
 * Detects "is this claim true?" questions — the user is repeating something
 * they heard (a myth, a rumour, a relative's opinion) and asking whether it
 * holds. These are NOT simple definitional questions ("What is a biopsy?"),
 * so they must not be routed to the answer-first definitional path, which by
 * design returns a 2-3 sentence definition plus a clarifying question and
 * never engages with the claim itself (issue #136).
 *
 * Routing signal only. This does not change prompts, templates, safety
 * keywords or clinical wording, and it does not affect response language.
 */

const CLAIM_VERIFICATION_PATTERNS: RegExp[] = [
  // ── English ─────────────────────────────────────────────────────────────
  // Truth check
  /\bis (it|this|that|the claim) (really )?true\b/i,
  /\b(true or false|fact or (myth|fiction)|myth or fact)\b/i,
  /\b(is (it|this|that) a myth|myths?|misconceptions?)\b/i,
  // Hearsay framing
  /\b(people|they|everyone|some people|many people) (say|says|claim|believe|think)\b/i,
  /\b(i|we|i've|we've) (have )?(heard|read|been told)\b/i,
  /\b(someone|somebody|my \w+) (told|tells|said|says) (me|us)\b/i,

  // ── Hinglish (romanized) ───────────────────────────────────────────────
  // "kya ye sach hai", "sach hai kya", "sach hai ya nahi"
  /\b(kya )?(ye|yeh|yah|wo|woh|vo|baat) sa(ch|ach) hai\b/i,
  /\bsa(ch|ach) hai (kya|ya)\b/i,
  // "log kehte hain", "papa kehte hai", "sab kehte hain"
  /\b(log|logon|sab|sabhi|\w+) (kehte|kahte|kehti|kahti|bolte|bolti|batate) (hai|hain|he|hein)\b/i,
  // "maine suna hai", "suna hai ki"
  /\bsun(a|i) hai\b/i,
  // rumour / nonsense / lie framing
  /\b(afwah|afvah|bakwas|bakwaas|jhooth|jhuth|jhoot|galat ?fehmi|mithak)\b/i,

  // ── Devanagari Hindi ───────────────────────────────────────────────────
  // "क्या यह सच है", "सच है क्या", "ये सच है"
  /(यह|ये|वह|वो|बात) सच है/,
  /सच है (क्या|या)/,
  // "लोग कहते हैं", "सब कहते हैं", "पापा कहते हैं"
  /(लोग|सब|सभी|\S+) (कहते|कहती|बोलते|बताते) (हैं|है)/,
  // "सुना है"
  /सुना है/,
  // rumour / myth / lie
  /(अफवाह|मिथक|झूठ|गलतफहमी|भ्रम)/,
];

export function isClaimVerificationQuestion(text?: string | null): boolean {
  if (!text) return false;
  const t = text.trim();
  if (!t) return false;
  return CLAIM_VERIFICATION_PATTERNS.some((re) => re.test(t));
}
