/**
 * The first four weeks of posts. Three a week, on Tuesday, Thursday and
 * Saturday. Every item is written by hand for every platform, so these weeks
 * contain no generated text. The generator is for later weeks and is off
 * unless SOCIAL_GENERATOR_ENABLED is "true".
 *
 * All twelve are in the practical lane. The Onco Talks videos are left out:
 * their recorded metadata holds a title, audience tags and takeaways that are
 * unreviewed clinical statements, which is too thin to say what a video offers
 * a family without someone watching it first.
 *
 * Every Instagram card is rendered by scripts/render-social-cards.py into
 * apps/landing/public/social/cards/.
 */
import { ContentBrief, Platform, PlatformDraftText } from "../social.types";
import { siteLink, SITE_URL, webChatLink } from "../links";
import {
  HOSPITAL_CHECK, HOSPITAL_REPORT_URL, NCI_RECORDS, NCI_RECORDS_URL, NCI_TALK, NCI_TALK_URL, NCI_TREATMENT_QUESTIONS,
  NCI_TREATMENT_QUESTIONS_URL, PIB_ABHA, PIB_ABHA_URL, PMJAY_ABOUT_URL, PMJAY_CARRY, PMJAY_CHECK, PMJAY_COVER,
  PMJAY_FIND, PMJAY_HELPLINE, PMJAY_LIMITS, PMJAY_OFFICIAL, NHA_URL, RAIL_CONCESSION, RAIL_URL, SENIOR_FAQ_URL,
  SITE_ABOUT_SUCHI, VAY_VANDANA,
} from "./sources";

export interface CalendarItem {
  /** Publication date (Asia/Kolkata), YYYY-MM-DD. */
  date: string;
  brief: ContentBrief;
  card: { file: string; text: string };
  /** Hand-written text. Without it the generator writes the post, if switched on. */
  drafts?: Record<Platform, PlatformDraftText>;
}

export function cardUrl(file: string): string {
  return `${SITE_URL}/social/cards/${file}`;
}

function brief(topicId: string, title: string, angle: string, facts: ContentBrief["facts"], sitePath?: string): ContentBrief {
  return { topicId, lane: "practical", title, angle, facts, nextStep: sitePath ? "site" : "chat", sitePath };
}

type Texts = { linkedin: string; facebook: string; instagram: string; x: string };

/** Adds each platform's next-step link and the Instagram card. */
function posts(b: ContentBrief, card: { file: string; text: string }, t: Texts): Record<Platform, PlatformDraftText> {
  const link = (p: Platform) => (b.sitePath ? siteLink(b.sitePath, p) : webChatLink(p));
  return {
    linkedin: { text: `${t.linkedin}\n${link("linkedin")}` },
    facebook: { text: `${t.facebook}\n${link("facebook")}` },
    instagram: { text: t.instagram, cardText: card.text, imageUrl: cardUrl(card.file) },
    x: { text: `${t.x}\n${link("x")}` },
  };
}

function item(date: string, b: ContentBrief, card: { file: string; text: string }, t: Texts): CalendarItem {
  return { date, brief: b, card, drafts: posts(b, card, t) };
}

