export class MelPackInputDto {
  projectId?: string;
  capabilities!: string[];
  targetGroup!: string;
  geography?: string;
}

export class ProgramDesignInputDto {
  projectId?: string;
  capabilities!: string[];
  miModalities!: string[];
  targetGroup!: string;
  ageBand!: string;
  setting!: string;
  durationWeeks?: number;
  sessionsPerWeek?: number;
}

export class ComparablesInputDto {
  capabilities!: string[];
  targetGroup!: string;
  geographyConstraints?: string;
}

export class ConsistencyCheckInputDto {
  draftText!: string;
  claimedCapabilities!: string[];
  claimedMIModalities?: string[];
  projectId?: string;
}

export class RecommendationInputDto {
  ageBand!: string;
  setting!: string;
  capabilities!: string[];
  miModalities?: string[];
}
