/**
 * Structured organization profile for Diksha Foundation.
 * Extracted from kb_funding/docs/misc/diksha-organisation-profile-2026-27.md
 * and enriched from the Gully Goal proposal (Reliance Foundation ESA, 2026).
 * Used in planner + section-writer prompts to ground the LLM in real org data.
 */

export const DIKSHA_ORG_PROFILE = `
Diksha Foundation is a registered society (Reg. S/RS/SW/0019/2010) established in 2010 in Bihar, India, with 12A, 80G, FCRA, and CSR-1 certifications. Our mission is to provide holistic education and life skills to marginalized children and youth — creating inclusive learning spaces that combine academic support, digital literacy, sports, social-emotional learning (SEE Learning), and civic engagement. Since inception, we have graduated over 2,000 students through our KHEL Centers and currently serve approximately 771 beneficiaries across two core programs.

Our flagship program, KHEL (Knowledge Hub for Education and Learning), operates through a Hub & Spoke model across 3 centers: KHEL Patna (Rukanpura) serving 147 students with supplementary education, ICT lab, Khan Academy, SEE Learning, and Saturday football; KHEL Bihta (Sita Ram Ashram) serving 150 students with after-school programming, volleyball, badminton, and links to 4 community schools; and KHEL Sarairanjan serving 179 students (est. August 2024) with baseline-midline assessments, Bal Sansad (Children's Parliament), and 3 partner government schools. Each center (hub) links to nearby government schools (spokes) via our Fellow Teachers. Total KHEL direct reach is approximately 511 students across 3 centers and ~10 government schools.

Our Empowering Futures program is a 3-year initiative reaching approximately 260 adolescent girls across 6 urban settlements in Patna, delivering life skills, peer leadership, and agency-building. The Poonji Project provides grants to financially marginalized women for micro-entrepreneurship. Our Teaching Fellowship program trains and mentors Fellow Teachers who deliver sessions across both KHEL centers and government schools.

Curriculum spans: academic support (Hindi, English, Math), digital literacy (computer labs, Khan Academy, DCA diploma), 21st-century skills (STEAM club, creative arts, theater), social-emotional learning (SEE Learning — Dalai Lama Trust curriculum), sports (football, volleyball, badminton, indoor games), and civic engagement (Bal Sansad, debate, quiz). Assessment uses baseline-midline-endline design, Khan Academy tracking, and pen-and-paper tests 3x/year.

Leadership:
- Gautam Gauri — Executive Director & Co-founder; MPhil Education (Cambridge University); 15+ years nonprofit leadership
- Shivam Mishra — Education & Community Development Specialist; field operations lead across centers
- Nisha Kumari — Communications Coordinator

Board of Directors:
- Gautam Gauri (President) — Co-founder & Executive Director; MPhil Education (Cambridge); 15 years education sector
- Saurabh Kumar (Treasurer) — Co-founder and COO at Sparklehood; angel investor with startup ecosystem expertise
- Mohita Katriar (Secretary) — Education professional; Master's in Education (TISS); academic leadership
- Harish Nandan Sahay — 25+ years national experience; corporate-to-social sector transition; Amity Foundation
- Arti Nair — Master's in Philosophy (Cambridge); children's literature, curriculum development, teacher training
- Vikas Gupta — Entrepreneur and investor in retail-tech; strategic advisor on business transformation
- Dr. Nandini Jha — MD Radiologist; advanced imaging and musculoskeletal diagnostics

Annual Operating Expenditure: ₹104.56 lakhs (FY 2024-25)

Current Funding Partners: Azim Premji Foundation, Feeding India, Ruban Hospital, eGain Communications, BP Singh & Shakuntla Devi Foundation, Every.org, Benevity Causes, GIVE India, North South Foundation (MOU for learning outcome tracking), Swatantra Talim (STEAM curriculum), SEE Learning India, DaanVeda, IndiaDonates, ArtKaar Collective, SAATHIYA

Past Partners: JP Morgan Chase (Code for Good collaboration), PRAVAH, Commutiny, Asha for Education, US Consulate General (Kolkata)

Compliance: Society Reg. S/RS/SW/0019/2010; PAN: AABTD9924D; 12A and 80G approved; FCRA registered (latest return filed December 2025); CSR-1 registered; audited annually by Jha BK & Associates (Firm No. 043115N); not registered under GST; no FCRA defaults or blacklisting.

Geography: Patna, Bihta (Patna district), Samastipur — all in Bihar, India
Target communities: Economically disadvantaged children (ages 6-18), youth facing barriers to education, adolescent girls from urban slum communities, women from marginalized backgrounds
Staff: Center Coordinators (1 per center), Fellow Teachers, Computer Instructors, community volunteers; operations 10 AM–6 PM Tue–Sun
`.trim();

/**
 * Program Snapshot box — inserted as preamble before first proposal section.
 * Update when org data changes.
 */
export const PROGRAM_SNAPSHOT_MD = `
## Program Snapshot

| Metric | Value |
|--------|-------|
| **Organization** | Diksha Foundation |
| **Founded** | 2010, Bihar, India |
| **Legal Status** | Registered Society, 12A, 80G, FCRA, CSR-1 |
| **Core Program** | KHEL (Knowledge Hub for Education and Learning) — Hub & Spoke model |
| **Centers** | 3 (Patna-Rukanpura, Bihta, Sarairanjan) |
| **Direct Beneficiaries** | ~476 students across 3 centers + ~10 govt schools |
| **Key Streams** | Academic support, digital literacy, sports, SEE Learning, civic engagement |
| **Geography** | Patna, Bihta, Samastipur — Bihar, India |
| **Assessment** | Baseline–midline–endline, Khan Academy tracking, pen-and-paper tests 3x/year |
`.trim();
