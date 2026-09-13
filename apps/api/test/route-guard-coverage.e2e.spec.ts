import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness.js';

/**
 * Nest's own metadata keys for controller/route/guard reflection. NOT part of `@nestjs/common`'s
 * public export surface (`Object.keys(require('@nestjs/common'))` does not list them) - but the
 * string values are part of Nest's stable decorator contract: `@Controller`, `@Get`/`@Post`/etc,
 * and `@UseGuards` all write exactly these keys via `Reflect.defineMetadata`
 * (`@nestjs/common/decorators/core/controller.decorator.js`,
 * `.../http/request-mapping.decorator.js`, `.../core/use-guards.decorator.js` - verified against
 * the installed package). Reading them back is reading Nest's real, running wiring for this app,
 * not a hand-maintained parallel list of routes that can silently drift from the source.
 */
const CONTROLLER_WATERMARK = '__controller__';
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';
const GUARDS_METADATA = '__guards__';

/** Every route in this app is served under this prefix (`app.setGlobalPrefix('api')`, bootstrap.ts). */
const GLOBAL_PREFIX = 'api';

type RouteEntry = {
    method: string;
    path: string;
    controllerName: string;
    handlerName: string;
    /** Class-level guards followed by method-level guards, in that order - see `collectRoutes`. */
    guardNames: string[];
};

type PublicRoute = { method: string; path: string; reason: string };

/**
 * Routes that are genuinely anonymous by design - no session, no MCP token, nothing. Every entry
 * here was verified against its controller's own source (and usually its own doc comment) before
 * being added; padding this list to make a failing test pass defeats the entire point of this
 * suite, which is to fail loudly the next time an unguarded route is added by mistake.
 */
const PUBLIC_ROUTES: PublicRoute[] = [
    {
        method: 'GET',
        path: '/api/health',
        reason: 'Liveness probe, deliberately dependency-free (health.controller.ts:getHealth).',
    },
    {
        method: 'GET',
        path: '/api/health/ready',
        reason:
            'Readiness probe. Touches the database but returns no data - it is what gates a deploy ' +
            '(railway.api.json), and a platform probe cannot present a credential ' +
            '(health.controller.ts:getReadiness).',
    },
    {
        method: 'GET',
        path: '/api/health/boom',
        reason:
            'Test-only route that throws unconditionally so AppErrorFilter has real HTTP coverage; ' +
            'falls back to a 404 outside NODE_ENV=test in the handler body itself, not via a guard ' +
            '(health.controller.ts:getBoom).',
    },
    {
        method: 'POST',
        path: '/api/v1/auth/login',
        reason: 'The sign-in flow itself - a caller with no session is exactly who calls this (auth.controller.ts).',
    },
    {
        method: 'POST',
        path: '/api/v1/auth/logout',
        reason:
            'Always responds 200 and clears the cookie even with no valid session, by design ' +
            '(auth.controller.ts, see AuthService.logout doc).',
    },
    {
        method: 'POST',
        path: '/api/v1/auth/signup',
        reason: 'The sign-up flow itself (auth.controller.ts).',
    },
];

/**
 * The exact routes `apps/mcp`'s tools call, and the ONLY routes that may carry
 * `SessionOrMcpPatGuard`. Adding a route to this list is a deliberate decision that a leaked MCP
 * token can now reach it; it should never grow because a controller change happened to leave a
 * broader guard on by accident.
 */
