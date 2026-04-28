---
schema_version: "1.0"
page_id: colorectal-cancer
title: "Colorectal Cancer: Signs, Diagnosis, and Treatment Basics"
summary: >
  Colorectal cancer often begins as a polyp inside the colon or rectum, and
  removing polyps early can prevent it. This page covers warning signs,
  diagnosis using stool tests, colonoscopy, and biopsy, treatment basics,
  and care in India.
content_type: cancer_type

locale: en
geo_relevance: ["IN-pan", "IN-BR"]
audience: ["patient", "caregiver"]

last_reviewed: 2026-04-28
review_status: ai_draft
version_id: "v1.0.0-2026-04-28-cgp-walked-005"

provenance:
  generator_model: human-walked-example
  generator_run_id: cgp-walked-2026-04-28-005
  pipeline_version: "0.2"
  source_chunks:
    - doc_id: nci.types-colorectal
      chunk_id: overview
      source: NCI
    - doc_id: nci.types-colorectal-patient-colon-treatment-pdq
      chunk_id: key-points
      source: NCI
    - doc_id: nci.types-colorectal-patient-colon-treatment-pdq
      chunk_id: what-it-is
      source: NCI
    - doc_id: nci.types-colorectal-patient-colon-treatment-pdq
      chunk_id: risk-factors
      source: NCI
    - doc_id: nci.types-colorectal-patient-colon-treatment-pdq
      chunk_id: signs-symptoms
      source: NCI
    - doc_id: nci.types-colorectal-patient-colon-treatment-pdq
      chunk_id: diagnosis-tests
      source: NCI
    - doc_id: nci.types-colorectal-patient-colon-treatment-pdq
      chunk_id: staging-tests
      source: NCI
    - doc_id: nci.types-colorectal-patient-colon-treatment-pdq
      chunk_id: second-opinion
      source: NCI
    - doc_id: nci.types-colorectal-patient-colon-treatment-pdq
      chunk_id: treatment-options
      source: NCI
    - doc_id: nci.types-colorectal-patient-colorectal-screening-pdq
      chunk_id: screening-tests
      source: NCI
    - doc_id: kb_local.pmjay-ayushman-bharat-cancer
      chunk_id: cancer-treatment-covered
      source: kb_local
    - doc_id: kb_local.bihar-cancer-navigation-guide
      chunk_id: mahavir-cancer-sansthan
      source: kb_local
  gaps:
    - section: risk-factors
      description: India-specific epidemiology — including reports of rising colorectal cancer incidence in younger Indian adults and dietary risk-factor patterns specific to the Indian context — is not directly covered in current Tier-1 KB sources. Claims hedged accordingly.
    - section: how-is-colorectal-cancer-diagnosed
      description: India-specific cost differential of colonoscopy in public vs private hospitals is referenced generally but not quantified in current Tier-1 KB sources. Hedged claim used.
  # eval_scores omitted intentionally — populated by Module 7 (Eval gate) in production.

related_pages:
  - blood-in-stool
  - change-in-bowel-habits
  - what-to-do-after-cancer-diagnosis
  - questions-to-ask-your-doctor
  - colonoscopy
  - biopsy
  - cancer-care-in-bihar

tags:
  cancer_types: ["colorectal"]
  situations: ["newly-diagnosed", "prevention"]
  topics: ["symptoms", "diagnosis", "treatment", "screening", "colonoscopy", "stool-tests", "biopsy", "polyps"]
  clinical_category: gastrointestinal

featured: false
---

> **Important:** This page is for general information only and is not a diagnosis. Please see a doctor if you notice blood in your stool, a change in bowel habits, or other symptoms that worry you.

## What is colorectal cancer?

Colorectal cancer is cancer that forms in the tissues of the colon or the rectum [citation:nci.types-colorectal-patient-colon-treatment-pdq:what-it-is]. The colon (large bowel) is the main part of the large intestine and is about 5 feet long; together, the rectum and anal canal make up the last part of the large intestine [citation:nci.types-colorectal-patient-colon-treatment-pdq:what-it-is]. The colon and rectum are part of the body's digestive system, which takes in nutrients from foods and helps pass waste material out of the body [citation:nci.types-colorectal-patient-colon-treatment-pdq:what-it-is].

Colorectal cancer often begins as a small growth called a **polyp** inside the colon or rectum [citation:nci.types-colorectal:overview]. Most polyps are not cancer, but some types of polyps can become cancer over time. Finding and removing polyps during a screening test such as colonoscopy can help prevent colorectal cancer from developing [citation:nci.types-colorectal:overview].

