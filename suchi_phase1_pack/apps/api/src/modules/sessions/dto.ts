import { IsIn, IsOptional, IsString } from "class-validator";
export class CreateSessionDto {
  @IsString() @IsIn(["web","app","whatsapp"]) channel!: string;
  @IsOptional() @IsString() locale?: string;
  @IsOptional() @IsString() userType?: string;
  @IsOptional() @IsString() @IsIn(["general", "patient", "caregiver", "post_diagnosis"]) userContext?: string;
  @IsOptional() @IsString() cancerType?: string;
}
