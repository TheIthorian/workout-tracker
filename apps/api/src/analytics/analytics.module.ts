import { Module } from '@nestjs/common';
import { analyticsServiceProviders } from './analytics.providers.js';
import { MuscleVolumeController } from './muscle-volume.controller.js';

/** Wires `/api/v1/workspaces/:workspaceId/analytics`. */
@Module({
    controllers: [MuscleVolumeController],
    providers: [...analyticsServiceProviders],
})
export class AnalyticsModule {}
