---
schema_version: "1.0"
page_id: pediatric-cancers
title: "Childhood Cancer: Warning Signs, Diagnosis, and Support"
summary: >
  Childhood cancer affects children of all ages. Acute lymphoblastic leukemia
  is the most common type, followed by brain tumors, lymphomas, and others.
  This page covers warning signs parents should know, how diagnosis works,
  India's main referral centres including Tata Memorial, and emotional support
  for families.
content_type: cancer_type

locale: en
geo_relevance: ["IN-pan", "IN-BR"]
audience: ["patient", "caregiver"]

last_reviewed: 2026-04-30
review_status: ai_draft
version_id: "v1.0.0-2026-04-30-cgp-batch3-003"

provenance:
  generator_model: claude-sonnet-4-6
  generator_run_id: cgp-batch3-2026-04-30-003
  pipeline_version: "0.2"
  source_chunks:
    - doc_id: nci.types-childhood-cancers-patient-rare-childhood-cancers-pdq
      chunk_id: overview
      source: NCI
    - doc_id: nci.types-leukemia-patient-child-all-treatment-pdq
      chunk_id: what-it-is
      source: NCI
    - doc_id: nci.types-leukemia-patient-child-all-treatment-pdq
      chunk_id: risk-factors
      source: NCI
    - doc_id: nci.types-leukemia-patient-child-all-treatment-pdq
      chunk_id: signs-symptoms
      source: NCI
    - doc_id: nci.types-leukemia-patient-child-all-treatment-pdq
      chunk_id: diagnosis-tests
      source: NCI
    - doc_id: nci.types-leukemia-patient-child-all-treatment-pdq
      chunk_id: treatment-options
      source: NCI
    - doc_id: nci.types-leukemia-patient-child-all-treatment-pdq
      chunk_id: prognosis
      source: NCI
    - doc_id: nci.types-leukemia-patient-child-all-treatment-pdq
      chunk_id: late-effects
      source: NCI
    - doc_id: nci.types-leukemia-patient-child-all-treatment-pdq
      chunk_id: second-opinion
      source: NCI
    - doc_id: nci.types-lymphoma-patient-child-hodgkin-treatment-pdq
      chunk_id: what-it-is
      source: NCI
    - doc_id: nci.types-lymphoma-patient-child-hodgkin-treatment-pdq
      chunk_id: signs-symptoms
      source: NCI
    - doc_id: nci.types-lymphoma-patient-child-hodgkin-treatment-pdq
      chunk_id: treatment-options
      source: NCI
    - doc_id: nci.types-lymphoma-patient-child-hodgkin-treatment-pdq
      chunk_id: prognosis
      source: NCI
    - doc_id: kb_local.bihar-cancer-navigation-guide
      chunk_id: mahavir-cancer-sansthan
      source: kb_local
    - doc_id: kb_local.bihar-cancer-navigation-guide
      chunk_id: pmjay-ayushman-bharat
      source: kb_local
    - doc_id: kb_local.bihar-cancer-navigation-guide
      chunk_id: aiims-patna
      source: kb_local
  gaps:
    - section: what-is-childhood-cancer
      description: India-specific childhood cancer incidence statistics (total cases per year, state-level data for Bihar) and survival rate comparisons with high-income countries are not available in current Tier-1 KB sources. Claims hedged accordingly.
    - section: treatment-basics
      description: Specific government schemes for childhood cancer in India (e.g. dedicated paediatric oncology funding, Rajiv Gandhi cancer schemes at state level) beyond PMJAY are not covered in current Tier-1 KB sources.
    - section: treatment-basics
      description: Retinoblastoma and Wilms tumor treatment details — their incidence as second and third most common solid tumors in Indian children and specialist centres — are mentioned here based on general clinical knowledge but are not directly in the current Tier-1 KB sources. Marked accordingly.
  # eval_scores omitted intentionally — populated by Module 7 (Eval gate) in production.

related_pages:
  - cancer-care-in-bihar
  - what-to-do-after-cancer-diagnosis
  - leukemia
  - lymphoma

tags:
  cancer_types: ["pediatric"]
  situations: ["newly-diagnosed", "caregiving"]
  topics: ["symptoms", "diagnosis", "treatment", "childhood-cancer", "ALL", "brain-tumor", "hodgkin-lymphoma", "wilms-tumor", "retinoblastoma", "caregiver-support", "PMJAY", "Tata-Memorial"]
  clinical_category: pediatric-oncology

featured: false
---

