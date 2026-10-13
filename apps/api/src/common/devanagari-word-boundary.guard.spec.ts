import * as fs from "fs";
import * as path from "path";

/**
 * Regression guard: no `\b` word boundary against Devanagari.
 *
 * JavaScript's `\b` is ASCII-only — a space and a Devanagari letter are both
 * "non-word" characters to it — so `\b(आयुष्मान)\b` can never match Hindi
 * script. This repo has shipped that bug repeatedly (issue #30 safety keywords,
 * PR #148 hospital search, the execution-planner signals, the Hindi NAVIGATION
 * route). The accepted fix is a `\b`-guarded Latin regex plus a boundary-free
 * (or `(?<![ऀ-ॿ])…(?![ऀ-ॿ])`-fenced) Devanagari regex.
 *
 * This spec scans every non-spec source file under src/ and fails on any `\b`
 * that sits next to a Devanagari character, directly or as the first/last
 * character of an alternative in the group the `\b` guards. Comment lines are
 * ignored. Known remaining sites are listed in KNOWN_UNFIXED with an exact
 * count, so a new instance anywhere — including in an allow-listed file —
 * fails the build.
 */

const SRC_ROOT = path.resolve(__dirname, "..");
const DEVANAGARI = /[ऀ-ॿ]/;

/**
 * Sites deliberately left for a follow-up. Each entry is an exact count of
 * offending `\b` tokens (a `\b(…)\b` group counts twice): fixing
 * one must lower the number here, and adding one fails the test.
 */
const KNOWN_UNFIXED: Record<string, { count: number; why: string }> = {
  // TODO(#201): open PR #201 edits empathy-detector.ts; fix `अकेला\b` there
  // (or right after it merges) and drop this entry.
  "modules/chat/empathy-detector.ts": { count: 1, why: "PR #201 owns this file" },
  // TODO(#203): open PR #203 (location-detector false cities) edits this file;
  // the `(?:se|से|mein|में|ka|का)\b` suffix alternatives are dead for Devanagari.
  "modules/chat/utils/location-detector.ts": { count: 1, why: "PR #203 owns this file" },
  // `\b(ambulance|एम्बुलेंस)\s*(bula|…)` — emergency fast path; changing what
  // escalates is a clinical-behaviour change that needs SCCF review.
  "modules/safety/emergency-fast-path.ts": { count: 1, why: "safety escalation — SCCF review" },
  // Hindi medical-content marker. Enabling it as-is would prepend the ENGLISH
  // "**Important:** …" disclaimer to Hindi replies (the auto-fix is
  // English-only and runs before the localised appendDisclaimer), contrary to
  // #162. Needs a decision on the verifier's disclaimer auto-fix first.
  "modules/chat/output-verifier.service.ts": { count: 2, why: "auto-fix disclaimer is English-only" },
};

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...listSourceFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Index of the paren matching the one at `open`, scanning forward. */
function matchForward(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "\\") { i++; continue; }
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/** Index of the paren matching the one at `close`, scanning backward. */
function matchBackward(s: string, close: number): number {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    const escaped = i > 0 && s[i - 1] === "\\";
    if (escaped) continue;
    if (s[i] === ")") depth++;
    else if (s[i] === "(" && --depth === 0) return i;
  }
  return -1;
}

/** Top-level `|` alternatives of a group body. */
function alternatives(body: string): string[] {
  const alts: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "\\") { cur += c + (body[i + 1] ?? ""); i++; continue; }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "|" && depth === 0) { alts.push(cur); cur = ""; continue; }
    cur += c;
  }
  alts.push(cur);
  return alts;
}

function stripGroupPrefix(s: string): string {
  return s.replace(/^(?:\((?:\?(?::|<[A-Za-z]\w*>))?)+/, "");
}

function stripTrailingQuantifiers(s: string): string {
  return s.replace(/(?:[)?*+]|\{\d+(?:,\d*)?\})+$/, "");
}

/**
 * Count `\b` tokens adjacent to Devanagari in one line of source. Handles both
 * regex-literal `\b` and string-escaped `\\b`.
 */
