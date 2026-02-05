export class MethodCardDto {
  id!: string;
  methodId!: string;
  title!: string;
  intent!: string;
  steps!: string[];
  whenToUse!: string | null;
  whenNotToUse!: string | null;
  ageBand!: string | null;
  settingTags!: string[];
  assessmentArtifacts!: string[];
  sourceUrl!: string | null;
  licenseFlag!: string;
  qualityScore!: number | null;
  status!: string;
  miTagsPrimary!: string[];
  miTagsSecondary!: string[];
  capabilityLinks!: string[];
  createdAt!: Date;
  updatedAt!: Date;
}

export class CreateMethodCardDto {
  methodId!: string;
  title!: string;
  intent!: string;
  steps!: string[];
  whenToUse?: string;
  whenNotToUse?: string;
  ageBand?: string;
  settingTags?: string[];
  assessmentArtifacts?: string[];
  sourceDocId?: string;
  sourceUrl?: string;
  licenseFlag?: string;
  miTagsPrimary?: string[];
  miTagsSecondary?: string[];
  capabilityLinks?: string[];
}

export class UpdateMethodCardDto {
  title?: string;
  intent?: string;
  steps?: string[];
  whenToUse?: string;
  whenNotToUse?: string;
  ageBand?: string;
  settingTags?: string[];
  assessmentArtifacts?: string[];
  licenseFlag?: string;
  status?: string;
  miTagsPrimary?: string[];
  miTagsSecondary?: string[];
  capabilityLinks?: string[];
}

export class MethodCardQueryDto {
  capabilities?: string[];
  miModalities?: string[];
  ageBand?: string;
  setting?: string;
  status?: string;
  limit?: number;
  offset?: number;
}
