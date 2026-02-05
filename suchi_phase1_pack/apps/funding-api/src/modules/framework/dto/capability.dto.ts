export class CapabilityDto {
  id!: string;
  capabilityId!: string;
  name!: string;
  definitionShort!: string;
  definitionLong!: string;
  subdimensions!: string[];
  biharContextExamples!: string[];
  measurementIdeas!: string[];
  ethicsRisks!: string[];
}

export class MiModalityDto {
  id!: string;
  miId!: string;
  name!: string;
  definitionShort!: string;
  activitySignals!: string[];
  assessmentArtifacts!: string[];
}
