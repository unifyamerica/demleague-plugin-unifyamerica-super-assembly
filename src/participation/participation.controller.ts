import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  CurrentActor,
  RequireAbility,
  type PluginActor,
} from '@unifyamerica/demleague-plugin-sdk';
import { JoinDto, RespondDto } from './dto/participation.dto';
import { ParticipationService } from './participation.service';

// Members (`Participation` is granted to member, so org admins too): only their own participations
@Controller()
export class ParticipationController {
  constructor(private readonly participation: ParticipationService) {}

  @Get('join/:code')
  @RequireAbility('read', 'Participation')
  preview(@CurrentActor() actor: PluginActor, @Param('code') code: string) {
    return this.participation.preview(actor, code);
  }

  @Get('participations')
  @RequireAbility('read', 'Participation')
  list(@CurrentActor() actor: PluginActor) {
    return this.participation.list(actor);
  }

  @Post('participations')
  @RequireAbility('create', 'Participation')
  join(@CurrentActor() actor: PluginActor, @Body() dto: JoinDto) {
    return this.participation.join(actor, dto.code);
  }

  @Get('participations/:id')
  @RequireAbility('read', 'Participation')
  session(@CurrentActor() actor: PluginActor, @Param('id') id: string) {
    return this.participation.session(actor, id);
  }

  @Post('participations/:id/ready')
  @RequireAbility('update', 'Participation')
  @HttpCode(200)
  ready(@CurrentActor() actor: PluginActor, @Param('id') id: string) {
    return this.participation.ready(actor, id);
  }

  @Post('participations/:id/responses')
  @RequireAbility('create', 'Participation')
  @HttpCode(200)
  respond(
    @CurrentActor() actor: PluginActor,
    @Param('id') id: string,
    @Body() dto: RespondDto,
  ) {
    return this.participation.respond(actor, id, dto.value);
  }
}
