import { ExternalLink } from 'lucide-react';
import type { ExerciseDetail } from '@/models/exercise';

/** One fixed guide section, in the order the guide is always read. */
type GuideSection = {
    heading: string;
    body: string | null;
};

/**
 * The read-only exercise guide: the four fixed sections, then images, then links.
 *
 * Presentational and fetch-free by design — it renders whatever `exercise` it is given, nothing
 * more. A later bottom-sheet view over the live workout screen renders this same component inside
 * a sheet, where a component-owned fetch would put a second spinner in front of someone mid-set.
 * The edit screen relies on the same fact to show an unsaved live preview: it builds a draft
 * `ExerciseDetail` from its form state and passes it straight in, no network round trip required.
 */
export function ExerciseGuide({ exercise }: { exercise: ExerciseDetail }): JSX.Element {
    const sections: GuideSection[] = [
        { heading: 'Setup', body: exercise.guideSetup },
        { heading: 'Execution', body: exercise.guideExecution },
        { heading: 'Cues', body: exercise.guideCues },
        { heading: 'Common mistakes', body: exercise.guideMistakes },
    ].filter((section): section is GuideSection => !isBlank(section.body));

    const hasImages = exercise.images.length > 0;
    const hasLinks = exercise.links.length > 0;

    if (sections.length === 0 && !hasImages && !hasLinks) {
        return <p className='text-sm text-muted-foreground'>No guide written yet.</p>;
    }

    return (
        <div className='space-y-6'>
            {sections.length > 0 && (
                <div className='divide-y divide-border'>
                    {sections.map(section => (
                        <section key={section.heading} className='py-4 first:pt-0 last:pb-0'>
                            <h2 className='font-heading text-xl text-foreground'>{section.heading}</h2>
                            {/* body comes from a max-4000-char textarea, not markup — plain text, line breaks preserved */}
                            <p className='mt-1.5 max-w-[60ch] whitespace-pre-line leading-relaxed text-foreground/90'>
                                {section.body}
                            </p>
                        </section>
                    ))}
                </div>
            )}

            {hasImages && (
                <div>
                    <h2 className='font-heading text-lg text-foreground'>Images</h2>
                    <div className='mt-2 flex gap-3 overflow-x-auto pb-1'>
                        {exercise.images.map(image => {
                            const src = image.url;

                            return (
                                <a
                                    key={image.id}
                                    href={src}
                                    target='_blank'
                                    rel='noreferrer'
                                    className='flex-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                                >
                                    <img
                                        src={src}
                                        alt={image.caption ?? `${exercise.name} reference`}
                                        loading='lazy'
                                        className='h-36 w-36 rounded-lg border border-border object-cover'
                                    />
                                </a>
                            );
                        })}
                    </div>
                </div>
            )}

            {hasLinks && (
                <div>
                    <h2 className='font-heading text-lg text-foreground'>Links</h2>
                    <ul className='mt-2 space-y-2'>
                        {exercise.links.map(link => (
                            <li key={link.id}>
                                <a
                                    href={link.url}
                                    target='_blank'
                                    rel='noreferrer'
                                    className='flex min-h-[2.75rem] items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                                >
                                    <ExternalLink className='h-3.5 w-3.5 shrink-0 text-muted-foreground' aria-hidden />
                                    <span className='truncate'>{link.label || link.url}</span>
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

function isBlank(value: string | null): boolean {
    return !value || value.trim().length === 0;
}
