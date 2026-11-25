/**
 * Facts for the practical-support lane. Each fact is worded as close to its
 * page as plain English allows, and carries the page's URL and the date it
 * was read. Nothing here comes from memory. A new topic needs a new reading.
 *
 * Scheme facts (PM-JAY, the Ayushman Vay Vandana card, the railway
 * concession) come from docs/support/financial-support-reference-2026-11.md
 * on branch docs/support-gap-assessment-2026-11, where every fact was read on
 * the official page named here on 25 November 2026. The US National Cancer
 * Institute pages, the ABHA explainer and the site's own pages were read for
 * this module on the same day. The hospital facts come from SCCF's own check,
 * docs/navigator/hospital-verification-2026-11.md.
 *
 * Re-check these pages before reusing a fact more than a few months later.
 */
import { SourceFact } from "../social.types";

const READ = "2026-11-25";

export const NCI_TALK_URL = "https://www.cancer.gov/about-cancer/coping/adjusting-to-cancer/talk-with-doctors";
export const NCI_RECORDS_URL = "https://www.cancer.gov/about-cancer/managing-care/track-care-costs";
export const NCI_TREATMENT_QUESTIONS_URL = "https://www.cancer.gov/about-cancer/treatment/questions";
export const PMJAY_ABOUT_URL = "https://pmjay.nha.gov.in/about-ayushman-bharat";
export const PMJAY_PORTAL_URL = "https://beneficiary.nha.gov.in/";
export const PMJAY_TOLLFREE_URL = "https://pmjay.nha.gov.in/tollFree";
export const PMJAY_FAQ_URL = "https://pmjay.nha.gov.in/strapi/uploads/AB_PMJAY_FA_Qs_ed45d95556.pdf";
export const NHA_URL = "https://nha.gov.in/";
export const SENIOR_FAQ_URL = "https://pmjay.nha.gov.in/strapi/uploads/English_FA_Qs_related_to_the_benefits_for_senior_citizens_7596c43be0.pdf";
export const RAIL_URL = "https://www.indianrail.gov.in/enquiry/StaticPages/StaticEnquiry.jsp?StaticPage=conc_Rules.html";
export const PIB_ABHA_URL = "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2017129";
export const HOSPITAL_REPORT_URL =
  "https://github.com/gautamgauri/suchi-cancer-bot/blob/main/docs/navigator/hospital-verification-2026-11.md";
export const SITE_HOME_URL = "https://suchitracancercare.org/";
export const CHAT_HOME_URL = "https://chat.suchitracancercare.org/";
export const HOSPITAL_SEARCH_URL = "https://hem.nha.gov.in/search";

const f = (text: string, url: string): SourceFact => ({ text, url, fetchedOn: READ });

/** US National Cancer Institute, "Talking with Your Health Care Team", updated 15 January 2025. */
export const NCI_TALK: SourceFact[] = [
  f("Write down your questions and bring them with you to your visit.", NCI_TALK_URL),
  f("Ask your most important questions first, in case the doctor runs out of time.", NCI_TALK_URL),
  f("Ask a family member or friend to go with you when you see your doctor. They can listen, take notes and ask questions.", NCI_TALK_URL),
  f("Take notes, have someone take them for you, or ask if you can record the conversation.", NCI_TALK_URL),
];

/** US National Cancer Institute, "Managing Cancer Costs and Medical Information", updated 21 October 2024. */
export const NCI_RECORDS: SourceFact[] = [
  f("Ask for and keep copies of treatment plans and test results.", NCI_RECORDS_URL),
  f("Keep a record of the date of each medical visit, and the dates and results of tests.", NCI_RECORDS_URL),
  f("Keep a list of the medicines the doctor prescribes.", NCI_RECORDS_URL),
  f("Put medical bills in a single folder or binder, or use a separate folder for each month or each type of paperwork.", NCI_RECORDS_URL),
];

/** US National Cancer Institute, "Questions to Ask Your Doctor about Treatment". Questions quoted exactly. */
export const NCI_TREATMENT_QUESTIONS: SourceFact[] = [
  f("Questions to ask the doctor about treatment include: Where will I go for treatment?", NCI_TREATMENT_QUESTIONS_URL),
  f("How long will each treatment session take? How many treatment sessions will I have?", NCI_TREATMENT_QUESTIONS_URL),
  f("Should a family member or friend come with me to my treatment sessions?", NCI_TREATMENT_QUESTIONS_URL),
  f("Will I be able to work? Should I think about going part-time?", NCI_TREATMENT_QUESTIONS_URL),
  f("Will I need to be in the hospital for treatment? If so, for how long?", NCI_TREATMENT_QUESTIONS_URL),
];

