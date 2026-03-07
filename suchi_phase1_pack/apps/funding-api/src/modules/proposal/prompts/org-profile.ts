/**
 * Structured organization profile for Diksha Foundation.
 * Extracted from kb_funding/docs/misc/diksha-organisation-profile-2026-27.md
 * Used in planner + section-writer prompts to ground the LLM in real org data.
 */

export const DIKSHA_ORG_PROFILE = `
Organization: Diksha Foundation
Legal entity: Registered Society (Registration No. S/RS/SW/0019/2010) with 12A (ABECS8375CE20217), 80G (ABECS8375CF20223), FCRA (231661629) and CSR-1 (CSR0001271203) registrations in place.
Founded: 2010, Bihar, India
Website: www.dikshafoundation.org

Who we are:
Diksha Foundation is a Bihar-born non-profit that has been working since 2010 to provide holistic education and social development opportunities to children, adolescents and women from socially and economically marginalised communities. Our mission is to create inclusive and vibrant learning spaces where education goes beyond basic literacy to include social-emotional growth, civic engagement and 21st‑century skills. We work primarily in urban and peri‑urban settlements in and around Patna, Bihta and Samastipur in Bihar.

Programme architecture – KHEL hub & spoke:
Our core programme is KHEL (Knowledge Hub for Education and Learning), which operates as a hub‑and‑spoke model. KHEL centres function as community learning hubs that provide supplementary education, digital literacy, sports and SEE Learning, while Fellow Teachers connect these hubs to nearby government and community schools (spokes).
- KHEL Patna (Rukanpura): Supplementary education hub for around 147 learners from low‑income communities, with an ICT lab (Khan Academy), SEE Learning sessions, Saturday football at Gandhi Maidan, weekend clubs and STEAM labs.
- KHEL Bihta (Sita Ram Ashram): Around 150 learners, strong focus on sports (volleyball, badminton), after‑school support, cultural programmes, an Ayurvedic clinic for the community, and volunteer engagement in four community schools.
- KHEL Sarairanjan (Samastipur): Established in 2024, currently serving around 179 learners with baseline–midline assessments, Bal Sansad (Children’s Parliament), community events and fellow‑led sessions in three nearby government schools.
Across these hubs and their linked schools, Diksha reaches several hundred children and adolescents each year through a predictable timetable of academic, co‑curricular and life‑skills activities.

Other flagship programmes:
- Teaching Fellowship: Fellow Teachers are trained and mentored by Diksha to deliver sessions both in KHEL centres and in nearby government/community schools, strengthening classroom practice and building a local educator pipeline.
- Poonji Project: Grants and peer‑learning support for financially marginalised women in Patna to start or stabilise micro‑enterprises, often linked to self‑help groups and informal sector workers’ collectives.
- Empowering Futures (Adolescent Girls Programme): A three‑year, capability‑based programme for adolescent girls across six underserved urban locations in Patna, building agency, life skills, peer leadership and collective voice.

What we do inside the classroom:
Across centres, Diksha blends academic support (Hindi, English, Mathematics) with digital literacy (computer labs, DCA‑style courses, Khan Academy), 21st‑century skills (STEAM club, creative arts and theatre) and structured Social‑Emotional and Ethical (SEE) Learning. Sports (football, volleyball, badminton and indoor games) and civic platforms such as Bal Sansad are used to build confidence, teamwork and leadership, not just recreation.

Assessment and evidence culture:
Learning is tracked through a combination of baseline–midline–endline assessments (often with external partners), pen‑and‑paper tests three times a year and digital tracking through platforms such as Khan Academy. ActivityInstance records in our internal registry capture fortnightly enrolment, attendance, meals served, SEL sessions and other operational metrics, which are then used to inform planning and to ground funder‑facing proposals in real data.

Communities and geography:
We work with economically disadvantaged children and youth, sanitation workers’ families, women from slum communities and adolescent girls from informal settlements. Our current footprint is anchored in Patna, Bihta and Samastipur (Bihar, India), with centres typically operating from 10:00 AM to 6:00 PM, Tuesday to Sunday, providing a safe after‑school environment.

People and governance:
Diksha’s work is guided by a governing board and a lean professional leadership team with experience in education, social work, finance and community development. Day‑to‑day delivery is led by dedicated educators, youth fellows and programme staff who are present on‑site for extended hours, supported by volunteers and partner organisations for specialist inputs.

Partnerships and track record:
Over more than a decade, Diksha has built partnerships with institutional donors (including CSR partners, international scholarship programmes and foundations) and individual philanthropists. Graduates from Diksha’s programmes have gone on to higher education (including universities such as Amity, Azim Premji and Shiv Nadar, as documented in scholarship reports) and to livelihoods where they remain connected to their communities as peer leaders. The organisation’s history of consistent centre operations, regular assessments and long‑term engagement with families is a core part of its credibility with funders and government schools.
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
