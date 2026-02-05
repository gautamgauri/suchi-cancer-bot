/* eslint-disable no-console */
/**
 * Seed MVP Framework Card Library: 15 method cards, 25 pattern cards, 30 comparable cases.
 * Run after seed-framework-taxonomy.ts. Cards are created with status "validated" so they appear in generation.
 *
 * Usage: npx ts-node src/scripts/seed-mvp-cards.ts
 *    or: npm run framework:seed-mvp
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const METHOD_CARDS = [
  { methodId: "see-think-wonder", title: "See-Think-Wonder", intent: "Develop observation and inquiry; surface prior knowledge and questions.", steps: ["What do you see?", "What do you think about that?", "What does it make you wonder?"], whenToUse: "Introducing a new topic or image.", whenNotToUse: "When quick recall is needed.", ageBand: "6-10", settingTags: ["school", "after-school"], miTagsPrimary: ["MI1", "MI3"], miTagsSecondary: ["MI6"], capabilityLinks: ["C4"] },
  { methodId: "think-puzzle-explore", title: "Think-Puzzle-Explore", intent: "Activate prior knowledge and identify questions for inquiry.", steps: ["What do you think you know?", "What puzzles you?", "What would you like to explore?"], whenToUse: "Launching an inquiry or unit.", whenNotToUse: "N/A", ageBand: "11-14", settingTags: ["school"], miTagsPrimary: ["MI1", "MI6"], miTagsSecondary: ["MI2"], capabilityLinks: ["C4", "C6"] },
  { methodId: "claim-support-question", title: "Claim-Support-Question", intent: "Build reasoning with claims, evidence, and open questions.", steps: ["Make a claim.", "What supports your claim?", "What question does it raise?"], whenToUse: "Analyzing data or text.", whenNotToUse: "N/A", ageBand: "11-14", settingTags: ["school"], miTagsPrimary: ["MI1", "MI2"], miTagsSecondary: ["MI6"], capabilityLinks: ["C4", "C6"] },
  { methodId: "connect-extend-challenge", title: "Connect-Extend-Challenge", intent: "Connect new ideas to prior learning; extend and challenge thinking.", steps: ["How does this connect to what you know?", "What new ideas does it extend?", "What challenges or puzzles does it raise?"], whenToUse: "After reading or experience.", whenNotToUse: "N/A", ageBand: "11-14", settingTags: ["school", "community"], miTagsPrimary: ["MI1", "MI7"], miTagsSecondary: ["MI6"], capabilityLinks: ["C4", "C6"] },
  { methodId: "circle-of-viewpoints", title: "Circle of Viewpoints", intent: "Explore multiple perspectives on an issue or artifact.", steps: ["Identify different viewpoints.", "I am thinking of ... from the viewpoint of ...", "A question I have from this viewpoint is ..."], whenToUse: "Controversial or multi-stakeholder topics.", whenNotToUse: "N/A", ageBand: "15-18", settingTags: ["school", "community"], miTagsPrimary: ["MI6", "MI7"], miTagsSecondary: ["MI1"], capabilityLinks: ["C6", "C7"] },
  { methodId: "3-2-1-bridge", title: "3-2-1 Bridge", intent: "Bridge initial and later thinking; surface how ideas changed.", steps: ["Initial: 3 thoughts, 2 questions, 1 analogy.", "After engagement: repeat.", "Bridge: How did your thinking change?"], whenToUse: "Before and after a learning experience.", whenNotToUse: "N/A", ageBand: "11-14", settingTags: ["school"], miTagsPrimary: ["MI1", "MI7"], miTagsSecondary: ["MI2"], capabilityLinks: ["C4", "C6"] },
  { methodId: "what-makes-you-say-that", title: "What Makes You Say That?", intent: "Surface reasoning and evidence behind interpretations.", steps: ["What's going on?", "What makes you say that?"], whenToUse: "When interpretations or claims are shared.", whenNotToUse: "N/A", ageBand: "6-10", settingTags: ["school", "after-school"], miTagsPrimary: ["MI1", "MI6"], miTagsSecondary: ["MI2"], capabilityLinks: ["C4", "C6"] },
  { methodId: "i-used-to-think-now-i-think", title: "I Used to Think... Now I Think...", intent: "Reflect on how thinking has changed.", steps: ["I used to think ...", "Now I think ..."], whenToUse: "After a unit or significant experience.", whenNotToUse: "N/A", ageBand: "11-14", settingTags: ["school"], miTagsPrimary: ["MI7", "MI1"], miTagsSecondary: ["MI6"], capabilityLinks: ["C4", "C6"] },
  { methodId: "compass-points", title: "Compass Points", intent: "Explore reactions to an idea: excitement, worries, need to know, stance.", steps: ["E: What excites you?", "W: What worries you?", "N: What do you need to know?", "S: What is your stance?"], whenToUse: "New proposal or decision.", whenNotToUse: "N/A", ageBand: "15-18", settingTags: ["school", "community"], miTagsPrimary: ["MI6", "MI7"], miTagsSecondary: ["MI1"], capabilityLinks: ["C6", "C7"] },
  { methodId: "explanation-game", title: "The Explanation Game", intent: "Build explanations by naming, explaining, and generating alternatives.", steps: ["Name it.", "Explain it.", "Give a different explanation.", "What else could it be?"], whenToUse: "Complex images or phenomena.", whenNotToUse: "N/A", ageBand: "6-10", settingTags: ["school"], miTagsPrimary: ["MI1", "MI3"], miTagsSecondary: ["MI2"], capabilityLinks: ["C4"] },
  { methodId: "generate-sort-connect-elaborate", title: "Generate-Sort-Connect-Elaborate", intent: "Organize and elaborate on ideas; see relationships.", steps: ["Generate ideas.", "Sort them.", "Connect with lines and labels.", "Elaborate on key ideas."], whenToUse: "Synthesizing a topic.", whenNotToUse: "N/A", ageBand: "11-14", settingTags: ["school"], miTagsPrimary: ["MI2", "MI3"], miTagsSecondary: ["MI1"], capabilityLinks: ["C4", "C6"] },
  { methodId: "tug-of-war", title: "Tug of War", intent: "Surface tensions and complexities; avoid oversimplification.", steps: ["Identify a central tension.", "List forces on each side.", "Add complexity.", "Where do you stand and why?"], whenToUse: "Dilemmas and tensions.", whenNotToUse: "N/A", ageBand: "15-18", settingTags: ["school", "community"], miTagsPrimary: ["MI6", "MI7"], miTagsSecondary: ["MI1"], capabilityLinks: ["C6", "C7"] },
  { methodId: "sentence-phrase-word", title: "Sentence-Phrase-Word", intent: "Capture essence of a text through selection and justification.", steps: ["Choose a sentence that captured your attention.", "A phrase.", "A word.", "Share why."], whenToUse: "After reading or viewing.", whenNotToUse: "N/A", ageBand: "11-14", settingTags: ["school"], miTagsPrimary: ["MI1", "MI7"], miTagsSecondary: ["MI6"], capabilityLinks: ["C4"] },
  { methodId: "color-symbol-image", title: "Color-Symbol-Image", intent: "Represent ideas non-verbally; deepen connection to concepts.", steps: ["Choose a color that represents the idea.", "A symbol.", "An image.", "Explain your choices."], whenToUse: "After a rich experience or text.", whenNotToUse: "N/A", ageBand: "11-14", settingTags: ["school", "after-school"], miTagsPrimary: ["MI3", "MI7"], miTagsSecondary: ["MI1"], capabilityLinks: ["C4", "C9"] },
  { methodId: "headlines", title: "Headlines", intent: "Summarize and capture significance in a headline.", steps: ["Write a headline that captures the core of the topic.", "Share and compare."], whenToUse: "Summarizing or synthesizing.", whenNotToUse: "N/A", ageBand: "11-14", settingTags: ["school"], miTagsPrimary: ["MI1"], miTagsSecondary: ["MI7"], capabilityLinks: ["C4"] },
];

const PATTERN_CARDS = Array.from({ length: 25 }, (_, i) => {
  const id = i + 1;
  return {
    patternId: `pattern-${String(id).padStart(2, "0")}`,
    title: `MI Activity Pattern ${id}`,
    durationMins: 20 + (id % 4) * 10,
    materials: ["Chart paper", "Markers", "Handouts"],
    facilitatorScript: [`Step 1: Introduce the theme.`, `Step 2: Facilitate the activity.`, `Step 3: Debrief and connect to outcomes.`],
    adaptations: ["Low-resource: use local materials.", "Language: use visuals and simple language."],
    evidenceLevel: id % 3 === 0 ? "RESEARCH" : id % 3 === 1 ? "PRACTICE_GUIDE" : "ANECDOTAL",
    miTagsPrimary: [["MI1", "MI6"], ["MI2", "MI3"], ["MI5", "MI6"], ["MI7", "MI1"], ["MI4", "MI5"]][id % 5],
    miTagsSecondary: [["MI7"], ["MI1"], ["MI1"], ["MI6"], ["MI8"]][id % 5],
    capabilitiesPrimary: [["C4"], ["C4", "C6"], ["C7", "C9"], ["C6", "C7"], ["C4", "C5"]][id % 5],
    capabilitiesSecondary: [["C6"], ["C7"], ["C4"], ["C4"], ["C7"]][id % 5],
  };
});

interface ComparableCaseSeed {
  caseId: string;
  programName: string;
  orgName: string;
  geography: string;
  targetGroup: string;
  deliveryModelTags?: string[];
  capabilitiesPrimary: string[];
  capabilitiesSecondary: string[];
  outcomesSummary: string;
  indicatorsUsed?: string[];
  transferabilityBihar?: string;
}

const COMPARABLE_CASES: ComparableCaseSeed[] = [
  { caseId: "plan-adolescent-toolkit", programName: "Adolescent Programming Toolkit", orgName: "Plan International", geography: "Global", targetGroup: "youth", deliveryModelTags: ["peer-led", "school-community"], capabilitiesPrimary: ["C4", "C6", "C7"], capabilitiesSecondary: ["C3", "C10"], outcomesSummary: "Holistic adolescent development through life skills, participation, and protection. Used in multiple countries with peer-led components.", indicatorsUsed: ["Participation rates", "Life skills scores", "Safety indicators"], transferabilityBihar: "Peer educator model and school-community links are adaptable; language and curriculum localization needed." },
  { caseId: "unwomen-economic-empowerment", programName: "Women's Economic Empowerment Strategy", orgName: "UN Women", geography: "Global", targetGroup: "women", deliveryModelTags: ["SHGs", "skills training"], capabilitiesPrimary: ["C10", "C2", "C6"], capabilitiesSecondary: ["C7", "C3"], outcomesSummary: "Economic empowerment through asset building, decent work, and collective action. Evidence from multiple regions.", indicatorsUsed: ["Asset ownership", "Employment", "Agency scales"], transferabilityBihar: "Self-help group linkage and skills training have been piloted in Bihar; scale and market access are constraints." },
  { caseId: "unwomen-disability", programName: "Empowerment of Women and Girls with Disabilities", orgName: "UN Women", geography: "Global", targetGroup: "women", deliveryModelTags: [], capabilitiesPrimary: ["C3", "C7", "C10"], capabilitiesSecondary: ["C4", "C2"], outcomesSummary: "Inclusion and empowerment of women and girls with disabilities through accessibility, advocacy, and livelihood support.", indicatorsUsed: ["Access to services", "Participation", "Rights awareness"], transferabilityBihar: "Inclusive design and disability-inclusive MEL need investment; existing SHG structures can be leveraged." },
  { caseId: "pratham-aser", programName: "ASER Learning Outcomes", orgName: "Pratham", geography: "India", targetGroup: "children", deliveryModelTags: ["citizen-led"], capabilitiesPrimary: ["C4"], capabilitiesSecondary: ["C6", "C7"], outcomesSummary: "Large-scale citizen-led assessment of reading and arithmetic; informs pedagogy and policy.", indicatorsUsed: ["Reading level", "Numeracy level", "Enrollment"], transferabilityBihar: "Directly applicable; ASER Bihar conducted; use for baseline and advocacy." },
  { caseId: "escuela-nueva", programName: "Escuela Nueva Model", orgName: "Fundación Escuela Nueva", geography: "Colombia/LATAM", targetGroup: "children", deliveryModelTags: ["multigrade", "peer collaboration"], capabilitiesPrimary: ["C4", "C6", "C7"], capabilitiesSecondary: ["C10"], outcomesSummary: "Child-centered, multigrade learning with peer collaboration and self-paced materials.", indicatorsUsed: ["Learning outcomes", "Repetition rates", "Student leadership"], transferabilityBihar: "Multigrade and peer learning relevant for rural Bihar; requires teacher training and materials." },
  { caseId: "brac-education", programName: "BRAC Education Program", orgName: "BRAC", geography: "Bangladesh", targetGroup: "children", deliveryModelTags: ["non-formal", "adolescent clubs"], capabilitiesPrimary: ["C4", "C7"], capabilitiesSecondary: ["C2", "C6"], outcomesSummary: "Non-formal primary schools and adolescent clubs; strong outcomes in enrollment and completion.", indicatorsUsed: ["Completion rates", "Learning outcomes", "Transition to formal school"], transferabilityBihar: "Community-based schools and second-chance education are relevant; adapt to state curriculum." },
  { caseId: "akshara-foundation", programName: "Akshara Foundation Programs", orgName: "Akshara Foundation", geography: "India (Karnataka)", targetGroup: "children", deliveryModelTags: ["volunteer", "tech"], capabilitiesPrimary: ["C4"], capabilitiesSecondary: ["C7"], outcomesSummary: "Math and reading interventions in government schools; volunteer and tech components.", indicatorsUsed: ["Learning levels", "School participation"], transferabilityBihar: "Similar government school context; volunteer model may need adaptation." },
  { caseId: "room-to-read", programName: "Room to Read Literacy & Girls' Education", orgName: "Room to Read", geography: "Asia/Africa", targetGroup: "children", deliveryModelTags: ["library", "life skills"], capabilitiesPrimary: ["C4", "C7", "C3"], capabilitiesSecondary: ["C6"], outcomesSummary: "Literacy instruction and girls' education with library and life skills components.", indicatorsUsed: ["Reading fluency", "School retention", "Life skills"], transferabilityBihar: "Library and life skills model applicable; partnership with government possible." },
  { caseId: "teach-for-all", programName: "Teach For All Network", orgName: "Teach For All", geography: "Global", targetGroup: "children", deliveryModelTags: ["fellowship"], capabilitiesPrimary: ["C4", "C6"], capabilitiesSecondary: ["C7", "C10"], outcomesSummary: "Placement of leaders in underserved schools; network of local organizations.", indicatorsUsed: ["Student outcomes", "Leadership pipeline"], transferabilityBihar: "Teach For India presence; fellowship model can inform teacher development." },
  { caseId: "khel-life-skills", programName: "KHEL Life Skills", orgName: "Diksha/SCCF", geography: "India (Bihar)", targetGroup: "youth", deliveryModelTags: ["sport", "peer facilitators"], capabilitiesPrimary: ["C4", "C6", "C7", "C9"], capabilitiesSecondary: ["C5"], outcomesSummary: "Sport and play-based life skills for adolescents; peer facilitators and school/community settings.", indicatorsUsed: ["Life skills scales", "Participation", "Attendance"], transferabilityBihar: "Native Bihar program; direct evidence for proposals." },
  { caseId: "sport-for-dev", programName: "Sport for Development", orgName: "Various", geography: "Global", targetGroup: "youth", deliveryModelTags: ["sport", "life skills"], capabilitiesPrimary: ["C9", "C7", "C4"], capabilitiesSecondary: ["C3", "C6"], outcomesSummary: "Structured sport plus life skills curricula; used in conflict and development settings.", indicatorsUsed: ["Life skills", "Cohesion", "Health behaviors"], transferabilityBihar: "Align with KHEL-style models; ensure gender and inclusion." },
  { caseId: "girl-effect", programName: "Girl Effect Programs", orgName: "Girl Effect", geography: "Global", targetGroup: "youth", deliveryModelTags: ["media", "mobile"], capabilitiesPrimary: ["C4", "C6", "C7", "C3"], capabilitiesSecondary: ["C10"], outcomesSummary: "Media and mobile-based content for girls' agency, health, and economic opportunity.", indicatorsUsed: ["Agency", "Knowledge", "Behavior"], transferabilityBihar: "Digital and media components; consider connectivity and language." },
  { caseId: "care-village-savings", programName: "Village Savings and Loan", orgName: "CARE", geography: "Africa/Asia", targetGroup: "women", deliveryModelTags: ["savings groups"], capabilitiesPrimary: ["C10", "C7", "C6"], capabilitiesSecondary: ["C2"], outcomesSummary: "Community savings groups for financial inclusion and collective action.", indicatorsUsed: ["Savings", "Loans", "Group governance"], transferabilityBihar: "SHG ecosystem in Bihar; VSL methodology has been adapted." },
  { caseId: "undp-hdi", programName: "Human Development Index", orgName: "UNDP", geography: "Global", targetGroup: "mixed", deliveryModelTags: [], capabilitiesPrimary: ["C1", "C2", "C4"], capabilitiesSecondary: ["C10"], outcomesSummary: "Composite measure of health, education, living standards; used for narrative and comparison.", indicatorsUsed: ["HDI", "Inequality-adjusted HDI", "Gender Development Index"], transferabilityBihar: "Bihar HDI and district data available for proposal credibility." },
  { caseId: "plan-global-approach", programName: "Global Programme and Influence Approach", orgName: "Plan International", geography: "Global", targetGroup: "mixed", deliveryModelTags: ["rights-based"], capabilitiesPrimary: ["C3", "C7", "C10"], capabilitiesSecondary: ["C4", "C6"], outcomesSummary: "Rights-based programming and influence; child participation and safeguarding.", indicatorsUsed: ["Coverage", "Policy change", "Child participation"], transferabilityBihar: "Alignment with rights-based framing; safeguarding standards applicable." },
  ...Array.from({ length: 15 }, (_, i) => ({
    caseId: `case-${String(i + 16).padStart(2, "0")}`,
    programName: `Comparable Program ${i + 16}`,
    orgName: `Org ${i + 16}`,
    geography: ["India", "Bangladesh", "Nepal", "Global", "South Asia"][i % 5],
    targetGroup: ["children", "youth", "women", "mixed"][i % 4],
    deliveryModelTags: [] as string[],
    capabilitiesPrimary: ["C4", "C6", "C7"].slice(0, 2),
    capabilitiesSecondary: ["C2", "C10"],
    outcomesSummary: `Summary of outcomes for comparable program ${i + 16}. Evidence from similar contexts.`,
    indicatorsUsed: ["Outcome indicators", "Process indicators"],
    transferabilityBihar: "Relevant for Bihar with adaptation of context and delivery.",
  })),
];

async function resolveCapabilityIds(codes: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const code of codes) {
    const c = await prisma.frameworkCapability.findUnique({ where: { capabilityId: code } });
    if (c) map.set(code, c.id);
  }
  return map;
}

async function resolveMiIds(codes: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const code of codes) {
    const m = await prisma.frameworkMI.findUnique({ where: { miId: code } });
    if (m) map.set(code, m.id);
  }
  return map;
}

async function main() {
  console.log("Seeding MVP card library (15 method, 25 pattern, 30 comparable)...");

  const allCapCodes = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"];
  const allMiCodes = ["MI1", "MI2", "MI3", "MI4", "MI5", "MI6", "MI7", "MI8"];
  const capIds = await resolveCapabilityIds(allCapCodes);
  const miIds = await resolveMiIds(allMiCodes);

  if (capIds.size < 10 || miIds.size < 8) {
    console.error("Run seed-framework-taxonomy.ts first to seed C1–C10 and MI1–MI8.");
    process.exit(1);
  }

  // --- Method cards (15) ---
  for (const m of METHOD_CARDS) {
    const existing = await prisma.frameworkMethodCard.findUnique({ where: { methodId: m.methodId } });
    if (existing) {
      console.log(`  Method card ${m.methodId} already exists, skip`);
      continue;
    }
    const card = await prisma.frameworkMethodCard.create({
      data: {
        methodId: m.methodId,
        title: m.title,
        intent: m.intent,
        steps: m.steps,
        whenToUse: m.whenToUse,
        whenNotToUse: m.whenNotToUse,
        ageBand: m.ageBand,
        settingTags: m.settingTags,
        assessmentArtifacts: [],
        licenseFlag: "OK_INTERNAL",
        status: "validated",
        qualityScore: 80,
      },
    });
    for (const miId of m.miTagsPrimary ?? []) {
      const fid = miIds.get(miId);
      if (fid) await prisma.methodCardMI.create({ data: { methodCardId: card.id, miId: fid, isPrimary: true } });
    }
    for (const miId of m.miTagsSecondary ?? []) {
      const fid = miIds.get(miId);
      if (fid) await prisma.methodCardMI.create({ data: { methodCardId: card.id, miId: fid, isPrimary: false } });
    }
    for (const cid of m.capabilityLinks ?? []) {
      const fid = capIds.get(cid);
      if (fid) await prisma.methodCardCapability.create({ data: { methodCardId: card.id, capabilityId: fid } });
    }
    console.log(`  Method card ${m.methodId} (${m.title}) created`);
  }

  // --- Pattern cards (25) ---
  for (const p of PATTERN_CARDS) {
    const existing = await prisma.frameworkPatternCard.findUnique({ where: { patternId: p.patternId } });
    if (existing) {
      console.log(`  Pattern card ${p.patternId} already exists, skip`);
      continue;
    }
    const card = await prisma.frameworkPatternCard.create({
      data: {
        patternId: p.patternId,
        title: p.title,
        durationMins: p.durationMins,
        materials: p.materials,
        facilitatorScript: p.facilitatorScript,
        adaptations: p.adaptations,
        assessmentArtifacts: [],
        evidenceLevel: p.evidenceLevel,
        status: "validated",
        qualityScore: 70,
      },
    });
    for (const miId of p.miTagsPrimary ?? []) {
      const fid = miIds.get(miId);
      if (fid) await prisma.patternCardMI.create({ data: { patternCardId: card.id, miId: fid, isPrimary: true } });
    }
    for (const miId of p.miTagsSecondary ?? []) {
      const fid = miIds.get(miId);
      if (fid) await prisma.patternCardMI.create({ data: { patternCardId: card.id, miId: fid, isPrimary: false } });
    }
    for (const cid of p.capabilitiesPrimary ?? []) {
      const fid = capIds.get(cid);
      if (fid) await prisma.patternCardCapability.create({ data: { patternCardId: card.id, capabilityId: fid, isPrimary: true } });
    }
    for (const cid of p.capabilitiesSecondary ?? []) {
      const fid = capIds.get(cid);
      if (fid) await prisma.patternCardCapability.create({ data: { patternCardId: card.id, capabilityId: fid, isPrimary: false } });
    }
    console.log(`  Pattern card ${p.patternId} (${p.title}) created`);
  }

  // --- Comparable cases (30) ---
  for (const c of COMPARABLE_CASES) {
    const existing = await prisma.frameworkComparableCase.findUnique({ where: { caseId: c.caseId } });
    if (existing) {
      console.log(`  Comparable case ${c.caseId} already exists, skip`);
      continue;
    }
    const row = await prisma.frameworkComparableCase.create({
      data: {
        caseId: c.caseId,
        programName: c.programName,
        orgName: c.orgName,
        geography: c.geography,
        targetGroup: c.targetGroup,
        deliveryModelTags: c.deliveryModelTags ?? [],
        outcomesSummary: c.outcomesSummary,
        indicatorsUsed: c.indicatorsUsed ?? [],
        transferabilityBihar: c.transferabilityBihar ?? null,
        confidenceScore: 4,
        status: "validated",
        qualityScore: 75,
      },
    });
    for (const capId of c.capabilitiesPrimary ?? []) {
      const fid = capIds.get(capId);
      if (fid) await prisma.comparableCaseCapability.create({ data: { caseId: row.id, capabilityId: fid, isPrimary: true } });
    }
    for (const capId of c.capabilitiesSecondary ?? []) {
      const fid = capIds.get(capId);
      if (fid) await prisma.comparableCaseCapability.create({ data: { caseId: row.id, capabilityId: fid, isPrimary: false } });
    }
    console.log(`  Comparable case ${c.caseId} (${c.programName}) created`);
  }

  console.log("MVP card library seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
