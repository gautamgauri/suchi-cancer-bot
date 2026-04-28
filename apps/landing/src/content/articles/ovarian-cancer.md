---
schema_version: "1.0"
page_id: ovarian-cancer
title: "Ovarian Cancer: Signs, Diagnosis, and Treatment Basics"
summary: >
  Ovarian cancer often causes no early symptoms and is frequently
  diagnosed at an advanced stage. This page covers warning signs such
  as bloating and pelvic pain, diagnosis using pelvic exam, transvaginal
  ultrasound, CA-125 blood test, and biopsy, treatment basics, and
  care in India.
content_type: cancer_type

locale: en
geo_relevance: ["IN-pan", "IN-BR"]
audience: ["patient", "caregiver"]

last_reviewed: 2026-04-28
review_status: ai_draft
version_id: "v1.0.0-2026-04-28-cgp-walked-007"

provenance:
  generator_model: human-walked-example
  generator_run_id: cgp-walked-2026-04-28-007
  pipeline_version: "0.2"
  source_chunks:
    - doc_id: nci.types-ovarian
      chunk_id: overview
      source: NCI
    - doc_id: nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq
      chunk_id: key-points
      source: NCI
    - doc_id: nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq
      chunk_id: what-it-is
      source: NCI
    - doc_id: nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq
      chunk_id: risk-factors
      source: NCI
    - doc_id: nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq
      chunk_id: hereditary
      source: NCI
    - doc_id: nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq
      chunk_id: signs-symptoms
      source: NCI
    - doc_id: nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq
      chunk_id: diagnosis-tests
      source: NCI
    - doc_id: nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq
      chunk_id: treatment-options
      source: NCI
    - doc_id: nci.types-ovarian-patient-ovarian-screening-pdq
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
      description: India-specific epidemiology — including the typical late-stage presentation pattern reported clinically and the limited availability of BRCA testing in many Indian centres — is referenced in clinical literature but not directly covered in current Tier-1 KB sources. Hedged claims used.
    - section: how-is-ovarian-cancer-diagnosed
      description: India-specific availability and cost of CA-125 testing and BRCA genetic testing across public vs private hospitals is not directly covered in current Tier-1 KB sources.
  # eval_scores omitted intentionally — populated by Module 7 (Eval gate) in production.

related_pages:
  - persistent-bloating
  - what-to-do-after-cancer-diagnosis
  - questions-to-ask-your-doctor
  - transvaginal-ultrasound
  - ca-125-blood-test
  - biopsy
  - cancer-care-in-bihar

tags:
  cancer_types: ["ovarian"]
  situations: ["newly-diagnosed"]
  topics: ["symptoms", "diagnosis", "treatment", "ca-125", "transvaginal-ultrasound", "biopsy", "brca"]
  clinical_category: gynecologic

featured: false
---

> **Important:** This page is for general information only and is not a diagnosis. Please see a doctor if you have persistent bloating, pelvic pain, or other symptoms that worry you.

## What is ovarian cancer?

Ovarian cancer is cancer that forms in the tissue covering the ovary [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:what-it-is]. The ovaries are a pair of organs in the female reproductive system; they are in the pelvis, one on each side of the uterus, and each ovary is about the size and shape of an almond [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:what-it-is]. The ovaries make eggs and female hormones [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:what-it-is].

**Ovarian epithelial cancer**, **fallopian tube cancer**, and **primary peritoneal cancer** form in the same type of tissue and are treated the same way [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:key-points] [citation:nci.types-ovarian:overview]. Cancer sometimes begins at the end of the fallopian tube near the ovary and spreads to the ovary; cancer can also begin in the peritoneum (the tissue lining the abdominal wall) and spread to the ovary [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:what-it-is]. These cancers are often advanced at diagnosis [citation:nci.types-ovarian:overview].

Less common types include **ovarian germ cell tumours** and **ovarian low malignant potential (borderline) tumours**, which have their own treatment approaches.