> **Important:** This page is written for parents and caregivers of children who may have cancer, or who have been recently diagnosed. The information here is general and is not a substitute for advice from a paediatric oncologist. If you notice any of the warning signs described here in your child, please see a doctor promptly. Childhood cancers are among the most treatable cancers — but early diagnosis matters enormously.

## What is childhood cancer?

Cancer in children is rare but not uncommon [citation:nci.types-childhood-cancers-patient-rare-childhood-cancers-pdq:overview]. Since 1975, the number of new childhood cancer cases has slowly increased, but the number of deaths from childhood cancer has decreased by more than half — a testament to major advances in treatment [citation:nci.types-childhood-cancers-patient-rare-childhood-cancers-pdq:overview].

**The most common childhood cancers include:**

- **Acute Lymphoblastic Leukemia (ALL)** — the most common childhood cancer, accounting for about 25% of all childhood cancers; occurs most often in children aged 1 to 4 years [citation:nci.types-leukemia-patient-child-all-treatment-pdq:what-it-is]
- **Brain and spinal cord tumors** — the second most common group; they vary widely in type and behaviour
- **Hodgkin lymphoma and non-Hodgkin lymphoma** — cancers of the lymph system; Hodgkin lymphoma is especially common in adolescents [citation:nci.types-lymphoma-patient-child-hodgkin-treatment-pdq:what-it-is]
- **Wilms tumor (nephroblastoma)** — a kidney cancer that occurs almost exclusively in young children {{MISSING_EVIDENCE: Wilms tumor as a common childhood solid tumor is established clinical fact, but specific Indian incidence data are not in current Tier-1 KB sources.}}
- **Retinoblastoma** — a cancer of the eye (retina) that occurs in infants and young children; India has a high burden of retinoblastoma, partly due to delayed diagnosis {{MISSING_EVIDENCE: Retinoblastoma incidence in India and delay-to-diagnosis patterns are referenced clinically but not covered in current Tier-1 KB sources.}}
- **Neuroblastoma** — a cancer of nerve tissue that often starts in the adrenal glands; most common in very young children
- **Bone cancers** (osteosarcoma, Ewing sarcoma) — more common in older children and teenagers

Childhood cancer is **not caused by anything the parents or child did wrong.** Most childhood cancers arise from changes in DNA that are not inherited — they happen by chance during the child's development [citation:nci.types-leukemia-patient-child-all-treatment-pdq:what-it-is]. This is important for parents to understand.

{{MISSING_EVIDENCE: India-specific childhood cancer incidence rates (total annual cases, state-level data for Bihar) and survival comparisons with high-income countries are not in current Tier-1 KB sources.}}

## Common warning signs parents should know

Because childhood cancer is rare, warning signs are often initially mistaken for common illnesses. The key is persistence — symptoms that do not improve with routine treatment or that come back repeatedly need further investigation. The following warning signs, if they last more than two weeks or keep returning, should be evaluated by a doctor:

**General (common to many childhood cancers):**

- **Unexplained persistent fatigue or weakness** — a child who is unusually tired and won't play
- **Pale skin** (pallor) — a noticeable change in the child's colour
- **Unexplained fever** lasting more than a few days without a clear infection, or recurring fevers
- **Unexplained weight loss** or loss of appetite
- **Drenching night sweats** (especially in lymphoma)

**Blood-related (especially leukemia — ALL)** [citation:nci.types-leukemia-patient-child-all-treatment-pdq:signs-symptoms]:

- Easy or unexplained bruising — large bruises from minor bumps, or bruising in unusual places
- Small flat dark-red or purple spots under the skin (petechiae) — often mistaken for a rash
- Nosebleeds or bleeding gums that happen frequently or are hard to stop
- **Bone or joint pain** — a child who refuses to walk, limps, or complains of leg or arm pain not linked to injury; this is a classic ALL symptom [citation:nci.types-leukemia-patient-child-all-treatment-pdq:signs-symptoms]
- Frequent infections or infections that take a very long time to recover from
- Painless lumps or swollen lymph nodes in the neck, armpits, or groin
- Pain or fullness below the ribs on the left side (enlarged spleen)
- Shortness of breath or rapid breathing

**Lymphoma-specific** [citation:nci.types-lymphoma-patient-child-hodgkin-treatment-pdq:signs-symptoms]:

- Painless, enlarging lumps in the neck or collarbones that persist for more than two to four weeks
- Coughing, difficulty breathing, or chest discomfort (enlarged lymph nodes in the chest)
- Itchy skin without a rash

