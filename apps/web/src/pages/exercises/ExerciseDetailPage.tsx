import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil } from 'lucide-react';
import { ExerciseGuide } from '@/components/exercises/ExerciseGuide';
import { ExerciseGuideEditor } from '@/components/exercises/ExerciseGuideEditor';
import { LoadingState } from '@/components/common/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useExercise } from '@/hooks/use-exercises';
import NotFoundError from '@/pages/NotFoundError';
import { TRACKING_TYPE_META } from './ExercisesListPage';

/**
 * One exercise's how-to guide: read it in a few seconds mid-rest, or switch to editing it.
 *
 * Loads the exercise once, here, and hands it down to `ExerciseGuide` and `ExerciseGuideEditor` as
 * a prop — neither of those components fetches anything itself, which is what lets `ExerciseGuide`
 * be reused inside a bottom sheet over the live workout screen without a second spinner.
 */
export default function ExerciseDetailPage(): JSX.Element {
    const { workspaceId = '', exerciseId = '' } = useParams<{ workspaceId: string; exerciseId: string }>();
    const navigate = useNavigate();

    const [isEditing, setEditing] = useState(false);

    const { data: exercise, isLoading, isError } = useExercise({ workspaceId, exerciseId });

    if (isLoading) {
        return (
            <div className='mx-auto max-w-3xl px-4 py-10 md:px-8'>
                <LoadingState label='Loading exercise…' />
            </div>
        );
    }

    if (isError || !exercise) {
        return <NotFoundError />;
    }

    const { label, icon: Icon } = TRACKING_TYPE_META[exercise.trackingType];

    return (
        <div className='mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-10'>
            <Button
                variant='ghost'
                className='mb-6 gap-2'
                onClick={() => navigate(`/workspaces/${workspaceId}/exercises`)}
            >
                <ArrowLeft className='h-4 w-4' aria-hidden />
                Back to exercises
            </Button>

            <div className='flex flex-wrap items-start justify-between gap-4'>
                <div>
                    <h1 className='font-heading text-3xl text-foreground'>{exercise.name}</h1>
                    <Badge variant='secondary' className='mt-2 gap-1'>
                        <Icon className='h-3 w-3' aria-hidden />
                        {label}
                    </Badge>
                </div>
                {/* While editing, ExerciseGuideEditor renders its own close control: it alone knows
                    whether there's unsaved guide text or an open link/image draft a close might
                    otherwise silently discard, so it alone can decide whether closing is safe. */}
                {!isEditing && (
                    <Button variant='outline' className='gap-2' onClick={() => setEditing(true)}>
                        <Pencil className='h-4 w-4' aria-hidden />
                        Edit guide
                    </Button>
                )}
            </div>

            <div className='mt-8'>
                {isEditing ? (
                    <ExerciseGuideEditor
                        workspaceId={workspaceId}
                        exercise={exercise}
                        onDone={() => setEditing(false)}
                    />
                ) : (
                    <ExerciseGuide exercise={exercise} />
                )}
            </div>
        </div>
    );
}
