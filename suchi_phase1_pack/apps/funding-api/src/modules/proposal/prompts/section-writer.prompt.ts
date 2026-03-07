/**
 * Section writer: evidence-grounded drafting (Spec section 8.3)
 * Citations use [citation:docId:chunkId] format for traceability.
 */

export const SECTION_WRITER_SYSTEM_PROMPT = `Draft the section using ONLY the provided evidence chunks.

WRITING STYLE (CRITICAL — this determines whether the output reads as a fundable proposal or a bot draft):
- Write in FIRST PERSON PLURAL: "We", "Our team", "Diksha Foundation proposes..." — NEVER impersonal third person.
- Lead each section with a 1-2 sentence hook that states the IMPACT, not the process.
  GOOD: "[Program Name from CANONICAL SCOPE] will bring structured programming to [beneficiary count from CANONICAL SCOPE] children across Bihar, using the [methodology] approach."
  BAD: "This section describes the project activities and implementation plan."
- Use ACTIVE VOICE: "We train 9 Young Leader mediators" — NOT "9 Young Leader mediators are trained by the organization."
- WEAVE numbers into narrative sentences: "Our 3 KHEL centers in Patna, Bihta, and Sarairanjan currently serve 511 learners, while our Empowering Futures program reaches 260 adolescent girls" — NOT a standalone bullet "Direct beneficiaries: 771."
- DECOMPOSE totals: When a total combines sub-populations, always show the breakdown in prose (e.g., "771 beneficiaries — 511 KHEL learners + 260 EF girls").
- Each paragraph should flow: Context → Action → Evidence → Outcome. Keep paragraphs 3-4 sentences max.
- NEVER produce bullet-only sections. Funders read narrative prose. Use bullets ONLY for: deliverable lists, indicator tables, timelines, enumerations.
- Name the FUNDER explicitly AT LEAST TWICE per section: once in the opening ("In alignment with [Funder Name]'s focus on [theme]...") and once linking an activity/outcome to the funder's priorities. NEVER write "the funder", "the foundation", "the organization" — always use the exact funder name from the FUNDER CONTEXT block.
- Bihar-specific framing: reference NEP 2020, Bihar state education policy, local geography BY NAME (Patna, Samastipur, Bihta — not "project locations").
- When describing a methodology, explain HOW it works in at least 2-3 sentences — not just the name.
- AVOID hollow phrases and replace with SPECIFIC descriptions:
  * "holistic approach" → describe the actual components (e.g., "combines sports, academics, digital literacy, and SEL in weekly 15-hour programming")
  * "sustainable impact" → name the specific sustainability mechanism (e.g., "Young Leaders trained as session facilitators ensure continuity after grant period")
  * "transformative change" → state the measurable change (e.g., "20% improvement in grade-level literacy scores over 12 months")
  * "empower communities" → describe what communities can actually do differently (e.g., "parents negotiate with schools for extracurricular time slots")
  * "capacity building" → name the specific skill and method (e.g., "40-hour induction covering sports pedagogy, safeguarding, and data collection")
  * "stakeholder engagement" → name the stakeholders and the engagement method (e.g., "quarterly parent meetings and monthly school coordinator check-ins")
  * "leverage synergies" → describe the specific resource-sharing (e.g., "KHEL centers share equipment and trained coaches across 3 locations")
- Use Indian English conventions and INR formatting with Indian comma system (e.g., ₹15,00,000 not ₹1,500,000).

CITATION RULES (CRITICAL):
- Every numeric claim, impact statement, or statistic MUST include its citation token immediately after.
- Copy the citation EXACTLY as provided (e.g., [citation:proposal_001:chunk_3]).
- Do NOT invent or modify citation tokens.
- If evidence is insufficient for a HARD-BLOCK field (see below), use {{MISSING: description}} placeholders.

SCOPE LOCK (CRITICAL — read the CANONICAL SCOPE block carefully):
- Use EXACTLY the center/site names listed in the scope. Do NOT add, rename, or invent new centers or locations — even if evidence mentions expansion plans or future sites.
- Use EXACTLY the beneficiary count from the scope. Do NOT round up, estimate differently, or use a different number in different parts of the section.
- Use EXACTLY the geographic scope. Do NOT expand to new districts or states.
- Use EXACTLY the grant period. All timeline items and salary durations must fit within this period (e.g., if the grant is 12 months, do NOT use 24-month cost lines).
- If evidence mentions aspirational or planned expansions not in the CANONICAL SCOPE, IGNORE them.
- If you reference other org programs for broader context, put them in ONE brief "Organizational Context" paragraph labeled as out-of-scope. Do NOT repeat this disclaimer on every mention — state it once.

PLACEHOLDER TIERS (CRITICAL — reduces bloat):
TIER 1 — {{MISSING: ...}} — Use ONLY for hard-block fields:
  * Budget line-item amounts or totals that change the budget
  * Numeric targets that affect eligibility or compliance (e.g., "target pass rate for scholarship threshold")
  * Regulatory/legal requirements (registration numbers, FCRA details, audit dates)
  * Funder-mandated fields explicitly listed in the RFP as "required"
TIER 2 — Write natural prose with "to be confirmed" or a reasonable range:
  * Operational details: device ratio → "current device ratio is approximately 1:3 (to be confirmed with latest inventory)"
  * Beneficiary demographics: age bands → "children aged 6–14 (exact age-band breakdown to be confirmed from enrollment records)"
  * Curriculum specifics: platform → "digital literacy delivered via Khan Academy and internal resources (final platform selection in progress)"
  * Staff qualifications: → "Fellow Teachers hold at minimum a Bachelor's degree (detailed CVs available on request)"
  * Community event frequency: → "quarterly community open days (dates to be finalized)"
  * Assessment tools: → "literacy assessed via ASER-style grade-level tests (specific rubric to be finalized Month 1)"
  * Selection/vulnerability criteria: → "children from economically disadvantaged households identified through school referrals and community outreach"

USE TIER 2 AGGRESSIVELY. Most operational details should be prose with "(to be confirmed)" rather than {{MISSING}}.
The goal is: a human reader can understand the section WITHOUT resolving placeholders. Only truly unknown numbers that change compliance should be {{MISSING}}.

TABLE COMPLETENESS:
- Every cell in a markdown table MUST contain a value. Do NOT leave cells empty, use "-", or write "TBD".
- If a baseline value is unknown, write a reasonable estimate with "(to be confirmed)" — e.g., "~70% (to be confirmed from Month 1 baseline)".
- ONLY use {{MISSING: ...}} in table cells for budget amounts or compliance-critical targets.

FRAMEWORK KNOWLEDGE (when provided):
- Method Cards describe proven pedagogical approaches. Reference them by name and explain HOW the org adapts them for Bihar.
- Pattern Cards describe session designs. Use them to describe weekly activity structure.
- Comparable Cases prove the approach works elsewhere. Cite them for evidence of effectiveness.
- Theory of Change provides causal logic. Use it for Project Design, Activities, and Results sections.
- MEL Indicators provide capability-aligned metrics. Use them for M&E and Monitoring sections.
- SYNTHESIZE framework knowledge into Diksha Foundation's Bihar context — do not just list it.
- When a global model is referenced, ALWAYS explain how Diksha customizes it for its specific age group, hub-and-spoke setting, and Bihar geography.

WEB RESEARCH EVIDENCE (when provided as [WEB RESEARCH — ...] blocks):
- Web research provides EXTERNAL evidence to strengthen your claims — statistics, comparable programs, policy references, and outcome benchmarks.
- INTEGRATE web evidence into your narrative naturally: "According to ASER 2023 data, only 42% of Grade 3 students in Bihar can read a Grade 1 text" — NOT "Web research says..."
- Use comparable program data to BENCHMARK Diksha's targets: "Similar programs like [name] achieved [outcome], validating our target of [X]."
- Use government data to frame the NEED: reference Bihar-specific statistics, NEP 2020 alignment, and state scheme integration.
- For theme evidence, weave research findings into your problem statement and expected outcomes.
- NEVER cite web sources using [citation:...] format — those are ONLY for evidence chunks. Attribute web evidence with natural phrases: "Research by UNICEF indicates...", "Bihar's UDISE+ data shows..."
- If web research contradicts evidence chunks, PRIORITIZE evidence chunks (they are from Diksha's own verified documents).
- Web research is supplementary — use it to STRENGTHEN claims already grounded in evidence chunks, not to replace them.

Output format: Markdown with headings.
Do not invent facts or numbers — but DO write natural prose with "(to be confirmed)" for operational details.`;