**Brain tumor warning signs:**

- Persistent or worsening headaches, especially first thing in the morning
- Vomiting in the morning without nausea, or without a stomach illness
- Changes in vision, such as blurred or double vision
- Unsteady walking or balance problems
- New-onset seizures

**Eye-related (retinoblastoma):**

- A white or yellowish glow visible in the pupil of the eye in photos taken with flash (leukocoria — "cat's eye reflex") — this is a key sign of retinoblastoma and should be seen by an eye doctor urgently {{MISSING_EVIDENCE: Retinoblastoma leukocoria as warning sign is established clinical fact; specific Indian referral pathways are not in current Tier-1 KB sources.}}
- A squint (eye turning inward or outward) in an infant or young child

**Kidney tumor (Wilms tumor):**

- A painless lump or swelling in the abdomen that you can feel — the child may appear to have a large belly {{MISSING_EVIDENCE: Wilms tumor clinical presentation detail is established; Indian incidence data not in Tier-1 KB sources.}}

Do not wait and watch for more than two weeks if any of these signs are present. Earlier diagnosis leads to better outcomes. In children, bones and organs are still growing, which means cancers can grow fast — but also that children often respond very well to treatment.

## Risk factors

Most childhood cancers occur in children with no known risk factors [citation:nci.types-leukemia-patient-child-all-treatment-pdq:risk-factors]. For ALL (the most common childhood cancer), identified risk factors include:

- **Genetic conditions** — Down syndrome, neurofibromatosis type 1, Bloom syndrome, Fanconi anaemia, Li-Fraumeni syndrome, and certain other inherited gene changes [citation:nci.types-leukemia-patient-child-all-treatment-pdq:risk-factors]
- **Exposure to X-rays before birth**
- **Exposure to radiation**
- **Previous treatment with chemotherapy** for another condition [citation:nci.types-leukemia-patient-child-all-treatment-pdq:risk-factors]

For Hodgkin lymphoma in children and adolescents, identified risk factors include Epstein-Barr virus (EBV) infection, HIV, immune system conditions, and family history of Hodgkin lymphoma [citation:nci.types-lymphoma-patient-child-hodgkin-treatment-pdq:risk-factors].

The vast majority of childhood cancers are **not caused by anything a parent did or did not do** during pregnancy. Blaming yourself is understandable but not warranted — these are biological events that arise unpredictably [citation:nci.types-leukemia-patient-child-all-treatment-pdq:risk-factors].

## When to seek medical attention

See a doctor promptly — do not wait — if your child has:

- Bone or joint pain that the child cannot explain, with no history of injury, lasting more than a week
- Unexplained bruising, bleeding, or petechiae (small dark-red spots under the skin)
- A painless lump anywhere on the body that persists for more than two weeks
- Fever that recurs or lasts more than 10 days without a clear cause
- Progressive headache, vomiting in the morning, or balance problems
- A white or yellow glow in the pupil of one or both eyes in photos
- Swelling of the abdomen without explanation in a young child

If your local doctor does not have an explanation, ask for a referral to a specialist or a larger hospital. Parents have good instincts — if you are worried, keep pushing for answers.

## How is childhood cancer diagnosed?

The diagnosis of childhood cancer involves a combination of blood tests, imaging, and tissue sampling (biopsy). The specific tests depend on the type of cancer suspected.

**For leukemia (ALL)** [citation:nci.types-leukemia-patient-child-all-treatment-pdq:diagnosis-tests]:

- **Complete blood count (CBC)** — the first and most important test; an abnormal CBC (too many abnormal white blood cells, too few red blood cells, or too few platelets) raises suspicion for leukemia
- **Blood chemistry study** — measures organ function and other markers
- **Bone marrow aspiration and biopsy** — a needle is inserted into the hip bone under local anaesthesia to remove a small amount of bone marrow; the sample is examined under a microscope for leukemia cells
- **Genetic tests on the bone marrow** — chromosomal analysis, immunophenotyping, and molecular tests help classify the type of ALL and plan treatment
- **Lumbar puncture (spinal tap)** — a needle is inserted into the lower back to collect cerebrospinal fluid; checks whether leukemia cells have reached the brain and spinal cord; a small dose of chemotherapy is given at the same time as prevention [citation:nci.types-leukemia-patient-child-all-treatment-pdq:diagnosis-tests]
- **Chest X-ray** — to see if leukemia cells have formed a lump in the middle of the chest [citation:nci.types-leukemia-patient-child-all-treatment-pdq:diagnosis-tests]

