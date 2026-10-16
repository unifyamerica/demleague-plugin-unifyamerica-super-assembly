import { IsInt, IsString, Matches, Max, Min } from 'class-validator';

export const INVITATION_CODE_PATTERN = /^[A-Za-z0-9]{20}$/;

export class JoinDto {
  @IsString() @Matches(INVITATION_CODE_PATTERN) code!: string;
}

export class RespondDto {
  // The question's own min and max are checked by the service
  @IsInt() @Min(-1_000_000_000) @Max(1_000_000_000) value!: number;
}