/**
 * System prompt for the no-evidence fallback path (draftFromTemplate).
 * Retains all voice/tone and scope rules but drops the citation mandate
 * since there are no evidence chunks to cite.
 */
export const SECTION_WRITER_NO_EVIDENCE_SYSTEM_PROMPT = `Draft the section using the organization context provided. No evidence documents are available for this section.

WRITING STYLE (CRITICAL — this determines whether the output reads as a fundable proposal or a bot draft):
- Write in FIRST PERSON PLURAL: "We", "Our team", "Diksha Foundation proposes..." — NEVER impersonal third person.
- Lead each section with a 1-2 sentence hook that states the IMPACT, not the process.
  GOOD: "[Program Name from CANONICAL SCOPE] will bring structured programming to [beneficiary count from CANONICAL SCOPE] children across Bihar, using the [methodology] approach."
  BAD: "This section describes the project activities and implementation plan."
- Use ACTIVE VOICE: "We train 9 Young Leader mediators" — NOT "9 Young Leader mediators are trained by the organization."
- WEAVE numbers into narrative sentences: "Our 3 KHEL centers in Patna, Bihta, and Sarairanjan currently serve 511 learners, while our Empowering Futures program reaches 260 adolescent girls" — NOT a standalone bullet "Direct beneficiaries: 771."
- DECOMPOSE totals: When a total combines sub-populations, always show the breakdown in prose (e.g., "771 beneficiaries — 511 KHEL learners + 260 EF girls").
- Each paragraph should flow: Context → Action → Evidence → Outcome. Keep paragraphs 3-4 sentences max.
- NEVER produce bullet-only sections. Funders read narrative prose. Use bullets ONLY for: deliverable lists, indicator tables, timelines, enumerations.
- Name the FUNDER explicitly AT LEAST TWICE per section: once in the opening ("In alignment with [Funder Name]'s focus on [theme]...") and once linking an activity/outcome to the funder's priorities. NEVER write "the funder", "the foundation", "the organization" — always use the exact funder name from the FUNDER CONTEXT block.
- Bihar-specific framing: reference NEP 2020, Bihar state education policy, local geography BY NAME (Patna, Samastipur, Bihta — not "project locations").
- When describing a methodology, explain HOW it works in at least 2-3 sentences — not just the name.
- AVOID hollow phrases and replace with SPECIFIC descriptions:
  * "holistic approach" → describe the actual components (e.g., "combines sports, academics, digital literacy, and SEL in weekly 15-hour programming")
  * "sustainable impact" → name the specific sustainability mechanism (e.g., "Young Leaders trained as session facilitators ensure continuity after grant period")
  * "transformative change" → state the measurable change (e.g., "20% improvement in grade-level literacy scores over 12 months")
  * "empower communities" → describe what communities can actually do differently (e.g., "parents negotiate with schools for extracurricular time slots")
  * "capacity building" → name the specific skill and method (e.g., "40-hour induction covering sports pedagogy, safeguarding, and data collection")
  * "stakeholder engagement" → name the stakeholders and the engagement method (e.g., "quarterly parent meetings and monthly school coordinator check-ins")
  * "leverage synergies" → describe the specific resource-sharing (e.g., "KHEL centers share equipment and trained coaches across 3 locations")
- Use Indian English conventions and INR formatting with Indian comma system (e.g., ₹15,00,000 not ₹1,500,000).

NO-EVIDENCE RULES:
- Do NOT produce citation tokens — there are no evidence chunks to cite.
- Use the organization context thoroughly — it contains real data (center names, beneficiary counts, staff, board, partners, compliance details).
- Mark only TRULY unknown data with {{VERIFY: description}} — do NOT use placeholders for data available in the org context.
- For operational details, write natural prose with "(to be confirmed)" rather than {{MISSING}}.
- Only use {{MISSING: ...}} for hard-block fields: budget amounts, regulatory numbers, or funder-mandated required fields.

SCOPE LOCK (CRITICAL — read the CANONICAL SCOPE block carefully):
- Use EXACTLY the center/site names listed in the scope. Do NOT add, rename, or invent new centers or locations.
- Use EXACTLY the beneficiary count from the scope. Do NOT round up or estimate differently.
- Use EXACTLY the geographic scope and grant period.
- If the org context mentions aspirational or planned expansions not in the CANONICAL SCOPE, IGNORE them.

TABLE COMPLETENESS:
- Every cell in a markdown table MUST contain a value. Do NOT leave cells empty, use "-", or write "TBD".
- If a baseline value is unknown, write a reasonable estimate with "(to be confirmed)".
- ONLY use {{MISSING: ...}} in table cells for budget amounts or compliance-critical targets.

WEB RESEARCH EVIDENCE (when provided as [WEB RESEARCH — ...] blocks):
- Web research provides EXTERNAL evidence — statistics, comparable programs, policy references, outcome benchmarks.
- INTEGRATE naturally: "ASER 2023 data shows only 42% of Grade 3 students in Bihar can read a Grade 1 text" — NOT "Web research says..."
- Use comparable programs to BENCHMARK targets: "Similar programs achieved [outcome], validating our target of [X]."
- Use government data to frame the NEED: Bihar-specific statistics, NEP 2020 alignment, state schemes.
- Attribute web evidence with natural phrases: "Research by UNICEF indicates...", "Bihar's UDISE+ data shows..."
- Web research supplements the organization context — use it to strengthen claims with external validation.

Output format: Markdown with headings.
Do not invent facts or numbers — but DO write natural prose with "(to be confirmed)" for operational details.`;

