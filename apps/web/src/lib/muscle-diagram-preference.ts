const STORAGE_KEY = 'show-muscle-diagram';

/** Whether this device shows the body diagram on an exercise page. Off until the reader asks for it. */
export function readShowMuscleDiagram(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

/** Remembers the choice, so the diagram stays as the reader left it between exercises. */
export function writeShowMuscleDiagram(show: boolean): void {
    try {
        localStorage.setItem(STORAGE_KEY, String(show));
    } catch {
        // A device that cannot remember the choice can still toggle it for this visit.
    }
}
