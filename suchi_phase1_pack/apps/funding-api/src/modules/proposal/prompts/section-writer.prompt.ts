/**
 * Section writer: evidence-grounded drafting (Spec section 8.3)
 * Citations use [citation:docId:chunkId] format for traceability.
 */

export const SECTION_WRITER_SYSTEM_PROMPT = `Draft the section using ONLY the provided evidence chunks.

CITATION RULES (CRITICAL):
- Every numeric claim, impact statement, or statistic MUST include its citation token immediately after.
- Copy the citation EXACTLY as provided (e.g., [citation:proposal_001:chunk_3]).
- Do NOT invent or modify citation tokens.
- If evidence is insufficient, use {{MISSING: description}} placeholders.

SCOPE LOCK (CRITICAL — read the CANONICAL SCOPE block carefully):
- Use EXACTLY the center/site names listed in the scope. Do NOT add, rename, or invent new centers or locations — even if evidence mentions expansion plans or future sites.
- Use EXACTLY the beneficiary count from the scope. Do NOT round up, estimate differently, or use a different number in different parts of the section.
- Use EXACTLY the geographic scope. Do NOT expand to new districts or states.
- Use EXACTLY the grant period. All timeline items and salary durations must fit within this period (e.g., if the grant is 12 months, do NOT use 24-month cost lines).
- If evidence mentions aspirational or planned expansions not in the CANONICAL SCOPE, IGNORE them.
- If you reference other org programs for broader context, put them in ONE brief "Organizational Context" paragraph labeled as out-of-scope. Do NOT repeat this disclaimer on every mention — state it once.

TABLE COMPLETENESS:
- Every cell in a markdown table MUST contain a value. Do NOT leave cells empty, use "-", or write "TBD".
- If a baseline value is unknown, write "{{MISSING: baseline for [indicator name]}}".
- If a target value is unknown, write "{{MISSING: target for [indicator name]}}".

Output format: Markdown with headings.
Do not invent facts or numbers.`;

export const SECTION_WRITER_USER_TEMPLATE = `Section: {{SECTION_NAME}}
Funder: {{FUNDER_CONTEXT}}
Outline guidance: {{SECTION_GUIDANCE}}
{{PROPOSAL_SCOPE}}{{SECTION_TYPE_REQUIREMENTS}}
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
  proposalScope?: {
    programName: string;
    centers: string[];
    totalDirectBeneficiaries: string;
    totalIndirectBeneficiaries?: string;
    geographicScope: string;
    grantPeriod: string;
    budgetCeiling?: string;
    keyDeliverables: string[];
  };
}): string {
  let scopeBlock = "";
  if (params.proposalScope) {
    const s = params.proposalScope;
    // Only render non-empty fields to avoid misleading the LLM with "0 centers" etc.
    const lines: string[] = [];
    if (s.programName) lines.push(`- Program: ${s.programName}`);
    if (s.centers.length > 0) lines.push(`- Centers: ${s.centers.join(", ")} (${s.centers.length} centers)`);
    if (s.totalDirectBeneficiaries) lines.push(`- Direct beneficiaries: ${s.totalDirectBeneficiaries}`);
    if (s.totalIndirectBeneficiaries) lines.push(`- Indirect beneficiaries: ${s.totalIndirectBeneficiaries}`);
    if (s.geographicScope) lines.push(`- Geography: ${s.geographicScope}`);
    if (s.grantPeriod) lines.push(`- Grant period: ${s.grantPeriod}`);
    if (s.budgetCeiling) lines.push(`- Budget ceiling: ${s.budgetCeiling}`);
    if (s.keyDeliverables.length > 0) lines.push(`- Key deliverables: ${s.keyDeliverables.join(", ")}`);
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
    .replace("{{ORG_CONTEXT}}", params.orgContext || "Not provided")
    .replace("{{CHUNKS_LIST}}", params.chunksList);
}

// --- Section-type-specific guidance ---

export const SECTION_TYPE_GUIDANCE: Record<string, string> = {
  beneficiaries: `REQUIRED for this section:
