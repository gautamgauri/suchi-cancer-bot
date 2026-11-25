/**
 * Facts for the practical-support lane. Every fact was read on the page given,
 * on the date given, and is worded as close to that page as plain English
 * allows. Nothing here comes from memory. A new topic needs a new fetch.
 *
 * Re-check these pages before reusing a fact more than a few months later.
 * Scheme figures in particular change (the PM-JAY hospital count is "as on
 * 28.02.2026" in the release cited).
 */
import { SourceFact } from "../social.types";

const FETCHED = "2026-11-25";

export const NCI_TALK_URL = "https://www.cancer.gov/about-cancer/coping/adjusting-to-cancer/talk-with-doctors";
export const NCI_RECORDS_URL = "https://www.cancer.gov/about-cancer/managing-care/track-care-costs";
export const NCI_TREATMENT_QUESTIONS_URL = "https://www.cancer.gov/about-cancer/treatment/questions";
export const PIB_PMJAY_URL = "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2241085";
export const NIS_HELPLINE_URL =
  "https://newindiasamachar.pib.gov.in/WriteReadData/flipbook/2025/Sep/2nd/English/files/basic-html/page15.html";
export const PIB_ABHA_URL = "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2017129";
export const HOSPITAL_REPORT_URL =
  "https://github.com/gautamgauri/suchi-cancer-bot/blob/main/docs/navigator/hospital-verification-2026-11.md";
export const SITE_HOME_URL = "https://suchitracancercare.org/";

const f = (text: string, url: string): SourceFact => ({ text, url, fetchedOn: FETCHED });

/** US National Cancer Institute, "Talking with Your Health Care Team", updated 15 January 2025. */
export const NCI_TALK: SourceFact[] = [
  f("The US National Cancer Institute advises: write down your questions and bring them with you to your visit.", NCI_TALK_URL),
  f("Ask your most important questions first, in case the doctor runs out of time.", NCI_TALK_URL),
  f("Ask a family member or friend to go with you when you see your doctor. They can listen, take notes and ask questions.", NCI_TALK_URL),
  f("Take notes, have someone take them for you, or ask if you can record the conversation.", NCI_TALK_URL),
];

/** US National Cancer Institute, "Managing Cancer Costs and Medical Information", updated 21 October 2024. */
export const NCI_RECORDS: SourceFact[] = [
  f("The US National Cancer Institute advises: ask for and keep copies of treatment plans and test results.", NCI_RECORDS_URL),
  f("Keep a record of the date of each medical visit, and the dates and results of tests.", NCI_RECORDS_URL),
  f("Keep a list of the medicines the doctor prescribes.", NCI_RECORDS_URL),
  f("Put medical bills in a single folder or binder, or use a separate folder for each month or each type of paperwork.", NCI_RECORDS_URL),
];

/** US National Cancer Institute, "Questions to Ask Your Doctor about Treatment". Questions quoted exactly. */
export const NCI_TREATMENT_QUESTIONS: SourceFact[] = [
  f("The US National Cancer Institute lists questions to ask the doctor about treatment, including: Where will I go for treatment?", NCI_TREATMENT_QUESTIONS_URL),
  f("How long will each treatment session take? How many treatment sessions will I have?", NCI_TREATMENT_QUESTIONS_URL),
  f("Should a family member or friend come with me to my treatment sessions?", NCI_TREATMENT_QUESTIONS_URL),
  f("Will I be able to work? Should I think about going part-time?", NCI_TREATMENT_QUESTIONS_URL),
  f("Will I need to be in the hospital for treatment? If so, for how long?", NCI_TREATMENT_QUESTIONS_URL),
];

/** Press Information Bureau, Ministry of Health and Family Welfare, 17 March 2026. */
export const PIB_PMJAY: SourceFact[] = [
  f("Press release of the Ministry of Health and Family Welfare, 17 March 2026, on Ayushman Bharat PM-JAY.", PIB_PMJAY_URL),
  f("AB-PMJAY provides health coverage of Rs 5 lakh per family per year for secondary and tertiary care hospitalisation to eligible families.", PIB_PMJAY_URL),
  f("The scheme was expanded to cover senior citizens aged 70 years and above, irrespective of their socio-economic status. They receive an Ayushman Vay Vandana card.", PIB_PMJAY_URL),
  f("As on 28.02.2026, 36,229 hospitals had been empanelled under the scheme, of which 19,483 are public and 16,746 are private hospitals.", PIB_PMJAY_URL),
];

/** New India Samachar (Government of India, published by PIB), 16 to 30 September 2025, page 15. */
export const NIS_HELPLINE: SourceFact[] = [
  f("Call the PM-JAY helpline 14555 to find out whether you are a beneficiary of the scheme.", NIS_HELPLINE_URL),
];

/** Press Information Bureau, "Explainer on Ayushman Bharat Health Accounts (ABHA)", 4 April 2024. */
export const PIB_ABHA: SourceFact[] = [
  f("ABHA, the Ayushman Bharat Health Account, gives a person a random 14-digit number that identifies them across different health care providers in the country.", PIB_ABHA_URL),
  f("An ABHA address is an easy-to-remember username that lets a person see their health records digitally and share them with health care providers.", PIB_ABHA_URL),
  f("Health records are shared based on the individual's informed consent.", PIB_ABHA_URL),
];

/** SCCF's own check of its hospital directory, docs/navigator/hospital-verification-2026-11.md. */
export const HOSPITAL_CHECK: SourceFact[] = [
  f("In November 2026 SCCF checked all 83 entries in Suchi's hospital directory against each hospital's official website.", HOSPITAL_REPORT_URL),
  f("77 values in 54 entries were changed so that the phone number, address or website matches the official site.", HOSPITAL_REPORT_URL),
  f("Where an official website was found, the directory links to it. No hospital was telephoned.", HOSPITAL_REPORT_URL),
];

/** SCCF home page, "What We Do" and "What We Are Not". Wording already approved for the site. */
export const SITE_ABOUT_SUCHI: SourceFact[] = [
  f("Suchi is not a doctor. It is a guide to help you learn and prepare, and it does not replace a medical consultation. For emergencies, seek immediate care.", SITE_HOME_URL),
  f("SCCF is not a hospital or clinic and not a diagnostic service, and it cannot prescribe treatment.", SITE_HOME_URL),
  f("SCCF gives clear information for patients and caregivers, help with finding the way through care, doctor-led videos through Onco Talks, and guidance through Suchi.", SITE_HOME_URL),
  f("Suchi can help with clear explanations and with questions to ask your doctor.", SITE_HOME_URL),
];
