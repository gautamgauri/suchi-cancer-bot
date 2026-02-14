/**
 * Seed script for ProgramActivity table.
 * Run with: npx ts-node prisma/seeds/program-activities.seed.ts
 *
 * These are Diksha Foundation's core activities — the "source of truth"
 * that the proposal generator queries when matching funder themes.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ACTIVITIES = [
  {
    activityId: "sports_football",
    programArea: "sports",
    activityName: "Football training",
    description:
      "Structured football coaching sessions for children at KHEL centers. Saturday football at Patna, regular sessions at Bihta and Sarairanjan. Builds teamwork, discipline, physical fitness, and attendance motivation. Football is the primary sport across all three centers and a key engagement tool for holistic education.",
    centers: ["KHEL Patna", "KHEL Bihta", "KHEL Sarairanjan"],
    targetGroup: "476 students ages 6-18 across 3 centers",
    frequency: "3x/week (Patna: Saturday focus; Bihta & Sarairanjan: weekday sessions)",
    assetsNeeded: ["footballs", "cones", "training bibs", "goalposts", "first aid kits", "sports shoes"],
    unitCostINR: 800,
    costBreakdown: "Footballs: 20 x ₹800 = ₹16,000; Cones: 40 x ₹150 = ₹6,000; Bibs: 60 x ₹200 = ₹12,000; Goalposts: 3 pairs x ₹8,000 = ₹24,000; First aid: 3 x ₹2,000 = ₹6,000",
    outcomes: ["improved attendance", "teamwork and leadership skills", "physical fitness", "reduced dropout rates", "social-emotional development"],
    indicators: ["attendance rate on sports days vs non-sports days", "dropout rate", "teamwork rubric score", "student self-reported wellbeing"],
    evidenceTypes: ["attendance registers", "photos", "match reports", "student testimonials", "coach observation logs"],
    staffInvolved: ["Fellow Teachers", "Sports Coach (part-time)", "Center Coordinators"],
    orgId: "diksha",
  },
  {
    activityId: "sports_volleyball",
    programArea: "sports",
    activityName: "Volleyball and badminton",
    description:
      "Indoor and outdoor sports at KHEL Bihta including volleyball and badminton. Inclusive design ensures participation of girls and younger children.",
    centers: ["KHEL Bihta"],
    targetGroup: "150 students ages 8-16",
    frequency: "2x/week",
    assetsNeeded: ["volleyball net", "volleyballs", "badminton rackets", "shuttlecocks"],
    unitCostINR: 500,
    costBreakdown: "Volleyball net: ₹3,000; Volleyballs: 6 x ₹500 = ₹3,000; Badminton sets: 10 x ₹600 = ₹6,000; Shuttlecocks: ₹2,000",
    outcomes: ["inclusion of girls in sports", "motor skills development", "peer interaction"],
    indicators: ["girls participation rate", "skill assessment scores"],
    evidenceTypes: ["attendance logs", "photos", "participation records"],
    staffInvolved: ["Fellow Teachers"],
    orgId: "diksha",
  },
  {
    activityId: "sports_tournaments",
    programArea: "sports",
    activityName: "Inter-center tournaments and leagues",
    description:
      "Quarterly inter-center sports tournaments bringing students from all three KHEL centers together. Includes football matches, relay races, and team events. Builds community identity and provides competitive experience.",
    centers: ["KHEL Patna", "KHEL Bihta", "KHEL Sarairanjan"],
    targetGroup: "200+ students per event",
    frequency: "Quarterly (4x/year)",
    assetsNeeded: ["trophies", "medals", "transport", "refreshments", "banners"],
    unitCostINR: 15000,
    costBreakdown: "Transport: ₹8,000/event; Trophies/medals: ₹3,000; Refreshments: ₹4,000; Total per event: ~₹15,000; Annual: ₹60,000",
    outcomes: ["cross-center bonding", "competitive spirit", "community visibility", "parent engagement"],
    indicators: ["student participation rate", "parent attendance at events", "repeat participation"],
    evidenceTypes: ["event photos", "participation sheets", "parent feedback forms"],
    staffInvolved: ["Center Coordinators", "Fellow Teachers", "Project Lead"],
    orgId: "diksha",
  },
  {
    activityId: "education_academic",
    programArea: "education",
    activityName: "Academic support (Hindi, English, Math)",
    description:
      "Supplementary academic support in Hindi, English, and Mathematics for children attending government schools. Uses activity-based learning methods, peer tutoring, and structured lesson plans aligned to state curriculum.",
    centers: ["KHEL Patna", "KHEL Bihta", "KHEL Sarairanjan"],
    targetGroup: "476 students ages 6-14",
    frequency: "5x/week (Tue-Sat), 2 hours/day",
    assetsNeeded: ["textbooks", "workbooks", "stationery kits", "whiteboards", "teaching aids"],
    unitCostINR: 300,
    costBreakdown: "Stationery kit per student: ₹300 x 476 = ₹1,42,800; Workbooks: ₹150 x 476 = ₹71,400; Teaching aids: ₹20,000/center x 3 = ₹60,000",
    outcomes: ["grade-level competency improvement", "reading fluency", "numeracy skills"],
    indicators: ["% students at grade-level reading", "% students at grade-level math", "baseline-midline-endline scores"],
    evidenceTypes: ["assessment scorecards", "Khan Academy progress reports", "pen-and-paper test results"],
    staffInvolved: ["Fellow Teachers (8)", "Center Coordinators (3)"],
    orgId: "diksha",
  },
  {
    activityId: "digital_khan_academy",
    programArea: "digital",
    activityName: "Khan Academy digital learning",
    description:
      "Computer lab sessions using Khan Academy for self-paced learning in math, science, and English. Tablets and desktops available at all three centers. Progress tracked via Khan Academy teacher dashboard.",
    centers: ["KHEL Patna", "KHEL Bihta", "KHEL Sarairanjan"],
    targetGroup: "300+ students ages 8-16",
    frequency: "3x/week, 1 hour/session",
    assetsNeeded: ["tablets", "desktops", "internet connectivity", "Khan Academy accounts"],
    unitCostINR: 12000,
    costBreakdown: "Internet: ₹2,000/month x 3 centers x 12 months = ₹72,000; Device maintenance: ₹3,000/center/year = ₹9,000; Electricity: included in infrastructure",
    outcomes: ["self-paced learning habits", "improved math and science scores", "digital literacy"],
    indicators: ["Khan Academy mastery points", "time-on-task", "modules completed per student"],
    evidenceTypes: ["Khan Academy dashboard exports", "screen time logs", "student progress reports"],
    staffInvolved: ["Fellow Teachers", "IT volunteer"],
    orgId: "diksha",
  },
  {
    activityId: "digital_dca",
    programArea: "digital",
    activityName: "DCA diploma computer course",
    description:
      "Diploma in Computer Applications (DCA) for older students and youth. Covers MS Office, typing, internet skills, and basic programming. Provides a formal certification pathway.",
    centers: ["KHEL Patna"],
    targetGroup: "30-40 youth ages 16-22",
    frequency: "4x/week, 2 hours/session",
    assetsNeeded: ["desktops", "DCA curriculum materials", "certification fees"],
    unitCostINR: 3000,
    costBreakdown: "Per student certification: ₹3,000 x 35 students = ₹1,05,000",
    outcomes: ["formal digital certification", "employability", "computer proficiency"],
    indicators: ["DCA pass rate", "employment/further education after certification"],
    evidenceTypes: ["certificates", "enrollment records", "placement tracking"],
    staffInvolved: ["Computer Instructor", "Center Coordinator"],
    orgId: "diksha",
  },
  {
    activityId: "life_skills_see_learning",
    programArea: "life_skills",
    activityName: "SEE Learning (Social, Emotional, Ethical Learning)",
    description:
      "Emory University / Dalai Lama Trust SEE Learning curriculum delivered across all three KHEL centers. Builds self-awareness, empathy, resilience, and ethical reasoning. Integrated into daily schedule as dedicated sessions.",
    centers: ["KHEL Patna", "KHEL Bihta", "KHEL Sarairanjan"],
    targetGroup: "476 students ages 6-18",
    frequency: "2x/week, 45 min/session",
    assetsNeeded: ["SEE Learning facilitator guides", "activity materials", "circle time space"],
    unitCostINR: 500,
    costBreakdown: "Facilitator training: ₹15,000 (annual); Materials per center: ₹5,000 x 3 = ₹15,000",
    outcomes: ["emotional regulation", "empathy", "conflict resolution skills", "prosocial behavior"],
    indicators: ["SEE Learning pre-post assessment", "teacher-reported behavior change", "peer conflict frequency"],
    evidenceTypes: ["SEE assessment scores", "teacher observation forms", "student journals"],
    staffInvolved: ["Fellow Teachers (trained in SEE Learning)"],
    orgId: "diksha",
  },
  {
    activityId: "civic_bal_sansad",
    programArea: "civic",
    activityName: "Bal Sansad (Children's Parliament)",
    description:
      "Student-led governance body at KHEL Sarairanjan. Children elect representatives, discuss community issues, propose solutions, and practice democratic decision-making. Includes debate, public speaking, and quiz competitions.",
    centers: ["KHEL Sarairanjan"],
    targetGroup: "179 students ages 10-16",
    frequency: "Weekly meetings + monthly assemblies",
    assetsNeeded: ["meeting space", "registers", "stationery", "event supplies"],
    unitCostINR: 200,
    costBreakdown: "Annual materials: ₹5,000; Event costs: ₹2,000/event x 12 = ₹24,000",
    outcomes: ["civic awareness", "public speaking confidence", "leadership skills", "community participation"],
    indicators: ["student participation rate", "issues raised and resolved", "parent awareness of Bal Sansad"],
    evidenceTypes: ["meeting minutes", "photos", "student presentations", "parent survey"],
    staffInvolved: ["Center Coordinator", "Fellow Teachers"],
    orgId: "diksha",
  },
  {
    activityId: "education_steam",
    programArea: "education",
    activityName: "STEAM club and creative arts",
    description:
      "Science, Technology, Engineering, Arts, and Mathematics club activities including hands-on experiments, art projects, theater, and creative writing. Runs as after-school enrichment at all centers.",
    centers: ["KHEL Patna", "KHEL Bihta", "KHEL Sarairanjan"],
    targetGroup: "200+ students ages 8-16",
    frequency: "2x/week",
    assetsNeeded: ["science kits", "art supplies", "craft materials", "display boards"],
    unitCostINR: 400,
    costBreakdown: "Science kits: 3 x ₹10,000 = ₹30,000; Art supplies: ₹5,000/center/quarter x 3 x 4 = ₹60,000",
    outcomes: ["scientific thinking", "creativity", "problem-solving", "self-expression"],
    indicators: ["project completion rate", "exhibition participation", "student interest surveys"],
    evidenceTypes: ["project photos", "exhibition records", "student work portfolios"],
    staffInvolved: ["Fellow Teachers", "Volunteer facilitators"],
    orgId: "diksha",
  },
  {
    activityId: "sports_coaching_training",
    programArea: "sports",
    activityName: "Coach and Fellow Teacher sports training",
    description:
      "Capacity building for Fellow Teachers and part-time coaches in sports pedagogy, child safeguarding during sports, inclusive sports design, and basic sports science. Ensures quality and safety of all sports programming.",
    centers: ["KHEL Patna", "KHEL Bihta", "KHEL Sarairanjan"],
    targetGroup: "8 Fellow Teachers + 2 part-time coaches",
    frequency: "Quarterly training workshops (4x/year)",
    assetsNeeded: ["training venue", "resource materials", "external trainer fees"],
    unitCostINR: 10000,
    costBreakdown: "External trainer: ₹10,000/session x 4 = ₹40,000; Materials: ₹5,000; Venue: ₹5,000",
    outcomes: ["improved coaching quality", "child safety compliance", "inclusive sports methods"],
    indicators: ["training attendance", "post-training assessment scores", "coaching observation rubric"],
    evidenceTypes: ["training attendance sheets", "pre-post assessments", "observation reports"],
    staffInvolved: ["Project Lead", "External Sports Trainer"],
    orgId: "diksha",
  },
];

async function main() {
  console.log("Seeding ProgramActivity table...");

  for (const activity of ACTIVITIES) {
    await prisma.programActivity.upsert({
      where: { activityId: activity.activityId },
      update: activity,
      create: activity,
    });
    console.log(`  ✓ ${activity.activityId}: ${activity.activityName}`);
  }

  console.log(`\nSeeded ${ACTIVITIES.length} program activities.`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
