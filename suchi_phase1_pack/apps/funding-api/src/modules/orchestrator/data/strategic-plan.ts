/**
 * Diksha Foundation 3-Year Strategic Plan (2025–2028)
 *
 * This is the canonical reference for strategic alignment scoring.
 * The orchestrator compares incoming opportunity themes against these
 * priorities to determine fit and detect strategic gaps.
 *
 * Update this file when the strategic plan is revised.
 */

export interface StrategicPriority {
  id: string;
  priority: string;
  themes: string[];
  capabilities: string[];
  hasExistingProposal: boolean;
  hasFunding: boolean;
  gapAreas: string[];
}

export interface StrategicPlan {
  timeframe: string;
  visionStatement: string;
  strategicPriorities: StrategicPriority[];
  capacityGaps: string[];
  geographicFocus: string[];
}

export const DIKSHA_STRATEGIC_PLAN: StrategicPlan = {
  timeframe: "2025-2028",
  visionStatement:
    "Every child in Bihar has access to holistic education and the opportunity to develop their full potential, regardless of socio-economic background.",
  strategicPriorities: [
    {
      id: "SP-01",
      priority: "Scale KHEL centres to 5 locations by 2027",
      themes: ["education", "expansion", "scale", "holistic learning", "foundational literacy"],
      capabilities: ["C4", "C2", "C9"],
      hasExistingProposal: false,
      hasFunding: false,
      gapAreas: ["new centre establishment", "local partnerships for new geographies"],
    },
    {
      id: "SP-02",
      priority: "Strengthen digital infrastructure and literacy across all centres",
      themes: ["digital literacy", "technology", "ICT", "computer", "innovation", "digital access"],
      capabilities: ["C4", "C6"],
      hasExistingProposal: true,
      hasFunding: true,
      gapAreas: ["advanced digital skills beyond DCA", "career-linked digital pathways"],
    },
    {
      id: "SP-03",
      priority: "Deepen girls' empowerment and agency through Empowering Futures",
      themes: [
        "girls empowerment",
        "gender equality",
        "adolescent girls",
        "leadership",
        "women",
        "agency",
        "life skills",
      ],
      capabilities: ["C7", "C5", "C10"],
      hasExistingProposal: true,
      hasFunding: true,
      gapAreas: ["economic livelihood pathways", "menstrual health integration"],
    },
    {
      id: "SP-04",
      priority: "Establish football-for-development as a structured capability-building pathway",
      themes: ["sports", "football", "physical activity", "grassroots sports", "play", "sport-for-development"],
      capabilities: ["C1", "C7", "C3", "C5"],
      hasExistingProposal: true,
      hasFunding: false,
      gapAreas: ["dedicated sports infrastructure", "coach certification pathway"],
    },
    {
      id: "SP-05",
      priority: "Formalize M&E systems and build evidence base for outcomes",
      themes: [
        "monitoring",
        "evaluation",
        "impact measurement",
        "evidence",
        "data",
        "learning outcomes",
        "assessment",
      ],
      capabilities: ["C4", "C6"],
      hasExistingProposal: false,
      hasFunding: false,
      gapAreas: ["longitudinal outcome tracking", "third-party evaluation"],
    },
    {
      id: "SP-06",
      priority: "Build social-emotional learning (SEL) and mental health capacity",
      themes: [
        "social emotional learning",
        "SEL",
        "SEE Learning",
        "mental health",
        "well-being",
        "resilience",
        "emotional intelligence",
      ],
      capabilities: ["C3", "C5", "C9"],
      hasExistingProposal: false,
      hasFunding: false,
      gapAreas: ["trained SEL facilitators", "community mental health awareness"],
    },
    {
      id: "SP-07",
      priority: "Develop youth leadership pipeline and employability skills",
      themes: [
        "youth",
        "leadership",
        "employability",
        "vocational",
        "skills training",
        "career",
        "young leaders",
      ],
      capabilities: ["C6", "C10", "C4"],
      hasExistingProposal: false,
      hasFunding: false,
      gapAreas: ["structured career counseling", "industry partnerships for placements"],
    },
    {
      id: "SP-08",
      priority: "Strengthen community engagement and parent involvement",
      themes: ["community", "parents", "family", "civic engagement", "inclusive", "diversity", "inclusivity"],
      capabilities: ["C5", "C8", "C10"],
      hasExistingProposal: false,
      hasFunding: false,
      gapAreas: ["parent education programs", "community-led governance structures"],
    },
  ],
  capacityGaps: [
    "M&E systems formalization and longitudinal tracking",
    "Digital infrastructure upgrades (reliable internet, devices) across all centres",
    "Career counseling and employability pathways for 16+ graduates",
    "Trained sports coaches with certified methodology (Football3, etc.)",
    "SEL-trained facilitators across all centres",
    "Parent education and engagement programs",
    "Third-party impact evaluation baseline",
  ],
  geographicFocus: [
    "Patna (urban-poor, peri-urban)",
    "Bihta (rural, Patna district)",
    "Sarairanjan (rural, Samastipur district)",
    "Bihar state — expansion targets",
  ],
};
