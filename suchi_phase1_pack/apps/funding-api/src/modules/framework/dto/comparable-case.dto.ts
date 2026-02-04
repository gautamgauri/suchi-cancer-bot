export class ComparableCaseDto {
  id!: string;
  caseId!: string;
  programName!: string;
  orgName!: string;
  geography!: string;
  targetGroup!: string;
  deliveryModelTags!: string[];
  outcomesSummary!: string;
  indicatorsUsed!: string[];
  costNotes!: string | null;
  programConstraints!: string | null;
  contextConstraints!: string | null;
  transferabilityBihar!: string | null;
  sourceUrl!: string | null;
  confidenceScore!: number;
  qualityScore!: number | null;
  status!: string;
  capabilitiesPrimary!: string[];
  capabilitiesSecondary!: string[];
  createdAt!: Date;
  updatedAt!: Date;
}

export class CreateComparableCaseDto {
  caseId!: string;
  programName!: string;
  orgName!: string;
  geography!: string;
  targetGroup!: string;
  deliveryModelTags?: string[];
  outcomesSummary!: string;
  indicatorsUsed?: string[];
  costNotes?: string;
  programConstraints?: string;
  contextConstraints?: string;
  transferabilityBihar?: string;
  sourceDocId?: string;
  sourceUrl?: string;
  confidenceScore?: number;
  capabilitiesPrimary?: string[];
  capabilitiesSecondary?: string[];
}

export class UpdateComparableCaseDto {
  programName?: string;
  orgName?: string;
  geography?: string;
  targetGroup?: string;
  deliveryModelTags?: string[];
  outcomesSummary?: string;
  indicatorsUsed?: string[];
  costNotes?: string;
  programConstraints?: string;
  contextConstraints?: string;
  transferabilityBihar?: string;
  confidenceScore?: number;
  status?: string;
  capabilitiesPrimary?: string[];
  capabilitiesSecondary?: string[];
}

export class ComparableCaseQueryDto {
  capabilities?: string[];
  targetGroup?: string;
  geography?: string;
  status?: string;
  limit?: number;
  offset?: number;
}
