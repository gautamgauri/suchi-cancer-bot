/**
 * The first four weeks of posts, in the two lanes that need only the owner's
 * approval. Three posts a week, on Tuesday, Thursday and Saturday.
 *
 * Items 1 to 6 carry hand-written text for every platform, so the owner can
 * judge the voice and the first fortnight does not depend on the model.
 * Items 7 to 12 carry a brief and are written by the generator at run time,
 * through the same gate. Every item has a card image for Instagram, rendered
 * by scripts/render-social-cards.py into apps/landing/public/social/cards/.
 *
 * Nothing in this file is clinical. The clinical lane has no calendar items.
 */
import { ContentBrief, Platform, PlatformDraftText } from "../social.types";
import { siteLink, SITE_URL, webChatLink, whatsappLink } from "../links";
import {
  HOSPITAL_CHECK, HOSPITAL_REPORT_URL, NCI_RECORDS, NCI_TALK, NCI_TREATMENT_QUESTIONS,
  NCI_TREATMENT_QUESTIONS_URL, NIS_HELPLINE, PIB_ABHA, PIB_PMJAY, PIB_PMJAY_URL, SITE_ABOUT_SUCHI,
} from "./sources";
import { episodeBrief, findEpisode } from "./onco-talks";

export interface CalendarItem {
  /** Publication date (Asia/Kolkata), YYYY-MM-DD. */
  date: string;
  brief: ContentBrief;
  card: { file: string; text: string };
  /** Hand-written text, when present. Otherwise the generator writes it. */
  drafts?: Record<Platform, PlatformDraftText>;
}

export function cardUrl(file: string): string {
  return `${SITE_URL}/social/cards/${file}`;
}

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

const firstAppointment: ContentBrief = {
  topicId: "first-appointment",
  lane: "practical",
  title: "Getting ready for a first appointment with a cancer doctor",
  angle: "Practical help for a family before a first visit to a cancer specialist: questions written down, someone to take notes, papers kept together.",
  facts: [...NCI_TALK, ...NCI_RECORDS.slice(0, 2)],
  nextStep: "chat",
};

const pmjay: ContentBrief = {
  topicId: "pmjay-basics",
  lane: "practical",
  title: "Ayushman Bharat PM-JAY and how to check whether a family is covered",
  angle: "What PM-JAY covers, that people aged 70 and above are included, and how to check cover by phone.",
  facts: [...PIB_PMJAY, ...NIS_HELPLINE],
  nextStep: "chat",
};

const treatmentQuestions: ContentBrief = {
  topicId: "treatment-questions",
  lane: "practical",
  title: "Questions to take to the doctor when treatment is discussed",
  angle: "Practical, non-medical questions a family can carry to the conversation about treatment, quoted from the US National Cancer Institute's list.",
  facts: NCI_TREATMENT_QUESTIONS,
  nextStep: "chat",
};

const hospitalContact: ContentBrief = {
  topicId: "hospital-contact",
  lane: "practical",
  title: "Check a hospital's own website before travelling",
  angle: "Why a family should check the hospital's own website for its phone number and address, using what SCCF found when it checked its own directory.",
  facts: HOSPITAL_CHECK,
  sitePath: "/find-care/hospitals/",
  nextStep: "site",
};

const whatSuchiDoes: ContentBrief = {
  topicId: "what-suchi-does",
  lane: "practical",
  title: "What Suchi can and cannot do",
  angle: "Say plainly what Suchi is for (clear explanations and questions to ask the doctor) and what it is not (a doctor, a hospital, a diagnostic service, a prescriber). Repeat the emergency sentence word for word if used.",
  facts: SITE_ABOUT_SUCHI,
  nextStep: "chat",
};

const keepRecords: ContentBrief = {
  topicId: "keep-records",
  lane: "practical",
  title: "Keeping medical papers in one place",
  angle: "A simple way for a caregiver to keep reports, treatment plans, dates and bills together, from the US National Cancer Institute's advice.",
  facts: NCI_RECORDS,
  nextStep: "whatsapp",
};

const abha: ContentBrief = {
  topicId: "abha-records",
  lane: "practical",
  title: "ABHA, the Ayushman Bharat Health Account, and health records",
  angle: "What an ABHA number and ABHA address are, and that records are shared only with the person's consent. No advice on whether to create one.",
  facts: PIB_ABHA,
  nextStep: "chat",
};

