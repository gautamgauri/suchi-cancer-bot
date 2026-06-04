# Suchi Content Guide

Standards for cancer information articles and social media posts published by SCCF.
Applies to human-written content and AI-generated drafts alike.

North-star reference: [Macmillan Cancer Support](https://www.macmillan.org.uk) — calm, explanatory, practical.

---

## Voice

> A calm public health educator. A thoughtful oncologist. A trusted caregiver guide.

Not a startup growth team. Not influencer healthcare. Not SEO health content.

In a landscape where Indian health content is often chaotic, sensational, or misleading, Suchi's restraint is the differentiator. Calm clarity builds trust over time — especially with patients, caregivers, doctors, and CSR funders.

### The Content Formula

```
Human Observation  +  Medical Clarity  +  Actionable Guidance  +  Calm Tone
```

Not: `Shock + Fear + Urgency`

### Voice Dimensions

| Dimension | Suchi Style |
|---|---|
| Tone | Calm, respectful |
| Emotion | Empathetic but grounded |
| Authority | Expert but humble |
| Urgency | Gentle — never alarming |
| Language | Simple, non-jargon |
| Medical stance | Educational, not diagnostic |
| Cultural framing | India-aware (PM-JAY, local tobacco names) |
| CTA style | "Please consult a doctor" |

### Optimisation target

**Maximum Useful Attention — not Maximum Engagement.**

The goal is not CTR or virality. The goal is that the right person, in the right moment of anxiety or uncertainty, finds calm, accurate, actionable guidance — and feels trusted enough to act on it.

---

## Language Rules

### Avoid absolute clinical language

Bad: "destroy cancer cells or prevent them from multiplying"  
Good: "damage cancer cells so they stop growing and dividing"

Absolute phrasing (destroy, eliminate, eradicate) becomes awkward when treatment fails or cancer recurs. Use directional language: damage, slow, reduce, stop growing.

### Hedge survival and efficacy claims

Bad: "radiation therapy can cure cancer"  
Good: "in some cancers, radiation therapy alone can eliminate the disease"

Always name the specific cancer types or contexts where a claim applies.

### No self-management without qualification

Every article must include a hard safety line near the top and near the side effects section:

> Always follow your doctor's guidance, and never adjust or stop treatment on your own.

Herbal, Ayurvedic, and OTC supplements must be called out explicitly: tell your oncologist before taking anything.

---

## Before / After Examples

### Opening hooks

❌ **Generic**
> "Oral cancer is a serious health concern, especially in India."

✓ **Suchi voice**
> "In Bihar, many people ignore mouth sores for months assuming it's just heat or a minor infection. Sometimes, it turns out to be oral cancer."

### Symptom framing

❌ **Fear without relief**
> "These symptoms could mean cancer."

✓ **Suchi voice**
> "While these symptoms may be due to other causes, persistent issues should always be evaluated by a doctor."

### Actionability

❌ **Vague**
> "Oral cancer is treatable if caught early."

✓ **Suchi voice**
> "If you notice a sore in your mouth that hasn't healed in 2–3 weeks, visit a doctor or dentist. A simple check-up can make a significant difference."

---

## What to Avoid

| Pattern | Why |
|---|---|
| "Silent killer" | Fearbait — creates panic, not action |
| "Deadly" | Alarm without guidance |
| "You may have cancer" | Implied diagnosis — causes distress |
| Miracle narratives ("beat cancer", "cancer warrior") | Oversimplifies, dismisses patients still in treatment |
| Generic openers ("Cancer is serious") | Wastes the first line |
| Survivorship framing | Feels dismissive to a newly diagnosed patient |
| Citation markers in body text | Citations are for auditors, not readers |
| Passive voice for safety warnings | Use direct imperatives: "Tell your doctor", "Call your team" |
| Technical jargon without definition | Always define terms like neoadjuvant, hypofractionation |

---

## India-Grounding Checklist

Good Suchi content does at least one of these:

- Names local tobacco products (gutka, paan masala, khaini, bidi) instead of just "tobacco"
- Mentions PM-JAY / Ayushman Bharat for affordability context where relevant
- References Bihar, Eastern India, or a recognisable local setting
- Uses local phrasing ("speak to a doctor" feels warmer than "seek medical attention")

---

## Article Structure (Treatment Articles)

Every treatment article (chemotherapy, radiation, surgery, etc.) must cover all seven sections:

1. **What is it** — plain-language mechanism, one paragraph
2. **Why it is used** — goals (curative, neoadjuvant, adjuvant, palliative) as a bullet list
3. **The treatment process** — step by step, numbered subheadings: consultation → planning → sessions → duration → follow-up
4. **Side effects and management** — localised, practical (see below)
5. **When to call your team** — urgent symptoms as a bullet list
6. **Cost and financial support in India** — PM-JAY, government hospitals, Bihar-specific info
7. **Questions to ask your oncologist** — 8–10 numbered questions

### Side effects: localisation rules

Generic AI articles produce the same three side effects (fatigue, skin changes, nausea). SCCF articles must include locally relevant content.

**Always include:**
- **Travel fatigue and logistical strain** — many patients travel hours for daily treatment; acknowledge this and suggest mitigation (accommodation near hospital, caregiver burnout)
- **Eating difficulties** — practical dietary advice, soft foods, small meals
- **Hydration in hot climates** — Bihar temperatures from March–June are severe; explicit hydration guidance (coconut water, ORS) for abdomen/head/neck treatments
- **Financial and caregiver burden** — who drives, who pays, who rests

**Avoid:**
- Generic lists with no actionable guidance
- Side effects without management strategies
- Side effects framed purely as patient symptoms rather than household-level events

### Emotional framing for anxiety reduction

For any treatment involving a large machine (radiation, CT, MRI):

- "The treatment itself is usually painless."
- "You may hear sounds from the machine — this is normal."
- "The team watches you on a camera and can speak to you through an intercom."
- "They leave the room because the thick walls provide protection — not because you are in danger."

For radiation specifically, always include: **"External beam radiation does not make you radioactive."** This is one of the highest-value myth-busting lines for Indian patients.

### Safety and myth-busting

For treatments with strong cultural fear (radiation, chemotherapy):

- Dedicate a section to "Is [treatment] safe? Addressing common concerns"
- Acknowledge the fear plainly before addressing it — do not skip past it

---

## Social Media Copy Rules

Social posts are derived from articles. The same voice applies; additionally:

**Facebook** (2–3 sentences, 280–380 chars): Warm, compassionate, end with article URL.

**Instagram** (2–3 sentences + 6–8 hashtags, under 480 chars): Include `#CancerCare #CancerInIndia`. End with URL.

**LinkedIn** (2–3 sentences, 300–420 chars): Professional framing for patients, families, and health workers across India. End with URL.

Never state survival rates, specific rupee costs, or definitive outcomes in social copy.

---

## Length and Formatting

- Minimum ~900 words for treatment articles (reference: `content/drafts/chemotherapy.md`)
- Subheadings use `##` and `###` — no deeper nesting
- Numbered subheadings for the treatment process section
- Bullet lists for "why it is used", "when to call your team", and "questions to ask"
- Frontmatter must follow the schema in `docs/CONTENT_PAGE_SCHEMA.md`

---

## Article Checklist Before Sending for Review

- [ ] Frontmatter complete (`schema_version`, `page_id`, `title`, `summary`, `content_type`, `geo_relevance`, `audience`, `last_reviewed`, `review_status`, `version_id`, `provenance`, `related_pages`, `tags`)
- [ ] Safety disclaimer blockquote at top
- [ ] Myth-busting section present (radiation, surgical, or chemotherapy articles)
- [ ] Treatment process covered step by step
- [ ] Side effects localised — travel fatigue, hydration, caregiver burden mentioned
- [ ] Emotional framing for anxiety (machine sounds, painless, team is watching)
- [ ] Hard anti-self-management line in side effects section
- [ ] When to call your team — urgent symptoms as bullet list
- [ ] PM-JAY and government hospital section — Bihar-specific contacts included
- [ ] Questions to ask — 8–10 numbered items
- [ ] No absolute efficacy language ("cure", "destroy", "eliminate") without qualification
- [ ] Minimum ~900 words
