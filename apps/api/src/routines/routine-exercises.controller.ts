import {
    guidSchema,
    patchRoutineExerciseRequestSchema,
    postRoutineExerciseRequestSchema,
    type PatchRoutineExerciseRequest,
    type PostRoutineExerciseRequest,
    type RoutineDetailResponse,
} from '@app/api-contract';
import {
    CurrentUser,
    SessionAuthGuard,
    ValidatedBody,
    ValidatedParam,
    type CurrentUserContext,
} from '@app/nest-common';
import type { RoutinesService } from '@app/services';
import { Controller, Delete, HttpCode, Inject, Patch, Post, UseGuards } from '@nestjs/common';
import { ROUTINES_SERVICE } from './routines.providers.js';

/**
 * One slot at a time — the web editor's save-as-you-go path. Session-only: the MCP tools send the
 * whole list through `PUT .../exercises` instead, so no token needs these.
 */
@Controller('v1/workspaces/:workspaceId/routines/:routineId/exercises')
@UseGuards(SessionAuthGuard)
export class RoutineExercisesController {
    constructor(@Inject(ROUTINES_SERVICE) private readonly routines: RoutinesService) {}

    /** Appends a slot to the end of the routine. Returns the whole routine. */
    @Post()
    @HttpCode(200)
    async addExercise(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'routineId', schema: guidSchema }) routineId: string,
        @ValidatedBody(postRoutineExerciseRequestSchema) body: PostRoutineExerciseRequest,
    ): Promise<RoutineDetailResponse> {
        return this.routines.addExercise({ userId: currentUser.userId, workspaceId, routineId, ...body });
    }

    /** Updates one slot's targets. An omitted key leaves the stored value alone. Returns the whole routine. */
    @Patch(':routineExerciseId')
    async patchExercise(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'routineId', schema: guidSchema }) routineId: string,
        @ValidatedParam({ name: 'routineExerciseId', schema: guidSchema }) routineExerciseId: string,
        @ValidatedBody(patchRoutineExerciseRequestSchema) body: PatchRoutineExerciseRequest,
    ): Promise<RoutineDetailResponse> {
        return this.routines.updateExercise({
            userId: currentUser.userId,
            workspaceId,
            routineId,
            routineExerciseId,
            ...body,
        });
    }

    /** Removes a slot and closes the gap. Returns the whole routine. */
    @Delete(':routineExerciseId')
    async removeExercise(
        @CurrentUser() currentUser: CurrentUserContext,
        @ValidatedParam({ name: 'workspaceId', schema: guidSchema }) workspaceId: string,
        @ValidatedParam({ name: 'routineId', schema: guidSchema }) routineId: string,
        @ValidatedParam({ name: 'routineExerciseId', schema: guidSchema }) routineExerciseId: string,
    ): Promise<RoutineDetailResponse> {
        return this.routines.removeExercise({ userId: currentUser.userId, workspaceId, routineId, routineExerciseId });
    }
}
