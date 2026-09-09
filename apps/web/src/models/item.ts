/**
 * The example workspace-owned resource. Rename or replace this alongside the API's own `items`
 * slice when you build the real thing.
 */
export type Item = {
    id: string;
    name: string;
    description: string | null;
    createdAt: string;
    updatedAt: string;
};

export type SaveItemRequest = {
    name: string;
    description?: string | null;
};

export type PatchItemRequest = {
    name?: string;
    description?: string | null;
};
