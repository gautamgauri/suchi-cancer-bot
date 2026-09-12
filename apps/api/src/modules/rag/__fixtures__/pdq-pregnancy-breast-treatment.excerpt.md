<!--
Regression fixture for apps/api/src/modules/rag/reference-chunk-filter.spec.ts (issue #129 / #126).
Verbatim excerpts of the NCI PDQ summary "Breast Cancer Treatment During Pregnancy"
(Health Professional Version), a U.S. federal government work in the public domain
(https://www.cancer.gov/publications/pdq). Only the three sections the test needs are
kept; nothing is edited inside a section. The full document lives in the KB corpus
(kb/en/, not tracked in git), which is why the test cannot read it in CI.
Sections are separated by the marker lines below; the spec splits on them.
-->

<!-- FIXTURE:references-block -->
###### References

1. Hoover HC: Breast cancer during pregnancy and lactation. Surg Clin North Am 70 (5): 1151-63, 1990. [[PUBMED Abstract]](http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=2218825&dopt=Abstract "http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=2218825&dopt=Abstract")
2. Gwyn K, Theriault R: Breast cancer during pregnancy. Oncology (Huntingt) 15 (1): 39-46; discussion 46, 49-51, 2001. [[PUBMED Abstract]](http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=11271981&dopt=Abstract "http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=11271981&dopt=Abstract")
3. Moore HC, Foster RS: Breast cancer and pregnancy. Semin Oncol 27 (6): 646-53, 2000. [[PUBMED Abstract]](http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=11130471&dopt=Abstract "http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=11130471&dopt=Abstract")
4. Rugo HS: Management of breast cancer diagnosed during pregnancy. Curr Treat Options Oncol 4 (2): 165-73, 2003. [[PUBMED Abstract]](http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=12594943&dopt=Abstract "http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=12594943&dopt=Abstract")
5. Clark RM, Chua T: Breast cancer and pregnancy: the ultimate challenge. Clin Oncol (R Coll Radiol) 1 (1): 11-8, 1989. [[PUBMED Abstract]](http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=2486467&dopt=Abstract "http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=2486467&dopt=Abstract")
6. Yang WT, Dryden MJ, Gwyn K, et al.: Imaging of breast cancer diagnosed and treated with chemotherapy during pregnancy. Radiology 239 (1): 52-60, 2006. [[PUBMED Abstract]](http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=16484353&dopt=Abstract "http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=16484353&dopt=Abstract")
7. Middleton LP, Amin M, Gwyn K, et al.: Breast carcinoma in pregnant women: assessment of clinicopathologic and immunohistochemical features. Cancer 98 (5): 1055-60, 2003. [[PUBMED Abstract]](http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=12942575&dopt=Abstract "http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=12942575&dopt=Abstract")
8. Elledge RM, Ciocca DR, Langone G, et al.: Estrogen receptor, progesterone receptor, and HER-2/neu protein in breast cancers from pregnant patients. Cancer 71 (8): 2499-506, 1993. [[PUBMED Abstract]](http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=8095853&dopt=Abstract "http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=8095853&dopt=Abstract")
9. Petrek JA, Dukoff R, Rogatko A: Prognosis of pregnancy-associated breast cancer. Cancer 67 (4): 869-72, 1991. [[PUBMED Abstract]](http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=1991259&dopt=Abstract "http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=1991259&dopt=Abstract")
10. Barnavon Y, Wallack MK: Management of the pregnant patient with carcinoma of the breast. Surg Gynecol Obstet 171 (4): 347-52, 1990. [[PUBMED Abstract]](http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=2218844&dopt=Abstract "http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=2218844&dopt=Abstract")
11. Gallenberg MM, Loprinzi CL: Breast cancer and pregnancy. Semin Oncol 16 (5): 369-76, 1989. [[PUBMED Abstract]](http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=2678487&dopt=Abstract "http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=2678487&dopt=Abstract")


<!-- FIXTURE:chemotherapy-prose -->
### Chemotherapy

Data suggest that it is safe to administer certain chemotherapeutic drugs after the first trimester, with most pregnancies resulting in live births with low
rates of morbidity in the newborns.

Anthracycline-based
chemotherapy (doxorubicin plus cyclophosphamide or fluorouracil, doxorubicin, and
cyclophosphamide [FAC]) appears to be safe to administer during the second and/or third trimester
on the basis of limited prospective data.[[6](#cit/section_3.6)-[8](#cit/section_3.8)] Safety data on the use of taxanes during pregnancy are limited.

Evidence (use of chemotherapy during the second and/or third trimester of pregnancy):

1. A multicenter
case-control study compared pediatric outcomes of 129 children whose mothers had breast cancer
with matched children of women without cancer.
In the pregnancy study group, 96 children
(74.4%) were exposed to chemotherapy, 11 (8.5%) to radiation therapy, 13 (10.1%) to surgery alone, 2
(1.7%) to other drug treatments, and 14 (10.9%) to no treatment.[[9](#cit/section_3.9)]

- The study
showed that there was no
significant difference in birth weight below the 10th
percentile (22% in the breast cancer treatment‒exposed
group vs. 15.2% in the control group, *P* = .16) or in cognitive development based on the Bayley
score (*P* = .08). The gestational age at birth was correlated with cognitive outcome in the two study
groups.
- Evaluation of cardiac function among 47 children, who were age 36 months in the study group, showed

<!-- FIXTURE:special-considerations -->
## Special Considerations for Pregnancy and Breast Cancer

### Lactation

Suppression of lactation does not improve prognosis. If surgery is
planned, however, lactation is suppressed to decrease the size and vascularity of
the breasts. If chemotherapy is to be given, lactation is also suppressed because many antineoplastic agents (i.e., cyclophosphamide and methotrexate), when
given systemically, may occur in high levels in breast milk and would
affect the nursing baby. Women receiving chemotherapy should not
breastfeed.[[1](#cit/section_5.1)]

### Fetal Consequences of Maternal Breast Cancer

No damaging effects on the fetus from maternal breast cancer have been
demonstrated,[[2](#cit/section_5.2)] and there are no reported cases of maternal-fetal transfer of
breast cancer cells.

### Pregnancy in Patients With a History of Breast Cancer

