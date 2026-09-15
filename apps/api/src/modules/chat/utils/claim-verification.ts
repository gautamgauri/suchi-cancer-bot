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

/**
 * Subjects whose report is an instruction from the care team, not hearsay.
 * "doctor kehte hain ki chemo lena chahiye" / "My doctor told me I need chemo"
 * is a genuine question about a prescribed plan and belongs on the ordinary
 * path; "log kehte hain…" / "my aunt told me…" is hearsay. Only the generic
 * `\w+` / `\S+` subject patterns consult this list (#137 review).
 */
const CLINICAL_AUTHORITY =
  /^(?:doctors?|dr\.?|daktar|daaktar|dakter|doctorji|nurses?|oncologists?|onco|surgeons?|physicians?|specialists?|consultants?|radiologists?|pathologists?|डॉक्टर|डाक्टर|डॉक्टरों|डॉक्टरजी|चिकित्सक|नर्स|सर्जन|ऑन्कोलॉजिस्ट|विशेषज्ञ)$/i;

interface ClaimPattern {
  pattern: RegExp;
  /**
   * Capture-group index holding the reported subject. When present, a match
   * whose subject is a clinical authority is ignored (see CLINICAL_AUTHORITY).
   */
  subjectGroup?: number;
}

const CLAIM_VERIFICATION_PATTERNS: ClaimPattern[] = [
  // ── English ─────────────────────────────────────────────────────────────
  // Truth check
  { pattern: /\bis (it|this|that|the claim) (really )?true\b/i },
  { pattern: /\b(true or false|fact or (myth|fiction)|myth or fact)\b/i },
  { pattern: /\b(is (it|this|that) a myth|myths?|misconceptions?)\b/i },
  // "Does chemotherapy really work?", "Do mobile phones really cause cancer?"
  { pattern: /\b(?:does|do|did|is|are|can|could|would|will)\b[^?.!]{0,60}?\breally\b/i },
  // Hearsay framing
  { pattern: /\b(people|they|everyone|some people|many people) (say|says|claim|believe|think)\b/i },
  { pattern: /\b(i|we|i've|we've) (have )?(heard|read|been told)\b/i },
  { pattern: /\b(?:someone|somebody|my (\w+)) (?:told|tells|said|says) (?:me|us)\b/i, subjectGroup: 1 },

  // ── Hinglish (romanized) ───────────────────────────────────────────────
  // "kya ye sach hai", "kya sach hai ki ..." (subjectless — #137 review)
  { pattern: /\bkya\s+(?:ye|yeh|yah|wo|woh|vo|baat|ise|isme|ismein)?\s*sa(?:ch|ach)\s+ha(?:i|in|y)\b/i },
  // "ye sach hai", "baat sach hai"
  { pattern: /\b(?:ye|yeh|yah|wo|woh|vo|baat)\s+sa(?:ch|ach)\s+ha(?:i|in|y)\b/i },
  // "sach hai kya", "sach hai ya nahi", "sach hai ki ..."
  { pattern: /\bsa(?:ch|ach)\s+ha(?:i|in|y)\s+(?:kya|ya|ki)\b/i },
  // Postposed question particle — "... hota hai kya?", "... hai kya?" (#137 review)
  { pattern: /\b(?:hai|hain|hay|he|hein|tha|thi|the|hoga|hogi)\s+kya\s*[?!.।]*\s*$/i },
  // "log kehte hain", "papa kehte hai", "sab kehte hain" — generic subject,
  // clinicians excluded.
  {
    pattern: /\b(\w+) (?:kehte|kahte|kehti|kahti|kehta|kahta|bolte|bolti|bolta|batate|batati|batata) (?:hai|hain|he|hein)\b/i,
    subjectGroup: 1,
  },
  // "kisi ne bataya ki ...", "logon ne kaha ki ..." (#137 review)
  {
    pattern: /\b(\w+)\s+ne\s+(?:bataya|batayi|bataye|bata|kaha|kahi|kaha|bola|boli|likha)\b/i,
    subjectGroup: 1,
  },
  // "maine suna hai", "suna hai ki"
  { pattern: /\bsun(a|i) hai\b/i },
  // rumour / nonsense / lie framing
  { pattern: /\b(afwah|afvah|bakwas|bakwaas|jhooth|jhuth|jhoot|galat ?fehmi|mithak)\b/i },

  // ── Devanagari Hindi ───────────────────────────────────────────────────
  // "क्या यह सच है", "क्या सच है कि ..." (subjectless — #137 review)
  { pattern: /क्या\s+(?:यह|ये|वह|वो|यही|इसमें|बात)?\s*सच\s+ह(?:ै|ैं)/ },
  { pattern: /(यह|ये|वह|वो|बात)\s+सच\s+है/ },
  { pattern: /सच\s+है\s+(क्या|या|कि)/ },
  // Postposed question particle — "... फैलता है क्या?" (#137 review)
  { pattern: /(?:है|हैं|था|थी|थे|होगा|होगी)\s+क्या\s*[?!.।]*\s*$/ },
  // "लोग कहते हैं", "सब कहते हैं", "पापा कहते हैं" — clinicians excluded.
  {
    pattern: /(\S+)\s+(?:कहते|कहती|कहता|बोलते|बोलती|बताते|बताती)\s+(?:हैं|है)/,
    subjectGroup: 1,
  },
  // "किसी ने बताया कि ...", "लोगों ने कहा कि ..." (#137 review)
  {
    pattern: /(\S+)\s+ने\s+(?:बताया|बताई|बताये|बताया|कहा|कही|बोला|लिखा)/,
    subjectGroup: 1,
  },
  // "सुना है"
  { pattern: /सुना है/ },
  // rumour / myth / lie
  { pattern: /(अफवाह|मिथक|झूठ|गलतफहमी|भ्रम)/ },
];

/** Scans every occurrence so a clinician mention cannot mask a later rumour. */
function matchesClaimPattern(text: string, { pattern, subjectGroup }: ClaimPattern): boolean {
  if (subjectGroup === undefined) return pattern.test(text);

  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const scanner = new RegExp(pattern.source, flags);

  let match: RegExpExecArray | null;
  while ((match = scanner.exec(text)) !== null) {
    const subject = (match[subjectGroup] ?? "").trim();
    if (!CLINICAL_AUTHORITY.test(subject)) return true;
    if (match.index === scanner.lastIndex) scanner.lastIndex++;
  }

  return false;
}

export function isClaimVerificationQuestion(text?: string | null): boolean {
  if (!text) return false;
  const t = text.trim();
  if (!t) return false;
  return CLAIM_VERIFICATION_PATTERNS.some((entry) => matchesClaimPattern(t, entry));
}
