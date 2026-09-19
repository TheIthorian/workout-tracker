// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLogSet } from './use-sessions';
import { sessionsApi } from '@/lib/api';
import { TrackingType } from '@/models/exercise';
import type { SessionDetail } from '@/models/session';

vi.mock('@/lib/api', () => ({ sessionsApi: { logSet: vi.fn() } }));

const workspaceId = 'workspace-1';
const sessionId = 'session-1';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('useLogSet', () => {
    it('logs a set in a browser without crypto.randomUUID', async () => {
        // A page served over plain HTTP — a phone on gym wifi — has no secure-context crypto.
        vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
            throw new TypeError('crypto.randomUUID is not a function');
        });
        const logSet = vi.mocked(sessionsApi.logSet).mockResolvedValue(buildSession());
        const { result, client } = renderLogSet();

        result.current.mutate({ sessionId, variables: { sessionExerciseId: 'session-exercise-1', data: { reps: 8 } } });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(logSet).toHaveBeenCalledWith(workspaceId, sessionId, 'session-exercise-1', { reps: 8 });
        client.clear();
    });

    it('shows the set on the workout screen before the server answers', async () => {
        let resolveLogSet: (session: SessionDetail) => void = () => {};
        vi.mocked(sessionsApi.logSet).mockReturnValue(
            new Promise<SessionDetail>((resolve) => {
                resolveLogSet = resolve;
            }),
        );
        const { result, client, key } = renderLogSet();

        result.current.mutate({
            sessionId,
            variables: { sessionExerciseId: 'session-exercise-1', data: { reps: 8, weightKg: 60 } },
        });

        await waitFor(() =>
            expect(client.getQueryData<SessionDetail>(key)?.exercises[0]?.sets).toEqual([
                expect.objectContaining({ reps: 8, weightKg: 60, setIndex: 1 }),
            ]),
        );

        resolveLogSet(buildSession());
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        client.clear();
    });

    it('gives each optimistic set its own key, so React can tell two sets apart', async () => {
        vi.mocked(sessionsApi.logSet).mockImplementation(() => new Promise<SessionDetail>(() => {}));
        const { result, client, key } = renderLogSet();

        result.current.mutate({ sessionId, variables: { sessionExerciseId: 'session-exercise-1', data: { reps: 8 } } });
        await waitFor(() => expect(client.getQueryData<SessionDetail>(key)?.exercises[0]?.sets).toHaveLength(1));
        result.current.mutate({ sessionId, variables: { sessionExerciseId: 'session-exercise-1', data: { reps: 6 } } });
        await waitFor(() => expect(client.getQueryData<SessionDetail>(key)?.exercises[0]?.sets).toHaveLength(2));

        const ids = client.getQueryData<SessionDetail>(key)?.exercises[0]?.sets.map((set) => set.id) ?? [];
        expect(new Set(ids).size).toBe(2);
        client.clear();
    });
});

/** Mounts `useLogSet` over a query cache already holding the in-progress workout. */
function renderLogSet(): {
    result: { current: ReturnType<typeof useLogSet> };
    client: QueryClient;
    key: readonly string[];
} {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
    const key = ['sessions', workspaceId, sessionId] as const;
    client.setQueryData<SessionDetail>(key, buildSession());

    const { result } = renderHook(() => useLogSet({ workspaceId }), {
        wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
    });

    return { result, client, key };
}

function buildSession(): SessionDetail {
    return {
        id: sessionId,
        name: 'Push day',
        routineId: null,
        startedAt: '2026-09-19T10:00:00.000Z',
        completedAt: null,
        notes: null,
        exerciseCount: 1,
        setCount: 0,
        createdAt: '2026-09-19T10:00:00.000Z',
        updatedAt: '2026-09-19T10:00:00.000Z',
        exercises: [
            {
                id: 'session-exercise-1',
                position: 1,
                source: 'from_routine',
                trackingType: TrackingType.WeightReps,
                targetSets: 3,
                restSeconds: 90,
                notes: null,
                skippedAt: null,
                targetReps: 8,
                targetWeightKg: 60,
                targetDurationSeconds: null,
                targetDistanceM: null,
                exercise: { id: 'exercise-1', name: 'Back Squat', isCatalog: true, equipment: [], archivedAt: null },
                sets: [],
            },
        ],
        state: {
            currentSessionExerciseId: 'session-exercise-1',
            nextSetIndex: 1,
            progress: {
                totalExercises: 1,
                completedExercises: 0,
                skippedExercises: 0,
                targetSets: 3,
                loggedSets: 0,
            },
            canComplete: false,
        },
    };
}