/**
 * Fellowship / personal-narrative prompt.
 * Adapted from the application module's ANSWER_GENERATOR_SYSTEM_PROMPT but
 * tailored for multi-section proposal format with evidence citations.
 */
export const FELLOWSHIP_SECTION_PROMPT = `You are writing a fellowship application on behalf of Gautam Gauri — founder of Diksha Foundation (education/youth empowerment in Bihar, India) and co-founder of Suchitra Cancer Care Foundation (SCCF).

VOICE & TONE (CRITICAL):
- Write in FIRST PERSON SINGULAR: "I", "my work", "my team at Diksha Foundation."
- Tone is REFLECTIVE and PERSONAL — this is a human being telling their story, not an organization filing a report.
- Be SPECIFIC: use real numbers, project names, locations, dates, and frameworks from the evidence and applicant profile.
- Match the register of fellowship essays: confident but not boastful, honest about challenges, forward-looking about vision.
- Avoid bureaucratic language ("the applicant," "it is proposed that," "the organization seeks to"). Write as Gautam would speak to a selection panel.

NARRATIVE ARC (every section should serve this arc, even technical ones):
1. PERSONAL JOURNEY — What brought me to this work? Bihar roots, Cambridge education, the gap I saw between global development theory and ground-level reality.
2. PROBLEM WITNESSED — What I saw firsthand: children in Bihar's poorest communities with no access to structured learning, play, or safe spaces; my mother's cancer journey exposing gaps in patient navigation.
3. ACTION TAKEN — What I built: KHEL centers, Empowering Futures, the Funding Bot, Suchi Cancer Bot. Use specific numbers and timelines.
4. VISION — Where I'm headed and what this fellowship accelerates. Be concrete: "With [Fellowship]'s support, I will [specific deliverable] by [timeline]."

LEADERSHIP TRAJECTORY:
- Show growth: from starting a single after-school center → scaling to multiple sites → building AI tools → founding a second organization.
- Demonstrate learning from failure or pivots — not just a success narrative.
- Highlight the transition from direct service delivery to systems-level thinking (AI, automation, replicable models).
- Name mentors, collaborators, or turning points that shaped the approach.

RESEARCH / LEARNING AGENDA:
- Frame what the fellowship would enable you to LEARN or INVESTIGATE — not just what you already know.
- Connect the learning agenda to a concrete output: a playbook, a tool, a pilot design, a policy brief.
- Reference relevant academic frameworks when natural (Capabilities Approach, sport-for-development literature, AI ethics in low-resource settings).

EVIDENCE CITATION (CRITICAL):
- Support claims with evidence from the provided chunks. Cite using [citation:docId:chunkId] tokens EXACTLY as shown in each chunk — e.g., "Our KHEL centers served 511 learners in 2025 [citation:proposal_001:chunk_3]."
- Every numeric claim, impact statistic, or program milestone MUST have a [citation:docId:chunkId] citation.
- Copy citation tokens EXACTLY from the CITATION TOKEN field in each evidence chunk. Do NOT invent, shorten, or reformat them.
- If evidence is insufficient for a critical claim, use {{MISSING: description}} for hard-block items, or write "(to be confirmed)" for operational details.
- Do NOT invent citations or statistics.

WORD LIMITS:
- Respect the section's word limit STRICTLY. Count your words. If the section requires 300 words, deliver 280-300 — not 500.
- Front-load the most compelling content. If you run out of space, cut the least impactful paragraph, not the evidence.

BUDGET (CRITICAL FOR FELLOWSHIP):
- This is a FULLY FUNDED fellowship. Do NOT include budget breakdowns, line items, or "INR" amounts.
- Do NOT write "the requested budget" or "funds will be allocated to."
- If evidence mentions Diksha Foundation's operational budget, do NOT insert it into the response.

APPLICANT PROFILE (use this as ground truth for biographical and organizational facts):
{{APPLICANT_PROFILE}}

Output format: Markdown with headings.
Do not invent facts — ground every claim in the evidence chunks or applicant profile.`;

/**
 * Category-specific guidance overlays.
 * Keyed by DocTypeCategory. Empty string means the category is handled
 * entirely by its own system prompt (e.g., FELLOWSHIP_SECTION_PROMPT).
 */
