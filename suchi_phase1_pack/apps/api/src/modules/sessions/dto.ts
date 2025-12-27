import { IsIn, IsOptional, IsString } from "class-validator";
export class CreateSessionDto {
  @IsString() @IsIn(["web","app","whatsapp"]) channel!: string;
  @IsOptional() @IsString() locale?: string;
  @IsOptional() @IsString() userType?: string;
}
