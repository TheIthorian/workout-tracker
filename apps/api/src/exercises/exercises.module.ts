import { Module } from '@nestjs/common';
import { ExerciseGuideImagesController } from './exercise-guide-images.controller.js';
import { ExerciseGuideController } from './exercise-guide.controller.js';
import { ExercisesController } from './exercises.controller.js';
import { exerciseServiceProviders } from './exercises.providers.js';

/** Wires the workspace-scoped `/api/v1/workspaces/:workspaceId/exercises` routes. */
@Module({
    controllers: [ExercisesController, ExerciseGuideController, ExerciseGuideImagesController],
    providers: [...exerciseServiceProviders],
})
export class ExercisesModule {}
