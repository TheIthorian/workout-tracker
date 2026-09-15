import { ApiClient } from '@app/api-client';
import { createLogger } from '@app/logger';
import { ResourceUrlGenerator } from '@app/nest-common';
import { describe, expect, it, vi } from 'vitest';
import { buildExerciseTools } from './exercise.tools.js';

describe('ListExercises', () => {
    it('passes the equipment filter to the API as a comma-separated query value', async () => {
        const fetch = vi.fn(
            async (_input: string | URL, _init?: RequestInit): Promise<Response> =>
                new Response(
                    JSON.stringify({
                        data: [],
                        page: 1,
                        pageSize: 20,
                        totalCount: 0,
                        totalPages: 0,
                    }),
                    { status: 200 },
                ),
        );
        const client = new ApiClient({ baseUrl: 'https://api.test', token: 'token', fetch });
        const logger = createLogger({ context: 'mcp-test', config: { level: 'fatal', pretty: false, redact: true } });
        const urls = new ResourceUrlGenerator({
            config: {
                webAppBaseUrl: 'https://web.test',
                apiBaseUrl: 'https://api.test',
                mcpBaseUrl: 'https://mcp.test',
            },
        });
        const tool = buildExerciseTools({
            context: { userId: 'user-id', workspaceId: 'workspace-id', token: 'token' },
            client,
            logger,
            urls,
        }).find((candidate) => candidate.name === 'list_exercises');

        await tool?.handler({ equipment: ['barbell', 'bench'] });

        expect(fetch).toHaveBeenCalledOnce();
        expect(String(fetch.mock.calls[0]?.[0])).toContain('equipment=barbell%2Cbench');
    });
});
