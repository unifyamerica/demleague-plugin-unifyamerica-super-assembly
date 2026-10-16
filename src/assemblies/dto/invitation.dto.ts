import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { MAX_INVITATIONS_PER_REQUEST } from '../assembly.interface';

/**
 * Either `count` invitations without traits, or one invitation per `traits` entry (e.g. `{ "smoker": "no" }`,
 * exported with the data). The traits' keys and values are checked by the service.
 */
export class CreateInvitationsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_INVITATIONS_PER_REQUEST)
  count?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_INVITATIONS_PER_REQUEST)
  @IsObject({ each: true })
  traits?: Record<string, unknown>[];
}
