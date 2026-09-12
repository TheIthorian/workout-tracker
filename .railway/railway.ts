import { bucket, defineRailway, github, postgres, preserve, project, redis, service, volume } from 'railway/iac';

// Infrastructure as code for this project's Railway deployment. Rename the repo, project and
// service names below for your own app; `preserve()` keeps whatever value Railway already holds for
// a variable, so no secret is ever written into this file.
//
// The web app is NOT declared here - it deploys to Cloudflare Pages from `apps/web` (see
// `docs/deployment.md`).
export default defineRailway(() => {
    const repo = github('your-org/your-repo', { checkSuites: true });

    const region = 'europe-west4-drams3a';

    const database = postgres('Postgres', { region });
    database.deploy = {
        limitOverride: { containers: { cpu: 0.5, memoryBytes: 1_000_000_000 } },
        sleepApplication: true,
    };
    database.networking = { privateNetworkEndpoint: 'postgres' };

    const cache = redis('Redis', { region });
    cache.deploy = {
        limitOverride: { containers: { cpu: 0.5, memoryBytes: 1_000_000_000 } },
        sleepApplication: true,
        // Redis refuses to start if the volume mount has a lost+found directory.
        startCommand:
            '/bin/sh -c "rm -rf $RAILWAY_VOLUME_MOUNT_PATH/lost+found/ && exec docker-entrypoint.sh redis-server --requirepass $REDIS_PASSWORD --save 60 1 --dir $RAILWAY_VOLUME_MOUNT_PATH"',
    };
    cache.networking = { privateNetworkEndpoint: 'redis' };

    const volumeAlerts = { usage: { '80': {}, '95': {}, '100': {} } };
    const redisVolume = volume('redis-volume', {
        alerts: volumeAlerts,
        allowOnlineResize: true,
        region,
        sizeMB: 5000,
    });
    const postgresVolume = volume('postgres-volume', {
        alerts: volumeAlerts,
        allowOnlineResize: true,
        region,
        sizeMB: 5000,
    });

    // Only needed if your app stores files. Delete it, and the S3_* variables below, if not.
    const fileBucket = bucket('app-bucket', { region: 'ams' });

    const api = service('api', {
        source: repo,
        replicas: { [region]: 1 },
        build: {
            builder: 'DOCKERFILE',
            dockerfilePath: 'apps/api/Dockerfile',
            watchPatterns: ['apps/api/**', 'packages/**', 'pnpm-lock.yaml', '.railway/railway.ts'],
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
            CORS_ORIGIN: preserve(),
            DATABASE_URL: preserve(),
            LLM_API_KEY: preserve(),
            MCP_BASE_URL: preserve(),
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

    return project('node-app-base', {
        resources: [api, mcp, database, cache, redisVolume, postgresVolume, fileBucket],
    });
});
