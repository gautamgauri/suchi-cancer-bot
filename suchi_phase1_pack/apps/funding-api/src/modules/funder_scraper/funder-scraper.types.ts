export type FunderNetwork = "TFIx" | "BDC" | string;

export interface FunderOrgRecord {
  id: string;
  orgName: string;
  orgWebsite: string;
  network: FunderNetwork;
}

export interface FunderFactDto {
  org_name: string;
  org_website: string;
  network: FunderNetwork;
  funder_name: string | null;
  funder_type: "CSR" | "Foundation" | "HNI" | "Gov" | "Multilateral" | "Other";
  evidence_type: string;
  evidence_excerpt: string;
  evidence_url: string;
  financial_amount: string | null;
  grant_years: string | null;
  program_focus: string | null;
  geography: string | null;
  confidence_score: "High" | "Medium" | "Low";
  notes: string | null;
  normalized_funder: string | null;
  match_confidence: number;
}

export interface SerpApiResultUrl {
  url: string;
  title: string;
  source: "org_site" | "external";
  query: string;
}

