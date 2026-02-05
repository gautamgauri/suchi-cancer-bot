export class PatternCardDto {
  id!: string;
  patternId!: string;
  title!: string;
  durationMins!: number | null;
  materials!: string[];
  facilitatorScript!: string[];
  adaptations!: string[];
  assessmentArtifacts!: string[];
  sourceUrl!: string | null;
  evidenceLevel!: string;
  qualityScore!: number | null;
  status!: string;
  miTagsPrimary!: string[];
  miTagsSecondary!: string[];
  capabilitiesPrimary!: string[];
  capabilitiesSecondary!: string[];
  createdAt!: Date;
  updatedAt!: Date;
}

export class CreatePatternCardDto {
  patternId!: string;
  title!: string;
  durationMins?: number;
  materials?: string[];
  facilitatorScript?: string[];
  adaptations?: string[];
  assessmentArtifacts?: string[];
  sourceDocId?: string;
  sourceUrl?: string;
  evidenceLevel?: string;
  miTagsPrimary?: string[];
  miTagsSecondary?: string[];
  capabilitiesPrimary?: string[];
  capabilitiesSecondary?: string[];
}

export class UpdatePatternCardDto {
  title?: string;
  durationMins?: number;
  materials?: string[];
  facilitatorScript?: string[];
  adaptations?: string[];
  assessmentArtifacts?: string[];
  evidenceLevel?: string;
  status?: string;
  miTagsPrimary?: string[];
  miTagsSecondary?: string[];
  capabilitiesPrimary?: string[];
  capabilitiesSecondary?: string[];
}

export class PatternCardQueryDto {
  capabilities?: string[];
  miModalities?: string[];
  ageBand?: string;
  setting?: string;
  status?: string;
  limit?: number;
  offset?: number;
}
