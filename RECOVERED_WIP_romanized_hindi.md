# Recovered WIP — Romanized-Hindi detection (intent/mode)

**Why this file exists:** an uncommitted working-tree change set (Romanized-Hindi
symptom/personal detection) was destroyed by an accidental `git reset --hard`
during the Hindi-safety remediation. It was never staged/committed, so git can't
recover it. The hunks below were **reconstructed from diffs that had been printed
earlier in the working session**, so the source edits are recoverable; the test
additions and one prompt tweak are **NOT fully recoverable** (see bottom).

Apply by hand to the named files (line numbers approximate — match on the
surrounding context lines shown).

---

## `apps/api/src/modules/chat/intent-classifier.ts`
In the symptom-pattern array (after the existing Hindi/Hinglish symptom regexes,
~line 459, before `];` / `return symptomPatterns.some(...)`):

```ts
      /लक्षण|संकेत|दर्द|सूजन|खून|बुखार|थकान|वजन|खांसी|सांस|उल्टी|गांठ|कमज़ोरी/,
      // Hinglish symptom terms (प्रॉब्लम=problem, तकलीफ=trouble, बीमारी=illness)
      /प्रॉब्लम|तकलीफ|बीमारी|परेशानी|सिंपटम्स/,
      // Romanized Hindi symptom terms (dard=pain, takleef=trouble, sujan=swelling,
      // gaanth/gilti=lump, khoon=blood, bukhar=fever, khansi=cough, ulti=vomiting,
      // kamzori=weakness, thakan=fatigue, pareshani=trouble, bimari=illness)
      /\b(dard|takl(ee|i)f|suj(a|aa)n|soojan|g(aa?)nth|gilti|khoon|khun|bukhar|khaa?nsi|ulti|kamz?ori|kamjori|thakaa?n|pareshani|bimaa?ri)\b/i,
      // Romanized body part + "mein/me" pain framing ("pet mein dard" = stomach pain)
      // Requires the location framing so the English word "pet" alone never matches
      /\b(pet|seene|chhati|gale|sir|kamar|munh|muh)\s+(mein|me|may)\b/i,
```

## `apps/api/src/modules/chat/mode-detector.ts`

Hunk 1 — personal/navigate pattern array (~line 110, after the Hindi family +
"चल रहा/हो रहा" framing lines):

```ts
      /मदर|फादर|माँ|मम्मी|पापा|पिता|पत्नी|बच्चा|बेटा|बेटी|भाई|बहन/,
      // Hindi personal symptom framing (चल रहा है=is ongoing, हो रहा=is happening, हो गया=has happened)
      /चल रहा|हो रहा|हो गया|करवानी|करवाना|लगता है|बोला/,
      // Romanized Hindi personal pronouns (mujhe/mujhko=to me, mera/meri/mere=my,
      // hamare/humein=our/us). "main"(=I) deliberately excluded — collides with English "main".
      /\b(mujhe|mujhko|mujhse|mera|meri|mere|hamaa?re|hamaa?ri|humein|hume)\b/i,
      // Romanized Hindi family references in possessive framing ("meri maa", "mere papa")
      /\b(meri|mere|mera)\s+(maa|mummy|mata|papa|pitaji|patni|pati|beta|beti|bhai|behen|bahan)\b/i,
      // Romanized Hindi symptom framing ("ho raha hai"=is happening, "ho gaya"=has happened)
      /\bho\s+rah(a|i)\b|\bho\s+gay(a|i)\b|\bchal\s+rah(a|i)\b/i,
```

Hunk 2 — strong personal-signal array (~line 162, after the Devanagari strong
signals):

```ts
      /मुझे\s+(दर्द|सूजन|खून|बुखार|थकान|गांठ)/,
      /मेरा\s+(रिपोर्ट|टेस्ट|इलाज|डॉक्टर)/,
      // Romanized Hindi strong personal signals ("mujhe ... dard hai" = I have pain)
      /\b(mujhe|mujhko)\b.*\b(dard|takl(ee|i)f|suj(a|aa)n|soojan|g(aa?)nth|gilti|khoon|khun|bukhar|khaa?nsi|ulti|kamz?ori|kamjori|thakaa?n|pareshani|problem)\b/i,
      /\b(mera|meri|mere)\s+(report|test|ilaa?j|doctor|daktar)\b/i,
```

---

## NOT fully recoverable (only you can restore these)
- **`apps/api/src/modules/chat/intent-classifier.spec.ts`** — ~65 lines of new
  tests for the above. The content was never printed in full, so it can't be
  reconstructed. (The source patterns above are testable; new tests can be
  re-written, but your originals are lost.)
- **`apps/api/src/modules/llm/prompts/symptom-soft-redirect.ts`** — a ~2-line
  change; content not captured.

If you have a local editor history (VS Code "Local History" / JetBrains LHS) on
this machine, those two may be recoverable there.
