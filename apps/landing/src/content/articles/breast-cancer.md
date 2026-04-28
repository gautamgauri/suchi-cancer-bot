---
schema_version: "1.0"
page_id: breast-cancer
title: "Breast Cancer: Signs, Diagnosis, and Treatment Basics"
summary: >
  Breast cancer starts in the breast tissue. Early breast cancer often has
  no symptoms, which is why screening matters. This page covers warning
  signs, when to seek care, how breast cancer is diagnosed with mammogram,
  ultrasound, and biopsy, what treatment involves, and how to find care
  in India.
content_type: cancer_type

locale: en
geo_relevance: ["IN-pan", "IN-BR"]
audience: ["patient", "caregiver"]

last_reviewed: 2026-04-28
review_status: ai_draft
version_id: "v1.0.0-2026-04-28-cgp-walked-002"

provenance:
  generator_model: human-walked-example
  generator_run_id: cgp-walked-2026-04-28-002
  pipeline_version: "0.2"
  source_chunks:
    - doc_id: nci.types-breast-what-is-breast-cancer
      chunk_id: what-it-is
      source: NCI
    - doc_id: nci.types-breast-symptoms
      chunk_id: signs-symptoms
      source: NCI
    - doc_id: nci.types-breast-causes-risk-factors
      chunk_id: risk-factors
      source: NCI
    - doc_id: nci.types-breast-diagnosis
      chunk_id: diagnosis-tests
      source: NCI
    - doc_id: nci.types-breast-diagnosis
      chunk_id: biopsy
      source: NCI
    - doc_id: nci.types-breast-diagnosis
      chunk_id: second-opinion
      source: NCI
    - doc_id: nci.types-breast-treatment
      chunk_id: treatment-options
      source: NCI
    - doc_id: nci.types-breast-screening-mammograms
      chunk_id: screening
      source: NCI
    - doc_id: kb_local.breast-cancer-diagnosis-pathway-india
      chunk_id: warning-signs
      source: kb_local
    - doc_id: kb_local.breast-cancer-diagnosis-pathway-india
      chunk_id: emergency-warning-signs
      source: kb_local
    - doc_id: kb_local.pmjay-ayushman-bharat-cancer
      chunk_id: cancer-treatment-covered
      source: kb_local
    - doc_id: kb_local.bihar-cancer-navigation-guide
      chunk_id: mahavir-cancer-sansthan
      source: kb_local
  # eval_scores omitted intentionally — populated by Module 7 (Eval gate) in production.

related_pages:
  - breast-lump
  - what-to-do-after-cancer-diagnosis
  - questions-to-ask-your-doctor
  - mammogram
  - biopsy
  - cancer-care-in-bihar

tags:
  cancer_types: ["breast"]
  situations: ["newly-diagnosed", "prevention"]
  topics: ["symptoms", "diagnosis", "treatment", "screening", "mammogram", "ultrasound", "biopsy"]
  clinical_category: breast

featured: false
---

> **Important:** This page is for general information only and is not a diagnosis. Please see a doctor if you notice any breast change or are worried about possible cancer symptoms.

## What is breast cancer?

Breast cancer is cancer that starts in the breast [citation:nci.types-breast-what-is-breast-cancer:what-it-is]. It can begin in one or both breasts, and it happens when cells in the breast grow out of control and form a mass called a tumor that may spread elsewhere in the body [citation:nci.types-breast-what-is-breast-cancer:what-it-is]. Breast cancer mostly affects women aged 45 and older, but anyone with breast tissue can get breast cancer; it is rare in children and males [citation:nci.types-breast-what-is-breast-cancer:what-it-is].

Most breast cancers begin in the milk ducts and are called ductal cancers; some begin in the lobules (the tiny glands that make milk) and are called lobular cancers [citation:nci.types-breast-what-is-breast-cancer:what-it-is]. When abnormal cells stay within the ducts or lobules, the cancer is called carcinoma in situ; when they spread into surrounding breast tissue, it is called invasive breast cancer [citation:nci.types-breast-what-is-breast-cancer:what-it-is].

## Common warning signs

Early breast cancer often has no symptoms, which is why screening with a mammogram is important [citation:nci.types-breast-symptoms:signs-symptoms]. When symptoms do occur, they may include [citation:nci.types-breast-symptoms:signs-symptoms]:

- A lump or thickening in or near your breast, or under your arm
- A change in the size or shape of the breast
- Fluid or discharge from the nipple that is not breast milk (especially if it is bloody)
- A change in the shape of the nipple, or the nipple turning inward (retraction)
- Scaly, red, or darkened skin on the breast, nipple, or areola
- General swelling on the breast, even if there is no lump
- Dimples or puckering of the breast skin
- Itching or tingling in the nipple or areola

Most breast changes are not cancer [citation:nci.types-breast-symptoms:signs-symptoms]. Many lumps turn out to be benign cysts, hormonal changes, or other non-cancer conditions [citation:nci.types-breast-symptoms:signs-symptoms]. But if you or your doctor finds a breast change, it is important to follow up — even if your last mammogram was normal [citation:nci.types-breast-symptoms:signs-symptoms].

