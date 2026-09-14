import { ExerciseImagesController } from './exercise-images.controller.js';
import { Module } from '@nestjs/common';
import { ExerciseGuideController } from './exercise-guide.controller.js';
import { ExerciseHistoryController } from './exercise-history.controller.js';
import { ExercisesController } from './exercises.controller.js';
import { exerciseServiceProviders } from './exercises.providers.js';

/** Wires the workspace-scoped `/api/v1/workspaces/:workspaceId/exercises` routes. */
@Module({
    controllers: [ExerciseImagesController, ExercisesController, ExerciseGuideController, ExerciseHistoryController],
    providers: [...exerciseServiceProviders],
})
export class ExercisesModule {}