export const CALENDAR: CalendarItem[] = [
  item("2026-12-01",
    brief("first-appointment", "Getting ready for a first appointment with a cancer doctor",
      "Questions written down at home, a second person to take notes, papers kept together.", [...NCI_TALK, ...NCI_RECORDS.slice(0, 2)]),
    { file: "first-appointment.jpg", text: "Before the first appointment, write the questions down. Bring someone who can take notes." },
    {
      linkedin: `Before a first appointment with a cancer specialist, sit down at home and write the family's questions on one sheet of paper. Put the most important at the top. Time with the doctor can run out.

Take a family member or friend along. One person listens while the other writes down what the doctor says, or asks whether the conversation may be recorded.

Source: ${NCI_TALK_URL}`,
      facebook: `Before the first visit to a cancer doctor, write the family's questions on one sheet of paper. The most important go at the top, in case the doctor runs out of time.

A family member or friend can come too, to listen and take notes. You can also ask the doctor if the conversation may be recorded on a phone.

Afterwards, keep test results and treatment plans together, with the date of each visit.`,
      instagram: `Write the family's questions on one sheet before the first visit to a cancer doctor, with the most important at the top. Bring a family member or friend to take notes. You can ask if the conversation may be recorded.`,
      x: `Before a first cancer appointment, write the questions down with the most important at the top, and bring a friend or family member who can take notes.`,
    }),

  item("2026-12-03",
    brief("pmjay-check", "Checking whether a family is covered by Ayushman Bharat PM-JAY",
      "What PM-JAY covers and the two ways to check cover.", [PMJAY_COVER, PMJAY_CHECK, PMJAY_HELPLINE, PMJAY_CARRY]),
    { file: "pmjay-check.jpg", text: "Check PM-JAY cover at beneficiary.nha.gov.in or call the helpline, 14555." },
    {
      linkedin: `Ayushman Bharat PM-JAY covers hospital care up to Rs 5 lakh a year for each eligible family, at empanelled public and private hospitals. Whether a family is covered can be checked before anyone goes into hospital.

Log in with a mobile number at beneficiary.nha.gov.in, or call the toll-free helpline, 14555.

Source: ${PMJAY_ABOUT_URL}`,
      facebook: `Ayushman Bharat PM-JAY pays for hospital care up to Rs 5 lakh a year for each eligible family, at empanelled hospitals across India.

To check whether your family is covered, log in with a mobile number at beneficiary.nha.gov.in. Or call 14555, which is toll-free.

At admission, carry a ration card or a government photo ID such as Aadhaar.`,
      instagram: `PM-JAY covers hospital care up to Rs 5 lakh a year for each eligible family, at empanelled hospitals. Check your family's cover with a mobile number at beneficiary.nha.gov.in, or on the toll-free helpline, 14555.`,
      x: `Check whether your family is covered by Ayushman Bharat PM-JAY at beneficiary.nha.gov.in, or call the toll-free helpline, 14555.`,
    }),

  item("2026-12-05",
    brief("treatment-questions", "Practical questions to take to the doctor when treatment is discussed",
      "Practical questions a family can write down before the treatment conversation. Suchi mentioned once, as a plain fact.", [...NCI_TREATMENT_QUESTIONS, NCI_TALK[0], SITE_ABOUT_SUCHI[2]]),
    { file: "treatment-questions.jpg", text: "Questions to ask before treatment. Where will treatment take place? How many sessions?" },
    {
      linkedin: `The practical questions about treatment often come to mind on the way home from the hospital. Where will treatment take place? How many sessions will there be? Can the patient keep working? Will there be a hospital stay, and for how long?

Suchi's web chat can help a family put its questions for the doctor into words. Write them down before the appointment, with the family's own questions below.

Source: ${NCI_TREATMENT_QUESTIONS_URL}`,
      facebook: `After a doctor talks about treatment, the family's practical questions often come later. Where will treatment take place? How many sessions? Will there be a stay in hospital? Can the patient go on working?

Write the questions down and take them to the next appointment.`,
      instagram: `Practical questions about treatment tend to come later, on the way home. Where will treatment take place? How many sessions? Will there be a stay in hospital? Can the patient keep working? Write the questions down before the next appointment.`,
      x: `Before treatment starts, ask where treatment will take place and how many sessions there will be.`,
    }),

  item("2026-12-08",
    brief("hospital-contact", "Check a hospital's own website before travelling",
      "Check the hospital's own contact page before travelling. Say only what SCCF's check found, without counts.", HOSPITAL_CHECK, "/find-care/hospitals/"),
    { file: "hospital-contact.jpg", text: "Before you travel, check the phone number on the hospital's own website." },
    {
      linkedin: `We checked the contact details in Suchi's hospital directory against each hospital's official website, where one could be found. Many needed correcting.

Before travelling for an appointment, open the hospital's own website and call the number on its contact page.

Report: ${HOSPITAL_REPORT_URL}`,
      facebook: `Before travelling to a hospital in another city, open the hospital's own website and call the number on its contact page.

When we checked the contact details in Suchi's hospital directory against official websites, many needed correcting.`,
      instagram: `Before travelling to a hospital in another city, check the phone number on the hospital's own website. When we checked the contact details in Suchi's directory against official websites, many needed correcting.`,
      x: `Before travelling to a hospital, check the phone number on its own website. Many entries in Suchi's directory needed correcting when we checked them against official websites.`,
    }),

  item("2026-12-10",
    brief("vay-vandana", "The Ayushman Vay Vandana card for people aged 70 and over",
      "People aged 70 or over can enrol whatever the family's income. Aadhaar only. Where to enrol and the missed-call number.", [...VAY_VANDANA, PMJAY_COVER]),
    { file: "vay-vandana.jpg", text: "Aged 70 or over, any income. Enrol for the Ayushman Vay Vandana card with Aadhaar." },
    {
      linkedin: `Anyone aged 70 or over can enrol for the Ayushman Vay Vandana card, whatever the family's income. It gives free treatment up to Rs 5 lakh at empanelled hospitals. If the family is already under PM-JAY, the senior gets an extra Rs 5 lakh of their own.

Aadhaar is the only document needed. People enrol at beneficiary.nha.gov.in or in the Ayushman app, and a missed call to 1800110770 brings details of the card.

Source: ${SENIOR_FAQ_URL}`,
      facebook: `If a grandparent is 70 or older, they can enrol for the Ayushman Vay Vandana card, whatever the family earns. The card gives free treatment up to Rs 5 lakh at empanelled hospitals.

Aadhaar is the only document needed. Enrol at beneficiary.nha.gov.in or in the Ayushman app.

A missed call to 1800110770 brings details of the card.`,
      instagram: `People aged 70 or over can enrol for the Ayushman Vay Vandana card, whatever the family's income. Aadhaar is the only document needed. Enrol at beneficiary.nha.gov.in or in the Ayushman app. For details of the card, give a missed call to 1800110770.`,
      x: `People aged 70 or over can enrol for the Ayushman Vay Vandana card whatever their income, with Aadhaar alone. A missed call to 1800110770 brings details.`,
    }),

  item("2026-12-12",
    brief("keep-records", "Keeping medical papers in one place",
      "A simple way for a caregiver to keep results, treatment plans, dates and bills together.", NCI_RECORDS),
    { file: "keep-records.jpg", text: "Keep test results and treatment plans in a folder, with the date written on each." },
    {
      linkedin: `Keep test results and treatment plans together in a folder, with the date of each visit and each test written on them. The bills can go in a separate folder, or a folder for each month.

A list of the medicines the doctor prescribes belongs in the same place.

Source: ${NCI_RECORDS_URL}`,
      facebook: `Keep test results and treatment plans in a folder, and write the date of each visit and test on them. Bills can go in a separate folder for each month.

Add a list of the medicines the doctor has prescribed.`,
      instagram: `Keep test results and treatment plans together in a folder, with the date of each visit written on them. Bills can go in a separate folder for each month. A list of the medicines the doctor prescribes is worth keeping there too.`,
      x: `Keep test results and treatment plans in a folder, with dates, and the bills in a separate folder.`,
    }),

  item("2026-12-15",
    brief("what-suchi-does", "What Suchi can and cannot do",
      "Say plainly what Suchi is for and what it is not. No emergency wording.", SITE_ABOUT_SUCHI),
    { file: "what-suchi-does.jpg", text: "Suchi helps with clear explanations and questions to ask your doctor. Suchi is not a doctor." },
    {
      linkedin: `Suchi gives clear explanations and helps a family prepare questions to ask the doctor. It is a guide to help people learn and prepare.

It is not a diagnostic service, and it cannot prescribe treatment.`,
      facebook: `Suchi explains things clearly and helps a family prepare questions for the doctor. It is a guide to help you learn and prepare.

Suchi is not a doctor and cannot prescribe treatment.`,
      instagram: `Suchi gives clear explanations and helps families prepare questions for the doctor. It is a guide to help you learn and prepare. Suchi is not a doctor and cannot prescribe treatment.`,
      x: `Suchi gives clear explanations and helps you prepare questions for the doctor. Suchi is not a doctor and cannot prescribe treatment.`,
    }),

  item("2026-12-17",
    brief("pmjay-admission", "What to carry for a PM-JAY admission",
      "The documents to carry, and which days around the admission are covered.", [PMJAY_CARRY, PMJAY_LIMITS]),
    { file: "pmjay-admission.jpg", text: "Going into hospital under PM-JAY, carry a ration card or a photo ID such as Aadhaar." },
    {
      linkedin: `For an admission under Ayushman Bharat PM-JAY, carry a ration card or a government photo ID such as Aadhaar. There is no limit on family size or age, and costs from up to 3 days before admission to 15 days after discharge are covered.

Source: ${PMJAY_ABOUT_URL}`,
      facebook: `Going into hospital under Ayushman Bharat PM-JAY, carry a ration card or a government photo ID such as Aadhaar.

Costs from up to 3 days before admission to 15 days after discharge are covered.`,
      instagram: `For a hospital admission under PM-JAY, carry a ration card or a government photo ID such as Aadhaar. Costs from up to 3 days before admission to 15 days after discharge are covered.`,
      x: `For an admission under PM-JAY, carry a ration card or a government photo ID such as Aadhaar.`,
    }),

  item("2026-12-19",
    brief("abha-records", "ABHA and health records",
      "What an ABHA number and address are, and that records are shared only with consent. No advice on whether to create one.", PIB_ABHA),
    { file: "abha-records.jpg", text: "ABHA. Health records on your phone, shared only with your consent." },
    {
      linkedin: `ABHA, the Ayushman Bharat Health Account, gives a person a 14-digit number that identifies them across health care providers in India. With an ABHA address, they can see their health records digitally and share them with a hospital. Records are shared only with the person's consent.

Source: ${PIB_ABHA_URL}`,
      facebook: `With an ABHA address, a person can see their health records digitally and share them with a hospital or clinic. Records are shared only with their consent.`,
      instagram: `With an ABHA address, a person can see their health records digitally and share them with a hospital. Records are shared only with their consent.`,
      x: `With an ABHA address, a person can see their health records on a phone and share them with a hospital. Records are shared only with their consent.`,
    }),

  item("2026-12-22",
    brief("pmjay-hospitals", "Finding a hospital empanelled under PM-JAY",
      "Where to look up empanelled hospitals.", [PMJAY_FIND, PMJAY_COVER]),
    { file: "pmjay-hospitals.jpg", text: "Find PM-JAY hospitals through Find Hospitals on nha.gov.in." },
    {
      linkedin: `PM-JAY works at empanelled public and private hospitals. To find them, use Find Hospitals on nha.gov.in, which leads to a search at hem.nha.gov.in/search.

Source: ${NHA_URL}`,
      facebook: `PM-JAY works at empanelled hospitals, public and private. To see which hospitals are empanelled, open Find Hospitals on nha.gov.in.`,
      instagram: `PM-JAY works at empanelled public and private hospitals. Find Hospitals on nha.gov.in leads to a search of them at hem.nha.gov.in/search.`,
      x: `To find hospitals empanelled under PM-JAY, use Find Hospitals on nha.gov.in.`,
    }),

  item("2026-12-24",
    brief("official-sites", "The only official PM-JAY website, and the warning about fraud",
      "The official website, the warning about fraudulent portals and calls, and the right way to check cover.", [PMJAY_OFFICIAL, PMJAY_CHECK, PMJAY_HELPLINE]),
    { file: "official-sites.jpg", text: "The only official PM-JAY website is nha.gov.in. Helpline 14555." },
    {
      linkedin: `The National Health Authority warns of fraudulent portals and calls about PM-JAY enrolment. Its only official website is nha.gov.in.

A family can check its cover at beneficiary.nha.gov.in or on the toll-free helpline, 14555.

Source: ${NHA_URL}`,
      facebook: `The National Health Authority warns of fraudulent websites and calls about PM-JAY enrolment. The only official website is nha.gov.in.

To check a family's cover, use beneficiary.nha.gov.in or call 14555.`,
      instagram: `The National Health Authority warns of fraudulent websites and calls about PM-JAY enrolment. The only official website is nha.gov.in. To check a family's cover, use beneficiary.nha.gov.in or call 14555.`,
      x: `nha.gov.in is the only official PM-JAY website. The National Health Authority warns of fraudulent portals and calls about enrolment.`,
    }),

  item("2026-12-26",
    brief("rail-concession", "Train fare concession for cancer patients",
      "The railway concession for a cancer patient and one escort, and the certificate it needs.", RAIL_CONCESSION),
    { file: "rail-concession.jpg", text: "Train travel for treatment. A cancer patient and one escort get a fare concession." },
    {
      linkedin: `Indian Railways gives a cancer patient travelling for treatment or a check-up a concession on the basic fare, and one escort gets it too. In sleeper class and AC three-tier the patient pays no basic fare. The usual 300 km minimum distance does not apply.

The concession needs a certificate, so ask about it before booking.

Source: ${RAIL_URL}`,
      facebook: `A cancer patient travelling by train for treatment or a check-up gets a concession on the basic fare, and so does one escort. In sleeper class and AC three-tier the patient pays no basic fare.

The concession needs a certificate, so ask about it before booking.`,
      instagram: `Indian Railways gives a cancer patient travelling for treatment or a check-up a concession on the basic fare, and one escort gets it too. In sleeper class and AC three-tier the patient pays no basic fare. The concession needs a certificate.`,
      x: `A cancer patient travelling by train for treatment gets a concession on the basic fare, and so does one escort. The concession needs a certificate.`,
    }),
];

/** Items due on `date` (YYYY-MM-DD, Asia/Kolkata). */
export function itemsDueOn(date: string): CalendarItem[] {
  return CALENDAR.filter((i) => i.date === date);
}
