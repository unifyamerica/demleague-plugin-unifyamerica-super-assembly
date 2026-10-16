import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  AssemblyStatus,
  MAX_PAGE_HTML_LENGTH,
  MAX_PROMPT_LENGTH,
  MAX_QUESTIONS,
  MAX_ROUND_DURATION_SEC,
  MAX_TITLE_LENGTH,
  MIN_ROUND_DURATION_SEC,
  TIME_ZONES,
} from '../assembly.interface';

// Bounds for estimates: wide enough for any question, small enough to stay exact in JSON and sums
const VALUE_BOUND = 1_000_000_000;

export class QuestionDto {
  @IsString() @MaxLength(MAX_PROMPT_LENGTH) prompt!: string;
  @IsInt() @Min(-VALUE_BOUND) @Max(VALUE_BOUND) min!: number;
  @IsInt() @Min(-VALUE_BOUND) @Max(VALUE_BOUND) max!: number;
}

/** Drafts may be incomplete; scheduling checks the rest. */
export class CreateAssemblyDto {
  @IsString() @IsNotEmpty() @MaxLength(MAX_TITLE_LENGTH) title!: string;

  // An ISO date-time (UTC), or null for none yet
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  startsAt?: string | null;

  @IsOptional() @IsIn(TIME_ZONES) timeZone?: string;

  @IsOptional()
  @IsInt()
  @Min(MIN_ROUND_DURATION_SEC)
  @Max(MAX_ROUND_DURATION_SEC)
  roundDurationSec?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_QUESTIONS)
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  questions?: QuestionDto[];

  @IsOptional()
  @IsString()
  @MaxLength(MAX_PAGE_HTML_LENGTH)
  landingHtml?: string;
  @IsOptional() @IsString() @MaxLength(MAX_PAGE_HTML_LENGTH) readyHtml?: string;
  @IsOptional()
  @IsString()
  @MaxLength(MAX_PAGE_HTML_LENGTH)
  finishedHtml?: string;
}

export class UpdateAssemblyDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TITLE_LENGTH)
  title?: string;
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  startsAt?: string | null;
  @IsOptional() @IsIn(TIME_ZONES) timeZone?: string;
  @IsOptional()
  @IsInt()
  @Min(MIN_ROUND_DURATION_SEC)
  @Max(MAX_ROUND_DURATION_SEC)
  roundDurationSec?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_QUESTIONS)
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  questions?: QuestionDto[];

  @IsOptional()
  @IsString()
  @MaxLength(MAX_PAGE_HTML_LENGTH)
  landingHtml?: string;
  @IsOptional() @IsString() @MaxLength(MAX_PAGE_HTML_LENGTH) readyHtml?: string;
  @IsOptional()
  @IsString()
  @MaxLength(MAX_PAGE_HTML_LENGTH)
  finishedHtml?: string;
}

export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class ListAssembliesQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(Object.values(AssemblyStatus)) status?: AssemblyStatus;
}

export class ExportQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page?: number;
}
