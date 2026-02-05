export interface CapabilityTagInput {
  capabilityId: string;
  isPrimary: boolean;
  strength: number | null;
  isApplicable: boolean;
}

export class TagProjectDto {
  tags!: CapabilityTagInput[];
}

export class ProjectTagsDto {
  capabilities!: Array<{
    capabilityId: string;
    name: string;
    isPrimary: boolean;
    strength: number | null;
    isApplicable: boolean;
  }>;
}