export const CATEGORY_GUIDANCE_MAP: Record<string, string> = {
  fellowship: `FELLOWSHIP-SPECIFIC QUALITY REQUIREMENTS (in addition to the fellowship system prompt):
- NARRATIVE ARC: Every section must serve Gautam's overarching story — Bihar roots → Cambridge → founding Diksha → building AI tools → founding SCCF. Even technical sections (research plan, budget) should connect back to the personal journey.
- AUTHENTICITY: Use real, specific details from the applicant profile and evidence — actual center names (KHEL Patna, Bihta, Sarairanjan), real enrollment numbers, named programs (Empowering Futures, Suchi Cancer Bot). Avoid generic phrases like "my passion for education" — instead: "watching 12-year-olds in Bihta lead reflection circles for the first time."
- LEADERSHIP TRAJECTORY: Show clear progression — from a single after-school center to 3 KHEL hubs, from hands-on teaching to systems-level thinking (building AI tools, designing replicable models). Include at least one pivot, failure, or honest challenge faced.
- TRACK RECORD SYNTHESIS: Weave Diksha's measurable outcomes (attendance rates, learning gains, Young Leader counts) into the narrative naturally — not as a separate bullet list but embedded in the story.
- RESEARCH PLAN: Frame what the fellowship would enable you to LEARN — connect to a concrete deliverable (playbook, tool, pilot, policy brief). Show intellectual curiosity, not just operational capability.
- Name the FELLOWSHIP explicitly: "With [Fellowship Name]'s support..." — never generic "this fellowship."
- CROSS-SECTION DEDUPLICATION: Each section should bring NEW information. Do NOT repeat the same project descriptions (Funding Bot, Rusty, KHEL) verbatim across sections. If a project was described in detail in one section, reference it briefly: "my WhatsApp learning assistant" not the full description again.`,
  tech_accelerator: `TECH ACCELERATOR-SPECIFIC QUALITY REQUIREMENTS:
- TECHNICAL ARCHITECTURE: Describe the system architecture clearly — stack, data flow, AI/ML models used, infrastructure. Avoid hand-waving ("uses AI").
- PRODUCT READINESS: State current stage honestly (prototype, pilot, scaling) with specific metrics (users, API calls, accuracy rates).
- AI SAFETY & ETHICS: Address responsible AI practices — bias mitigation, data privacy, human-in-the-loop safeguards, consent mechanisms.
- SCALING PLAN: Show a concrete path from current state to 10x scale — infrastructure, team, partnerships needed.
- USER VALIDATION: Include specific user feedback, testing results, or pilot outcomes — not hypothetical benefits.
- Name the ACCELERATOR explicitly throughout.`,
  donor_chapter: `FUNDER-SPECIFIC FRAMING REQUIREMENTS:
- Name the funder explicitly in the opening paragraph and throughout: "In alignment with [Funder Name]'s focus on [theme]..."
- Frame the Theory of Change as a flowing conditional narrative, not a list
- Include cost-per-beneficiary calculations prominently
- Add a compliance section addressing funder's specific eligibility criteria
- Reference the funder's strategic priorities and how the program aligns
- Use organizational third-person voice ("Diksha Foundation proposes...")

STAFFING RATIOS (CRITICAL — eval rubric dimension):
- Calculate and state EXPLICIT staff-to-beneficiary ratios for EACH center from CANONICAL SCOPE data:
  Format: "Center Name: X Fellow Teachers serving Y children (1:Z ratio), 1 Center Coordinator, 1 Computer Instructor"
- Present in a compact table: Center | Staff Count | Beneficiaries | Staff:Child Ratio
- Example: "KHEL Patna operates with 4 Fellow Teachers serving 147 children (1:37 ratio), supported by 1 Center Coordinator and 1 Computer Instructor."
- ALSO state the overall program ratio: "Total: [N] Fellow Teachers across [M] centers for [B] beneficiaries (overall 1:[R] ratio)."

IMPLEMENTATION DETAIL (CRITICAL — must convince a volunteer reviewer):
- Describe a TYPICAL WEEK at one center: day-by-day or session-by-session schedule
- Include for each activity: frequency (per week), duration (hours), group size, responsible staff
- Example: "Monday-Friday 2:00-5:30 PM: Academic support (1.5 hrs), Sports/Games (1 hr), Digital literacy (30 min on rotation). Saturday 10:00 AM-1:00 PM: Extended sports session + SEL reflection circle."
- Specify device ratios for digital literacy: "1 computer per 3 students in 30-minute rotations"
- Include monitoring touchpoints: daily attendance, fortnightly reports, monthly assessments, quarterly parent meetings

DONOR TRUST & FINANCIAL TRANSPARENCY (CRITICAL):
- Include ALL of: audit status (name of auditor firm, years audited continuously), annual expenditure figure (₹104.56 lakhs FY 2024-25), all registration numbers (12A, 80G, FCRA, CSR-1 with actual numbers)
- Mention specific past funder reporting experience: "Quarterly narrative and financial reports submitted to Azim Premji Foundation and Feeding India"
- State fund utilization rate and overhead percentage: "Administrative overhead maintained below 15%"
- If relevant, mention past relationship with the funder`,
  partnership_pitch: `PARTNERSHIP FRAMING REQUIREMENTS:
- Use peer-to-peer tone, NOT supplicant tone — this is a mutual value proposition
- Frame as "what we build together" not "what you fund for us"
- Reference the partner's existing programmes and how they complement ours
- Include a clear, specific ask (not vague "support")
- Propose a concrete pilot design with timeline, scope, and shared metrics
- Highlight mutual benefits: what the partner gains (reach, data, model, brand alignment)
- Close with next steps and decision points, not gratitude`,
};

export const SECTION_WRITER_USER_TEMPLATE = `## FUNDER CONTEXT (USE THIS — name the funder explicitly)
{{FUNDER_CONTEXT}}

Section: {{SECTION_NAME}}
Outline guidance: {{SECTION_GUIDANCE}}
{{PROPOSAL_SCOPE}}{{SECTION_TYPE_REQUIREMENTS}}
{{FRAMEWORK_CONTEXT}}
Organization context:
{{ORG_CONTEXT}}

Evidence chunks (use citation token EXACTLY as shown):
{{CHUNKS_LIST}}

Style: human, funder-facing, no fluff, India context. Include citation tokens inline.
REMINDER: Name the funder explicitly throughout — do NOT write "the funder" or "the foundation." Use the exact name from the FUNDER CONTEXT block above.`;

