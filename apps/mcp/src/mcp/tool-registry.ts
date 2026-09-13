import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

/** The four behaviour hints `tools/list` advertises, as the MCP SDK names them. */
export type ToolBehaviorHints = Required<
    Pick<ToolAnnotations, 'readOnlyHint' | 'destructiveHint' | 'idempotentHint' | 'openWorldHint'>
>;

/**
 * Wire name for a tool, derived from the PascalCase name it is declared under. Deriving rather than
 * restating means the name a client sees and the behaviour hints below cannot drift apart - both
 * are keyed off the same single string at the tool's definition site.
 */
export function buildToolName(methodName: string): string {
    return toSnakeCase(methodName);
}

/**
 * An underscore is inserted before an upper-case letter only when the previous character is
 * lower-case or the next one is, which keeps an acronym run together (`HTML` -> `html`) while still
 * splitting the word that follows it. Non-letters pass through untouched.
 */
export function toSnakeCase(value: string): string {
    if (value.trim().length === 0) return value;

    let result = '';

    for (let i = 0; i < value.length; i++) {
        const current = value[i];

        if (!isUpperCase(current)) {
            result += current;
            continue;
        }

        if (i > 0 && shouldInsertUnderscore({ value, index: i })) result += '_';

        result += current.toLowerCase();
    }

    return result;
}

/**
 * The behaviour hints a client uses to decide whether it may call a tool without asking, retry it,
 * or must confirm first.
 *
 * The unmatched arm is deliberately the pessimistic one - a tool added later without an entry here
 * is advertised as destructive and open-world until someone says otherwise, rather than quietly
 * inheriting every hint as `false`.
 */
export function toolBehaviorHints(methodName: string): ToolBehaviorHints {
    return BEHAVIOR_HINTS[methodName] ?? DEFAULT_BEHAVIOR_HINTS;
}

const READ: ToolBehaviorHints = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
};

const CREATE: ToolBehaviorHints = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
};

const MUTATE: ToolBehaviorHints = {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
};

const DEFAULT_BEHAVIOR_HINTS: ToolBehaviorHints = {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
};

const BEHAVIOR_HINTS: Record<string, ToolBehaviorHints> = {
    GetCurrentUser: READ,
    ListWorkspaces: READ,
    ListItems: READ,
    GetItem: READ,
    CreateItem: CREATE,
    UpdateItem: MUTATE,
    DeleteItem: MUTATE,
    ListExercises: READ,
    GetExercise: READ,
    CreateExercise: CREATE,
    UpdateExercise: MUTATE,
    AddExerciseLink: CREATE,
    ListRoutines: READ,
    GetRoutine: READ,
    CreateRoutine: CREATE,
    UpdateRoutine: MUTATE,
};

function shouldInsertUnderscore({ value, index }: { value: string; index: number }): boolean {
    const previous = value[index - 1];
    const next = index + 1 < value.length ? value[index + 1] : undefined;

    return isLowerCase(previous) || (next !== undefined && isLowerCase(next));
}

function isUpperCase(character: string): boolean {
    return character !== character.toLowerCase() && character === character.toUpperCase();
}

function isLowerCase(character: string): boolean {
    return character !== character.toUpperCase() && character === character.toLowerCase();
}