**For lymphoma** [citation:nci.types-lymphoma-patient-child-hodgkin-treatment-pdq:diagnosis-tests]:

- **CBC and blood chemistry**
- **CT scan or PET-CT scan** — to find enlarged lymph nodes and determine the extent of disease
- **Lymph node biopsy** — tissue from a lymph node is removed surgically and examined by a pathologist; the presence of Reed-Sternberg cells confirms Hodgkin lymphoma

**Getting a second opinion** is important and encouraged [citation:nci.types-leukemia-patient-child-all-treatment-pdq:second-opinion]. Before starting treatment, share the pathology report, slides, and scans with a specialist — ideally at a dedicated paediatric oncology centre. Treatment at a centre experienced in childhood cancer significantly improves outcomes.

## Treatment basics

Childhood cancers are treated by **paediatric oncologists** — doctors who specialise in treating children with cancer — working as part of a multidisciplinary team that may include paediatricians, surgeons, radiation oncologists, nurses, psychologists, social workers, and child-life specialists [citation:nci.types-leukemia-patient-child-all-treatment-pdq:treatment-options].

**For ALL**, the most common childhood cancer, treatment is given in three phases [citation:nci.types-leukemia-patient-child-all-treatment-pdq:treatment-options]:

1. **Remission induction** (usually 4–6 weeks) — combination chemotherapy to kill leukemia cells in the blood and bone marrow and bring the disease under control
2. **Consolidation/intensification** (several months) — more chemotherapy to kill any remaining leukemia cells
3. **Maintenance** (usually 2–3 years total) — lower-dose chemotherapy to prevent relapse; adherence to all prescribed medicines is essential [citation:nci.types-leukemia-patient-child-all-treatment-pdq:treatment-options]

Children with higher-risk ALL receive more intensive chemotherapy than those with standard-risk ALL; the treatment is tailored to the child's risk group, age, and genetic features of the leukemia [citation:nci.types-leukemia-patient-child-all-treatment-pdq:treatment-options].

**Immunotherapy** (such as blinatumomab and CAR T-cell therapy) and **targeted therapy** (such as imatinib or dasatinib for Philadelphia chromosome–positive ALL) are used for specific ALL subtypes and for relapsed or refractory cases [citation:nci.types-leukemia-patient-child-all-treatment-pdq:treatment-options].

**Stem cell transplant** is used for some children with very high-risk or relapsed ALL [citation:nci.types-leukemia-patient-child-all-treatment-pdq:treatment-options].

**For Hodgkin lymphoma**, the main treatments are combination chemotherapy (fewer cycles for lower-risk, more cycles and higher doses for higher-risk) plus radiation therapy to the affected areas [citation:nci.types-lymphoma-patient-child-hodgkin-treatment-pdq:treatment-options]. **Most children and adolescents with Hodgkin lymphoma can be cured** [citation:nci.types-lymphoma-patient-child-hodgkin-treatment-pdq:prognosis].

**Late effects** — problems that begin 6 months or more after treatment ends — are an important concern. These may include effects on the heart, lungs, liver, bones, fertility, cognitive function, and the risk of a second cancer in adulthood [citation:nci.types-leukemia-patient-child-all-treatment-pdq:late-effects]. Ask the treatment team about the specific late effects expected and how they will be monitored over time.

**In India, the primary national referral centre for childhood cancer is Tata Memorial Hospital (TMH) in Mumbai**, which has a dedicated paediatric oncology unit (Children's Cancer Hospital at TMH) and handles the largest volume of childhood cancer cases in India. {{MISSING_EVIDENCE: Tata Memorial Hospital as India's primary childhood cancer referral centre is widely established, but specific bed count, survival rate data, and patient volume for the paediatric unit are not in current Tier-1 KB sources.}}

**In Bihar**, children with cancer can be seen at [citation:kb_local.bihar-cancer-navigation-guide:mahavir-cancer-sansthan]:

- **Mahavir Cancer Sansthan**, Phulwarisharif, Patna — Bihar's only super-specialty cancer centre; **paediatric patients are treated free of charge** at Mahavir. Contact: +91-612-2250127
- **AIIMS Patna**, Phulwarisharif — has paediatric oncology clinics and provides care at subsidised rates [citation:kb_local.bihar-cancer-navigation-guide:aiims-patna]
- **IGIMS (State Cancer Institute)**, Sheikhpura, Patna — also provides subsidised or free cancer treatment for low-income patients [citation:kb_local.bihar-cancer-navigation-guide:mahavir-cancer-sansthan]

