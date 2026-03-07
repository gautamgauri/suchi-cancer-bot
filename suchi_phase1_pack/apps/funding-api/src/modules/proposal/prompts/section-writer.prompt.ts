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

WRITING STYLE (CRITICAL):
- Write in first-person plural from the organization's perspective ("we", "our work") unless the funder explicitly requests third-person.
- Use clear, active voice and short paragraphs (2–4 sentences) that read like human narrative prose, not bullet dumps.
- Write for Indian funders: default to Indian English spelling (programme, organisation, enrolment) and INR formatting (e.g., INR 12,34,000).
- Name Bihar and specific locations (Patna, Bihta, Sarairanjan, Samastipur) explicitly instead of generic phrases like "in the state" when relevant.
- When describing methodology or Theory of Change, start with 2–3 sentences that tell the end-to-end story, then use tables or structured lists for detail.
- Whenever you mention numbers, decompose them briefly so they are understandable to a lay reader (e.g., "476 children across three centres (Patna, Bihta, Sarairanjan)").
- Avoid vague marketing language and adjectives ("cutting-edge", "unique", "world-class"); prefer concrete, evidence-backed descriptions.
- Keep headings descriptive but concise; avoid repeating the RFP question verbatim as the heading text.

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

Style: first-person plural ("we"), active voice, funder-facing, Indian English (India context), narrative paragraphs with tables only where helpful. Include citation tokens inline.`;

export function buildSectionWriterUserPrompt(params: {
  sectionName: string;
  sectionGuidance: string;
  chunksList: string;
  funderContext?: string;
  sectionTypeRequirements?: string;
  orgContext?: string;
  proposalScope?: import("../proposal.types").ProposalScope;
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

  results: `REQUIRED for this section:
- 5-8 expected outcomes organized as: short-term (within 6 months) and intermediate (within 12 months)
- Each outcome MUST reference at least ONE Activity Fact (e.g., sessions/week, hours/week, device ratio, enrollment, attendance %)
- Use a table with columns: Outcome | Indicator | Activity Link | Timeline | Target
- Short-term outcomes: attendance improvement, enrollment stabilization, baseline assessments completed, initial sports participation
- Intermediate outcomes: learning level improvement, digital literacy gains, life skills behavior change, community engagement
- At least 3 outcomes must cite specific Activity Facts data (e.g., "SEL sessions: 2x/week → expected 15% improvement in emotional regulation scores")
- Do NOT leave this section empty. If evidence is thin, use Activity Facts + org context to construct plausible outcomes.`,

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
- Explain how the work will continue beyond the grant period across THREE lenses: (a) financial, (b) programmatic, and (c) institutional.
- Financial: describe diversified funding streams (CSR partners, individual donors, small grants) and how core costs for KHEL hubs and Fellow Teachers will be covered after this grant.
- Programmatic: show how capacities are built within staff, Fellows, adolescent peer leaders and community groups so that practices (clubs, Bal Sansad, SEL, digital labs) continue even if a specific project line ends.
- Institutional: describe the systems, policies and partnerships (e.g., with government schools, local institutions, women’s groups) that will outlast any single grant.
- Include at least 3–5 concrete mechanisms (e.g., cost‑sharing with schools, gradual reduction of stipend dependence, alumni volunteer networks, community contribution for space or utilities).
- If a phased exit or handover is relevant, clearly describe year‑wise transition (what the funder pays in Year 1 vs later years, what the community or government progressively takes on).
Do NOT leave this section empty. Use org context and Activity Facts to back up claims (e.g., years of continuous centre operation, repeat donors, existing community groups).`,

  experience: `REQUIRED for this section:
- Years of operation in the project geography and similar communities
- Specific programmes delivered (KHEL, Teaching Fellowship, Empowering Futures, Poonji, scholarships) and the outcomes achieved
- Beneficiary numbers served historically (use ranges and Activity Facts where precise totals are not available)
- Key achievements and milestones (e.g., centre establishment dates, scholarship alumni, assessment improvements)
- Relevant partnerships and collaborations (CSR partners, foundations, institutional donors, government schools)
- Staff expertise and capacity (leadership, programme team, Fellows)
Present as a narrative with concrete numbers and locations, not vague claims. Use Activity Facts (enrolment, attendance, meals, SEL sessions, etc.) to demonstrate track record.`,

  projectDesign: `REQUIRED for this section:
- Begin with a 2–3 paragraph narrative Theory of Change in plain language that clearly links inputs → activities → outputs → short‑term outcomes → longer‑term outcomes for children and communities in Bihar.
- Immediately after the narrative, include a markdown Theory of Change table with columns: Level | Description | Evidence Source | Activity Facts Link | Time horizon.
- Make sure each outcome in the ToC table is explicitly linked to at least one concrete activity or metric (sessions/week, centres, enrolment, attendance %, SEL sessions, meals, etc.).
- Clearly show how the KHEL hub & spoke model, Teaching Fellowship and community programmes (e.g., Empowering Futures, Poonji) reinforce each other, instead of describing them as isolated projects.
- Keep the number of rows manageable (8–14 rows across the whole table) so that a reviewer can see the full logic at a glance.
- Use CANONICAL SCOPE numbers (centres, beneficiaries, grant period, geography) consistently between the narrative and the table.`,

  compliance: `REQUIRED for this section:
- Present a single markdown table listing all key registrations and compliances with columns: Item | Registration Number | Valid till / Year | Issuing Authority | Notes.
- At minimum include: Society Registration, 12A, 80G, FCRA, CSR-1, PAN, and core governance policies (Child Protection, Safeguarding, Conflict of Interest, Financial Manual).
- Use the real registration numbers and policy names from the organisation profile; do NOT change or invent numbers, years or authorities.
- If a specific registration or policy does not exist, write a clear {{MISSING: ...}} placeholder instead of leaving cells blank or writing "N/A".
- Briefly explain how compliance is monitored (board oversight, statutory audit, renewal tracking) in 1 short paragraph before or after the table.`,

  capabilityAlignment: `REQUIRED for this section:
- Show how Diksha’s capabilities map onto the funder’s priorities or evaluation criteria using a markdown table with columns: Core Capability | Evidence from Activity Facts / Org Profile | Funder Priority / Evaluation Criterion | Strength (High/Medium/Emerging).
- Include at least 8–10 rows covering programme design, assessment and evidence use, working with government schools, work with adolescent girls and women, sports & SEL, digital learning, and community engagement.
- Whenever possible, anchor each capability in a concrete piece of evidence (centre names, years of operation, assessment results, scholarship stories, partnerships, registry metrics).
- Avoid generic claims like "strong experience" without a data point; pair every claim with a number, location or named programme.
- Make sure the language stays grounded in what Diksha actually does in Bihar, not generic NGO capabilities.`,
};

