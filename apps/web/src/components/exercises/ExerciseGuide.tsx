import { BookOpen, ExternalLink, Flag, Focus, MoveUpRight, TriangleAlert } from 'lucide-react';
import type { ExerciseDetail } from '@/models/exercise';

/** A quick reference that shows only authored guide sections and their attachments. */
export function ExerciseGuide({ exercise }: { exercise: ExerciseDetail }): JSX.Element {
    const sections = [
        { heading: 'Setup', body: exercise.guideSetup, icon: Flag, hint: 'Before your first rep' },
        { heading: 'Execution', body: exercise.guideExecution, icon: MoveUpRight, hint: 'The movement' },
        { heading: 'Cues', body: exercise.guideCues, icon: Focus, hint: 'Keep these in mind' },
        { heading: 'Common mistakes', body: exercise.guideMistakes, icon: TriangleAlert, hint: 'Things to watch for' },
    ].filter((section) => section.body?.trim());
    if (!sections.length && !exercise.images.length && !exercise.links.length)
        return (
            <div className="rounded-2xl border border-dashed bg-card px-6 py-10 text-center">
                <BookOpen className="mx-auto mb-4 h-7 w-7 text-primary" aria-hidden />
                <h2 className="text-xl">A little guidance goes a long way</h2>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                    {exercise.isCatalog
                        ? 'There aren’t any technique notes for this movement yet.'
                        : 'Choose Edit guide to add your setup, helpful cues, and a reference for your next session.'}
                </p>
            </div>
        );
    return (
        <div className="space-y-6">
            {exercise.images.length > 0 && (
                <section aria-label="Movement references">
                    <div className="flex gap-4 overflow-x-auto pb-3">
                        {exercise.images.map((image) => (
                            <figure key={image.id} className="w-64 flex-none sm:w-80">
                                <a
                                    href={image.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block overflow-hidden rounded-xl border bg-card focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                    <img
                                        src={image.url}
                                        alt={image.caption || `${exercise.name} reference`}
                                        loading="lazy"
                                        className="aspect-[4/3] w-full object-contain"
                                    />
                                </a>
                                {image.caption && (
                                    <figcaption className="mt-2 px-1 text-xs text-muted-foreground">
                                        {image.caption}
                                    </figcaption>
                                )}
                            </figure>
                        ))}
                    </div>
                </section>
            )}
            {sections.length > 0 && (
                <div className="overflow-hidden rounded-2xl border bg-card">
                    {sections.map(({ heading, body, icon: Icon, hint }, index) => (
                        <section key={heading} className="flex gap-4 border-b p-5 last:border-0 sm:gap-5 sm:p-7">
                            <div className="hidden sm:block">
                                <span className="grid h-9 w-9 place-items-center rounded-full bg-secondary text-xs font-semibold text-primary">
                                    {String(index + 1).padStart(2, '0')}
                                </span>
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="mb-3 flex items-center gap-2">
                                    <Icon className="h-4 w-4 text-primary" aria-hidden />
                                    <h2 className="text-lg">{heading}</h2>
                                    <span className="ml-auto hidden text-xs text-muted-foreground md:inline">
                                        {hint}
                                    </span>
                                </div>
                                <p className="max-w-[65ch] whitespace-pre-line text-sm leading-7 text-foreground/85">
                                    {body}
                                </p>
                            </div>
                        </section>
                    ))}
                </div>
            )}
            {exercise.links.length > 0 && (
                <section>
                    <h2 className="mb-3 text-lg">See it in action</h2>
                    <ul className="space-y-2">
                        {exercise.links.map((link) => (
                            <li key={link.id}>
                                <a
                                    href={safeWebUrl(link.url)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex min-h-14 items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                    <ExternalLink className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                                    <span className="min-w-0 flex-1 break-words">{link.label || link.url}</span>
                                    <span className="sr-only"> (opens in a new tab)</span>
                                    <MoveUpRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                                </a>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}

function safeWebUrl(value: string): string | undefined {
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) ? value : undefined;
    } catch {
        return undefined;
    }
}