## Common warning signs

Ovarian, fallopian tube, or peritoneal cancer may not cause early signs or symptoms; when signs or symptoms do appear, the cancer is often advanced [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:signs-symptoms]. Signs and symptoms may include [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:signs-symptoms]:

- **Pain, swelling, or a feeling of pressure in the abdomen or pelvis**
- **A sudden or frequent urge to urinate**
- **Trouble eating or feeling full quickly** (early satiety)
- **A lump in the pelvic area**
- **Gastrointestinal problems** — gas, bloating, or constipation

These signs and symptoms may be caused by other conditions and not by ovarian, fallopian tube, or peritoneal cancer [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:signs-symptoms]. Bloating, urinary symptoms, and abdominal discomfort are very common and most often caused by non-cancer issues. **But if these symptoms get worse or do not go away on their own, please check with your doctor so that any problem can be diagnosed and treated as early as possible** [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:signs-symptoms].

## Risk factors

Risk factors for ovarian cancer include [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:risk-factors]:

- **Family history of ovarian cancer** in a first-degree relative (mother, daughter, or sister) [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:risk-factors]
- **Inherited changes in the *BRCA1* or *BRCA2* genes** [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:risk-factors]
- **Other hereditary conditions**, such as hereditary nonpolyposis colorectal cancer (HNPCC; also called Lynch syndrome) [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:risk-factors]
- **Endometriosis** [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:risk-factors]
- **Postmenopausal hormone therapy** [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:risk-factors]
- **Obesity** [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:risk-factors]
- **Tall height** [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:risk-factors]
- **Older age** — the chance of getting cancer increases as you get older [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:risk-factors]

Hereditary ovarian cancer makes up about 20% of all cases [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:hereditary]. There are three hereditary patterns: ovarian cancer alone, ovarian and breast cancers, and ovarian and colon cancers [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:hereditary]. **Genetic testing** to detect *BRCA1*, *BRCA2*, or other gene changes is sometimes done for members of families with a high risk of cancer [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:hereditary]. Some women with an increased risk of ovarian cancer may consider **risk-reducing surgery** (oophorectomy — the removal of healthy ovaries) to greatly decrease the risk [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:hereditary].

Having a risk factor does not mean you will get cancer; not having risk factors does not mean you will not get cancer [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:risk-factors]. Talk to your doctor if you think you may be at risk for ovarian cancer.

In India, ovarian cancer may more often be diagnosed at a later stage because routine screening is not effective and family-history awareness can be limited. {{MISSING_EVIDENCE: India-specific stage-at-presentation patterns and the limited availability of BRCA testing in many Indian centres are referenced in clinical literature but not directly covered in current Tier-1 KB sources.}} If a close female relative has had ovarian or breast cancer at a young age, or if multiple relatives have been affected, ask a doctor whether genetic counselling is appropriate for you.

## When to seek medical attention

Please see a doctor or gynaecologist for evaluation if you have any of the following:

- **Bloating, abdominal swelling, or pelvic pressure that lasts more than 2 to 3 weeks** and does not come and go with your menstrual cycle [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:signs-symptoms]
- **Persistent pelvic or abdominal pain** lasting more than 2 weeks
- **Feeling full quickly or trouble eating** that lasts more than 2 to 3 weeks and is new for you
- **A new urinary urge or frequent urination** lasting more than 2 weeks that is not explained by infection
- **A lump or fullness you can feel in your pelvis or lower abdomen**
- **Unexplained weight loss** of more than a few kilograms over a few months
- **Postmenopausal bleeding** (any vaginal bleeding after menopause should be checked, even if it is not specific to ovarian cancer)

Because there is no reliable screening test for ovarian cancer in women at average risk [citation:nci.types-ovarian-patient-ovarian-screening-pdq:screening-tests], paying attention to these "soft" but persistent symptoms is the most important thing you can do.