## Common warning signs

Signs of colon cancer include blood in the stool or a change in bowel habits [citation:nci.types-colorectal-patient-colon-treatment-pdq:key-points]. These and other symptoms may be caused by colorectal cancer or by other conditions. Check with your doctor if you have [citation:nci.types-colorectal-patient-colon-treatment-pdq:signs-symptoms]:

- **Blood in the stool** — either bright red or very dark
- **A change in bowel habits**, such as:
  - Diarrhoea
  - Constipation
  - A feeling that the bowel does not empty completely
  - Stools that are narrower or have a different shape than usual
- **General abdominal discomfort** — frequent gas pains, bloating, fullness, or cramps
- **Weight loss** for no known reason
- **Fatigue** (feeling very tired)
- **Vomiting**

These symptoms are often caused by non-cancer problems such as haemorrhoids, infections, or irritable bowel — but persistent symptoms should be checked by a doctor [citation:nci.types-colorectal-patient-colon-treatment-pdq:signs-symptoms]. Many early colorectal cancers cause no symptoms at all, which is why screening is important for people at average or higher risk.

## Risk factors

Health history affects the risk of developing colon cancer [citation:nci.types-colorectal-patient-colon-treatment-pdq:key-points]. Some risk factors, like smoking, can be changed; others, like genetics and family history, cannot [citation:nci.types-colorectal-patient-colon-treatment-pdq:risk-factors]. Risk factors for colorectal cancer include [citation:nci.types-colorectal-patient-colon-treatment-pdq:risk-factors]:

- **Older age** — the chance of getting colorectal cancer increases as you get older
- **A first-degree relative** (parent, sibling, or child) with a history of colon or rectal cancer
- **A personal history** of colon, rectal, or ovarian cancer
- **A personal history of high-risk adenomas** — colorectal polyps that are 1 cm or larger or that look abnormal under a microscope
- **Inherited gene changes** that cause familial adenomatous polyposis (FAP) or Lynch syndrome (hereditary nonpolyposis colorectal cancer)
- **A personal history of chronic ulcerative colitis or Crohn disease for 8 years or more**
- **Three or more alcoholic drinks per day**
- **Smoking cigarettes**
- **Obesity**

Having one or more risk factors does not mean you will get colorectal cancer; many people with risk factors never develop the disease, while some people with no known risk factors do [citation:nci.types-colorectal-patient-colon-treatment-pdq:risk-factors]. Talk with your doctor if you think you might be at increased risk — earlier or more frequent screening may be appropriate.

In India, colorectal cancer historically has a lower incidence than in many Western countries, but cases may be more often diagnosed at later stages because routine screening is uncommon. {{MISSING_EVIDENCE: India-specific incidence trends and rising rates in younger Indian adults are widely discussed clinically but not directly covered in current Tier-1 KB sources.}} If you have a family history of colorectal cancer, polyps, or Lynch syndrome, ask a doctor whether colonoscopy or stool-based screening is appropriate for you.

## When to seek medical attention

Please see a doctor for evaluation if you have any of the following:

- Blood in the stool that lasts more than 1 to 2 weeks, or repeated bleeding [citation:nci.types-colorectal-patient-colon-treatment-pdq:signs-symptoms]
- A change in bowel habits — new diarrhoea, new constipation, or a feeling that the bowel does not empty — that lasts more than 3 weeks
- Persistent abdominal pain, bloating, or cramps that last more than 2 to 3 weeks
- Unexplained weight loss of more than a few kilograms over a few months
- Persistent fatigue or new anaemia (low haemoglobin) that lasts more than 2 to 3 weeks
- A lump or mass that you can feel in the abdomen

Bleeding from the rectum is often caused by haemorrhoids or anal fissures, but it can also be a sign of colorectal cancer or polyps — so do not assume any rectal bleeding is "just piles." Please see a doctor or surgeon for evaluation.

## How is colorectal cancer diagnosed?

Tests that examine the colon and rectum are used to diagnose colon cancer [citation:nci.types-colorectal-patient-colon-treatment-pdq:key-points]. In addition to asking about your personal and family health history and doing a physical exam, your doctor may perform [citation:nci.types-colorectal-patient-colon-treatment-pdq:diagnosis-tests]:

- **Digital rectal exam (DRE)** — a doctor or nurse inserts a lubricated, gloved finger into the lower part of the rectum to feel for lumps or anything else that seems unusual [citation:nci.types-colorectal-patient-colon-treatment-pdq:diagnosis-tests].
- **Stool tests** to check for hidden blood or genetic changes [citation:nci.types-colorectal-patient-colon-treatment-pdq:diagnosis-tests] [citation:nci.types-colorectal-patient-colorectal-screening-pdq:screening-tests]:
  - **Faecal occult blood test (FOBT)** — checks stool for blood that can only be seen with a microscope. Two types are common: guaiac-based FOBT and **immunochemical FOBT (FIT)**, which uses antibodies to detect blood [citation:nci.types-colorectal-patient-colorectal-screening-pdq:screening-tests].
  - **DNA stool test** — checks DNA in stool cells for genetic changes that may be a sign of colorectal cancer [citation:nci.types-colorectal-patient-colorectal-screening-pdq:screening-tests].
- **Sigmoidoscopy** — a thin, lighted tube called a sigmoidoscope is inserted through the anus to look inside the rectum and the lower (sigmoid) colon for polyps or abnormal areas [citation:nci.types-colorectal-patient-colon-treatment-pdq:diagnosis-tests].
- **Colonoscopy** — a thin, lighted tube called a colonoscope is inserted through the rectum to look inside the entire rectum and colon for polyps, abnormal areas, or cancer; the colonoscope can also remove polyps or take tissue samples for biopsy during the same procedure [citation:nci.types-colorectal-patient-colon-treatment-pdq:diagnosis-tests].
- **Virtual colonoscopy (CT colonography)** — uses a series of X-rays (CT) to make detailed pictures of the colon [citation:nci.types-colorectal-patient-colon-treatment-pdq:diagnosis-tests].
- **Biopsy** — the removal of cells or tissues so they can be viewed under a microscope by a pathologist; biopsy is the test that confirms or rules out colorectal cancer [citation:nci.types-colorectal-patient-colon-treatment-pdq:diagnosis-tests].

If your doctor recommends a biopsy, it is to check whether cancer is present and, if so, to plan treatment — not because cancer has been confirmed [citation:nci.types-colorectal-patient-colon-treatment-pdq:diagnosis-tests]. Tumour tissue from the biopsy may also be checked for gene changes such as those that cause Lynch syndrome, which can guide treatment [citation:nci.types-colorectal-patient-colon-treatment-pdq:diagnosis-tests].

After a colorectal cancer diagnosis, imaging tests such as CT scan, MRI, PET scan, or chest X-ray may be done to find out whether the cancer has spread (this is called staging) [citation:nci.types-colorectal-patient-colon-treatment-pdq:staging-tests]. A blood test called the **carcinoembryonic antigen (CEA) assay** may also be done; CEA can be a marker of colon cancer or other conditions [citation:nci.types-colorectal-patient-colon-treatment-pdq:staging-tests].

In India, colonoscopy is widely available in district hospitals, AIIMS centres, and private hospitals, though out-of-pocket costs in private hospitals can be substantially higher than in government or PMJAY-empanelled centres. {{MISSING_EVIDENCE: Specific India public-vs-private colonoscopy cost ranges are not in current Tier-1 KB sources.}}

## Treatment basics

Treatment for colorectal cancer depends on the stage of the cancer, the location of the tumour, your overall health, and your preferences [citation:nci.types-colorectal-patient-colon-treatment-pdq:treatment-options]. You and your cancer care team will work together to decide a treatment plan, which may include more than one type of treatment [citation:nci.types-colorectal-patient-colon-treatment-pdq:treatment-options]. The main types of treatment used are [citation:nci.types-colorectal-patient-colon-treatment-pdq:treatment-options]:

- **Surgery** — surgery is the most common treatment for all stages of colon cancer [citation:nci.types-colorectal-patient-colon-treatment-pdq:treatment-options]. If the cancer is found in a polyp, the polyp is often removed during a colonoscopy (polypectomy) [citation:nci.types-colorectal-patient-colon-treatment-pdq:treatment-options]. For larger tumours, the surgeon may perform a partial colectomy — removing the cancer and a small amount of healthy tissue around it — and then sew the healthy parts of the colon together (anastomosis) [citation:nci.types-colorectal-patient-colon-treatment-pdq:treatment-options]. In some cases, an opening called a **stoma** is made on the outside of the body for waste to pass through (this is called a colostomy) — sometimes temporary, sometimes permanent [citation:nci.types-colorectal-patient-colon-treatment-pdq:treatment-options].
- **Chemotherapy** — drugs that stop the growth of cancer cells. Chemotherapy may be given before surgery to shrink the tumour, after surgery to lower the risk that the cancer will come back, or as the main treatment for cancer that has spread [citation:nci.types-colorectal-patient-colon-treatment-pdq:treatment-options].
- **Radiation therapy** — uses high-energy X-rays or other types of radiation to kill cancer cells; it is sometimes used in colon cancer and is more often used in rectal cancer [citation:nci.types-colorectal-patient-colon-treatment-pdq:treatment-options].
- **Targeted therapy** — drugs that attack specific features of cancer cells; biomarker tests on the tumour help predict who is likely to benefit [citation:nci.types-colorectal-patient-colon-treatment-pdq:treatment-options].
- **Immunotherapy** — drugs that help the immune system fight cancer; biomarker tests can help predict who is likely to benefit [citation:nci.types-colorectal-patient-colon-treatment-pdq:treatment-options].

Treatment plans are individualized — what is best for one person may not be best for another [citation:nci.types-colorectal-patient-colon-treatment-pdq:treatment-options]. Talking with your cancer care team before treatment begins about what to expect — including how you will feel, how long treatment will take, and what kind of help you will need — is helpful [citation:nci.types-colorectal-patient-colon-treatment-pdq:treatment-options].

In India, much of the cost of colorectal cancer surgery, chemotherapy, radiation therapy, and diagnostic procedures including colonoscopy and biopsy may be covered by Ayushman Bharat (PM-JAY) for eligible families, up to Rs. 5 lakh per family per year [citation:kb_local.pmjay-ayushman-bharat-cancer:cancer-treatment-covered]. Ask the hospital's PMJAY desk before paying out of pocket.

## Questions to ask your doctor

When you visit a doctor about possible colorectal cancer, you may want to ask:

1. What do you think is causing my symptoms — could it be cancer, haemorrhoids, an infection, or something else?
2. Do I need a colonoscopy, stool test, or biopsy? When will I get the results?
3. If it is cancer, what stage is it and what does that mean?
4. Was a biomarker (gene mutation) test done on the tumour? How might the results change my treatment?
5. What are my treatment options — surgery, chemotherapy, radiation, targeted therapy, immunotherapy — and what side effects can I expect?
6. Will I need a colostomy (a stoma bag)? If yes, will it be temporary or permanent?
7. How long will the full treatment take, and how will it affect my eating, work, and daily life?
8. Should I get a second opinion? People often choose to get a second opinion to confirm the diagnosis and treatment plan [citation:nci.types-colorectal-patient-colon-treatment-pdq:second-opinion].
9. Should my close family members be screened earlier, especially if I have Lynch syndrome or familial adenomatous polyposis?
10. Is my treatment covered under PMJAY or any other scheme?

Bring a family member or trusted person to the visit. Write the answers down — it is normal to feel overwhelmed.

## When urgent care is needed

Please seek urgent medical help — go to the nearest hospital or call an ambulance — if you have any of the following:

- Heavy or repeated bleeding from the rectum that does not stop
- Severe abdominal pain that comes on suddenly or gets rapidly worse
- A bloated, hard abdomen with vomiting and inability to pass stool or gas (possible bowel obstruction)
- Vomiting blood, or vomit that looks like coffee grounds
- Fainting, severe dizziness, or a very fast heartbeat (possible signs of heavy blood loss)
- A fever ≥ 100.4°F / 38°C during chemotherapy — this is an emergency
- A severe allergic reaction (sudden swelling of face or throat, full-body rash, difficulty breathing) within 24 hours of a treatment

In India, you can call **108** or **112** for ambulance services. The Indian Cancer Society helpline is **1800-22-1951** for non-emergency questions and support.

If you live in Bihar and need a starting point for colorectal cancer evaluation, Mahavir Cancer Sansthan in Phulwarisharif, Patna is Bihar's super-specialty cancer centre and has surgical, medical, and radiation oncology departments [citation:kb_local.bihar-cancer-navigation-guide:mahavir-cancer-sansthan]. AIIMS Patna also has a developing oncology department, and IGIMS (the State Cancer Institute) in Patna provides cancer care [citation:kb_local.bihar-cancer-navigation-guide:mahavir-cancer-sansthan].