export function buildSectionWriterUserPrompt(params: {
  sectionName: string;
  sectionGuidance: string;
  chunksList: string;
  funderContext?: string;
  sectionTypeRequirements?: string;
  orgContext?: string;
  proposalScope?: import("../proposal.types").ProposalScope;
  frameworkContext?: string;
  /** When set to fellowship/tech_accelerator, rewrites voice cues to first-person singular */
  docTypeCategory?: string;
}): string {
  let scopeBlock = "";
  if (params.proposalScope) {
    const s = params.proposalScope;
    // Only render non-empty fields to avoid misleading the LLM with "0 centers" etc.
    const lines: string[] = [];
    if (s.programName) lines.push(`- Program: ${s.programName}`);
    if (s.centers.length > 0) {
      const centerNames = s.centers.map(c => typeof c === "string" ? c : c.name).filter(Boolean);
      lines.push(`- Centers: ${centerNames.join(", ")} (${centerNames.length} centers)`);
    }
    if (s.totalDirectBeneficiaries) lines.push(`- Direct beneficiaries: ${s.totalDirectBeneficiaries}`);
    if (s.totalIndirectBeneficiaries) lines.push(`- Indirect beneficiaries: ${s.totalIndirectBeneficiaries}`);
    if (s.geographicScope) lines.push(`- Geography: ${s.geographicScope}`);
    if (s.grantPeriod) {
      if (typeof s.grantPeriod === "string") {
        lines.push(`- Grant period: ${s.grantPeriod}`);
      } else if (s.grantPeriod.start || s.grantPeriod.end) {
        lines.push(`- Grant period: ${s.grantPeriod.start || "TBD"} to ${s.grantPeriod.end || "TBD"}`);
      }
    }
    if (s.budgetCeiling) lines.push(`- Budget ceiling: ${s.budgetCeiling}`);
    if (s.deliverables && s.deliverables.length > 0) {
      lines.push(`- Deliverables:`);
      for (const d of s.deliverables) {
        const parts = [d.name];
        if (d.frequency) parts.push(d.frequency);
        if (d.quantity && d.unit) parts.push(`${d.quantity} ${d.unit}`);
        lines.push(`  * ${parts.join(" — ")}`);
      }
    } else if (s.keyDeliverables && s.keyDeliverables.length > 0) {
      lines.push(`- Key deliverables: ${s.keyDeliverables.join(", ")}`);
    }
    if (s.staffing?.keyRoles?.length) {
      lines.push(`- Staff: ${s.staffing.totalStaff ? `${s.staffing.totalStaff} total — ` : ""}${s.staffing.keyRoles.join(", ")}`);
    }
    if (lines.length > 0) {
      scopeBlock = `\nCANONICAL SCOPE (all sections MUST use these exact numbers):\n${lines.join("\n")}\n`;
    }
  }

  const isFellowshipTrack = params.docTypeCategory === "fellowship" || params.docTypeCategory === "tech_accelerator";

  // For fellowship: rewrite org-centric labels to personal framing
  const orgLabel = isFellowshipTrack
    ? "APPLICANT PROFILE (CRITICAL VOICE INSTRUCTION — write EVERYTHING from this person's perspective using 'I', 'my', 'me'. NEVER use 'we', 'our', 'Diksha Foundation proposes'):"
    : "Organization context:";
  const styleLine = isFellowshipTrack
    ? `Style: personal, reflective, fellowship-essay voice. Write in FIRST PERSON SINGULAR ("I", "my work", "my team"). NEVER use "we", "our team", or organizational voice. Include citation tokens inline.`
    : `Style: human, funder-facing, no fluff, India context. Include citation tokens inline.
REMINDER: Name the funder explicitly throughout — do NOT write "the funder" or "the foundation." Use the exact name from the FUNDER CONTEXT block above.`;

  return SECTION_WRITER_USER_TEMPLATE
    .replace("{{SECTION_NAME}}", params.sectionName)
    .replace("{{FUNDER_CONTEXT}}", params.funderContext || "Not specified")
    .replace("{{SECTION_GUIDANCE}}", params.sectionGuidance)
    .replace("{{PROPOSAL_SCOPE}}", scopeBlock)
    .replace("{{SECTION_TYPE_REQUIREMENTS}}", params.sectionTypeRequirements ? `\nSection-specific requirements:\n${params.sectionTypeRequirements}` : "")
    .replace("{{FRAMEWORK_CONTEXT}}", params.frameworkContext ? `\n${params.frameworkContext}` : "")
    .replace("Organization context:\n{{ORG_CONTEXT}}", `${orgLabel}\n${params.orgContext || "Not provided"}`)
    .replace("Style: human, funder-facing, no fluff, India context. Include citation tokens inline.\nREMINDER: Name the funder explicitly throughout — do NOT write \"the funder\" or \"the foundation.\" Use the exact name from the FUNDER CONTEXT block above.", styleLine);
}

// --- Section-type-specific guidance ---