const MCP_TOKEN_ROUTES: { method: string; path: string }[] = [
    { method: 'GET', path: '/api/v1/me' },
    { method: 'GET', path: '/api/v1/workspaces' },
    { method: 'GET', path: '/api/v1/workspaces/:workspaceId' },
    // ListExercises
    { method: 'GET', path: '/api/v1/workspaces/:workspaceId/exercises' },
    // GetExercise
    { method: 'GET', path: '/api/v1/workspaces/:workspaceId/exercises/:exerciseId' },
    // CreateExercise
    { method: 'POST', path: '/api/v1/workspaces/:workspaceId/exercises' },
    // UpdateExercise
    { method: 'PATCH', path: '/api/v1/workspaces/:workspaceId/exercises/:exerciseId' },
    // AddExerciseLink. No UpdateExerciseLink/RemoveExerciseLink tool exists, so patching or
    // deleting a link stays session-only (exercise-guide.controller.ts) rather than joining this map.
    { method: 'POST', path: '/api/v1/workspaces/:workspaceId/exercises/:exerciseId/links' },
    // ListRoutines
    { method: 'GET', path: '/api/v1/workspaces/:workspaceId/routines' },
    // GetRoutine
    { method: 'GET', path: '/api/v1/workspaces/:workspaceId/routines/:routineId' },
    // CreateRoutine
    { method: 'POST', path: '/api/v1/workspaces/:workspaceId/routines' },
    // UpdateRoutine
    { method: 'PATCH', path: '/api/v1/workspaces/:workspaceId/routines/:routineId' },
    // CreateRoutine / UpdateRoutine send the whole exercise list here. The per-slot routes
    // (routine-exercises.controller.ts) are session-only: no tool edits one slot at a time.
    { method: 'PUT', path: '/api/v1/workspaces/:workspaceId/routines/:routineId/exercises' },
    // ListSessions
    { method: 'GET', path: '/api/v1/workspaces/:workspaceId/sessions' },
    // GetActiveSession
    { method: 'GET', path: '/api/v1/workspaces/:workspaceId/sessions/active' },
    // GetSession
    { method: 'GET', path: '/api/v1/workspaces/:workspaceId/sessions/:sessionId' },
    // StartSession
    { method: 'POST', path: '/api/v1/workspaces/:workspaceId/sessions' },
    // CompleteSession
    { method: 'POST', path: '/api/v1/workspaces/:workspaceId/sessions/:sessionId/complete' },
    // LogSet
    {
        method: 'POST',
        path: '/api/v1/workspaces/:workspaceId/sessions/:sessionId/exercises/:sessionExerciseId/sets',
    },
];

/**
 * Routes that must be reachable by an MCP personal access token ALONE - no session fallback - and
 * so carry `McpPatAuthGuard` bare rather than `SessionOrMcpPatGuard`. A second, separate list from
 * `MCP_TOKEN_ROUTES` because the guard class, and the reachability story, differ: `mcp-session` is
 * how `apps/mcp` resolves a token to a workspace before it has anything session-shaped to fall
 * back to. Same discipline as `MCP_TOKEN_ROUTES` applies - an entry here is a deliberate decision,
 * not something a route should gain by accident.
 */
const PAT_ONLY_ROUTES: { method: string; path: string }[] = [{ method: 'GET', path: '/api/v1/me/mcp-session' }];

/**
 * Pins two review findings in place: (1) every route in `apps/api` is reachable only by something
 * that authenticates it - a route added later with no `@UseGuards()` at all is completely
 * unauthenticated, since this app has no `APP_GUARD` catching an unguarded route by default; (2) a
 * personal access token reaches exactly the routes `apps/mcp`'s tools call and nowhere else - via
 * either `SessionOrMcpPatGuard` (`MCP_TOKEN_ROUTES`) or bare `McpPatAuthGuard` (`PAT_ONLY_ROUTES`) -
 * so a PAT cannot silently gain a new route the way it did before the Critical findings this suite
 * cannot silently gain a new route. The property being checked is "PAT-reachable", not "carries
 * this one guard class": a bare `@UseGuards(McpPatAuthGuard)` grants a token exactly as much access
 * as `SessionOrMcpPatGuard` does and must be tracked the same way.
 *
 * Walks the REAL, running `ModulesContainer` rather than importing controller files by hand: it
 * asks the same object Nest's own router built the live route table from, so a controller that is
 * wired into `AppModule` but never imported by this file is still checked, and a route this file
 * described that no longer exists is caught too (see the "PUBLIC_ROUTES still exist" case below).
 */