/** Ayushman Bharat PM-JAY, from the National Health Authority's pages. */
export const PMJAY_COVER = f("Ayushman Bharat PM-JAY gives a cover of Rs 5 lakh per family per year for secondary and tertiary care hospitalisation, at public and private empanelled hospitals across India.", PMJAY_ABOUT_URL);
export const PMJAY_SCOPE = f("PM-JAY covers admission to hospital for the conditions and procedures on its list. Outpatient visits are outside it.", PMJAY_FAQ_URL);
export const PMJAY_LIMITS = f("There is no limit on the size of an eligible family or the age of its members. Costs such as tests and medicines are covered from up to 3 days before admission to 15 days after discharge. The benefit can be used anywhere in India.", PMJAY_ABOUT_URL);
export const PMJAY_CHECK = f("A family can check whether it is covered by logging in with a mobile number on the beneficiary portal, beneficiary.nha.gov.in.", PMJAY_PORTAL_URL);
export const PMJAY_HELPLINE = f("The PM-JAY toll-free helpline is 14555.", PMJAY_TOLLFREE_URL);
export const PMJAY_CARRY = f("A family already on the PM-JAY list carries a ration card or any government photo ID such as Aadhaar at admission, so the hospital can confirm who they are.", PMJAY_FAQ_URL);
export const PMJAY_FIND = f("Empanelled hospitals can be found through Find Hospitals on the NHA site, nha.gov.in, which leads to a search at hem.nha.gov.in/search.", NHA_URL);
export const PMJAY_FIND_SPECIALITY = f("A hospital on the PM-JAY list may not offer cancer treatment under the scheme, so confirm with the hospital first.", HOSPITAL_SEARCH_URL);
export const PMJAY_OFFICIAL = f("nha.gov.in is the only official website of PM-JAY. The National Health Authority warns of fraudulent portals, calls and messages about enrolment or premium payments.", NHA_URL);
export const PMJAY_OFFICIAL_HOSTS = f("The National Health Authority's own pages have addresses that end in nha.gov.in, such as beneficiary.nha.gov.in, where a family can check its cover.", NHA_URL);

/** Ayushman Vay Vandana card, National Health Authority senior citizen FAQ and toll-free page. */
export const VAY_VANDANA: SourceFact[] = [
  f("Every citizen aged 70 or over, whatever the family's income, is eligible for free treatment up to Rs 5 lakh under the Ayushman Vay Vandana card. Age is taken from Aadhaar.", SENIOR_FAQ_URL),
  f("Aadhaar e-KYC is required and Aadhaar is the only document needed. A separate Ayushman card is issued. People enrol on beneficiary.nha.gov.in or the Ayushman app.", SENIOR_FAQ_URL),
  f("Where a family is already under PM-JAY, its members aged 70 or over get an additional Rs 5 lakh a year, shared between them.", SENIOR_FAQ_URL),
  f("A missed call to 1800110770 gives details of the Ayushman Vay Vandana card.", PMJAY_TOLLFREE_URL),
  f("A person covered by CGHS or another government health scheme has to choose between that scheme and the Ayushman Vay Vandana card, and the choice cannot be changed later.", SENIOR_FAQ_URL),
];

/** Indian Railways concession rules, passenger enquiry site. */
export const RAIL_CONCESSION: SourceFact[] = [
  f("A cancer patient travelling for treatment or a check-up gets a concession on the basic fare. In sleeper class and AC three-tier the concession is 100%, so no basic fare is paid.", RAIL_URL),
  f("One escort gets the same concession, except in sleeper class and AC three-tier, where the escort gets 75% off.", RAIL_URL),
  f("The concession is on the basic fare only. The reservation fee and other charges are still paid.", RAIL_URL),
  f("The concession is given only at station booking counters. It is not available for online booking.", RAIL_URL),
  f("It does not apply on Rajdhani, Shatabdi, Duronto, Vande Bharat, Garib Rath and special trains.", RAIL_URL),
  f("The usual 300 km minimum distance does not apply to cancer patients and their escorts.", RAIL_URL),
  f("A concession needs the required certificate, which is taken to the booking counter.", RAIL_URL),
];

/** Press Information Bureau, "Explainer on Ayushman Bharat Health Accounts (ABHA)", 4 April 2024. */
export const PIB_ABHA: SourceFact[] = [
  f("ABHA, the Ayushman Bharat Health Account, gives a person a random 14-digit number that identifies them across different health care providers in the country.", PIB_ABHA_URL),
  f("An ABHA address is an easy-to-remember username that lets a person see their health records digitally and share them with health care providers.", PIB_ABHA_URL),
  f("Health records are shared based on the person's informed consent.", PIB_ABHA_URL),
];

/** SCCF's own check of its hospital directory. No counts are used in posts. */
export const HOSPITAL_CHECK: SourceFact[] = [
  f("SCCF checked the contact details in Suchi's hospital directory, the phone number, address and website, against each hospital's official website where one could be found.", HOSPITAL_REPORT_URL),
  f("Many directory entries needed a corrected phone number, address or website.", HOSPITAL_REPORT_URL),
  f("For some hospitals no official website could be found or read. No hospital was telephoned.", HOSPITAL_REPORT_URL),
];

/** SCCF home page, "What We Do" and "What We Are Not". No emergency wording is used in posts. */
export const SITE_ABOUT_SUCHI: SourceFact[] = [
  f("Suchi is not a doctor. It is a guide to help you learn and prepare.", SITE_HOME_URL),
  f("SCCF is not a diagnostic service and is not able to prescribe treatment.", SITE_HOME_URL),
  f("Suchi helps with clear explanations and with questions to ask your doctor.", SITE_HOME_URL),
  f('The home page gives an example of a question to ask Suchi, "Meri maa ko breast cancer hai, next step kya hoga?", which in English is "My mother has breast cancer. What happens next?"', SITE_HOME_URL),
];

/**
 * The chat itself, for the few plain words before each post's chat link.
 * That Suchi is free to use is SCCF's own statement about its service. No
 * page says it in these words.
 */
export const SUCHI_CHAT: SourceFact[] = [
  f("Suchi is SCCF's free chat for cancer information. You can type a question in your own words. It explains things in simple language, answers questions and helps with questions to ask the doctor.", CHAT_HOME_URL),
];