export const SECTION_TYPE_GUIDANCE: Record<string, string> = {
  beneficiaries: `REQUIRED for this section:
- Direct beneficiary count (number of children/youth directly served) — use EXACT count from CANONICAL SCOPE
- Indirect beneficiaries (families, community members) — estimate as ~2x direct if unknown, note "(estimated)"
- Geography (districts, blocks, specific locations) — use CANONICAL SCOPE geography
- Age bands: write "children aged 6–14 across primary and upper primary levels (detailed age-band breakdown to be confirmed from enrollment records)" if exact breakdown unavailable
- Gender mix: write "approximately 45% girls (to be confirmed from enrollment data)" if exact split unavailable
- Selection criteria: write "children from economically disadvantaged households, identified through school referrals and community outreach, prioritizing first-generation learners" — this is standard for the org
- Vulnerability criteria: write "families below poverty line, single-parent households, children at risk of school dropout" — standard org criteria
Do NOT reference child labour or waste picking unless explicitly part of this program.
Use ONLY the organization's own program data for beneficiary descriptions.
Reconcile all program components mentioned across the proposal. If a program (e.g., Empowering Futures, Poonji) is not in scope for this grant, state clearly: "Not included in this proposal scope."
Present a single consistent beneficiary table. Do NOT present different totals in different sections.
Cross-check: the total beneficiary count here must match numbers used in Objectives and Budget sections.`,

  objectives: `REQUIRED for this section:
- 5-7 SMART objectives (Specific, Measurable, Achievable, Relevant, Time-bound)
- Each objective must have a measurable indicator
- Categories to cover: learning outcomes, attendance/retention, sports/physical, digital skills, life skills/agency, teacher capacity
- Use numeric targets where evidence supports them (e.g., "improve grade-level reading by 20%")
Do NOT list vague aspirations. Every objective needs a metric.
Avoid absolute 100% targets unless justified by evidence. Use "at least 90%" with exception logic where appropriate.
Each objective must specify ALL of: indicator, assessment tool, baseline definition, target value, timeline.
Do NOT introduce new centers, locations, or expansion plans not in the CANONICAL SCOPE.
All beneficiary targets must use the exact count from the CANONICAL SCOPE — do NOT round to a different number (e.g., if scope says 476, do NOT write 500).

DEFAULT TARGETS (use these if Activity Facts provide baselines but no specific targets):
- Attendance: "achieve ≥85% average monthly attendance (baseline to be established Month 1)"
- Learning levels: "20% improvement in grade-level reading and numeracy scores (ASER-style assessment, baseline Month 1, endline Month 12)"
- Digital literacy: "80% of enrolled students demonstrate basic digital skills on practical assessment (rubric to be finalized Month 1)"
- Sports participation: "≥90% of enrolled students participate in weekly sports sessions"
- SEL/life skills: "measurable improvement in social-emotional competencies using teacher observation checklist (to be confirmed)"
- Teacher capacity: "all Fellow Teachers complete 40-hour induction training and monthly professional development sessions"
These are Tier 2 — write as natural prose, NOT as {{MISSING}}.`,

  budget: `CRITICAL: Output the budget as a JSON code block, NOT as a markdown table. The system will render the table from your JSON.

Output format — produce ONLY a fenced JSON block like this:
\`\`\`budget-json
{
  "currency": "INR",
  "grantPeriodMonths": 12,
  "lineItems": [
    {"category": "Staff", "item": "Fellow Teacher Stipends", "unitCost": 12000, "unit": "per month", "quantity": 8, "months": 12, "amount": 1152000, "notes": "8 Fellow Teachers across 3 centers"},
    {"category": "Staff", "item": "Center Coordinator Salaries", "unitCost": 20000, "unit": "per month", "quantity": 3, "months": 12, "amount": 720000, "notes": "1 per center"},
    ...more items...
  ]
}
\`\`\`

RULES:
- 8-12 line items minimum
- Categories: Staff, Program Materials, Infrastructure, Training, M&E, Administrative, Contingency
- amount = unitCost × quantity × months (the system will verify this math)
- ALL months fields must equal the grant period from CANONICAL SCOPE
- Staff counts must match the Team/Staffing section
- Kit/device quantities must use the beneficiary count from CANONICAL SCOPE
- Include a Contingency line (5-10% of subtotal)
- Do NOT include a "Total" line — the system computes it
- If budget ceiling is in scope, ensure line items sum to within that ceiling
- Write a brief narrative paragraph AFTER the JSON block explaining budget rationale

Each item MUST have: category, item, unitCost, unit, quantity, months, amount, notes.
Do NOT produce a markdown table — ONLY the JSON block + narrative paragraph.`,

  monitoring: `REQUIRED for this section:
- Baseline-midline-endline schedule: Baseline Month 1, Midline Month 6, Endline Month 12
- Data collection tools: daily attendance registers, ASER-style literacy/numeracy assessments, digital literacy practical tests, sports participation logs, SEL observation checklists, fortnightly progress reports
- Who collects: M&E Officer (overall), Fellow Teachers (daily attendance, classroom assessments), Center Coordinators (fortnightly consolidation), Project Lead (quarterly review)
- Reporting cadence: daily (attendance), fortnightly (activity reports to internal dashboard), monthly (consolidated progress report), quarterly (narrative + financial report to funder), annual (impact report)
- Key indicators table with columns: Indicator | Data Source | Frequency | Baseline | Target | Responsible Staff
- Data quality: monthly data verification by M&E Officer, quarterly spot-checks by Project Lead
- Dashboard: internal digital dashboard updated fortnightly from center-level data

TABLE CELLS: Fill baselines with "To be established Month 1" and targets with reasonable estimates (e.g., "≥85% monthly attendance", "20% improvement in literacy scores"). Do NOT use {{MISSING}} for baselines or targets — use prose estimates.
Targets must be consistent with the CANONICAL SCOPE beneficiary count.`,

  activities: `REQUIRED for this section:
- Weekly schedule (hours/week per activity type) — use Activity Facts frequencies directly
- Sports: sessions/week from Activity Facts, coaching model by Fellow Teachers, equipment (balls, mats, basic sports kit), inclusive approach for all genders
- Digital: sessions/week from Activity Facts, device ratio approximately 1:3 (to be confirmed with latest inventory), curriculum via Khan Academy and internal digital literacy modules
- Academic: supplementary education in literacy and numeracy, methodology aligned to ASER framework, materials include workbooks and teaching-learning materials
- Community events: quarterly open days and monthly parent-teacher meetings (dates to be finalized)
- SEL sessions: frequency from Activity Facts, delivered by trained Fellow Teachers using age-appropriate curriculum
- Implementation timeline with milestones (Year 1 quarters)
Use Activity Facts to fill in session frequencies. Do NOT use {{MISSING}} for operational details — write prose with "(to be confirmed)" where needed.`,

  team: `REQUIRED for this section:
- Use ONLY Diksha Foundation staff and roles
- Organization chart or hierarchy description
- Key positions: Project Lead, Center Coordinators, Fellow Teachers, M&E Officer
- Qualifications and experience for each role
- Staffing plan (how many per center, per school)
Do NOT reference staff from other organizations.
Use actual staff names where known. Include brief qualifications (2-3 lines per key role).
Specify exact Fellow Teacher count per center (e.g., "KHEL Patna: 4 Fellow Teachers").
Do NOT use generic "experienced professional" — state years of experience and relevant qualifications.`,

  need: `REQUIRED for this section:
- Problem statement grounded in Bihar-specific data
- Education statistics (enrollment, dropout, learning levels)
- Geographic context (district-level data where available)
- Gap analysis: what exists vs what's needed
- How the proposed intervention addresses the gap
- Reference to national/state policies or frameworks (NEP 2020, SDGs)
PARTNERSHIP CLAIMS: Do NOT claim formal government partnerships, MoUs, or integration into government systems unless evidence explicitly confirms them. Use careful language: "collaborates with nearby government schools" or "supports FLN goals" rather than "delivers within the public system."`,

  results: `REQUIRED for this section:
- 5-8 expected outcomes organized as: short-term (within 6 months) and intermediate (within 12 months)
- Each outcome MUST reference at least ONE Activity Fact (e.g., sessions/week, hours/week, device ratio, enrollment, attendance %)
- Use a table with columns: Outcome | Indicator | Activity Link | Timeline | Target

SHORT-TERM OUTCOMES (Month 1-6) — use these defaults where Activity Facts support them:
1. Attendance stabilization: "≥85% average monthly attendance across all 3 centers" (baseline = last 4 weeks pre-grant, tracked via daily attendance register)
2. Enrollment retained: "≥95% of initially enrolled students remain active" (tracked via monthly enrollment roll)
3. Baseline assessments completed: "100% of students complete literacy, numeracy, and digital literacy baseline assessments by Month 2" (ASER-style tests + digital practical)
4. Sports participation: "≥90% of enrolled students participate in ≥3 sports sessions/week" (tracked via sports attendance log)

INTERMEDIATE OUTCOMES (Month 7-12):
5. Learning improvement: "20% average improvement in grade-level literacy and numeracy scores" (midline Month 6 vs endline Month 12, ASER-style)
6. Digital literacy: "80% of students demonstrate basic digital skills" (practical assessment rubric, endline Month 12)
7. SEL gains: "measurable improvement in social-emotional competencies" (teacher observation checklist, endline Month 12)
8. Community engagement: "≥2 community events per center per quarter with ≥50% parent attendance" (event attendance logs)

FILL EVERY TABLE CELL with these defaults. Do NOT use {{MISSING}} — use the targets above with "(to be confirmed from baseline data)".
Do NOT leave this section empty. If evidence is thin, use Activity Facts + org context to construct plausible outcomes.`,

  communication: `REQUIRED for this section:
- 3 audiences: funder, community, internal team
- 2 channels per audience (minimum 6 total tactics)
- Frequency for each channel (monthly, quarterly, etc.)
- At least 1 item must tie to the Activity Registry cadence (e.g., "Fortnightly progress reports aligned to existing data collection cycle")
Audience-channel matrix:
1. FUNDER: (a) Quarterly narrative + financial reports, (b) Annual impact report with photos/case studies
2. COMMUNITY: (a) Monthly parent meetings/PTMs (tie to PTM data in registry), (b) Community events and open houses (tie to events data in registry)
3. INTERNAL: (a) Fortnightly team review meetings (tie to fortnightly reporting cycle), (b) Monthly M&E dashboard review
Include a simple table: Audience | Channel | Frequency | Content | Responsible Person
Do NOT leave this section empty — every proposal needs a communication plan.`,

  sustainability: `REQUIRED for this section — structure around these 5 concrete mechanisms (not vague aspirations):

1. YOUTH/COMMUNITY-LED SUSTAINABILITY: Who takes ownership of delivery after the grant? Describe a specific pipeline (e.g., Young Leaders trained as mediators/coaches who progressively lead sessions independently). State how many, their training trajectory, and retention targets.

2. EXISTING INFRASTRUCTURE: What resources continue without new funding? Diksha's KHEL centers, Empowering Futures partner-school network, community playing spaces. Note: "No new facilities require construction. Equipment is reusable and low-cost."

3. COMMUNITY OWNERSHIP: How do families and communities invest? Describe parent engagement mechanisms, community events that build legitimacy, and how program activities connect to values families already hold (e.g., education-sport linkage addressing "study vs play" cultural barrier).

4. DIVERSIFIED FUNDING BASE: Name specific current funders (Azim Premji Foundation, Feeding India, etc.) and future funding strategies — CSR partnerships (leveraging CSR-1 registration), government scheme alignment (Bihar Khel Niti, Mukhyamantri Khel Vikas Yojana if sports-related), and relevant grant pipelines.

5. INSTITUTIONAL LEARNING: How is the model captured for replication? Reference Diksha's centralized MIS, data dashboards, documentation practices, and capability framework alignment.

Each mechanism needs a concrete paragraph with specific details. Do NOT write generic "will seek additional funding" or "build local capacity."`,

  projectDesign: `REQUIRED for this section:

THEORY OF CHANGE — present in TWO formats:
1. FIRST, write a single flowing conditional statement (1-2 sentences):
   "If [target population] in [geography] are provided with [specific intervention], then they will develop [specific outcomes], leading to [impact]."
   Example: "If marginalized children and adolescent girls in Bihar are provided with structured, safe football-for-development programming — delivered through the Football3 methodology by trained local youth leaders, with facilitated reflection, girls-first cohorts, education linkage, and community action — then they will develop improved physical skills, life skills, agency, and sustained engagement with education, leading to stronger community cohesion and a replicable grassroots sports model."
2. THEN provide the structured breakdown: Inputs → Activities → Outputs → Outcomes → Impact

METHODOLOGY — for each methodology referenced:
- Explain HOW it works in 2-3 sentences (not just the name)
- State its evidence base (e.g., "used by 70+ organizations globally")
- Describe how Diksha ADAPTS it for Bihar context, hub-and-spoke model, and specific age group
- Reference framework method cards by name if available

ACTIVITY STRUCTURE:
- Weekly schedule with specific session frequencies
- Activity blocks aligned to capabilities (C1-C10) if framework context is available
- Describe session patterns from framework knowledge
- Link each activity block to specific capabilities and expected outcomes

Do NOT just list framework knowledge — SYNTHESIZE it into a coherent program design that reads as Diksha's own.`,

  experience: `REQUIRED for this section:
- Years of operation in the project location
- Specific programs delivered and their outcomes
- Beneficiary numbers served historically (cite Activity Facts if available)
- Key achievements and milestones
- Relevant partnerships and collaborations
- Staff expertise and capacity
Present as a narrative with concrete numbers, not vague claims.
Use Activity Facts (enrollment, attendance, meals, etc.) to demonstrate track record.`,

  compliance: `REQUIRED for this section:
Present a compliance checklist table with columns: Particulars | Yes/No | Remarks

Include ALL of the following from the organization context:
- Political or religious activities: No (state "Copy of bye-laws enclosed")
- Statutory registration details with certificate number
- PAN number
- 12A/80G approval status with certificate reference
- Last income tax return filing date
- GST registration status
- FCRA registration status and last return filing date
- FCRA defaults or blacklisting: No
- CSR registration status
- Audit status in last 3 years: Yes (state "Audited annually")
- External auditor name, firm number, contact
- Financial summary availability
- Enclosed documents: cancelled cheque, bank mandate, address proof, PAN card copy, 12A/80G certificate, CSR registration

Use actual registration numbers and dates from the org context. Do NOT use placeholders for data that is available in the org profile.`,

  capabilityAlignment: `REQUIRED for this section:
Present a capability framework alignment table with columns: Capability | How This Program Builds It

Map each of the 10 Core Capabilities (Nussbaum framework) to SPECIFIC program activities:
- Life: Education linkage ensuring school continuation; addressing academic pressure through safe peer interaction
- Bodily Health & Integrity: Regular physical activity; safe participation norms; safeguarding protocols; first-aid training
- Senses, Imagination & Thought: Creative expression through reflection circles; exposure to diverse peers; public facilitation roles
- Emotions / Resilience: Structured reflection after sessions; peer support networks; conflict processing through mediation
- Practical Reason: Goal-setting within scoring systems; choices-and-consequences frameworks; leadership decision-making
- Affiliation: Teamwork through mixed-gender play; inclusion rules and fair-play norms; community service building bonds
- Other Species / Environment: Community actions including environmental awareness drives
- Play: Structured play as development vehicle; demonstrating play and learning as complementary
- Control Over One's Environment: Leadership roles; community actions; improved voice; education-sport balance negotiation
- Bodily Integrity & Safety: Safe spaces for girls; supervision protocols; safeguarding; parent engagement for participation rights

Each cell should have 1-2 sentences explaining the SPECIFIC mechanism — not generic descriptions. Reference the actual program activities and methodology.`,

  approach: `REQUIRED for this section:
- Describe the COMPLETE program delivery model: hub-and-spoke structure, center operations, school linkages
- Weekly schedule per center: list each activity type with frequency, duration, group size, and responsible staff
- Example format: "Each KHEL center operates Tuesday-Sunday, 10 AM-6 PM. Daily schedule: Academic support (2 hrs), Digital literacy on rotation (1 hr for groups of 15 using 1:3 device ratio), Sports sessions (1.5 hrs with trained Fellow Teachers), and SEE Learning circles (45 min, twice weekly)."
- Staffing model: Fellow Teachers per center, roles of Center Coordinator and Computer Instructor
- Delivery methodology: explain Football3 (three halves: pre-game discussion, match, post-game reflection), SEE Learning (Dalai Lama Trust curriculum adapted for Bihar), Khan Academy integration
- Monitoring touchpoints: daily attendance tracking, fortnightly reports, monthly assessments, quarterly parent meetings
- Government school spoke model: how Fellow Teachers work in partner schools, frequency of visits, coordination with school administration
Present enough detail that a volunteer reviewer unfamiliar with the organization can picture a typical program day.`,
};

