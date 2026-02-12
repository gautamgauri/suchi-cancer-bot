/**
 * Corpus classification constants and inference logic.
 *
 * Four logical corpora partition the KB so retrieval can target
 * the right document pool for each section type.
 */

export const CORPUS = {
  DIKSHA_INTERNAL: "diksha_internal",
  THEORY_FRAMEWORKS: "theory_frameworks",
  DONOR_FUNDER: "donor_funder",
  EXTERNAL_EVIDENCE: "external_evidence",
} as const;

export type CorpusValue = (typeof CORPUS)[keyof typeof CORPUS];

/**
 * Rule-based corpus inference from document metadata.
 * Order matters: first matching rule wins.
 */
export function inferCorpus(
  sourceFolder: string,
  name: string,
  docType?: string | null,
): CorpusValue {
  const lName = name.toLowerCase();
  const lFolder = sourceFolder.toLowerCase();

  // Rule 1: donor/funder docs
  if (
    lFolder.includes("funder") ||
    lFolder.includes("donor") ||
    lName.includes("rfp") ||
    lName.includes("call for") ||
    lName.includes("donor intelligence") ||
    lName.includes("grant application") ||
    lName.includes("grant form") ||
    lName.includes("guideline") ||
    lName.includes("grantee") ||
    lName.includes("seed grant") ||
    lName.includes("for funders") ||
    lName.includes("unicef") ||
    /csr.*grant|philanthropy.*grant/i.test(name) ||
    docType === "rfp" ||
    docType === "funder_guidelines"
  ) {
    return CORPUS.DONOR_FUNDER;
  }

  // Rule 2: theory/framework docs
  if (
    lFolder.includes("theory") ||
    lFolder.includes("framework") ||
    lFolder.includes("research") ||
    lName.includes("see learning") ||
    lName.includes("nep") ||
    lName.includes("pedagogy") ||
    lName.includes("social emotional") ||
    lName.includes("life skill") ||
    lName.includes("education policy") ||
    lName.includes("theory of change") ||
    lName.includes("curriculum framework") ||
    /acp.?sel/i.test(name)
  ) {
    return CORPUS.THEORY_FRAMEWORKS;
  }

  // Rule 3: external evidence
  if (
    lFolder.includes("external") ||
    lFolder.includes("nci") ||
    lFolder.includes("who") ||
    lFolder.includes("aser") ||
    lName.includes("census") ||
    lName.includes("survey data") ||
    lName.includes("ncrb") ||
    lName.includes("district information") ||
    lName.includes("education statistics")
  ) {
    return CORPUS.EXTERNAL_EVIDENCE;
  }

  // Rule 4: default to internal
  return CORPUS.DIKSHA_INTERNAL;
}
