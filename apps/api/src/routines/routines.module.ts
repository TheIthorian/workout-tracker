import { Module } from '@nestjs/common';
import { RoutineExercisesController } from './routine-exercises.controller.js';
import { RoutinesController } from './routines.controller.js';
import { routineServiceProviders } from './routines.providers.js';

/** Wires the workspace-scoped `/api/v1/workspaces/:workspaceId/routines` routes. */
@Module({
    controllers: [RoutinesController, RoutineExercisesController],
    providers: [...routineServiceProviders],
})
export class RoutinesModule {}
