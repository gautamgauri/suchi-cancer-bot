/**
 * Structured organization profile for Diksha Foundation.
 * Extracted from kb_funding/docs/misc/diksha-organisation-profile-2026-27.md
 * Used in planner + section-writer prompts to ground the LLM in real org data.
 */

export const DIKSHA_ORG_PROFILE = `
Organization: Diksha Foundation
Legal entity: Society (Reg. S/RS/SW/0019/2010), 12A, 80G, FCRA, CSR-1 registered
Founded: 2010, Bihar, India
Website: www.dikshafoundation.org

Mission: Creating inclusive and vibrant learning spaces for children, youth, and women from marginalized backgrounds.

Programs:
1. KHEL (Knowledge Hub for Education and Learning) — Hub & Spoke model
   - KHEL Patna (Rukanpura): 147 students, supplementary education, ICT lab, Khan Academy, SEE Learning, Saturday football
   - KHEL Bihta (Sita Ram Ashram): 150 students, after-school program, volleyball + badminton, Ayurvedic clinic, 4 community schools
   - KHEL Sarairanjan: 179 students (est. Aug 2024), baseline-midline assessments, Bal Sansad, 3 govt schools (UHS Manika, PS Dhuniya Tola, PS Khetapur)
   - Hub & Spoke: Each KHEL center (hub) links to nearby govt schools (spokes) via Fellow Teachers
   - Total direct reach: ~476 students across 3 centers + ~10 govt schools

2. Teaching Fellowship — Fellow Teachers trained and mentored by Diksha, conduct sessions in both KHEL centers and govt schools

3. Poonji Project — Grants to financially marginalized women for micro-entrepreneurship (Patna)

4. Empowering Futures — 3-year programme for 300 adolescent girls across 6 urban settlements in Patna (life skills, peer leadership, agency)

Curriculum Focus:
- Academic support: Hindi, English, Math (supplementary)
- Digital literacy: Computer labs, Khan Academy, DCA diploma
- 21st-century skills: STEAM club, creative arts, theater
- Social-emotional: SEE Learning (Dalai Lama Trust curriculum)
- Sports: Football, volleyball, badminton, indoor games
- Civic: Bal Sansad (Children's Parliament), debate, quiz

Assessment: Pre/mid/post assessments (external partners), pen-and-paper tests 3x/year, Khan Academy tracking

Geography: Patna, Bihta, Samastipur — all in Bihar, India
Target communities: Economically disadvantaged children, youth facing barriers to education, women from slum communities, sanitation workers

Staff: Dedicated educators and youth fellows, available 10 AM–6 PM Tue–Sun
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
