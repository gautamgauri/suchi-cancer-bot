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
 * Posts speak to a relative or carer ("you", "your family", "the person you
 * care for") and never call the reader a patient. Every link is preceded by a
 * few plain words saying what it is, worded differently from post to post.
 *
 * Every Instagram card is rendered by scripts/render-social-cards.py into
 * apps/landing/public/social/cards/.
 */
import { ContentBrief, Platform, PlatformDraftText } from "../social.types";
import { siteLink, SITE_URL, webChatLink } from "../links";
import {
  HOSPITAL_CHECK, HOSPITAL_REPORT_URL, NCI_RECORDS, NCI_RECORDS_URL, NCI_TALK, NCI_TALK_URL, NCI_TREATMENT_QUESTIONS,
  NCI_TREATMENT_QUESTIONS_URL, PIB_ABHA, PIB_ABHA_URL, PMJAY_ABOUT_URL, PMJAY_CARRY, PMJAY_CHECK, PMJAY_COVER,
  PMJAY_FIND, PMJAY_FIND_SPECIALITY, PMJAY_HELPLINE, PMJAY_LIMITS, PMJAY_OFFICIAL, PMJAY_OFFICIAL_HOSTS, PMJAY_SCOPE,
  NHA_URL, RAIL_CONCESSION, RAIL_URL, SENIOR_FAQ_URL, SITE_ABOUT_SUCHI, SUCHI_CHAT, VAY_VANDANA,
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

type Texts = {
  linkedin: string;
  facebook: string;
  instagram: string;
  x: string;
  /** The plain words just before the link on LinkedIn, Facebook and X. */
  lead: string;
  /** A shorter lead for X, where the lead does not fit. */
  xLead?: string;
};

/** Adds each platform's lead and next-step link, and the Instagram card. */
function posts(b: ContentBrief, card: { file: string; text: string }, t: Texts): Record<Platform, PlatformDraftText> {
  const link = (p: Platform) => (b.sitePath ? siteLink(b.sitePath, p) : webChatLink(p));
  return {
    linkedin: { text: `${t.linkedin}\n\n${t.lead}\n${link("linkedin")}` },
    facebook: { text: `${t.facebook}\n\n${t.lead}\n${link("facebook")}` },
    instagram: { text: t.instagram, cardText: card.text, imageUrl: cardUrl(card.file) },
    x: { text: `${t.x}\n${t.xLead ?? t.lead}\n${link("x")}` },
  };
}

function item(date: string, b: ContentBrief, card: { file: string; text: string }, t: Texts): CalendarItem {
  return { date, brief: b, card, drafts: posts(b, card, t) };
}

export const CALENDAR: CalendarItem[] = [
  item("2026-12-01",
    brief("first-appointment", "Getting ready for a first appointment with a cancer doctor",
      "Questions written down at home, a second person to take notes, papers kept together.", [...NCI_TALK, ...NCI_RECORDS.slice(0, 2), ...SUCHI_CHAT]),
    { file: "first-appointment.jpg", text: "Before the first appointment, write the questions down. Bring someone who can take notes." },
    {
      linkedin: `If you are going with a parent or partner to a first appointment with a cancer specialist, write your questions down at home on one sheet of paper. Put the most important at the top. Time with the doctor can run out.

Take another family member or a friend along too. While you talk with the doctor, they can listen and write down what is said. You can also ask the doctor whether you may record the conversation on your phone.

Source: ${NCI_TALK_URL}`,
      facebook: `When you go with a parent or partner to a first visit to a cancer doctor, write your questions on one sheet of paper beforehand. Put the most important at the top, in case the doctor runs out of time.

Bring another family member or a friend if you can. They can listen and take notes while you talk. You can also ask the doctor if you may record the conversation on your phone.

Afterwards, keep the test results and treatment plans together, with the date of each visit written on them.`,
      instagram: `Before you go with a parent or partner to a first visit to a cancer doctor, write your questions on one sheet, with the most important at the top. Bring a friend or relative who can take notes. You can ask the doctor if you may record the conversation.`,
      x: `Before a first cancer appointment, write your questions on one sheet with the most important at the top, in case time runs out. Bring a friend or relative who can take notes.`,
      lead: "If you are not sure what to ask, our free chat can suggest questions for the doctor.",
      xLead: "If you are not sure what to ask, our free chat can suggest questions.",
    }),

  item("2026-12-03",
    brief("pmjay-check", "Checking whether a family is covered by Ayushman Bharat PM-JAY",
      "What PM-JAY covers and the two ways to check cover.", [PMJAY_COVER, PMJAY_SCOPE, PMJAY_CHECK, PMJAY_HELPLINE, ...SUCHI_CHAT]),
    { file: "pmjay-check.jpg", text: "Check your family's PM-JAY cover at beneficiary.nha.gov.in or call the helpline, 14555." },
    {
      linkedin: `Ayushman Bharat PM-JAY pays for hospital care up to Rs 5 lakh a year for each eligible family, at public and private hospitals on the PM-JAY list. It covers admission to hospital for the conditions and procedures on its list..

You can check whether your family is covered before anyone needs a hospital. Log in with your mobile number at beneficiary.nha.gov.in, or call the toll-free helpline, 14555.

Source: ${PMJAY_ABOUT_URL}`,
      facebook: `Ayushman Bharat PM-JAY pays up to Rs 5 lakh a year for each eligible family when someone is admitted to hospital for a condition on the scheme's list..

To check whether your family is covered, log in with your mobile number at beneficiary.nha.gov.in. Or call 14555, which is toll-free.`,
      instagram: `PM-JAY pays up to Rs 5 lakh a year for each eligible family when someone is admitted to hospital for a condition on the scheme's list.. Check your family's cover with your mobile number at beneficiary.nha.gov.in, or call the toll-free helpline, 14555.`,
      x: `PM-JAY covers hospital admission for the conditions on its list, up to Rs 5 lakh a year for each eligible family.. Check your family's cover at beneficiary.nha.gov.in or call 14555.`,
      lead: "Questions about any of this can go to our free cancer information chat.",
      xLead: "Questions? Try our free chat.",
    }),

  item("2026-12-05",
    brief("treatment-questions", "Practical questions to take to the doctor when treatment is discussed",
      "Practical questions a family can write down before the treatment conversation, and why to ask the most important first.", [...NCI_TREATMENT_QUESTIONS, NCI_TALK[0], NCI_TALK[1], ...SUCHI_CHAT]),
    { file: "treatment-questions.jpg", text: "Questions to ask before treatment. Where will treatment take place? How many sessions?" },
    {
      linkedin: `Practical questions about treatment often come to mind later, on the way home from the hospital. Where will treatment take place? How many sessions will there be? Can the person you are caring for keep working? Will there be a hospital stay, and for how long?

Write these on one sheet before the next appointment, and add your own questions underneath. Ask the most important first, in case the doctor runs out of time.

Source: ${NCI_TREATMENT_QUESTIONS_URL}`,
      facebook: `When a doctor talks about treatment, the practical questions often come to mind later. Where will treatment take place? How many sessions will there be? Will there be a stay in hospital? Can the person you are caring for go on working?

Write them down as they come, and take the sheet to the next appointment. Put the most important at the top, in case the doctor runs out of time.`,
      instagram: `Practical questions about treatment tend to come later, on the way home. Where will treatment take place? How many sessions? Will there be a stay in hospital? Can the person you are caring for keep working? Write them down and take them to the next appointment, with the most important first.`,
      x: `Write your practical questions down before the treatment appointment, such as where treatment will take place and how many sessions there will be. Ask the most important first, in case the doctor runs out of time.`,
      lead: "If you want help putting other questions into words, try our free chat.",
      xLead: "Our free chat can help you word them.",
    }),

  item("2026-12-08",
    brief("hospital-contact", "Check a hospital's own website before travelling",
      "Check the hospital's own contact page before travelling. Say only what SCCF's check found, without counts.", HOSPITAL_CHECK, "/find-care/hospitals/"),
    { file: "hospital-contact.jpg", text: "Before you travel, check the phone number on the hospital's own website." },
    {
      linkedin: `We checked the contact details in Suchi's hospital directory against each hospital's official website, where we could find one. Many needed correcting.

Before you travel for an appointment, open the hospital's own website and call the number on its contact page.

Report: ${HOSPITAL_REPORT_URL}`,
      facebook: `Before you travel to a hospital in another city, open the hospital's own website and call the number on its contact page.

When we checked the contact details in Suchi's hospital directory against official websites, many needed correcting.`,
      instagram: `Before you travel to a hospital in another city, check the phone number on the hospital's own website. When we checked the contact details in Suchi's directory against official websites, many needed correcting.`,
      x: `Before you travel to a hospital, call the number on its own website. When we checked Suchi's hospital directory against official websites, many entries needed correcting.`,
      lead: "You can see the directory, with the details we corrected, on our website.",
      xLead: "The corrected directory is on our website.",
    }),

  item("2026-12-10",
    brief("vay-vandana", "The Ayushman Vay Vandana card for people aged 70 and over",
      "People aged 70 or over can enrol whatever the family's income. Aadhaar only. The shared top-up for PM-JAY families, the CGHS choice, where to enrol and the missed-call number.", [...VAY_VANDANA, PMJAY_COVER, ...SUCHI_CHAT]),
    { file: "vay-vandana.jpg", text: "Aged 70 or over, any income. Enrol for the Ayushman Vay Vandana card with Aadhaar." },
    {
      linkedin: `If a parent or grandparent is 70 or over, they can enrol for the Ayushman Vay Vandana card, whatever your family's income. It gives free treatment up to Rs 5 lakh at hospitals on the PM-JAY list. If your family is already under PM-JAY, its members aged 70 or over get an extra Rs 5 lakh a year, which they share.

Aadhaar is the only document needed. You can enrol them at beneficiary.nha.gov.in or in the Ayushman app. For details of the card, give a missed call to 1800110770.

A person covered by CGHS or another government health scheme has to choose between that scheme and this card, and the choice cannot be changed later.

Source: ${SENIOR_FAQ_URL}`,
      facebook: `If a parent or grandparent is 70 or older, they can enrol for the Ayushman Vay Vandana card, whatever the family earns. The card gives free treatment up to Rs 5 lakh at hospitals on the PM-JAY list. If your family is already under PM-JAY, its members aged 70 or over get an extra Rs 5 lakh a year, which they share.

Aadhaar is the only document needed. You can enrol them at beneficiary.nha.gov.in or in the Ayushman app. For details of the card, give a missed call to 1800110770.

A person covered by CGHS or another government health scheme has to choose between that scheme and this card, and the choice cannot be changed later.`,
      instagram: `People aged 70 or over can enrol for the Ayushman Vay Vandana card, whatever the family's income. Aadhaar is the only document needed. If the family is already under PM-JAY, its members aged 70 or over get an extra Rs 5 lakh a year, which they share. Enrol at beneficiary.nha.gov.in or in the Ayushman app. For details, give a missed call to 1800110770.`,
      x: `People aged 70 or over can enrol for the Ayushman Vay Vandana card whatever their income, with Aadhaar alone. For details, give a missed call to 1800110770.`,
      lead: "For a plain answer to other questions about cancer care, write to our free chat.",
      xLead: "Other questions? Our free chat answers in simple language.",
    }),

  item("2026-12-12",
    brief("keep-records", "Keeping medical papers in one place",
      "A simple way for a carer to keep results, treatment plans, dates and bills together.", [...NCI_RECORDS, ...SUCHI_CHAT]),
    { file: "keep-records.jpg", text: "Keep test results and treatment plans in a folder, with the date written on each." },
    {
      linkedin: `If you look after the papers for someone in cancer treatment, keep the test results and treatment plans together in one folder. Write the date of each visit and each test on them. The bills can go in a separate folder, or a folder for each month.

Keep a list of the medicines the doctor prescribes in the same place.

Source: ${NCI_RECORDS_URL}`,
      facebook: `If you look after the papers for someone in cancer treatment, keep the test results and treatment plans in one folder. Write the date of each visit and test on them. Bills can go in a separate folder for each month.

Add a list of the medicines the doctor has prescribed.`,
      instagram: `Keep test results and treatment plans together in one folder, with the date of each visit written on them. Bills can go in a separate folder for each month. Keep a list of the medicines the doctor prescribes in the same folder.`,
      x: `Keep test results and treatment plans in one folder, with the date on each, and the bills in a separate folder.`,
      lead: "If a word in these papers is unfamiliar, our free chat can explain it in simple language.",
      xLead: "An unfamiliar word in them? Our free chat explains in simple language.",
    }),

  item("2026-12-15",
    brief("what-suchi-does", "What Suchi can and cannot do",
      "Say plainly what Suchi is for and what it is not, with one example question, and that it is free. No emergency wording.", [...SITE_ABOUT_SUCHI, ...SUCHI_CHAT]),
    { file: "what-suchi-does.jpg", text: "Suchi is a free chat. It explains clearly and helps with questions for your doctor. Suchi is not a doctor." },
    {
      linkedin: `Suchi is SCCF's free chat for cancer information. You can type a question in your own words, such as "My mother has breast cancer. What happens next?" Suchi explains things in simple language and helps you prepare questions for the doctor.

It is a guide to help you learn and prepare. It is not a diagnostic service, and it cannot prescribe treatment.`,
      facebook: `Suchi is our free chat for cancer information. You can type a question in your own words, such as "My mother has breast cancer. What happens next?" Suchi explains things in simple language and helps you prepare questions for the doctor.

Suchi is not a doctor and cannot prescribe treatment.`,
      instagram: `Suchi is our free chat for cancer information. You can ask in your own words, such as "My mother has breast cancer. What happens next?" Suchi explains things in simple language and helps you prepare questions for the doctor. Suchi is not a doctor and cannot prescribe treatment.`,
      x: `Suchi is our free cancer information chat. Ask in your own words, such as "My mother has breast cancer. What happens next?" Suchi is not a doctor and cannot prescribe treatment.`,
      lead: "You can try the chat here.",
    }),

  item("2026-12-17",
    brief("pmjay-admission", "What to carry for a PM-JAY admission",
      "For a family already on the PM-JAY list, the documents to carry and the costs covered around the admission.", [PMJAY_CARRY, PMJAY_LIMITS, ...SUCHI_CHAT]),
    { file: "pmjay-admission.jpg", text: "Going into hospital under PM-JAY, carry a ration card or a photo ID such as Aadhaar." },
    {
      linkedin: `If your family is already on the PM-JAY list, take a ration card or a government photo ID such as Aadhaar to the hospital at admission. The hospital uses it to confirm who you are.

Costs such as tests and medicines are covered from up to 3 days before admission to 15 days after discharge.

There is no limit on the size of an eligible family or the age of its members.

Source: ${PMJAY_ABOUT_URL}`,
      facebook: `If your family is already on the PM-JAY list, carry a ration card or a government photo ID such as Aadhaar when the person you care for is admitted to hospital.

Costs such as tests and medicines are covered from up to 3 days before admission to 15 days after discharge.`,
      instagram: `If your family is already on the PM-JAY list, carry a ration card or a government photo ID such as Aadhaar at admission. Costs such as tests and medicines are covered from up to 3 days before admission to 15 days after discharge.`,
      x: `If your family is on the PM-JAY list, carry a ration card or a government photo ID such as Aadhaar at admission, so the hospital can confirm who you are.`,
      lead: "Our free chat can answer other questions about PM-JAY in simple language.",
      xLead: "More questions? Our free chat answers in simple language.",
    }),

  item("2026-12-19",
    brief("abha-records", "ABHA and health records",
      "What an ABHA number and address are, that records are shared only with consent, and sharing them with a new hospital. No advice on whether to create one.", [...PIB_ABHA, ...SUCHI_CHAT]),
    { file: "abha-records.jpg", text: "ABHA. Health records on your phone, shared only with your consent." },
    {
      linkedin: `ABHA, the Ayushman Bharat Health Account, gives each person a 14-digit number that identifies them with health care providers across India. With an ABHA address, the person you care for can see their health records on a phone.

If you take them to a new hospital, their earlier health records can be shared from the ABHA address with the health care provider there. Records are shared only with their consent.

Source: ${PIB_ABHA_URL}`,
      facebook: `With an ABHA address, the person you care for can see their health records on a phone and share them with a hospital or clinic.

If you take them to a new hospital, their earlier health records can be shared from the ABHA address with the health care provider there. Records are shared only with their consent.`,
      instagram: `With an ABHA address, the person you care for can see their health records on a phone. At a new hospital, their earlier records can be shared from the ABHA address with the health care provider. Records are shared only with their consent.`,
      x: `With an ABHA address, the person you care for can see their health records on a phone and share them with a new hospital. Records are shared only with their consent.`,
      lead: "You can also ask our free chat about health records and schemes.",
      xLead: "Questions? Ask our free chat.",
    }),

  item("2026-12-22",
    brief("pmjay-hospitals", "Finding a hospital on the PM-JAY list",
      "Where to look up hospitals on the PM-JAY list, and confirming cancer treatment with the hospital before going.", [PMJAY_FIND, PMJAY_FIND_SPECIALITY, PMJAY_COVER, ...SUCHI_CHAT]),
    { file: "pmjay-hospitals.jpg", text: "Find PM-JAY hospitals through Find Hospitals on nha.gov.in." },
    {
      linkedin: `PM-JAY can be used at public and private hospitals on its list. To find them, open Find Hospitals on nha.gov.in, which leads to a search at hem.nha.gov.in/search.

A hospital on the PM-JAY list may not offer cancer treatment under the scheme. Confirm with the hospital before you go.

Source: ${NHA_URL}`,
      facebook: `PM-JAY can be used at public and private hospitals on its list. To see which hospitals are on it, open Find Hospitals on nha.gov.in.

A hospital on the PM-JAY list may not offer cancer treatment under the scheme, so confirm with the hospital first.`,
      instagram: `PM-JAY can be used at public and private hospitals on its list. Find Hospitals on nha.gov.in leads to a search of them at hem.nha.gov.in/search. A hospital on the list may not offer cancer treatment under the scheme, so confirm with the hospital first.`,
      x: `A hospital on the PM-JAY list may not offer cancer treatment under the scheme. Find hospitals on the list through Find Hospitals on nha.gov.in, then confirm with the hospital before you go.`,
      lead: "To ask about cancer care in your own words, use our free chat.",
      xLead: "Questions? Our free chat can help.",
    }),

  item("2026-12-24",
    brief("official-sites", "The only official PM-JAY website, and the warning about fraud",
      "The official website, the warning about fraudulent portals and calls, how to recognise official addresses, and the right way to check cover.", [PMJAY_OFFICIAL, PMJAY_OFFICIAL_HOSTS, PMJAY_CHECK, PMJAY_HELPLINE, ...SUCHI_CHAT]),
    { file: "official-sites.jpg", text: "The only official PM-JAY website is nha.gov.in. Helpline 14555." },
    {
      linkedin: `The National Health Authority says nha.gov.in is the only official PM-JAY website. It warns of fraudulent websites and calls about enrolment or payments.

Its own pages have addresses that end in nha.gov.in, such as beneficiary.nha.gov.in, where you can check your family's cover. The toll-free helpline is 14555.

Source: ${NHA_URL}`,
      facebook: `The National Health Authority says nha.gov.in is the only official PM-JAY website. It warns of fraudulent websites and calls about enrolment or payments. Its own pages have addresses that end in nha.gov.in, such as beneficiary.nha.gov.in, where you can check your family's cover. The helpline is 14555.`,
      instagram: `The National Health Authority says nha.gov.in is the only official PM-JAY website. It warns of fraudulent websites and calls about enrolment or payments. Its own pages have addresses that end in nha.gov.in, such as beneficiary.nha.gov.in, where you can check your family's cover. The helpline is 14555.`,
      x: `nha.gov.in is the only official PM-JAY website. The National Health Authority warns of fraudulent websites and calls about enrolment. Its own pages end in nha.gov.in, such as beneficiary.nha.gov.in. Helpline 14555.`,
      lead: "If something about a scheme is unclear, ask our free chat in your own words.",
      xLead: "Questions? Ask our free chat.",
    }),

  item("2026-12-26",
    brief("rail-concession", "Train fare concession for cancer patients",
      "The railway concession for a cancer patient and one escort, what it leaves out, where it is given and the certificate it needs.", [...RAIL_CONCESSION, ...SUCHI_CHAT]),
    { file: "rail-concession.jpg", text: "Train fare concession for cancer patients. Book at the station counter and take the certificate." },
    {
      linkedin: `Indian Railways gives a cancer patient travelling for treatment or a check-up a concession on the basic fare. In sleeper class and AC three-tier the patient pays no basic fare and one escort gets 75% off. The reservation fee and other charges are still paid. For cancer patients the usual 300 km minimum distance does not apply.

The concession is given only at station booking counters. You cannot get it on a ticket booked online. It needs a certificate, so take the certificate to the counter.

It does not apply on Rajdhani or Shatabdi trains. Duronto and Vande Bharat trains are left out too, as are Garib Rath and special trains.

Source: ${RAIL_URL}`,
      facebook: `A cancer patient travelling by train for treatment or a check-up gets a concession on the basic fare. In sleeper class and AC three-tier the patient pays no basic fare and one escort gets 75% off. The reservation fee and other charges are still paid. The concession is given only at station booking counters and it needs a certificate, so take the certificate to the counter.

It does not apply on Rajdhani or Shatabdi trains. Duronto and Vande Bharat trains are left out too, as are Garib Rath and special trains.`,
      instagram: `A cancer patient travelling by train for treatment or a check-up gets a concession on the basic fare. In sleeper class and AC three-tier the patient pays no basic fare and one escort gets 75% off. The reservation fee and other charges are still paid. The concession is given only at station booking counters, and it needs a certificate.`,
      x: `A cancer patient travelling by train for treatment gets a concession on the basic fare. It is given only at station booking counters and needs a certificate, so take it to the counter.`,
      lead: "For other questions about travel for treatment, you can ask our free chat.",
      xLead: "Other questions? Ask our free chat.",
    }),
];

/** Items due on `date` (YYYY-MM-DD, Asia/Kolkata). */
export function itemsDueOn(date: string): CalendarItem[] {
  return CALENDAR.filter((i) => i.date === date);
}
