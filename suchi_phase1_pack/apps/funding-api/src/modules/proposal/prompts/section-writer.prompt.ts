/**
 * Section writer: evidence-grounded drafting (Spec section 8.3)
 * Citations use [citation:docId:chunkId] format for traceability.
 */

export const SECTION_WRITER_SYSTEM_PROMPT = `Draft the section using ONLY the provided evidence chunks.

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

Output format: Markdown with headings.
Do not invent facts or numbers — but DO write natural prose with "(to be confirmed)" for operational details.`;

export const SECTION_WRITER_USER_TEMPLATE = `Section: {{SECTION_NAME}}
Funder: {{FUNDER_CONTEXT}}
Outline guidance: {{SECTION_GUIDANCE}}
{{PROPOSAL_SCOPE}}{{SECTION_TYPE_REQUIREMENTS}}
{{FRAMEWORK_CONTEXT}}
Organization context:
{{ORG_CONTEXT}}

Evidence chunks (use citation token EXACTLY as shown):
{{CHUNKS_LIST}}

Style: human, funder-facing, no fluff, India context. Include citation tokens inline.`;

export function buildSectionWriterUserPrompt(params: {
  sectionName: string;
  sectionGuidance: string;
  chunksList: string;
  funderContext?: string;
  sectionTypeRequirements?: string;
  orgContext?: string;
  proposalScope?: import("../proposal.types").ProposalScope;
  frameworkContext?: string;
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

  return SECTION_WRITER_USER_TEMPLATE
    .replace("{{SECTION_NAME}}", params.sectionName)
    .replace("{{FUNDER_CONTEXT}}", params.funderContext || "Not specified")
    .replace("{{SECTION_GUIDANCE}}", params.sectionGuidance)
    .replace("{{PROPOSAL_SCOPE}}", scopeBlock)
    .replace("{{SECTION_TYPE_REQUIREMENTS}}", params.sectionTypeRequirements ? `\nSection-specific requirements:\n${params.sectionTypeRequirements}` : "")
    .replace("{{FRAMEWORK_CONTEXT}}", params.frameworkContext ? `\n${params.frameworkContext}` : "")
    .replace("{{ORG_CONTEXT}}", params.orgContext || "Not provided")
    .replace("{{CHUNKS_LIST}}", params.chunksList);
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

  sustainability: `REQUIRED for this section:
- Financial sustainability plan (post-grant funding sources)
- Programmatic sustainability (capacity built within communities, trained staff retention)
- Institutional sustainability (systems, processes, local partnerships that persist)
- Phased handover plan (if applicable)
- At least 3 concrete sustainability mechanisms (not just "will seek funding")
Do NOT leave this section empty. Use org context to describe existing sustainability practices.`,

  projectDesign: `REQUIRED for this section:
- Theory of Change: present a clear causal chain (inputs -> activities -> outputs -> outcomes -> impact)
- If framework knowledge provides a ToC, adapt it to Diksha's specific programs and Bihar context
- Reference proven program models (method cards) by name and explain HOW Diksha adapts them
- Activity blocks with weekly structure, aligned to capabilities (C1-C10)
- Describe session patterns if available from framework knowledge
- Include adaptation narrative: how global/proven models are customized for Diksha's hub-and-spoke model, Bihar geography, and specific age group
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
};

export function getSectionTypeGuidance(sectionName: string): string | null {
  const lower = sectionName.toLowerCase();
  if (lower.includes("beneficiar") || lower.includes("target group")) return SECTION_TYPE_GUIDANCE.beneficiaries;
  if (lower.includes("objective") || lower.includes("goal")) return SECTION_TYPE_GUIDANCE.objectives;
  if (lower.includes("budget") || lower.includes("financial")) return SECTION_TYPE_GUIDANCE.budget;
  if (lower.includes("monitor") || lower.includes("evaluat") || lower.includes("m&e") || lower.includes("m & e")) return SECTION_TYPE_GUIDANCE.monitoring;
  if (lower.includes("project design") || lower.includes("program design")) return SECTION_TYPE_GUIDANCE.projectDesign;
  if (lower.includes("activit") || lower.includes("implementation") || lower.includes("methodology")) return SECTION_TYPE_GUIDANCE.activities;
  if (lower.includes("team") || lower.includes("staff") || lower.includes("personnel") || lower.includes("core team")) return SECTION_TYPE_GUIDANCE.team;
  if (lower.includes("need") || lower.includes("problem") || lower.includes("rationale") || lower.includes("context") || lower.includes("background")) return SECTION_TYPE_GUIDANCE.need;
  if (lower.includes("result") || lower.includes("outcome") || lower.includes("impact") || lower.includes("expected")) return SECTION_TYPE_GUIDANCE.results;
  if (lower.includes("communicat") || lower.includes("disseminat") || lower.includes("stakeholder engag")) return SECTION_TYPE_GUIDANCE.communication;
  if (lower.includes("sustainab") || lower.includes("exit") || lower.includes("scale")) return SECTION_TYPE_GUIDANCE.sustainability;
  if (lower.includes("experience") || lower.includes("track record") || lower.includes("past work")) return SECTION_TYPE_GUIDANCE.experience;
  return null;
}