## How is ovarian cancer diagnosed?

Tests that examine the ovaries and pelvic area are used to diagnose and stage ovarian epithelial, fallopian tube, and peritoneal cancers [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:key-points]. The following tests and procedures may be used [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:diagnosis-tests]:

- **Physical exam and health history** — a check for general signs of health, including lumps or anything else that seems unusual [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:diagnosis-tests].
- **Pelvic exam** — an exam of the vagina, cervix, uterus, fallopian tubes, ovaries, and rectum. A speculum is inserted into the vagina, the doctor or nurse looks at the vagina and cervix for signs of disease, and a Pap test of the cervix is usually done. The doctor or nurse also inserts gloved fingers into the vagina and places the other hand over the lower abdomen to feel the size, shape, and position of the uterus and ovaries [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:diagnosis-tests].
- **CA-125 blood test (CA-125 assay)** — measures the level of CA-125 in the blood. CA-125 is a substance released by cells into the bloodstream; an increased CA-125 level can be a sign of cancer or another condition such as endometriosis [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:diagnosis-tests].
- **Ultrasound exam** — high-energy sound waves are bounced off internal tissues to make a picture (a sonogram). Many women with possible ovarian symptoms have a **transvaginal ultrasound**, in which an ultrasound probe is inserted into the vagina to give a clearer picture of the uterus, fallopian tubes, ovaries, and bladder [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:diagnosis-tests].
- **CT scan** — uses a computer linked to an X-ray machine to make detailed 3-D pictures of the abdomen and pelvis; a dye may be injected into a vein or swallowed to help organs show up more clearly [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:diagnosis-tests].
- **MRI** — uses a magnet, radio waves, and a computer to make detailed pictures of areas inside the body [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:diagnosis-tests].
- **PET scan** — a small amount of radioactive sugar is injected into a vein; cancer cells show up brighter because they take up more sugar than normal cells [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:diagnosis-tests].
- **Chest X-ray** — to check whether the cancer has spread to the lungs [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:diagnosis-tests].
- **Biopsy** — the removal of cells or tissues so they can be viewed under a microscope by a pathologist to check for signs of cancer; for ovarian cancer, the tissue is usually removed during surgery to remove the tumour [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:diagnosis-tests].

**Screening note**: Pelvic exam, transvaginal ultrasound, and CA-125 blood test have been studied as screening tests for ovarian cancer in women at average risk, but none has been shown to lower the number of deaths from ovarian cancer [citation:nci.types-ovarian-patient-ovarian-screening-pdq:screening-tests]. There is currently no recommended routine screening test for ovarian cancer for women at average risk [citation:nci.types-ovarian-patient-ovarian-screening-pdq:screening-tests]. These tests are used differently — for diagnosis when symptoms are present, or for closer monitoring in women at very high risk (for example, women with *BRCA1* / *BRCA2* mutations).

## Treatment basics

Treatment of ovarian, fallopian tube, and primary peritoneal cancers depends on the type of cancer, the stage and grade, whether all of the tumour can be removed by surgery, *BRCA1* / *BRCA2* gene status, your age and general health, and whether the cancer has just been diagnosed or has come back [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:key-points]. Treatment is often **multimodal** — combining more than one of the following [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:treatment-options]:

