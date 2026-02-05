/* eslint-disable no-console */
/**
 * Seed Framework Taxonomy: C1-C10 Capabilities + MI1-MI8 Modalities
 *
 * Usage: npx ts-node src/scripts/seed-framework-taxonomy.ts
 *    or: npm run framework:seed
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CAPABILITIES = [
  {
    capabilityId: "C1",
    name: "Life",
    definitionShort: "Being able to live to the end of a human life of normal length",
    definitionLong:
      "Being able to live to the end of a human life of normal length; not dying prematurely, or before one's life is so reduced as to be not worth living.",
    subdimensions: ["Life expectancy", "Avoiding premature death", "Dignity of life"],
    biharContextExamples: [
      "Child mortality reduction programs",
      "Maternal health interventions",
      "Safe water and sanitation access",
    ],
    measurementIdeas: [
      "Under-5 mortality rate",
      "Life expectancy at birth",
      "Maternal mortality ratio",
      "Premature death rate",
    ],
    ethicsRisks: ["Defining 'normal length'", "Quality vs quantity of life"],
    sourceRefs: [],
  },
  {
    capabilityId: "C2",
    name: "Bodily Health",
    definitionShort: "Being able to have good health, adequate nutrition, shelter",
    definitionLong:
      "Being able to have good health, including reproductive health; to be adequately nourished; to have adequate shelter.",
    subdimensions: ["Physical health", "Nutrition", "Shelter", "Reproductive health"],
    biharContextExamples: [
      "Nutrition programs for women and children",
      "Primary health centre outreach",
      "Housing and sanitation schemes",
    ],
    measurementIdeas: [
      "Stunting/wasting prevalence",
      "Anaemia prevalence",
      "Access to improved water/sanitation",
      "Health facility utilization",
    ],
    ethicsRisks: ["Medicalization of wellbeing", "Privacy in reproductive health"],
    sourceRefs: [],
  },
  {
    capabilityId: "C3",
    name: "Bodily Integrity",
    definitionShort: "Being able to move freely; secure against assault including sexual",
    definitionLong:
      "Being able to move freely from place to place; to be secure against violent assault, including sexual assault and domestic violence; having opportunities for sexual satisfaction and for choice in matters of reproduction.",
    subdimensions: ["Freedom of movement", "Security from violence", "Sexual and reproductive choice"],
    biharContextExamples: [
      "Safe spaces for women and girls",
      "Child protection mechanisms",
      "Legal aid for domestic violence",
    ],
    measurementIdeas: [
      "Incidence of violence (disaggregated)",
      "Access to justice indicators",
      "Freedom of movement (self-report)",
      "Contraceptive use / reproductive choice",
    ],
    ethicsRisks: ["Underreporting", "Stigma", "Safeguarding in data collection"],
    sourceRefs: [],
  },
  {
    capabilityId: "C4",
    name: "Senses, Imagination, Thought",
    definitionShort: "Using senses, imagine, think, reason in a truly human way",
    definitionLong:
      "Being able to use the senses, to imagine, think, and reason—and to do these things in a 'truly human' way, a way informed and cultivated by an adequate education.",
    subdimensions: ["Literacy and numeracy", "Critical thinking", "Imagination", "Aesthetic experience"],
    biharContextExamples: [
      "Quality education and learning outcomes",
      "Arts and culture programs",
      "Media literacy and critical thinking",
    ],
    measurementIdeas: [
      "Learning outcomes (reading, math)",
      "School attendance and completion",
      "Participation in cultural activities",
      "Critical thinking assessments",
    ],
    ethicsRisks: ["Narrow definitions of 'adequate education'", "Cultural bias in assessments"],
    sourceRefs: [],
  },
  {
    capabilityId: "C5",
    name: "Emotions",
    definitionShort: "Being able to have attachments, love, grieve, experience longing",
    definitionLong:
      "Being able to have attachments to things and people outside ourselves; to love those who love and care for us; to grieve at their absence; to experience longing, gratitude, and justified anger.",
    subdimensions: ["Attachment", "Love and care", "Grief and longing", "Emotional expression"],
    biharContextExamples: [
      "Psychosocial support programs",
      "Community care groups",
      "Mental health and wellbeing initiatives",
    ],
    measurementIdeas: [
      "Wellbeing/mental health scales",
      "Social support indicators",
      "Participation in community",
      "Self-reported emotional wellbeing",
    ],
    ethicsRisks: ["Stigma around mental health", "Cross-cultural validity of scales"],
    sourceRefs: [],
  },
  {
    capabilityId: "C6",
    name: "Practical Reason",
    definitionShort: "Being able to form conception of good, engage in critical reflection",
    definitionLong:
      "Being able to form a conception of the good and to engage in critical reflection about the planning of one's life.",
    subdimensions: ["Agency", "Planning and reflection", "Ethical reasoning", "Autonomy"],
    biharContextExamples: [
      "Life skills and decision-making education",
      "Youth leadership programs",
      "Participatory planning with communities",
    ],
    measurementIdeas: [
      "Agency scales",
      "Goal-setting and planning behaviors",
      "Participation in decisions affecting self",
      "Critical reflection (qualitative)",
    ],
    ethicsRisks: ["Individualistic bias", "Imposing external conception of good"],
    sourceRefs: [],
  },
  {
    capabilityId: "C7",
    name: "Affiliation",
    definitionShort: "Live with others, show concern, engage in social interaction",
    definitionLong:
      "Being able to live with and toward others, to recognize and show concern for other human beings, to engage in various forms of social interaction; to be able to imagine the situation of another.",
    subdimensions: ["Social inclusion", "Empathy", "Civic participation", "Respect and non-discrimination"],
    biharContextExamples: [
      "Inclusive education and peer groups",
      "Community dialogue and cohesion",
      "Anti-discrimination and caste/gender equity",
    ],
    measurementIdeas: [
      "Social inclusion indices",
      "Civic participation rates",
      "Attitudes toward others (surveys)",
      "Disaggregated access to services",
    ],
    ethicsRisks: ["Excluding marginalized voices", "Token participation"],
    sourceRefs: [],
  },
  {
    capabilityId: "C8",
    name: "Other Species",
    definitionShort: "Live with concern for animals, plants, nature",
    definitionLong: "Being able to live with concern for and in relation to animals, plants, and the world of nature.",
    subdimensions: ["Environmental awareness", "Care for nature", "Sustainable practices"],
    biharContextExamples: [
      "Environmental education",
      "Sustainable livelihoods",
      "Community forestry and conservation",
    ],
    measurementIdeas: [
      "Environmental knowledge/attitudes",
      "Sustainable practice adoption",
      "Access to natural resources",
      "Biodiversity / ecosystem indicators",
    ],
    ethicsRisks: ["Trade-offs with immediate livelihoods", "Who bears cost of conservation"],
    sourceRefs: [],
  },
  {
    capabilityId: "C9",
    name: "Play",
    definitionShort: "Being able to laugh, play, enjoy recreational activities",
    definitionLong: "Being able to laugh, to play, to enjoy recreational activities.",
    subdimensions: ["Leisure", "Play and recreation", "Joy and humour"],
    biharContextExamples: [
      "Sports and play-based learning",
      "Recreational spaces for children and youth",
      "Cultural and festival participation",
    ],
    measurementIdeas: [
      "Time for play/leisure",
      "Access to recreational spaces",
      "Participation in sports/arts",
      "Self-reported enjoyment",
    ],
    ethicsRisks: ["Trivializing in resource-constrained contexts", "Adult-centric definitions"],
    sourceRefs: [],
  },
  {
    capabilityId: "C10",
    name: "Control over Environment",
    definitionShort: "Political participation, property rights, work dignity",
    definitionLong:
      "Being able to participate effectively in political choices that govern one's life; having the right of political participation, protections of free speech and association; being able to hold property; having the right to seek employment on an equal basis with others.",
    subdimensions: ["Political participation", "Property and assets", "Work and employment", "Freedom of expression"],
    biharContextExamples: [
      "Village council participation",
      "Land rights and women's property",
      "Decent work and fair wages",
      "Collective bargaining",
    ],
    measurementIdeas: [
      "Voter participation",
      "Property ownership (disaggregated)",
      "Employment and wages",
      "Freedom of association",
    ],
    ethicsRisks: ["Formal vs effective participation", "Informal economy visibility"],
    sourceRefs: [],
  },
];

const MI_MODALITIES = [
  {
    miId: "MI1",
    name: "Linguistic",
    definitionShort: "Sensitivity to spoken and written language, ability to learn languages.",
    activitySignals: ["reading", "writing", "storytelling", "word games", "debate", "journaling"],
    assessmentArtifacts: ["essays", "stories", "presentations", "vocabulary assessments"],
    sourceRefs: [],
  },
  {
    miId: "MI2",
    name: "Logical-Mathematical",
    definitionShort: "Capacity for logical reasoning, abstraction, and problem-solving with numbers and patterns.",
    activitySignals: ["problem-solving", "experiments", "puzzles", "patterns", "classification", "hypothesis testing"],
    assessmentArtifacts: ["problem sets", "experiment write-ups", "logic puzzles", "math assessments"],
    sourceRefs: [],
  },
  {
    miId: "MI3",
    name: "Spatial",
    definitionShort: "Ability to perceive and manipulate visual-spatial information.",
    activitySignals: ["drawing", "building", "visualizing", "mapping", "design", "navigation"],
    assessmentArtifacts: ["maps", "diagrams", "models", "visual projects"],
    sourceRefs: [],
  },
  {
    miId: "MI4",
    name: "Musical",
    definitionShort: "Sensitivity to rhythm, melody, pitch, and musical expression.",
    activitySignals: ["rhythm", "melody", "singing", "instruments", "composition", "listening"],
    assessmentArtifacts: ["performances", "compositions", "rhythm assessments", "listening tasks"],
    sourceRefs: [],
  },
  {
    miId: "MI5",
    name: "Bodily-Kinesthetic",
    definitionShort: "Using the body effectively for expression, learning, and problem-solving.",
    activitySignals: ["movement", "hands-on", "sports", "crafts", "dance", "drama"],
    assessmentArtifacts: ["demonstrations", "performances", "physical projects", "skill checklists"],
    sourceRefs: [],
  },
  {
    miId: "MI6",
    name: "Interpersonal",
    definitionShort: "Capacity to understand and interact effectively with others.",
    activitySignals: ["group work", "discussion", "peer teaching", "negotiation", "empathy", "leadership"],
    assessmentArtifacts: ["group projects", "peer feedback", "role-plays", "sociometric measures"],
    sourceRefs: [],
  },
  {
    miId: "MI7",
    name: "Intrapersonal",
    definitionShort: "Self-understanding, reflection, and awareness of one's own strengths and goals.",
    activitySignals: ["reflection", "journaling", "goal-setting", "self-assessment", "mindfulness"],
    assessmentArtifacts: ["journals", "self-assessments", "goal plans", "reflection prompts"],
    sourceRefs: [],
  },
  {
    miId: "MI8",
    name: "Naturalist",
    definitionShort: "Ability to recognize, classify, and draw on patterns in the natural world.",
    activitySignals: ["classification", "observation", "nature exploration", "gardening", "ecology"],
    assessmentArtifacts: ["nature journals", "classification tasks", "field observations", "collections"],
    sourceRefs: [],
  },
];

async function main() {
  console.log("Seeding Framework Taxonomy (C1-C10 + MI1-MI8)...");

  for (const cap of CAPABILITIES) {
    await prisma.frameworkCapability.upsert({
      where: { capabilityId: cap.capabilityId },
      create: cap,
      update: {
        name: cap.name,
        definitionShort: cap.definitionShort,
        definitionLong: cap.definitionLong,
        subdimensions: cap.subdimensions,
        biharContextExamples: cap.biharContextExamples,
        measurementIdeas: cap.measurementIdeas,
        ethicsRisks: cap.ethicsRisks,
        sourceRefs: cap.sourceRefs,
      },
    });
    console.log(`  Capability ${cap.capabilityId} (${cap.name}) upserted`);
  }

  for (const mi of MI_MODALITIES) {
    await prisma.frameworkMI.upsert({
      where: { miId: mi.miId },
      create: mi,
      update: {
        name: mi.name,
        definitionShort: mi.definitionShort,
        activitySignals: mi.activitySignals,
        assessmentArtifacts: mi.assessmentArtifacts,
        sourceRefs: mi.sourceRefs,
      },
    });
    console.log(`  MI ${mi.miId} (${mi.name}) upserted`);
  }

  console.log("Framework taxonomy seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
