import { Module } from '@nestjs/common';
import { ExercisesController } from './exercises.controller.js';
import { exerciseServiceProviders } from './exercises.providers.js';

/** Wires the workspace-scoped `/api/v1/workspaces/:workspaceId/exercises` routes. */
@Module({
    controllers: [ExercisesController],
    providers: [...exerciseServiceProviders],
})
export class ExercisesModule {}
