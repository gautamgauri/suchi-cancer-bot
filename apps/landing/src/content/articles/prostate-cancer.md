---
schema_version: "1.0"
page_id: prostate-cancer
title: "Prostate Cancer: Signs, Diagnosis, and Treatment Basics"
summary: >
  Prostate cancer forms in the prostate gland and is most common in older
  men. This page covers urinary warning signs, diagnosis using the PSA
  test, digital rectal exam (DRE), and biopsy, the screening debate,
  treatment basics including watchful waiting and active surveillance,
  and care in India.
content_type: cancer_type

locale: en
geo_relevance: ["IN-pan", "IN-BR"]
audience: ["patient", "caregiver"]

last_reviewed: 2026-04-28
review_status: ai_draft
version_id: "v1.0.0-2026-04-28-cgp-walked-006"

provenance:
  generator_model: human-walked-example
  generator_run_id: cgp-walked-2026-04-28-006
  pipeline_version: "0.2"
  source_chunks:
    - doc_id: nci.types-prostate
      chunk_id: overview
      source: NCI
    - doc_id: nci.types-prostate-patient-prostate-treatment-pdq
      chunk_id: key-points
      source: NCI
    - doc_id: nci.types-prostate-patient-prostate-treatment-pdq
      chunk_id: what-it-is
      source: NCI
    - doc_id: nci.types-prostate-patient-prostate-treatment-pdq
      chunk_id: signs-symptoms
      source: NCI
    - doc_id: nci.types-prostate-patient-prostate-treatment-pdq
      chunk_id: diagnosis-tests
      source: NCI
    - doc_id: nci.types-prostate-patient-prostate-treatment-pdq
      chunk_id: biopsy-gleason
      source: NCI
    - doc_id: nci.types-prostate-patient-prostate-treatment-pdq
      chunk_id: treatment-options
      source: NCI
    - doc_id: nci.types-prostate-patient-prostate-screening-pdq
      chunk_id: screening-tests
      source: NCI
    - doc_id: nci.types-prostate-patient-prostate-prevention-pdq
      chunk_id: risk-factors
      source: NCI
    - doc_id: kb_local.pmjay-ayushman-bharat-cancer
      chunk_id: cancer-treatment-covered
      source: kb_local
    - doc_id: kb_local.bihar-cancer-navigation-guide
      chunk_id: mahavir-cancer-sansthan
      source: kb_local
  gaps:
    - section: risk-factors
      description: India-specific prostate cancer epidemiology — including reports of rising age-adjusted incidence in urban Indian men and lower historic rates compared with Western populations — is not directly covered in current Tier-1 KB sources. Hedged claims used.
    - section: how-is-prostate-cancer-diagnosed
      description: Specific PSA threshold guidance for Indian men is not directly covered in current Tier-1 KB sources. Numeric PSA cutoffs (e.g., "PSA above 4 ng/mL") referenced in the article come from NCI staging definitions, not from a screening guideline.
  # eval_scores omitted intentionally — populated by Module 7 (Eval gate) in production.

related_pages:
  - urinary-symptoms-in-men
  - what-to-do-after-cancer-diagnosis
  - questions-to-ask-your-doctor
  - psa-test
  - biopsy
  - cancer-care-in-bihar

tags:
  cancer_types: ["prostate"]
  situations: ["newly-diagnosed", "prevention"]
  topics: ["symptoms", "diagnosis", "treatment", "screening", "psa-test", "dre", "biopsy", "gleason-score"]
  clinical_category: genitourinary

featured: false
---

> **Important:** This page is for general information only and is not a diagnosis. Please see a doctor if you have new urinary symptoms, blood in urine or semen, or other changes that worry you, especially if you are over 50.

## What is prostate cancer?

Prostate cancer is a type of cancer that forms in the tissues of the prostate [citation:nci.types-prostate-patient-prostate-treatment-pdq:key-points] [citation:nci.types-prostate-patient-prostate-treatment-pdq:what-it-is]. The prostate is a gland in the male reproductive system; it lies just below the bladder and in front of the rectum, is about the size of a walnut, and surrounds part of the urethra (the tube that empties urine from the bladder) [citation:nci.types-prostate-patient-prostate-treatment-pdq:what-it-is]. The prostate gland makes fluid that is part of the semen [citation:nci.types-prostate-patient-prostate-treatment-pdq:what-it-is].

Prostate cancer is most common in older men [citation:nci.types-prostate-patient-prostate-treatment-pdq:what-it-is]. It usually grows very slowly, and most men diagnosed with prostate cancer do not die of it [citation:nci.types-prostate:overview]. Finding and treating prostate cancer before symptoms occur may not always improve a man's health or help him live longer — which is why screening for prostate cancer is a more nuanced decision than for some other cancers [citation:nci.types-prostate:overview].