- Direct beneficiary count (number of children/youth directly served)
- Indirect beneficiaries (families, community members)
- Geography (districts, blocks, specific locations)
- Age bands and gender breakdown (% girls target)
- Selection criteria (how beneficiaries are identified)
- Vulnerability criteria (what makes them eligible)
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
If a specific target value is unknown, use {{MISSING: target for [objective name]}} — do NOT invent numbers.`,

  budget: `REQUIRED for this section:
- 8-12 line items minimum
- Staff costs (salaries, stipends for fellows)
- Program costs (materials, kits, sports equipment, digital devices)
- Infrastructure (rent, utilities, internet, furniture)
- Training and capacity building
- M&E costs (assessments, data collection, reporting)
- Administrative (audit, travel, communication)
- Contingency (5-10%)
- Total must be plausible for the described scope
If budget ceiling is specified in guidance, all items must sum to within that ceiling.
Do NOT write "will be finalized later" — provide specific amounts.
Total must not exceed the grant ceiling specified in the outline guidance.
Each line item must have a unit cost x quantity breakdown (e.g., "Fellow Teacher stipend: INR 12,000/month x 12 months x 8 fellows = INR 11,52,000").
Cross-check: staff counts in budget must match the Team/Staffing section.
DURATION: ALL salary/stipend line items MUST use the same duration matching the grant period from the CANONICAL SCOPE. If the grant is 12 months, every line must be 12 months — do NOT use 24 months for some and 12 for others.
SINGLE TOTAL: Present exactly ONE "Total Proposed Budget" amount. Do NOT show different totals in different parts of the section.
BENEFICIARY COUNTS: Kit quantities, device counts, and per-student costs must use the exact beneficiary count from the CANONICAL SCOPE.`,

  monitoring: `REQUIRED for this section:
- Baseline-midline-endline schedule with dates
- Data collection tools (assessments, rubrics, attendance registers, observation forms)
- Who collects data (staff roles, external evaluators)
- Reporting cadence (monthly, quarterly, annual)
- Key indicators table (indicator, data source, frequency, target)
- Data quality assurance mechanism
- Dashboard or reporting format
Present the M&E framework as a table with columns: Indicator | Data Source | Frequency | Baseline | Target | Responsible Staff.
Include explicit baseline-midline-endline dates (e.g., "Baseline: Month 1, Midline: Month 6, Endline: Month 12").
Each indicator must have a named responsible person or role, not just "project team".
EVERY table cell MUST have a value. If baseline data is not yet collected, write "To be established Month 1" — do NOT leave cells blank.
Targets must be specific numbers consistent with the CANONICAL SCOPE beneficiary count.`,

  activities: `REQUIRED for this section:
- Weekly schedule (hours/week per activity type)
- Sports: sessions/week, coaching model, equipment, inclusion approach
- Digital: sessions/week, device ratio, curriculum/platform
- Academic: subjects covered, methodology, materials
- Community events: frequency, format
- Implementation timeline with milestones (Year 1 quarters)`,

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
};

export function getSectionTypeGuidance(sectionName: string): string | null {
  const lower = sectionName.toLowerCase();
  if (lower.includes("beneficiar") || lower.includes("target group")) return SECTION_TYPE_GUIDANCE.beneficiaries;
  if (lower.includes("objective") || lower.includes("goal")) return SECTION_TYPE_GUIDANCE.objectives;
  if (lower.includes("budget") || lower.includes("financial")) return SECTION_TYPE_GUIDANCE.budget;
  if (lower.includes("monitor") || lower.includes("evaluat") || lower.includes("m&e") || lower.includes("m & e")) return SECTION_TYPE_GUIDANCE.monitoring;
  if (lower.includes("activit") || lower.includes("implementation") || lower.includes("methodology")) return SECTION_TYPE_GUIDANCE.activities;
  if (lower.includes("team") || lower.includes("staff") || lower.includes("personnel") || lower.includes("core team")) return SECTION_TYPE_GUIDANCE.team;
  if (lower.includes("need") || lower.includes("problem") || lower.includes("rationale") || lower.includes("context")) return SECTION_TYPE_GUIDANCE.need;
  return null;
}