const pmjaySeniors: ContentBrief = {
  topicId: "pmjay-70-plus",
  lane: "practical",
  title: "PM-JAY cover for people aged 70 and above",
  angle: "Tell families that people aged 70 and above are covered whatever their income, that they receive an Ayushman Vay Vandana card, and how to check cover by phone.",
  facts: [...PIB_PMJAY, ...NIS_HELPLINE],
  nextStep: "whatsapp",
};

// ---------------------------------------------------------------------------
// Hand-written posts (items 1 to 6)
// ---------------------------------------------------------------------------

const ep1 = episodeBrief(findEpisode(1));
const ep3 = episodeBrief(findEpisode(3));
const ep5 = episodeBrief(findEpisode(5));
const ep8 = episodeBrief(findEpisode(8));

function drafts1(): Record<Platform, PlatformDraftText> {
  return {
    linkedin: {
      text: `A first visit to a cancer specialist often goes quickly. It is easy to come home having forgotten half of what was said.

The US National Cancer Institute has simple advice for this. Write the questions down before the visit and carry the list. Put the most important ones first, in case the doctor runs out of time. A family member or friend can come along to listen and take notes, and you can ask whether the conversation may be recorded.

Afterwards, keep copies of test results and treatment plans together, with the date of each visit and test.

Hospital staff and community health workers can pass this on to families before a first appointment. Suchi can help a family put its own list of questions together.

${webChatLink("linkedin")}`,
    },
    facebook: {
      text: `Before a first visit to a cancer doctor, sit down at home and write the family's questions on one sheet of paper. Put the most important ones at the top, because time with the doctor can run short.

Take someone along. One person can listen while the other writes down what the doctor says. You can also ask the doctor whether you may record the conversation on a phone.

Keep copies of test results and treatment plans in one place, and write down the date of each visit and test.

This advice comes from the US National Cancer Institute. Suchi can help you make the list of questions if you send a message on WhatsApp.
${whatsappLink("facebook")}`,
    },
    instagram: {
      text: `A first visit to a cancer doctor can go by quickly. It helps to write the family's questions down at home and put the most important ones first. Someone who comes along can take notes while the doctor talks, and you can ask whether the conversation may be recorded.

This advice is from the US National Cancer Institute. Suchi can help you prepare the list, and the link is in our profile.

#CancerCare #Caregivers`,
      cardText: "Before a first cancer appointment, write the questions down. Bring someone who can take notes.",
      imageUrl: cardUrl("first-appointment.jpg"),
    },
    x: {
      text: `Before a first cancer appointment, write the questions down and put the most important first. Bring someone who can take notes. This is advice from the US National Cancer Institute, and Suchi can help you make the list.
${webChatLink("x")}`,
    },
  };
}

function drafts2(): Record<Platform, PlatformDraftText> {
  const path = ep1.sitePath!;
  return {
    linkedin: {
      text: `Onco Talks is our video series in which oncologists speak about cancer. Episode 1 is about oral cancer.

The episode is listed for patients and caregivers, and for members of the public who want to learn about the subject. People who run health camps or train community health workers may find it useful to show.

${siteLink(path, "linkedin")}`,
    },
    facebook: {
      text: `In the first episode of Onco Talks, an oncologist speaks about oral cancer. The video is meant for patients and their families, and for anyone else who wants to learn about it.

You can watch it on our website. If it leaves your family with questions, Suchi is there on WhatsApp and in the web chat.
${siteLink(path, "facebook")}`,
    },
    instagram: {
      text: `Episode 1 of Onco Talks is about oral cancer. An oncologist speaks, and the video is meant for patients and families, and for anyone else who wants to learn. The link to our videos is in our profile.

#OncoTalks #OralCancer`,
      cardText: "Onco Talks, Episode 1. An oncologist speaks about oral cancer.",
      imageUrl: cardUrl("onco-talks-1.jpg"),
    },
    x: {
      text: `In episode 1 of Onco Talks, an oncologist speaks about oral cancer. The video is for patients and families, and for anyone who wants to learn.
${siteLink(path, "x")}`,
    },
  };
}