Breast cancer does not usually cause pain in early stages, but persistent breast pain that does not go away should be checked by a doctor [citation:nci.types-breast-symptoms:signs-symptoms] [citation:kb_local.breast-cancer-diagnosis-pathway-india:warning-signs].

## Risk factors

Risk factors are things that increase the chance of getting a disease [citation:nci.types-breast-causes-risk-factors:risk-factors]. Having one or more risk factors does not mean you will get breast cancer, and some people with no known risk factors do develop the disease [citation:nci.types-breast-causes-risk-factors:risk-factors]. The most important risk factor for breast cancer, after being female, is increasing age [citation:nci.types-breast-causes-risk-factors:risk-factors].

Factors that may raise the risk of breast cancer include [citation:nci.types-breast-causes-risk-factors:risk-factors]:

- Increasing age (most breast cancers occur in women aged 45 and older)
- A personal history of breast cancer or of certain non-cancer breast conditions such as ductal carcinoma in situ (DCIS)
- A family history of breast cancer in a first-degree relative (mother, daughter, or sister)
- Inherited gene changes, such as in *BRCA1*, *BRCA2*, *PALB2*, or other breast-cancer-related genes
- Having dense breast tissue
- Past radiation therapy to the chest, especially before age 30
- Excess body weight, especially after menopause
- Drinking alcohol — the more alcohol, the greater the risk
- Not being physically active, especially after menopause
- Reproductive factors that increase lifetime exposure to estrogen, such as starting periods at a young age, late menopause, late first birth, never having carried a pregnancy to term, or never having breastfed

If you have a strong family history of breast cancer or a known gene change, talk to a doctor about whether earlier or more frequent screening may be right for you [citation:nci.types-breast-causes-risk-factors:risk-factors].

## When to seek medical attention

Please see a doctor for evaluation if you notice any of the following:

- A new lump or thickening in the breast or underarm that does not go away after one menstrual cycle (about 4 weeks) [citation:kb_local.breast-cancer-diagnosis-pathway-india:warning-signs]
- A change in breast size or shape that lasts more than 2 weeks [citation:kb_local.breast-cancer-diagnosis-pathway-india:warning-signs]
- Nipple discharge that is not breast milk, especially if it is bloody [citation:nci.types-breast-symptoms:signs-symptoms]
- The nipple turning inward (retraction) or a new flattening of the nipple [citation:nci.types-breast-symptoms:signs-symptoms]
- Redness, scaling, or thickening of the nipple or breast skin that lasts more than 2 weeks [citation:kb_local.breast-cancer-diagnosis-pathway-india:warning-signs]
- Persistent breast pain that does not go away with your menstrual cycle [citation:kb_local.breast-cancer-diagnosis-pathway-india:warning-signs]

Because early breast cancer often causes no symptoms, regular screening mammograms are an important way to find breast cancer early [citation:nci.types-breast-symptoms:signs-symptoms] [citation:nci.types-breast-screening-mammograms:screening]. Talk to your doctor about when to start screening and how often you should be screened, based on your age and risk factors.

## How is breast cancer diagnosed?

If you have symptoms or screening results that suggest breast cancer, your doctor will ask about your personal and family medical history and do a physical exam, including a clinical breast exam to feel for lumps or anything unusual [citation:nci.types-breast-diagnosis:diagnosis-tests]. The following tests may be used [citation:nci.types-breast-diagnosis:diagnosis-tests]:

- **Diagnostic mammogram** — an X-ray of the breast that takes detailed pictures of a suspicious area from different angles. A mammogram is used both to screen for breast cancer and to check breast changes after a lump or symptom is found [citation:nci.types-breast-screening-mammograms:screening] [citation:nci.types-breast-diagnosis:diagnosis-tests].
- **Breast ultrasound** — uses high-energy sound waves to make pictures of the inside of the breast. It is often used alongside a mammogram, especially in younger women or in women with dense breast tissue [citation:nci.types-breast-diagnosis:diagnosis-tests] [citation:kb_local.breast-cancer-diagnosis-pathway-india:warning-signs].
- **Breast MRI** — uses a magnet, radio waves, and a computer to make detailed pictures of the breast. It may be used in addition to a mammogram in some people, especially those at high risk [citation:nci.types-breast-diagnosis:diagnosis-tests].
- **Biopsy** — if imaging finds a suspicious area, a biopsy removes a small sample of cells or tissue so a pathologist can study it under a microscope. A biopsy is the only sure way to diagnose breast cancer [citation:nci.types-breast-diagnosis:biopsy].

Common types of biopsy include fine-needle aspiration biopsy (uses a thin needle), core-needle biopsy (uses a wider needle to take small tissue cores), image-guided biopsy (uses ultrasound, mammography, or MRI to guide the needle), and surgical biopsy (removes part or all of a lump under anesthesia) [citation:nci.types-breast-diagnosis:biopsy]. Most biopsies are done as outpatient procedures, meaning you go home the same day [citation:nci.types-breast-diagnosis:biopsy].

