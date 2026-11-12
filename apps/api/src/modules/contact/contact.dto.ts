import { IsEmail, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from "class-validator";

/** Field caps for the public contact form (the landing form uses the same maxlength values). */
export const CONTACT_LIMITS = {
  name: 100,
  email: 254,
  message: 5000,
  honeypot: 200,
  /** Upper bound on the client-reported time on page, to keep the field sane. */
  maxElapsedMs: 7 * 24 * 60 * 60 * 1000,
} as const;

/**
 * Single-line text: no CR/LF (header injection), no other C0 controls, DEL or
 * Unicode line/paragraph separators.
 */
// eslint-disable-next-line no-control-regex
export const SINGLE_LINE = /^[^\u0000-\u001f\u007f\u2028\u2029]*$/;

export class ContactDto {
  @IsString()
  @Length(1, CONTACT_LIMITS.name)
  @Matches(SINGLE_LINE, { message: "name must be a single line of text" })
  name!: string;

  @IsString()
  @MaxLength(CONTACT_LIMITS.email)
  @Matches(SINGLE_LINE, { message: "email must be a single line of text" })
  @IsEmail({}, { message: "email must be a valid email address" })
  email!: string;

  @IsString()
  @Length(1, CONTACT_LIMITS.message)
  message!: string;

  /** Honeypot: a field people never see. Anything in it marks the request as automated. */
  @IsOptional()
  @IsString()
  @MaxLength(CONTACT_LIMITS.honeypot)
  website?: string;

  /** Milliseconds between the form becoming usable and the submit (client-reported). */
  @IsInt()
  @Min(0)
  @Max(CONTACT_LIMITS.maxElapsedMs)
  elapsedMs!: number;
}
