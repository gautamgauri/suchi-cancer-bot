import { IsIn, IsOptional, IsString } from "class-validator";
export class CreateSessionDto {
  @IsString() @IsIn(["web","app","whatsapp","voice"]) channel!: string;
  @IsOptional() @IsString() locale?: string;
  @IsOptional() @IsString() userType?: string;
  @IsOptional() @IsString() @IsIn(["general", "patient", "caregiver", "post_diagnosis"]) userContext?: string;
  @IsOptional() @IsString() cancerType?: string;
  @IsOptional() @IsString() @IsIn(["patient_caregiver", "community_member", "field_worker", "unknown"]) userRole?: string;
}