function drafts3(): Record<Platform, PlatformDraftText> {
  return {
    linkedin: {
      text: `Ayushman Bharat PM-JAY gives eligible families health cover of Rs 5 lakh a year for hospital care. The Ministry of Health and Family Welfare reported in March 2026 that 36,229 hospitals had joined the scheme, 19,483 of them public and 16,746 private.

The scheme now also covers people aged 70 and above, whatever their income.

Families who are unsure whether they are covered can call the national helpline on 14555. Hospital social workers and community health workers are well placed to pass the number on.

Source: ${PIB_PMJAY_URL}
Suchi can explain how the scheme works in plain language. ${webChatLink("linkedin")}`,
    },
    facebook: {
      text: `Ayushman Bharat PM-JAY is a government scheme that gives eligible families health cover of up to Rs 5 lakh a year for hospital care. It works in government hospitals and in private hospitals that are part of the scheme.

People aged 70 and above are now covered too, whatever the family's income.

To find out whether your family is covered, call the helpline on 14555.

Source: ${PIB_PMJAY_URL}
Suchi can explain the scheme on WhatsApp. ${whatsappLink("facebook")}`,
    },
    instagram: {
      text: `Ayushman Bharat PM-JAY gives eligible families health cover of up to Rs 5 lakh a year for hospital care, in government hospitals and in private hospitals that are part of the scheme. People aged 70 and above are covered whatever their income. To find out whether your family is covered, call 14555.

The figures are from the Press Information Bureau, March 2026. Suchi can explain more, and the link is in our profile.

#AyushmanBharat #PMJAY`,
      cardText: "Ayushman Bharat PM-JAY. Health cover of up to Rs 5 lakh a year for eligible families. Helpline 14555.",
      imageUrl: cardUrl("pmjay-basics.jpg"),
    },
    x: {
      text: `Ayushman Bharat PM-JAY gives eligible families health cover of up to Rs 5 lakh a year for hospital care. Call 14555 to check whether your family is covered. Source ${PIB_PMJAY_URL}
Suchi can explain more ${webChatLink("x")}`,
    },
  };
}

function drafts4(): Record<Platform, PlatformDraftText> {
  return {
    linkedin: {
      text: `When a doctor first talks about treatment, many questions only come to mind later. The US National Cancer Institute publishes a list of questions people can take into that conversation. Some of the practical ones are below.

Where will I go for treatment?
How many treatment sessions will I have?
Should a family member or friend come with me to my treatment sessions?
Will I be able to work?

Patients and families can add their own questions under these and take the sheet to the appointment. Suchi can help with that.

Source: ${NCI_TREATMENT_QUESTIONS_URL}
${webChatLink("linkedin")}`,
    },
    facebook: {
      text: `When the doctor talks about treatment, it helps to have questions ready. The US National Cancer Institute suggests questions such as these.

Where will I go for treatment?
How many treatment sessions will I have?
Should a family member or friend come with me to my treatment sessions?
Will I be able to work?

Add your own questions below these and take the paper with you. Suchi can help you think of them on WhatsApp.
${whatsappLink("facebook")}`,
    },
    instagram: {
      text: `When the doctor talks about treatment, it helps to have questions ready. The US National Cancer Institute suggests asking where treatment will happen and how many sessions there will be. Add your own questions and take the list with you.

Suchi can help, and the link is in our profile.

#CancerCare #Caregivers`,
      cardText: "Questions to take to the doctor. Where will I go for treatment? How many sessions will I have?",
      imageUrl: cardUrl("treatment-questions.jpg"),
    },
    x: {
      text: `Before treatment starts, it helps to ask where it will happen and how many sessions there will be. The US National Cancer Institute keeps a longer list of questions, and Suchi can help you write yours.
${webChatLink("x")}`,
    },
  };
}

function drafts5(): Record<Platform, PlatformDraftText> {
  const path = ep5.sitePath!;
  return {
    linkedin: {
      text: `Episode 5 of Onco Talks is about childhood cancer. An oncologist speaks, and the episode is meant for parents and others who care for a child.

School counsellors and parent support groups may want to keep the link for families who ask.

${siteLink(path, "linkedin")}`,
    },
    facebook: {
      text: `The fifth episode of Onco Talks is about childhood cancer. An oncologist speaks, and the video is meant for parents and others who look after a child.

You can watch it on our website. If questions come up afterwards, Suchi is on WhatsApp.
${siteLink(path, "facebook")}`,
    },
    instagram: {
      text: `Episode 5 of Onco Talks is about childhood cancer. An oncologist speaks, and the episode is meant for parents and others who care for a child. The link to our videos is in our profile.

#OncoTalks #ChildhoodCancer`,
      cardText: "Onco Talks, Episode 5. An oncologist speaks about childhood cancer, for parents and caregivers.",
      imageUrl: cardUrl("onco-talks-5.jpg"),
    },
    x: {
      text: `In episode 5 of Onco Talks, an oncologist speaks about childhood cancer. It is meant for parents and others who care for a child.
${siteLink(path, "x")}`,
    },
  };
}