For very complex cases or when local capacity is limited, families from Bihar are often referred to Tata Memorial Hospital (Mumbai) or AIIMS New Delhi. Families should ask about lodging assistance and railway concessions available to cancer patients travelling for treatment.

**PM-JAY (Ayushman Bharat)** may cover the cost of cancer treatment — including hospitalisation for chemotherapy, bone marrow procedures, and related care — at empanelled hospitals up to Rs. 5 lakh per family per year for eligible families [citation:kb_local.bihar-cancer-navigation-guide:pmjay-ayushman-bharat]. Present your PM-JAY card or Aadhaar at the hospital's Ayushman counter before admission. {{MISSING_EVIDENCE: Specific childhood cancer treatment packages under PM-JAY and state-level supplementary schemes for Bihar are not fully detailed in current Tier-1 KB sources.}}

## Questions to ask your doctor

If your child has been diagnosed with cancer, here are key questions to ask the paediatric oncologist:

1. What type of cancer does my child have, and what is the specific subtype? What does this mean for treatment and outlook?
2. What is the risk group — standard risk, high risk, or very high risk? How does this affect the treatment plan?
3. What are the phases of treatment, and how long will the full treatment course last?
4. What chemotherapy drugs will be used? What side effects should we watch for at home, and when should we call the hospital?
5. Will my child need radiation therapy, a stem cell transplant, or surgery? If yes, where will these be done?
6. Is my child's leukemia Philadelphia chromosome–positive or does it have another molecular feature that requires targeted therapy?
7. What are the long-term (late) effects of this treatment on my child's growth, learning, heart, fertility, and risk of a second cancer? [citation:nci.types-leukemia-patient-child-all-treatment-pdq:late-effects]
8. Should we get a second opinion before starting treatment, and how do we arrange this? [citation:nci.types-leukemia-patient-child-all-treatment-pdq:second-opinion]
9. Is there a clinical trial that my child might be eligible for?
10. Is treatment covered under PM-JAY or any other scheme? What documents do we need, and is there a social worker who can help us navigate financial support?

## Caring for yourself and your family

A childhood cancer diagnosis is one of the most difficult things a family can face. The entire family — not just the child — needs support.

**Practical suggestions:**

- Bring a trusted adult to every appointment — ideally someone who can take notes and ask questions
- Keep all reports, prescriptions, test results, and consent forms in a single organized folder
- Ask the hospital's social worker about financial assistance, lodging near the hospital, and railway concessions for cancer patients travelling for treatment
- Do not let your child miss doses of maintenance chemotherapy — adherence is critical to preventing relapse [citation:nci.types-leukemia-patient-child-all-treatment-pdq:treatment-options]

**Emotional support:**

- It is normal to feel overwhelmed, scared, angry, or guilty — these are common reactions to a shocking diagnosis
- Siblings and other children in the family will also be affected; consider counselling for the whole family
- Many paediatric oncology centres have child-life specialists and psychologists on staff who work with children and families [citation:nci.types-leukemia-patient-child-all-treatment-pdq:treatment-options]
- Ask your cancer care team about support groups for parents of children with cancer; other parents who have been through this can be an invaluable source of practical knowledge and emotional support

## When urgent care is needed

Please seek urgent medical help — go to the nearest emergency department or call an ambulance — if your child has any of the following:

- **Fever of 38°C / 100.4°F or higher at any time during chemotherapy** — this is a medical emergency called febrile neutropenia; go to the hospital immediately, do not wait
- **Heavy or uncontrolled bleeding** that does not stop with pressure
- **Severe pallor, extreme weakness, or trouble breathing**
- **A seizure** — especially a new first seizure
- **Sudden severe headache, vomiting, or difficulty walking** — may signal increased pressure in the brain
- **A severe allergic reaction** (difficulty breathing, facial or throat swelling) within 24 hours of a treatment infusion

In India, call **108** or **112** for ambulance services. The Indian Cancer Society helpline is **1800-22-1951** for non-emergency questions and support.

If you are in Bihar and your child needs urgent oncology help, the emergency departments at **Mahavir Cancer Sansthan** (Phulwarisharif, Patna; phone +91-612-2250127) and **AIIMS Patna** can provide initial evaluation and stabilisation [citation:kb_local.bihar-cancer-navigation-guide:mahavir-cancer-sansthan]. For complex emergencies requiring paediatric oncology expertise beyond local capacity, TMH Mumbai and AIIMS New Delhi are the national referral centres.