If a biopsy confirms breast cancer, the cells are tested for biomarkers such as hormone receptors (estrogen and progesterone) and HER2; this information helps your doctor plan treatment [citation:nci.types-breast-diagnosis:diagnosis-tests]. Additional tests, such as a CT scan, bone scan, or PET scan, may be done to find out if the cancer has spread (this is called staging) [citation:nci.types-breast-diagnosis:diagnosis-tests].

## Treatment basics

Breast cancer treatment depends on the type and stage of the cancer, biomarker results, your overall health, and your preferences [citation:nci.types-breast-treatment:treatment-options]. Treatment plans are individualized — what is best for one person may not be best for another. Treatment may include both **local treatments** (directed at the breast and nearby tissue) and **systemic treatments** (drugs that can reach cancer cells throughout the body) [citation:nci.types-breast-treatment:treatment-options].

Common breast cancer treatments may include [citation:nci.types-breast-treatment:treatment-options]:

- **Surgery** — such as lumpectomy (which removes the tumor and a margin of healthy tissue) or mastectomy (which removes the whole breast). A sentinel lymph node biopsy is often done at the same time to check if cancer has spread to nearby lymph nodes [citation:nci.types-breast-diagnosis:diagnosis-tests].
- **Radiation therapy** — often given after lumpectomy to lower the risk of the cancer coming back; it may also be given after mastectomy in some cases.
- **Chemotherapy** — drugs given by mouth or vein that travel through the body to kill cancer cells; not everyone with breast cancer needs chemotherapy.
- **Hormone (endocrine) therapy** — used for cancers that are estrogen-receptor positive or progesterone-receptor positive, to lower the risk that the cancer will come back.
- **Targeted therapy** — drugs that target specific features of cancer cells, such as HER2-positive tumors.
- **Immunotherapy** — may be used in some types of breast cancer, such as triple-negative breast cancer.

Often, more than one type of treatment is used. Your cancer care team will explain the options, the goals of treatment, and the side effects to expect [citation:nci.types-breast-treatment:treatment-options].

In India, much of the cost of breast cancer surgery, chemotherapy, radiation therapy, and diagnostic procedures including biopsy may be covered by Ayushman Bharat (PM-JAY) for eligible families, up to Rs. 5 lakh per family per year [citation:kb_local.pmjay-ayushman-bharat-cancer:cancer-treatment-covered]. Ask the hospital's PMJAY desk before paying out of pocket.

## Questions to ask your doctor

When you visit a doctor about a breast change or after a breast cancer diagnosis, you may want to ask:

1. What do you think is causing my symptoms or what I am feeling?
2. Do I need a mammogram, ultrasound, MRI, or biopsy? When will I get the results?
3. If it is cancer, what type and stage is it, and what does that mean?
4. What is the receptor status of my tumor (ER, PR, HER2), and how does it affect treatment?
5. What are my treatment options — surgery, radiation, chemotherapy, hormone therapy, targeted therapy — and what side effects can I expect?
6. Will I need a lumpectomy or a mastectomy, and why?
7. How long will the full treatment plan take?
8. Should I get a second opinion? Many people choose to get a second opinion to confirm the diagnosis and treatment plan [citation:nci.types-breast-diagnosis:second-opinion].
9. Is my treatment covered under PMJAY or any other scheme?
10. Are there clinical trials I should consider?

Bring a family member or trusted person to the visit. Write the answers down — it is normal to feel overwhelmed.

## When urgent care is needed

Please seek urgent medical help — go to the nearest hospital or call an ambulance — if you have any of the following during or after breast cancer treatment [citation:kb_local.breast-cancer-diagnosis-pathway-india:emergency-warning-signs]:

- A fever ≥ 100.4°F / 38°C during chemotherapy — this is an emergency [citation:kb_local.breast-cancer-diagnosis-pathway-india:emergency-warning-signs]
- Severe chest pain or sudden serious difficulty breathing
- Heavy or uncontrolled bleeding
- A severe allergic reaction (sudden swelling of face or throat, difficulty breathing, full-body rash)
- Sudden confusion, severe weakness, or fainting
- Severe back pain, sudden bone pain, or new swelling that appears within hours

In India, you can call **108** or **112** for ambulance services. The Indian Cancer Society helpline is **1800-22-1951** for non-emergency questions and support.

If you live in Bihar and need a starting point for breast cancer evaluation, Mahavir Cancer Sansthan in Phulwarisharif, Patna is Bihar's super-specialty cancer centre and has surgical, medical, and radiation oncology departments [citation:kb_local.bihar-cancer-navigation-guide:mahavir-cancer-sansthan]. AIIMS Patna also has a developing oncology department that runs specialized clinics, including a breast clinic [citation:kb_local.bihar-cancer-navigation-guide:mahavir-cancer-sansthan].
