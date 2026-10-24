import { defineRailway, github, postgres, preserve, project, service, volume } from 'railway/iac';

// Infrastructure as code for this project's Railway deployment. `preserve()` keeps whatever value
// Railway already holds for a variable, so no secret is ever written into this file.
//
// The web app is NOT declared here - it deploys to Cloudflare Pages from `apps/web` (see
// `docs/deployment.md`).
export default defineRailway(() => {
    const repo = github('TheIthorian/workout-tracker', { checkSuites: true });

    const region = 'europe-west4-drams3a';

    const database = postgres('Postgres', { region });
    database.deploy = {
        limitOverride: { containers: { cpu: 0.5, memoryBytes: 1_000_000_000 } },
        sleepApplication: true,
    };
    database.networking = { privateNetworkEndpoint: 'postgres' };

    const volumeAlerts = { usage: { '80': {}, '95': {}, '100': {} } };
    const postgresVolume = volume('postgres-volume', {
        alerts: volumeAlerts,
        allowOnlineResize: true,
        region,
        sizeMB: 5000,
    });

    const api = service('api', {
        source: repo,
        replicas: { [region]: 1 },
        build: {
            builder: 'DOCKERFILE',
            dockerfilePath: 'apps/api/Dockerfile',
            // `content/**` is in here because the API publishes the catalog on boot: a content
            // change has to produce a new deploy or nothing seeds it.
            watchPatterns: [
                'apps/api/**',
                'packages/**',
                'content/**',
                'pnpm-lock.yaml',
                '.railway/railway.ts',
            ],
        },
        deploy: {
            limitOverride: { containers: { cpu: 0.5, memoryBytes: 500_000_000 } },
            // Readiness, not liveness: /api/health answers before the database is reachable.
            healthcheckPath: '/api/health/ready',
            healthcheckTimeout: 300,
            restartPolicyType: 'ON_FAILURE',
            restartPolicyMaxRetries: 10,
            sleepApplication: true,
        },
        env: {
            API_BASE_URL: preserve(),
            AUTH_BASE_URL: preserve(),
            AUTH_SECRET: preserve(),
            AUTH_SECURE_COOKIES: preserve(),
            AUTH_TRUSTED_ORIGINS: preserve(),
            CATALOG_IMAGE_BASE_URL: preserve(),
            CATALOG_SEED_ON_STARTUP: preserve(),
            CORS_ORIGIN: preserve(),
            DATABASE_URL: preserve(),
            DB_MIGRATE_ON_STARTUP: preserve(),
            LLM_API_KEY: preserve(),
            MCP_BASE_URL: preserve(),
            MCP_OAUTH_VERIFIED_CLIENT_IDS: preserve(),
            PROBLEM_TYPE_BASE: preserve(),
            S3_ACCESS_KEY_ID: preserve(),
            S3_BUCKET: preserve(),
            S3_ENDPOINT: preserve(),
            S3_FORCE_PATH_STYLE: preserve(),
            S3_REGION: preserve(),
            S3_SECRET_ACCESS_KEY: preserve(),
            WEB_APP_BASE_URL: preserve(),
        },
    });

    const mcp = service('mcp', {
        source: repo,
        replicas: { [region]: 1 },
        build: {
            builder: 'DOCKERFILE',
            dockerfilePath: 'apps/mcp/Dockerfile',
            watchPatterns: ['apps/mcp/**', 'packages/**', 'pnpm-lock.yaml', '.railway/railway.ts'],
        },
        deploy: {
            limitOverride: { containers: { cpu: 0.5, memoryBytes: 500_000_000 } },
            // Liveness, deliberately. /health/ready dials `api`, and gating this deploy on another
            // service's health means a restarting or sleeping `api` takes `mcp` down with it.
            healthcheckPath: '/health',
            healthcheckTimeout: 300,
            restartPolicyType: 'ON_FAILURE',
            restartPolicyMaxRetries: 10,
            sleepApplication: true,
        },
        env: {
            API_BASE_URL: preserve(),
            API_INTERNAL_BASE_URL: preserve(),
            MCP_BASE_URL: preserve(),
            WEB_APP_BASE_URL: preserve(),
        },
    });

    return project('workout-tracker', {
        resources: [api, mcp, database, postgresVolume],
    });
});
