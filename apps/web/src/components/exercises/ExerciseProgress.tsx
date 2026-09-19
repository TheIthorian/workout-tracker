import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { EmptyState } from '@/components/common/EmptyState';
import { formatDate } from '@/lib/date-format';
import { TrackingType } from '@/models/exercise';
import { formatSessionClock, type ExerciseHistoryEntry } from '@/models/session';

type ProgressPoint = { date: string; label: string; value: number };

type ProgressSeries = {
    key: string;
    title: string;
    description: string;
    points: ProgressPoint[];
    format: (value: number) => string;
};

/**
 * How one exercise's measurements have moved over its completed workouts.
 *
 * Each measurement gets its own chart rather than a second y-axis: kilograms and reps share no
 * scale, and plotting them together makes one of the two lines unreadable.
 */
export function ExerciseProgress({
    trackingType,
    history,
    isLoading = false,
}: {
    trackingType: TrackingType;
    history: ExerciseHistoryEntry[];
    isLoading?: boolean;
}): JSX.Element {
    const series = buildSeries({ trackingType, history });

    if (isLoading) {
        return <p className="text-sm text-muted-foreground">Loading your progress…</p>;
    }

    if (series.length === 0) {
        return (
            <EmptyState
                title="No progress to chart yet"
                description="Finish a workout with this exercise and your numbers will start showing up here."
            />
        );
    }

    return (
        <div className="space-y-6">
            {series.map((item) => (
                <ProgressChart key={item.key} series={item} />
            ))}
        </div>
    );
}

/** One measurement's trend line, with its latest value called out above the plot. */
function ProgressChart({ series }: { series: ProgressSeries }): JSX.Element {
    const latest = series.points[series.points.length - 1];
    const config = { value: { label: series.title, color: 'hsl(var(--primary))' } } satisfies ChartConfig;

    return (
        <section className="rounded-2xl border border-border bg-card p-4" aria-labelledby={`progress-${series.key}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div>
                    <h3 id={`progress-${series.key}`} className="font-medium">
                        {series.title}
                    </h3>
                    <p className="text-xs text-muted-foreground">{series.description}</p>
                </div>
                <p className="text-lg font-semibold tabular-nums">{series.format(latest.value)}</p>
            </div>
            {series.points.length < 2 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                    One workout logged so far. Finish another to see the line move.
                </p>
            ) : (
                <ChartContainer config={config} className="mt-4 aspect-[16/9] w-full">
                    <LineChart data={series.points} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
                        <YAxis
                            width={48}
                            tickLine={false}
                            axisLine={false}
                            tickMargin={8}
                            tickFormatter={series.format}
                        />
                        <ChartTooltip
                            content={<ChartTooltipContent formatter={(value) => series.format(Number(value))} />}
                        />
                        <Line
                            dataKey="value"
                            name={series.title}
                            type="monotone"
                            stroke="var(--color-value)"
                            strokeWidth={2}
                            dot={{ r: 4, fill: 'var(--color-value)' }}
                            activeDot={{ r: 6 }}
                        />
                    </LineChart>
                </ChartContainer>
            )}
        </section>
    );
}

/** Derives one chronological series per measurement the exercise's tracking type records. */
function buildSeries({
    trackingType,
    history,
}: {
    trackingType: TrackingType;
    history: ExerciseHistoryEntry[];
}): ProgressSeries[] {
    // History arrives newest first; a trend line reads left to right in time.
    const appearances = [...history].reverse();

    const collect = (pick: (entry: ExerciseHistoryEntry) => number | null): ProgressPoint[] =>
        appearances.flatMap((entry) => {
            const value = pick(entry);
            return value === null ? [] : [{ date: entry.completedAt, label: formatDate(entry.completedAt), value }];
        });

    const candidates: ProgressSeries[] =
        trackingType === TrackingType.WeightReps
            ? [
                  {
                      key: 'weight',
                      title: 'Heaviest set',
                      description: 'Top working-set weight each workout',
                      points: collect((entry) => best(workingSets(entry).map((set) => set.weightKg))),
                      format: (value) => `${round(value)} kg`,
                  },
                  {
                      key: 'reps',
                      title: 'Total reps',
                      description: 'Working reps each workout',
                      points: collect((entry) => total(workingSets(entry).map((set) => set.reps))),
                      format: (value) => `${round(value)}`,
                  },
              ]
            : trackingType === TrackingType.Duration
              ? [
                    {
                        key: 'duration',
                        title: 'Longest set',
                        description: 'Best working-set time each workout',
                        points: collect((entry) => best(workingSets(entry).map((set) => set.durationSeconds))),
                        format: (value) => formatSessionClock(Math.round(value)),
                    },
                ]
              : [
                    {
                        key: 'distance',
                        title: 'Distance',
                        description: 'Total working distance each workout',
                        points: collect((entry) => total(workingSets(entry).map((set) => set.distanceM))),
                        format: (value) => `${round(value)} m`,
                    },
                    {
                        key: 'time',
                        title: 'Time',
                        description: 'Total working time each workout',
                        points: collect((entry) => total(workingSets(entry).map((set) => set.durationSeconds))),
                        format: (value) => formatSessionClock(Math.round(value)),
                    },
                ];

    return candidates.filter((item) => item.points.length > 0);
}

/** Warm-ups are deliberately excluded: they measure preparation, not what the exercise achieved. */
function workingSets(entry: ExerciseHistoryEntry): ExerciseHistoryEntry['sets'] {
    return entry.sets.filter((set) => !set.isWarmup);
}

/** The largest recorded measurement, or null when the workout recorded none. */
function best(values: (number | null)[]): number | null {
    const recorded = values.filter((value): value is number => value !== null);
    return recorded.length === 0 ? null : Math.max(...recorded);
}

/** The summed measurement, or null when the workout recorded none. */
function total(values: (number | null)[]): number | null {
    const recorded = values.filter((value): value is number => value !== null);
    return recorded.length === 0 ? null : recorded.reduce((sum, value) => sum + value, 0);
}

/** Trims the floating-point noise a kilogram value can carry without inventing precision. */
function round(value: number): string {
    return String(Math.round(value * 100) / 100);
}
