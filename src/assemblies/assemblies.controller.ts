import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequireAbility } from '@unifyamerica/demleague-plugin-sdk';
import { AssembliesService } from './assemblies.service';
import {
  CreateAssemblyDto,
  ExportQueryDto,
  ListAssembliesQueryDto,
  PageQueryDto,
  UpdateAssemblyDto,
} from './dto/assembly.dto';
import { CreateInvitationsDto } from './dto/invitation.dto';

// Org admins only (`Assembly` is granted to org_admin), checked in the request's organization
@Controller('assemblies')
export class AssembliesController {
  constructor(private readonly assemblies: AssembliesService) {}

  @Get()
  @RequireAbility('read', 'Assembly')
  list(@Query() query: ListAssembliesQueryDto) {
    return this.assemblies.list(query);
  }

  @Post()
  @RequireAbility('create', 'Assembly')
  create(@Body() dto: CreateAssemblyDto) {
    return this.assemblies.create(dto);
  }

  @Get(':id')
  @RequireAbility('read', 'Assembly')
  get(@Param('id') id: string) {
    return this.assemblies.get(id);
  }

  @Patch(':id')
  @RequireAbility('update', 'Assembly')
  update(@Param('id') id: string, @Body() dto: UpdateAssemblyDto) {
    return this.assemblies.update(id, dto);
  }

  @Delete(':id')
  @RequireAbility('delete', 'Assembly')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.assemblies.remove(id);
  }

  @Post(':id/schedule')
  @RequireAbility('update', 'Assembly')
  @HttpCode(200)
  schedule(@Param('id') id: string) {
    return this.assemblies.schedule(id);
  }

  @Post(':id/unschedule')
  @RequireAbility('update', 'Assembly')
  @HttpCode(200)
  unschedule(@Param('id') id: string) {
    return this.assemblies.unschedule(id);
  }

  @Post(':id/cancel')
  @RequireAbility('update', 'Assembly')
  @HttpCode(200)
  cancel(@Param('id') id: string) {
    return this.assemblies.cancel(id);
  }

  @Get(':id/invitations')
  @RequireAbility('read', 'Assembly')
  listInvitations(@Param('id') id: string, @Query() query: PageQueryDto) {
    return this.assemblies.listInvitations(id, query);
  }

  @Post(':id/invitations')
  @RequireAbility('update', 'Assembly')
  createInvitations(
    @Param('id') id: string,
    @Body() dto: CreateInvitationsDto,
  ) {
    return this.assemblies.createInvitations(id, dto);
  }

  @Delete(':id/invitations/:invitationId')
  @RequireAbility('update', 'Assembly')
  @HttpCode(204)
  async removeInvitation(
    @Param('id') id: string,
    @Param('invitationId') invitationId: string,
  ): Promise<void> {
    await this.assemblies.removeInvitation(id, invitationId);
  }

  @Get(':id/progress')
  @RequireAbility('read', 'Assembly')
  progress(@Param('id') id: string) {
    return this.assemblies.progress(id);
  }

  @Get(':id/export')
  @RequireAbility('read', 'Assembly')
  export(@Param('id') id: string, @Query() query: ExportQueryDto) {
    return this.assemblies.exportPage(id, query.page);
  }
}