- **Surgery** — most patients have surgery to remove as much of the tumour as possible [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:treatment-options]. Different types of surgery may include hysterectomy (removal of the uterus and sometimes the cervix), unilateral or bilateral salpingo-oophorectomy (removal of one or both ovaries and fallopian tubes), omentectomy (removal of the omentum), and lymph node biopsy [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:treatment-options].
- **Chemotherapy** — drugs that stop the growth of cancer cells, given by mouth, vein, or muscle (systemic chemotherapy), or directly into the abdominal cavity through a thin tube (**intraperitoneal (IP) chemotherapy**) [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:treatment-options]. Treatment with more than one anticancer drug is called combination chemotherapy [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:treatment-options].
- **Targeted therapy** — drugs that attack specific features of cancer cells [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:treatment-options]. **Bevacizumab**, a monoclonal antibody and angiogenesis inhibitor, may be used with chemotherapy to treat ovarian epithelial, fallopian tube, or primary peritoneal cancer that has come back [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:treatment-options]. **PARP inhibitors** such as olaparib, rucaparib, and niraparib may be used as maintenance therapy in certain ovarian cancers, especially those with *BRCA1* / *BRCA2* mutations [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:treatment-options].
- **Radiation therapy and immunotherapy** — these are being studied in clinical trials for ovarian cancer; intraperitoneal radiation therapy and vaccine-based immunotherapy are among the approaches under investigation [citation:nci.types-ovarian-patient-ovarian-epithelial-treatment-pdq:treatment-options].

Treatment plans are individualized — what is best for one woman may not be best for another. Talking with your cancer care team before treatment begins about what to expect, including how it will affect your daily life and how long it will take, is helpful.

In India, much of the cost of ovarian cancer surgery, chemotherapy, radiation therapy, and diagnostic procedures including biopsy may be covered by Ayushman Bharat (PM-JAY) for eligible families, up to Rs. 5 lakh per family per year [citation:kb_local.pmjay-ayushman-bharat-cancer:cancer-treatment-covered]. Ask the hospital's PMJAY desk before paying out of pocket.

## Questions to ask your doctor

When you visit a doctor about possible ovarian cancer or after an ovarian cancer diagnosis, you may want to ask:

1. What do you think is causing my bloating or pelvic symptoms — could it be cancer, endometriosis, fibroids, or something else?
2. Do I need a pelvic exam, transvaginal ultrasound, CA-125 test, or other tests? When will I get the results?
3. If it is cancer, what type and stage is it, and what does that mean?
4. Should I have genetic testing for *BRCA1*, *BRCA2*, or Lynch syndrome? How might the results change my treatment or affect my family?
5. What are my treatment options — surgery, chemotherapy, targeted therapy — and what side effects can I expect?
6. Will surgery affect my ability to have children, and is fertility preservation an option for me?
7. How many surgeries and cycles of chemotherapy am I likely to need?
8. Should I get a second opinion to confirm the diagnosis and treatment plan?
9. Should my close female family members consider screening or genetic counselling?
10. Is my treatment covered under PMJAY or any other scheme?

Bring a family member or trusted person to the visit. Write the answers down — it is normal to feel overwhelmed.

## When urgent care is needed

Please seek urgent medical help — go to the nearest hospital or call an ambulance — if you have any of the following:

- Severe abdominal or pelvic pain that comes on suddenly
- A bloated, hard abdomen with vomiting and inability to pass stool or gas (possible bowel obstruction)
- Heavy or repeated vaginal bleeding, especially if you are postmenopausal
- Sudden severe shortness of breath or chest pain (possible blood clot, an emergency)
- Sudden swelling and pain in one leg (possible deep vein thrombosis)
- A fever ≥ 100.4°F / 38°C during chemotherapy — this is an emergency
- A severe allergic reaction (sudden swelling of face or throat, full-body rash, difficulty breathing) within 24 hours of a treatment

In India, you can call **108** or **112** for ambulance services. The Indian Cancer Society helpline is **1800-22-1951** for non-emergency questions and support.

If you live in Bihar and need a starting point for ovarian cancer evaluation, Mahavir Cancer Sansthan in Phulwarisharif, Patna is Bihar's super-specialty cancer centre and has surgical, medical, and radiation oncology departments [citation:kb_local.bihar-cancer-navigation-guide:mahavir-cancer-sansthan]. AIIMS Patna also has a developing oncology department, and IGIMS (the State Cancer Institute) in Patna provides cancer care [citation:kb_local.bihar-cancer-navigation-guide:mahavir-cancer-sansthan].
