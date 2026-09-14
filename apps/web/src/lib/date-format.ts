import { z } from 'zod';

export enum DateFormat {
    MonthFirst = 'mdy',
    DayFirst = 'dmy',
    YearFirst = 'ymd',
}
const preferencesSchema = z.object({ dateFormat: z.enum(DateFormat) });

/** Reads a validated preference, falling back to the browser’s regional ordering. */
export function readDateFormat(): DateFormat {
    try {
        const parsed = preferencesSchema.safeParse(JSON.parse(localStorage.getItem('userPreferences') ?? 'null'));
        if (parsed.success) return parsed.data.dateFormat;
    } catch {
        /* Invalid or unavailable storage uses the regional default. */
    }
    const first = new Intl.DateTimeFormat()
        .formatToParts(new Date())
        .find((part) => ['day', 'month', 'year'].includes(part.type));
    return first?.type === 'month'
        ? DateFormat.MonthFirst
        : first?.type === 'year'
          ? DateFormat.YearFirst
          : DateFormat.DayFirst;
}

/** Formats workout and connection dates using the saved display preference. */
export function formatDate(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Date unavailable';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const preference = readDateFormat();
    return preference === DateFormat.YearFirst
        ? `${year}-${month}-${day}`
        : preference === DateFormat.DayFirst
          ? `${day}/${month}/${year}`
          : `${month}/${day}/${year}`;
}
