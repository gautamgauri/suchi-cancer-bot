export class TagProjectDto {
  capabilityIds!: string[];
  isPrimary?: boolean[];
  strength?: (number | null)[];
  isApplicable?: boolean[];
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
