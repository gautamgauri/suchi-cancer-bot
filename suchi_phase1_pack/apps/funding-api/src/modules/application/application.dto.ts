import { IsString, IsOptional, IsUrl } from "class-validator";

export class IngestApplicationDto {
  @IsUrl({}, { message: "url must be a valid URL" })
  url!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  owner?: string;
}

export class ReviseAnswerDto {
  @IsOptional()
  @IsString()
  questionId?: string;

  @IsString()
  instructions!: string;
}

export class ApproveApplicationDto {
  @IsOptional()
  @IsString()
  actor?: string;
}

export class SubmitApplicationDto {
  @IsOptional()
  @IsString()
  actor?: string;
}

export class SlackCommandDto {
  @IsOptional()
  @IsString()
  command?: string;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  user_name?: string;
}

export class ListApplicationsQueryDto {
  @IsOptional()
  @IsString()
  status?: string;
}