export function getSectionTypeGuidance(sectionName: string): string | null {
  const lower = sectionName.toLowerCase();
  if (lower.includes("beneficiar") || lower.includes("target group")) return SECTION_TYPE_GUIDANCE.beneficiaries;
  if (lower.includes("objective") || lower.includes("goal")) return SECTION_TYPE_GUIDANCE.objectives;
  if (lower.includes("budget") || lower.includes("financial")) return SECTION_TYPE_GUIDANCE.budget;
  if (lower.includes("monitor") || lower.includes("evaluat") || lower.includes("m&e") || lower.includes("m & e")) return SECTION_TYPE_GUIDANCE.monitoring;
  if (lower.includes("project design") || lower.includes("program design")) return SECTION_TYPE_GUIDANCE.projectDesign;
  if (lower.includes("approach") || lower.includes("program description")) return SECTION_TYPE_GUIDANCE.approach;
  if (lower.includes("activit") || lower.includes("implementation") || lower.includes("methodology")) return SECTION_TYPE_GUIDANCE.activities;
  if (lower.includes("team") || lower.includes("staff") || lower.includes("personnel") || lower.includes("core team")) return SECTION_TYPE_GUIDANCE.team;
  if (lower.includes("need") || lower.includes("problem") || lower.includes("rationale") || lower.includes("context") || lower.includes("background")) return SECTION_TYPE_GUIDANCE.need;
  if (lower.includes("result") || lower.includes("outcome") || lower.includes("impact") || lower.includes("expected")) return SECTION_TYPE_GUIDANCE.results;
  if (lower.includes("communicat") || lower.includes("disseminat") || lower.includes("stakeholder engag")) return SECTION_TYPE_GUIDANCE.communication;
  if (lower.includes("sustainab") || lower.includes("exit") || lower.includes("scale")) return SECTION_TYPE_GUIDANCE.sustainability;
  if (lower.includes("experience") || lower.includes("track record") || lower.includes("past work")) return SECTION_TYPE_GUIDANCE.experience;
  if (lower.includes("compliance") || lower.includes("checklist") || lower.includes("statutory") || lower.includes("registration")) return SECTION_TYPE_GUIDANCE.compliance;
  if (lower.includes("capability") || lower.includes("capabilities") || lower.includes("framework alignment") || lower.includes("nussbaum")) return SECTION_TYPE_GUIDANCE.capabilityAlignment;
  // Fellowship-specific section names
  if (lower.includes("career") || lower.includes("fellowship impact") || lower.includes("why this fellowship")) return SECTION_TYPE_GUIDANCE.experience;
  if (lower.includes("engagement") || lower.includes("digital minds") || lower.includes("focus area")) return SECTION_TYPE_GUIDANCE.projectDesign;
  if (lower.includes("expertise") || lower.includes("field of")) return SECTION_TYPE_GUIDANCE.experience;
  // Org info / appendix (donor chapter)
  if (lower.includes("appendix") || lower.includes("org") && lower.includes("info")) return SECTION_TYPE_GUIDANCE.compliance;
  return null;
}