function countDevanagariBoundaries(line: string): number {
  // Normalise string-escaped `\\b` to `\b` so both forms are scanned alike.
  const s = line.replace(/\\\\b/g, "\\b");
  let count = 0;
  const re = /\\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    // An escaped backslash before it ("\\\b") is not a boundary token.
    if (m.index > 0 && s[m.index - 1] === "\\") continue;
    const after = s.slice(m.index + 2);
    const before = s.slice(0, m.index);
    let hit = false;

    // Right side: `\bआ…`, `\b(आ…|…)`, `\b(?:…|आ…)`.
    const afterBare = stripGroupPrefix(after);
    if (DEVANAGARI.test(afterBare[0] ?? "")) hit = true;
    if (!hit && after.startsWith("(")) {
      const close = matchForward(after, 0);
      if (close > 0) {
        const body = after.slice(1, close).replace(/^\?(?::|<[A-Za-z]\w*>)/, "");
        hit = alternatives(body).some((a) => DEVANAGARI.test(stripGroupPrefix(a)[0] ?? ""));
      }
    }

    // Left side: `…आ\b`, `(…|…आ)\b`.
    if (!hit) {
      const beforeBare = stripTrailingQuantifiers(before);
      if (DEVANAGARI.test(beforeBare[beforeBare.length - 1] ?? "")) hit = true;
    }
    if (!hit && before.endsWith(")")) {
      const open = matchBackward(before, before.length - 1);
      if (open >= 0) {
        const body = before.slice(open + 1, before.length - 1).replace(/^\?(?::|<[A-Za-z]\w*>)/, "");
        hit = alternatives(body).some((a) => {
          const t = stripTrailingQuantifiers(a);
          return DEVANAGARI.test(t[t.length - 1] ?? "");
        });
      }
    }

    if (hit) count++;
  }
  return count;
}

function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

describe("regression guard: no ASCII-only \\b against Devanagari", () => {
  describe("the scanner itself", () => {
    test.each([
      ["/\\b(आयुष्मान)\\b/", 2],
      ["/\\b(budget|खर्च|free)\\b/i", 2],
      ["/अकेला\\b/i", 1],
      ["/\\bकैंसर/", 1],
      ["/\\b(?:cancer|कैंसर)\\b/", 2],
      ["new RegExp(\"\\\\b(?:ambulance|एम्बुलेंस)\\\\s\")", 1],
      ["/(?:se|से|ka)\\b/gi", 1],
    ])("flags %s", (line, expected) => {
      expect(countDevanagariBoundaries(line)).toBe(expected);
    });

    test.each([
      "/\\b(budget|afford)\\b/i.test(lower) || /(खर्च|पैसा)/.test(lower)",
      "/(?<![ऀ-ॿ])(कौन\\s*सा)\\s*(अस्पताल)/",
      "/(\\bcancer\\b|कैंसर).*\\b(jankari)\\b/i",
      "const CHEMO = \"(?:\\\\b(?:chemo\\\\w*|kimo)\\\\b|कीमो)\";",
      "/\\b(?:glasses|lens\\w*)\\b|चश्म|ऐनक/i",
    ])("does not flag the accepted split form: %s", (line) => {
      expect(countDevanagariBoundaries(line)).toBe(0);
    });
  });

  test("no source file has a new \\b next to Devanagari", () => {
    const found: Record<string, string[]> = {};
    for (const file of listSourceFiles(SRC_ROOT)) {
      const rel = path.relative(SRC_ROOT, file).split(path.sep).join("/");
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (isCommentLine(line)) return;
        const n = countDevanagariBoundaries(line);
        for (let k = 0; k < n; k++) (found[rel] ??= []).push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }

    const unexpected: string[] = [];
    for (const [rel, hits] of Object.entries(found)) {
      const allowed = KNOWN_UNFIXED[rel]?.count ?? 0;
      if (hits.length > allowed) unexpected.push(...hits);
    }
    expect(unexpected).toEqual([]);

    // Keep the allow-list honest: once a site is fixed, its count must drop.
    for (const [rel, { count }] of Object.entries(KNOWN_UNFIXED)) {
      expect({ file: rel, hits: found[rel]?.length ?? 0 }).toEqual({ file: rel, hits: count });
    }
  });
});
