/** How an exercise's work is measured. Mirrors `@app/domain`'s enum of the same name. */
export enum TrackingType {
    WeightReps = 'weight_reps',
    Duration = 'duration',
    DistanceTime = 'distance_time',
}

/** A movement in the workspace's exercise library. */
export type Exercise = {
    id: string;
    name: string;
    trackingType: TrackingType;
    notes: string | null;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
};

/** One image attached to an exercise's guide, in display order. */
export type ExerciseGuideImage = {
    id: string;
    caption: string | null;
    position: number;
    url: string;
};

/** One external link attached to an exercise's guide, in display order. */
export type ExerciseLink = {
    id: string;
    url: string;
    label: string | null;
    position: number;
};

/** An exercise plus its guide content, images, and links — what the detail page reads. */
export type ExerciseDetail = Exercise & {
    guideSetup: string | null;
    guideExecution: string | null;
    guideCues: string | null;
    guideMistakes: string | null;
    images: ExerciseGuideImage[];
    links: ExerciseLink[];
};

export type SaveExerciseRequest = {
    name: string;
    trackingType: TrackingType;
    notes?: string | null;
    guideSetup?: string | null;
    guideExecution?: string | null;
    guideCues?: string | null;
    guideMistakes?: string | null;
};

export type PatchExerciseRequest = {
    name?: string;
    trackingType?: TrackingType;
    notes?: string | null;
    guideSetup?: string | null;
    guideExecution?: string | null;
    guideCues?: string | null;
    guideMistakes?: string | null;
    archived?: boolean;
};

export type SaveExerciseLinkRequest = {
    url: string;
    label?: string | null;
};

export type PatchExerciseLinkRequest = {
    url?: string;
    label?: string | null;
    position?: number;
};