export function getSectionTypeGuidance(sectionName: string): string | null {
  const lower = sectionName.toLowerCase();
  if (lower.includes("beneficiar") || lower.includes("target group")) return SECTION_TYPE_GUIDANCE.beneficiaries;
  if (lower.includes("objective") || lower.includes("goal")) return SECTION_TYPE_GUIDANCE.objectives;
  if (lower.includes("budget") || lower.includes("financial")) return SECTION_TYPE_GUIDANCE.budget;
  if (lower.includes("monitor") || lower.includes("evaluat") || lower.includes("m&e") || lower.includes("m & e")) return SECTION_TYPE_GUIDANCE.monitoring;
  if (lower.includes("activit") || lower.includes("implementation") || lower.includes("methodology")) return SECTION_TYPE_GUIDANCE.activities;
  if (lower.includes("team") || lower.includes("staff") || lower.includes("personnel") || lower.includes("core team")) return SECTION_TYPE_GUIDANCE.team;
  if (lower.includes("need") || lower.includes("problem") || lower.includes("rationale") || lower.includes("context") || lower.includes("background")) return SECTION_TYPE_GUIDANCE.need;
  if (lower.includes("result") || lower.includes("outcome") || lower.includes("impact") || lower.includes("expected")) return SECTION_TYPE_GUIDANCE.results;
  if (lower.includes("communicat") || lower.includes("disseminat") || lower.includes("stakeholder engag")) return SECTION_TYPE_GUIDANCE.communication;
  if (lower.includes("sustainab") || lower.includes("exit") || lower.includes("scale")) return SECTION_TYPE_GUIDANCE.sustainability;
  if (lower.includes("experience") || lower.includes("track record") || lower.includes("past work")) return SECTION_TYPE_GUIDANCE.experience;
  if (lower.includes("project design") || lower.includes("theory of change") || lower.includes("toc")) return SECTION_TYPE_GUIDANCE.projectDesign;
  if (lower.includes("compliance") || lower.includes("regulator") || lower.includes("legal") || lower.includes("governance")) return SECTION_TYPE_GUIDANCE.compliance;
  if (lower.includes("capability alignment") || lower.includes("organisational capability") || lower.includes("organizational capability") || lower.includes("capabilities")) {
    return SECTION_TYPE_GUIDANCE.capabilityAlignment;
  }
  return null;
}