## Common warning signs

Signs of prostate cancer may include a weak flow of urine or frequent urination [citation:nci.types-prostate-patient-prostate-treatment-pdq:key-points]. These and other signs and symptoms may be caused by prostate cancer or by other conditions. Check with your doctor if you have [citation:nci.types-prostate-patient-prostate-treatment-pdq:signs-symptoms]:

- Trouble starting the flow of urine
- Frequent urination, especially at night
- Trouble emptying the bladder completely
- Weak or interrupted ("stop-and-go") flow of urine

When prostate cancer is detected at a more advanced stage, symptoms may also include [citation:nci.types-prostate-patient-prostate-treatment-pdq:signs-symptoms]:

- Pain in the back, hips, or pelvis that does not go away
- Shortness of breath, feeling very tired, fast heartbeat, dizziness, or pale skin (caused by anaemia)

Many of these symptoms can also be caused by **benign prostatic hyperplasia (BPH)**, a non-cancer condition in which the prostate gets bigger as men age and presses on the bladder and urethra [citation:nci.types-prostate-patient-prostate-treatment-pdq:signs-symptoms]. BPH is common and treatable, but its symptoms can look like prostate cancer symptoms — so they should be evaluated by a doctor [citation:nci.types-prostate-patient-prostate-treatment-pdq:signs-symptoms].

## Risk factors

Risk factors for prostate cancer include [citation:nci.types-prostate-patient-prostate-prevention-pdq:risk-factors]:

- **Age** — prostate cancer is rare in men younger than 50; the chance of developing prostate cancer increases as men get older [citation:nci.types-prostate-patient-prostate-prevention-pdq:risk-factors]
- **Family history** — a man whose father, brother, or son has had prostate cancer has a higher-than-average risk [citation:nci.types-prostate-patient-prostate-prevention-pdq:risk-factors]
- **Race** — prostate cancer occurs more often in African American men than in White men, and African American men with prostate cancer are more likely to die from the disease [citation:nci.types-prostate-patient-prostate-prevention-pdq:risk-factors]
- **Inherited gene changes**, such as in *BRCA1* or *BRCA2* genes
- **Hormones** — male sex hormones (such as testosterone and DHT) may play a part in the development of prostate cancer [citation:nci.types-prostate-patient-prostate-prevention-pdq:risk-factors]
- **Vitamin E supplements taken alone** have been linked to increased prostate cancer risk in a large prevention trial [citation:nci.types-prostate-patient-prostate-prevention-pdq:risk-factors]
- **Folic acid supplements** at 1 mg per day have been linked to increased risk in some studies [citation:nci.types-prostate-patient-prostate-prevention-pdq:risk-factors]
- **A diet high in dairy foods and calcium** may cause a small increase in risk [citation:nci.types-prostate-patient-prostate-prevention-pdq:risk-factors]

Having one or more risk factors does not mean you will get prostate cancer; many men with risk factors never develop the disease, and some men with no known risk factors do.

In India, prostate cancer has historically been less common than in many Western populations but is one of the cancers a urologist sees often, particularly in older men presenting with urinary symptoms. {{MISSING_EVIDENCE: India-specific prostate cancer incidence and trends in urban Indian men are widely discussed clinically but not directly covered in current Tier-1 KB sources.}} If you have a strong family history of prostate cancer or a known *BRCA1* / *BRCA2* gene change, talk to a doctor about whether earlier evaluation is appropriate.

## When to seek medical attention

Please see a doctor or urologist for evaluation if you have any of the following:

- New or worsening urinary symptoms (weak stream, hesitancy, frequent night-time urination) that last more than 4 weeks
- Blood in the urine or semen, even once
- New, persistent pain in the back, hips, or pelvis that lasts more than 2 weeks and is not explained by injury
- Inability to urinate at all (this is a medical emergency — see "When urgent care is needed" below)
- Erection problems that develop alongside other urinary symptoms

For men over 50 — or earlier if there is a family history — it is reasonable to discuss prostate health with a doctor at a routine check-up, even without symptoms. The decision about whether to screen with a PSA test or DRE is one to make with your doctor (see below).

## How is prostate cancer diagnosed?

Tests that examine the prostate and blood are used to diagnose prostate cancer [citation:nci.types-prostate-patient-prostate-treatment-pdq:key-points]. In addition to asking about your personal and family health history and doing a physical exam, your doctor may perform [citation:nci.types-prostate-patient-prostate-treatment-pdq:diagnosis-tests]:

- **Digital rectal exam (DRE)** — an exam of the rectum in which the doctor or nurse inserts a lubricated, gloved finger into the rectum and feels the prostate through the rectal wall for lumps or abnormal areas [citation:nci.types-prostate-patient-prostate-treatment-pdq:diagnosis-tests].
- **Prostate-specific antigen (PSA) test** — a blood test that measures the level of PSA in the blood. PSA is a substance made by the prostate that may be found in higher than normal amounts in the blood of men who have prostate cancer [citation:nci.types-prostate-patient-prostate-treatment-pdq:diagnosis-tests]. PSA levels can also be high in men who have an infection or inflammation of the prostate, or BPH (an enlarged but non-cancerous prostate) [citation:nci.types-prostate-patient-prostate-treatment-pdq:diagnosis-tests].
- **Transrectal ultrasound** — a probe about the size of a finger is inserted into the rectum to check the prostate; sound waves form a sonogram (ultrasound picture) that may also be used to guide a biopsy [citation:nci.types-prostate-patient-prostate-treatment-pdq:diagnosis-tests].
- **Transrectal MRI** — a probe is inserted into the rectum near the prostate so the MRI machine can make clearer pictures of the prostate; it can be used during a biopsy procedure [citation:nci.types-prostate-patient-prostate-treatment-pdq:diagnosis-tests].
- **PSMA PET scan** — an imaging procedure used to help find prostate cancer cells that have spread outside of the prostate [citation:nci.types-prostate-patient-prostate-treatment-pdq:diagnosis-tests].

A **biopsy** is done to diagnose prostate cancer and find out the grade of the cancer (Gleason score) [citation:nci.types-prostate-patient-prostate-treatment-pdq:biopsy-gleason]. A transrectal biopsy is the removal of tissue from the prostate by inserting a thin needle through the rectum into the prostate, often guided by transrectal ultrasound or MRI; a pathologist views the tissue under a microscope to look for cancer cells [citation:nci.types-prostate-patient-prostate-treatment-pdq:biopsy-gleason]. If cancer is found, the pathologist gives the cancer a grade — the **Gleason score** — that describes how abnormal the cells look and how quickly the cancer is likely to grow and spread [citation:nci.types-prostate-patient-prostate-treatment-pdq:biopsy-gleason]. The Gleason score ranges from 6 to 10; a score of 6 is low-grade, 7 is medium-grade, and 8 to 10 is high-grade [citation:nci.types-prostate-patient-prostate-treatment-pdq:biopsy-gleason].

**Screening**: There is no standard or routine screening test for prostate cancer [citation:nci.types-prostate-patient-prostate-screening-pdq:screening-tests]. The PSA test and DRE may be able to detect prostate cancer at an early stage, but it is not clear whether early detection and treatment decrease the risk of dying from prostate cancer for most men [citation:nci.types-prostate-patient-prostate-screening-pdq:screening-tests]. Screening also has risks: finding cancer that may never cause symptoms, complications from a follow-up biopsy, and false-positive or false-negative results [citation:nci.types-prostate-patient-prostate-screening-pdq:screening-tests]. For most men, the decision to have a PSA test should be a shared decision with the doctor, weighing your age, family history, and personal preferences. {{MISSING_EVIDENCE: Numeric PSA cutoffs specific to Indian men or to age-adjusted screening guidelines are not directly covered in current Tier-1 KB sources.}}

## Treatment basics

Prostate cancer treatment depends on the stage of the cancer (PSA level, Gleason score / Grade Group, and how much of the prostate is affected and whether it has spread), your age, your overall health, and your preferences [citation:nci.types-prostate-patient-prostate-treatment-pdq:key-points] [citation:nci.types-prostate-patient-prostate-treatment-pdq:treatment-options]. Treatment may include one or more of the following [citation:nci.types-prostate-patient-prostate-treatment-pdq:treatment-options]:

- **Watchful waiting or active surveillance** — for older men or men with slow-growing, low-risk cancer, doctors may recommend closely monitoring the cancer without immediate treatment [citation:nci.types-prostate-patient-prostate-treatment-pdq:treatment-options]. **Active surveillance** uses regular DRE, PSA tests, transrectal ultrasound, and repeat biopsies to look for early signs that the cancer is growing; if it begins to grow, treatment is given [citation:nci.types-prostate-patient-prostate-treatment-pdq:treatment-options]. **Watchful waiting** is closely monitoring without treatment until symptoms appear or change [citation:nci.types-prostate-patient-prostate-treatment-pdq:treatment-options].
- **Surgery** — for men in good health whose tumour is in the prostate gland only, **radical prostatectomy** removes the prostate, surrounding tissue, and seminal vesicles; nearby lymph nodes may also be removed [citation:nci.types-prostate-patient-prostate-treatment-pdq:treatment-options]. Possible problems after prostate surgery include impotence, leakage of urine, and shortening of the penis [citation:nci.types-prostate-patient-prostate-treatment-pdq:treatment-options].
- **Radiation therapy** — uses high-energy X-rays or other types of radiation to kill cancer cells. **External beam radiation** uses a machine outside the body; **internal radiation** (brachytherapy) uses radioactive seeds placed in the prostate [citation:nci.types-prostate-patient-prostate-treatment-pdq:treatment-options]. Radiation therapy can cause impotence and urinary problems [citation:nci.types-prostate-patient-prostate-treatment-pdq:treatment-options].
- **Hormone therapy (androgen deprivation therapy, ADT)** — uses drugs or surgery to lower the amount of male hormones or block their action so that prostate cancer cells stop growing [citation:nci.types-prostate-patient-prostate-treatment-pdq:treatment-options]. Side effects can include hot flushes, impaired sexual function, loss of desire for sex, and weakened bones [citation:nci.types-prostate-patient-prostate-treatment-pdq:treatment-options].
- **Chemotherapy** — drugs that stop the growth of cancer cells, usually given by vein, used mainly when prostate cancer has spread or is no longer responding to hormone therapy [citation:nci.types-prostate-patient-prostate-treatment-pdq:treatment-options].
- **Targeted therapy** — drugs that attack specific features of cancer cells; for example, PARP inhibitors may be used in men with prostate cancer that has spread and has mutations in *BRCA1*, *BRCA2*, or related genes [citation:nci.types-prostate-patient-prostate-treatment-pdq:treatment-options].
- **Immunotherapy** — uses the patient's immune system to fight cancer; sipuleucel-T is a type of immunotherapy used to treat prostate cancer that has spread to other parts of the body [citation:nci.types-prostate-patient-prostate-treatment-pdq:treatment-options].

For prostate cancer that has spread to the bone, treatments such as radiopharmaceuticals (e.g., radium-223), bisphosphonates, or denosumab may be used to lessen bone pain or reduce the risk of fractures [citation:nci.types-prostate-patient-prostate-treatment-pdq:treatment-options]. Treatment plans are individualized — what is best for one man may not be best for another.

In India, much of the cost of prostate cancer surgery, chemotherapy, hormone therapy, radiation therapy, and diagnostic procedures including biopsy may be covered by Ayushman Bharat (PM-JAY) for eligible families, up to Rs. 5 lakh per family per year [citation:kb_local.pmjay-ayushman-bharat-cancer:cancer-treatment-covered]. Ask the hospital's PMJAY desk before paying out of pocket.

## Questions to ask your doctor

When you visit a doctor about possible prostate cancer or after a prostate cancer diagnosis, you may want to ask:

1. What do you think is causing my urinary symptoms — could it be cancer, BPH, an infection, or something else?
2. Should I have a PSA test or DRE, given my age, family history, and overall health?
3. If my PSA is high, what does it mean? Could it be from BPH or an infection rather than cancer?
4. Do I need a biopsy? What are the risks and what will the procedure involve?
5. If it is cancer, what is my Gleason score / Grade Group, what stage is the cancer, and what does that mean?
6. Should we consider active surveillance or watchful waiting, or do I need treatment now?
7. What are my treatment options — surgery, radiation, hormone therapy — and what side effects (urinary, sexual, bowel) can I expect?
8. Should I get a second opinion to confirm the diagnosis and treatment plan?
9. Is my treatment covered under PMJAY or any other scheme?
10. Are there clinical trials I should consider?

Bring a family member or trusted person to the visit. Write the answers down — it is normal to feel overwhelmed.

## When urgent care is needed

Please seek urgent medical help — go to the nearest hospital or call an ambulance — if you have any of the following:

- **Inability to urinate at all** (acute urinary retention) — this needs urgent care, usually within 24 hours
- Heavy or repeated bleeding in the urine
- Severe back, hip, or pelvic pain that comes on suddenly, especially with weakness or numbness in the legs (possible spinal-cord compression — a medical emergency)
- Sudden inability to move the legs or new loss of bladder or bowel control
- A fever ≥ 100.4°F / 38°C during chemotherapy — this is an emergency
- A severe allergic reaction (sudden swelling of face or throat, full-body rash, difficulty breathing) within 24 hours of a treatment

In India, you can call **108** or **112** for ambulance services. The Indian Cancer Society helpline is **1800-22-1951** for non-emergency questions and support.

If you live in Bihar and need a starting point for prostate cancer evaluation, Mahavir Cancer Sansthan in Phulwarisharif, Patna is Bihar's super-specialty cancer centre and has surgical, medical, and radiation oncology departments [citation:kb_local.bihar-cancer-navigation-guide:mahavir-cancer-sansthan]. AIIMS Patna also has a developing oncology department, and IGIMS (the State Cancer Institute) in Patna provides cancer care [citation:kb_local.bihar-cancer-navigation-guide:mahavir-cancer-sansthan].
