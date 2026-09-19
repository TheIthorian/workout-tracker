import { Dumbbell, Route, Timer, type LucideIcon } from 'lucide-react';
import type { Equipment } from './equipment';
import type { MuscleGroup } from './muscle';

/** How an exercise's work is measured. Mirrors `@app/domain`'s enum of the same name. */
export enum TrackingType {
    WeightReps = 'weight_reps',
    Duration = 'duration',
    DistanceTime = 'distance_time',
}

/**
 * Label and icon for each tracking type, shared by the list badge, the create dialog's select, and
 * the detail page's header badge.
 *
 * Kept in this model file rather than a page component: a page module that exports a non-component
 * value alongside its default component export trips `react-refresh/only-export-components`.
 */
export const TRACKING_TYPE_META: Record<TrackingType, { label: string; icon: LucideIcon }> = {
    [TrackingType.WeightReps]: { label: 'Weight & reps', icon: Dumbbell },
    [TrackingType.Duration]: { label: 'Duration', icon: Timer },
    [TrackingType.DistanceTime]: { label: 'Distance & time', icon: Route },
};

/** A movement in the user's exercise library. */
export type Exercise = {
    id: string;
    name: string;
    /** Set on catalog exercises; null on the user's own. */
    slug: string | null;
    /** Shared, read-only content: no edit, archive, or link controls apply. */
    isCatalog: boolean;
    trackingType: TrackingType;
    equipment: Equipment[];
    /** What the movement is for. */
    primaryMuscles: MuscleGroup[];
    /** What it also works, without being the point of the movement. */
    secondaryMuscles: MuscleGroup[];
    notes: string | null;
    /** This workspace's rest between sets; null until set, when the app's default applies. */
    restSeconds: number | null;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
};

/** One image attached to an exercise's guide, in display order. */
export type ExerciseGuideImage = {
    id: string;
    caption: string | null;
    position: number;
    /** Absolute CDN url; needs no session. */
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
    equipment?: Equipment[];
    primaryMuscles?: MuscleGroup[];
    secondaryMuscles?: MuscleGroup[];
    notes?: string | null;
    guideSetup?: string | null;
    guideExecution?: string | null;
    guideCues?: string | null;
    guideMistakes?: string | null;
};

export type PatchExerciseRequest = {
    name?: string;
    trackingType?: TrackingType;
    equipment?: Equipment[];
    primaryMuscles?: MuscleGroup[];
    secondaryMuscles?: MuscleGroup[];
    notes?: string | null;
    guideSetup?: string | null;
    guideExecution?: string | null;
    guideCues?: string | null;
    guideMistakes?: string | null;
    archived?: boolean;
};

/** The workspace's own settings for an exercise, catalog or custom. */
export type SaveExercisePreferencesRequest = {
    restSeconds: number;
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