describe('route guard coverage', () => {
    let app: TestApp;
    let routes: RouteEntry[];

    beforeAll(async () => {
        app = await createTestApp();
        routes = collectRoutes(app.get(ModulesContainer));
    });

    afterAll(async () => {
        await app?.close();
    });

    // A canary for the introspection itself: if `collectRoutes` silently returned nothing (a
    // metadata-key typo, a Nest version bump changing where controllers live), every assertion
    // below would vacuously pass instead of failing - this catches that before it can happen.
    it('found a realistic number of real routes to check', () => {
        expect(routes.length).toBeGreaterThan(15);
    });

    it('guards every route except the documented public ones', () => {
        const publicKeys = new Set(PUBLIC_ROUTES.map(routeKey));
        const unguarded = routes.filter((route) => route.guardNames.length === 0 && !publicKeys.has(routeKey(route)));

        if (unguarded.length === 0) return;

        const details = unguarded
            .map((route) => `  ${route.method} ${route.path}  (${route.controllerName}.${route.handlerName})`)
            .join('\n');

        throw new Error(
            `${unguarded.length} route(s) in apps/api have NO guard at all and are not on the PUBLIC_ROUTES ` +
                `allowlist in test/route-guard-coverage.e2e.spec.ts:\n${details}\n\n` +
                'This app has no APP_GUARD, so an unguarded route is completely unauthenticated - anyone can ' +
                'call it. Fix this by either:\n' +
                '  1. Adding @UseGuards(SessionAuthGuard) (session-only) or @UseGuards(SessionOrMcpPatGuard) ' +
                '(session or MCP token) to the handler, matching what the route is meant to require; or\n' +
                '  2. If the route is genuinely meant to be anonymous, add it to PUBLIC_ROUTES in this file ' +
                'with a comment naming why - do not add it just to make this test pass.',
        );
    });

    it('every PUBLIC_ROUTES entry still names a route that actually exists', () => {
        // Catches the mirror mistake: an allowlist entry for a route that was renamed or removed,
        // which would otherwise sit there doing nothing while looking like real coverage.
        const actualKeys = new Set(routes.map(routeKey));
        const stale = PUBLIC_ROUTES.filter((route) => !actualKeys.has(routeKey(route)));

        expect(stale.map(routeKey)).toEqual([]);
    });

    it('gives PAT-reachable access to exactly the MCP tool-to-route map plus the PAT-only allowlist, and only the expected guard on each', () => {
        const byKey = new Map(routes.map((route) => [routeKey(route), route]));
        const mappedKeys = new Set(MCP_TOKEN_ROUTES.map(routeKey));
        const patOnlyKeys = new Set(PAT_ONLY_ROUTES.map(routeKey));
        const problems: string[] = [];

        checkExactGuard(MCP_TOKEN_ROUTES, 'SessionOrMcpPatGuard', byKey, problems);
        checkExactGuard(PAT_ONLY_ROUTES, 'McpPatAuthGuard', byKey, problems);

        for (const route of routes) {
            const key = routeKey(route);
            if (mappedKeys.has(key) || patOnlyKeys.has(key)) continue;

            // "PAT-reachable" - either guard class grants a token access, so either one showing up
            // on an unlisted route is the same over-grant, not just SessionOrMcpPatGuard's.
            const patGuard = route.guardNames.find(
                (name) => name === 'SessionOrMcpPatGuard' || name === 'McpPatAuthGuard',
            );
            if (patGuard === undefined) continue;

            problems.push(
                `${key}: carries ${patGuard} (${route.controllerName}.${route.handlerName}) but is not on the ` +
                    'MCP_TOKEN_ROUTES or PAT_ONLY_ROUTES map in this file - an MCP token can reach a route no ' +
                    'tool needs, the exact over-grant a previous review caught on this same feature. Either ' +
                    'narrow the route back to @UseGuards(SessionAuthGuard), or add it to the appropriate ' +
                    'allowlist if a tool now genuinely needs it.',
            );
        }

        if (problems.length === 0) return;

        throw new Error(`PAT-reachable route coverage mismatch:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    });
});

/**
 * Asserts every route in `expectedRoutes` exists and carries exactly `[guardName]` - no more, no
 * fewer. Appends one message to `problems` per violation instead of throwing immediately, so a
 * single test run reports every mismatch at once rather than stopping at the first.
 */
function checkExactGuard(
    expectedRoutes: { method: string; path: string }[],
    guardName: string,
    byKey: Map<string, RouteEntry>,
    problems: string[],
): void {
    for (const expected of expectedRoutes) {
        const key = routeKey(expected);
        const route = byKey.get(key);

        if (route === undefined) {
            problems.push(`${key}: no such route exists (renamed, or removed?)`);
            continue;
        }

        // Exact equality, not "includes": a class-level guard re-added to one of the MCP-adjacent
        // controllers would show up here as a second entry, and Nest ANDs a class-level guard with
        // a method-level one rather than letting the method loosen it - see task-2-report.md's fix
        // report - so that second entry would silently re-require a session on a route apps/mcp
        // must be able to reach with a token alone.
        if (route.guardNames.length !== 1 || route.guardNames[0] !== guardName) {
            problems.push(
                `${key}: expected exactly [${guardName}], found [${route.guardNames.join(', ') || 'nothing'}] ` +
                    `on ${route.controllerName}.${route.handlerName} - check for a stray class-level ` +
                    '@UseGuards() on that controller.',
            );
        }
    }
}

/** `"METHOD /path"` - the identity a route is looked up and reported by throughout this file. */
function routeKey(route: { method: string; path: string }): string {
    return `${route.method} ${route.path}`;
}

/**
 * Walks every module Nest actually registered, and every controller in it, reading route and guard
 * metadata straight off the controller classes and their handler methods - the same metadata Nest's
 * own `GuardsContextCreator`/`RouterExplorer` read when the real app booted (see this file's class
 * doc for the source citations). A method is a route handler iff `PATH_METADATA` is defined on it
 * at all (every `@Get`/`@Post`/etc decorator defines it, even for the default `'/'` path); a plain
 * method with no HTTP decorator never has it defined, so it is skipped.
 */
function collectRoutes(modulesContainer: ModulesContainer): RouteEntry[] {
    const routes: RouteEntry[] = [];

    for (const nestModule of modulesContainer.values()) {
        for (const wrapper of nestModule.controllers.values()) {
            const controllerClass = wrapper.metatype;
            if (typeof controllerClass !== 'function') continue;
            if (Reflect.getMetadata(CONTROLLER_WATERMARK, controllerClass) !== true) continue;

            const controllerSegments = pathSegments(Reflect.getMetadata(PATH_METADATA, controllerClass));
            const classGuards = guardNamesOf(controllerClass);
            const prototype = controllerClass.prototype as Record<string, unknown>;

            for (const propertyName of Object.getOwnPropertyNames(prototype)) {
                if (propertyName === 'constructor') continue;

                const handler = prototype[propertyName];
                if (typeof handler !== 'function') continue;

                const handlerPathMeta: unknown = Reflect.getMetadata(PATH_METADATA, handler);
                if (handlerPathMeta === undefined) continue;

                const handlerSegments = pathSegments(handlerPathMeta);
                const joined = [...controllerSegments, ...handlerSegments].join('/');

                routes.push({
                    method: requestMethodName(Reflect.getMetadata(METHOD_METADATA, handler)),
                    path: joined.length > 0 ? `/${GLOBAL_PREFIX}/${joined}` : `/${GLOBAL_PREFIX}`,
                    controllerName: controllerClass.name,
                    handlerName: propertyName,
                    guardNames: [...classGuards, ...guardNamesOf(handler)],
                });
            }
        }
    }

    return routes;
}

/** Normalizes a `@Controller()`/`@Get()`-style path argument (string, string[], or absent) to non-empty segments. */
function pathSegments(pathMeta: unknown): string[] {
    const raw = Array.isArray(pathMeta) ? pathMeta : [pathMeta];

    return raw
        .filter((segment): segment is string => typeof segment === 'string')
        .map((segment) => segment.replace(/^\/+/, '').replace(/\/+$/, ''))
        .filter((segment) => segment.length > 0);
}

/** The class names of every guard `@UseGuards()` attached to `target` (a controller class or a handler function). */
function guardNamesOf(target: object): string[] {
    const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, target);
    if (!Array.isArray(guards)) return [];

    return guards
        .map((guard) => (typeof guard === 'function' ? guard.name : undefined))
        .filter((name): name is string => typeof name === 'string' && name.length > 0);
}

/** `RequestMethod`'s numeric metadata value back to its verb name; `@Get()`'s implicit default when absent. */
function requestMethodName(value: unknown): string {
    if (typeof value !== 'number') return 'GET';

    const name = (RequestMethod as unknown as Record<number, string>)[value];
    return typeof name === 'string' ? name : `UNKNOWN(${value})`;
}