function drafts6(): Record<Platform, PlatformDraftText> {
  const path = hospitalContact.sitePath!;
  return {
    linkedin: {
      text: `In November 2026 we checked all 83 entries in Suchi's hospital directory against each hospital's own website. We changed 77 details across 54 entries so that they match the official sites.

A family may travel a long way on the strength of a phone number or an address. Before setting out, it helps to open the hospital's own website and find its contact page. Our directory links to that site wherever we found one.

The full report is public. ${HOSPITAL_REPORT_URL}
${siteLink(path, "linkedin")}`,
    },
    facebook: {
      text: `Before travelling to a hospital in another city, check its phone number and address on the hospital's own website. In November 2026 we checked all 83 hospitals in Suchi's directory this way and had to change 77 details across 54 of them.

Our directory links to each hospital's own website where we found one.
${siteLink(path, "facebook")}`,
    },
    instagram: {
      text: `Before travelling to a hospital in another city, check its phone number and address on the hospital's own website. When we checked the 83 hospitals in Suchi's directory in November 2026, 54 needed at least one change. The link to the directory is in our profile.

#CancerCare #Caregivers`,
      cardText: "Before you travel, check the hospital's own website for its phone number and address.",
      imageUrl: cardUrl("hospital-contact.jpg"),
    },
    x: {
      text: `We checked the 83 hospitals in Suchi's directory against their own websites and changed 77 details in 54 entries. Before travelling, check the hospital's own contact page. ${HOSPITAL_REPORT_URL}
${siteLink(path, "x")}`,
    },
  };
}

// ---------------------------------------------------------------------------
// The calendar
// ---------------------------------------------------------------------------

export const CALENDAR: CalendarItem[] = [
  { date: "2026-12-01", brief: firstAppointment, card: { file: "first-appointment.jpg", text: "Before a first cancer appointment, write the questions down. Bring someone who can take notes." }, drafts: drafts1() },
  { date: "2026-12-03", brief: ep1, card: { file: "onco-talks-1.jpg", text: "Onco Talks, Episode 1. An oncologist speaks about oral cancer." }, drafts: drafts2() },
  { date: "2026-12-05", brief: pmjay, card: { file: "pmjay-basics.jpg", text: "Ayushman Bharat PM-JAY. Health cover of up to Rs 5 lakh a year for eligible families. Helpline 14555." }, drafts: drafts3() },
  { date: "2026-12-08", brief: treatmentQuestions, card: { file: "treatment-questions.jpg", text: "Questions to take to the doctor. Where will I go for treatment? How many sessions will I have?" }, drafts: drafts4() },
  { date: "2026-12-10", brief: ep5, card: { file: "onco-talks-5.jpg", text: "Onco Talks, Episode 5. An oncologist speaks about childhood cancer, for parents and caregivers." }, drafts: drafts5() },
  { date: "2026-12-12", brief: hospitalContact, card: { file: "hospital-contact.jpg", text: "Before you travel, check the hospital's own website for its phone number and address." }, drafts: drafts6() },
  { date: "2026-12-15", brief: whatSuchiDoes, card: { file: "what-suchi-does.jpg", text: "Suchi helps with clear explanations and questions to ask your doctor. Suchi is not a doctor." } },
  { date: "2026-12-17", brief: ep3, card: { file: "onco-talks-3.jpg", text: "Onco Talks, Episode 3. An oncologist speaks about cancer surgery." } },
  { date: "2026-12-19", brief: keepRecords, card: { file: "keep-records.jpg", text: "Keep medical papers and bills in one folder, with the date written on each." } },
  { date: "2026-12-22", brief: abha, card: { file: "abha-records.jpg", text: "ABHA, the Ayushman Bharat Health Account. Health records shared only with your consent." } },
  { date: "2026-12-24", brief: ep8, card: { file: "onco-talks-8.jpg", text: "Onco Talks, Episode 8. An oncologist speaks about lung cancer and head and neck cancers." } },
  { date: "2026-12-26", brief: pmjaySeniors, card: { file: "pmjay-70-plus.jpg", text: "PM-JAY covers people aged 70 and above, whatever their income. Helpline 14555." } },
];

/** Items due on `date` (YYYY-MM-DD, Asia/Kolkata). */
export function itemsDueOn(date: string): CalendarItem[] {
  return CALENDAR.filter((i) => i.date === date);
}
