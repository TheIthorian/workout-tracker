import { customType } from 'drizzle-orm/pg-core';

/**
 * A `timestamp with time zone` column that always reads back as ISO 8601.
 *
 * Postgres renders `timestamptz` in its own format (`2026-09-19 23:50:21.6+00`), and Drizzle's
 * string-mode columns hand that to callers verbatim. Browsers are only required to parse ISO 8601,
 * so that value falls to engine-specific behaviour and becomes `Invalid Date` on stricter ones.
 * Converting here also pins the format, which otherwise follows whatever `TimeZone` the server
 * session carries.
 *
 * Better Auth's naive `timestamp` columns deliberately stay on the plain Drizzle type - see the
 * Auth section of CLAUDE.md.
 */
export const timestamptz = customType<{ data: string; driverData: string }>({
    dataType: () => 'timestamp with time zone',

    fromDriver: (value: string): string => {
        const parsed = new Date(value);

        // `infinity`/`-infinity` have no ISO rendering, so they pass through untouched.
        return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : value;
    },
});
