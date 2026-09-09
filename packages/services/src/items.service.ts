import { schema, scopedToWorkspace, type Db } from '@app/db';
import { EntityNotFoundError } from '@app/errors';
import { count, desc, eq } from 'drizzle-orm';
import type { WorkspaceMembershipService } from './workspace-membership.service.js';

const { items } = schema;

export type ItemResponse = {
    id: string;
    name: string;
    description: string | null;
    createdAt: string;
    updatedAt: string;
};

export type PaginatedItems = {
    data: ItemResponse[];
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
};

/**
 * Example CRUD service for a workspace-owned resource. It exists to show the shape every service
 * in this repo follows — a plain class, dependencies through one object argument, typed errors
 * from `@app/errors`, and the two-part tenancy discipline below — and is meant to be replaced by
 * the real thing.
 *
 * Every method does both halves of that discipline: `membership.require` proves the caller may see
 * the workspace at all, and `scopedToWorkspace` puts the tenant filter on the query. Neither is
 * sufficient alone.
 */
export class ItemsService {
    private readonly db: Db;
    private readonly membership: WorkspaceMembershipService;

    constructor({ db, membership }: { db: Db; membership: WorkspaceMembershipService }) {
        this.db = db;
        this.membership = membership;
    }

    /**
     * A page of the workspace's items, newest first.
     *
     * @throws EntityNotFoundError when the caller is not a member of the workspace.
     */
    async list({
        userId,
        workspaceId,
        page,
        pageSize,
    }: {
        userId: string;
        workspaceId: string;
        page: number;
        pageSize: number;
    }): Promise<PaginatedItems> {
        await this.membership.require({ userId, workspaceId });

        const where = scopedToWorkspace(items, workspaceId);

        const [data, [totals]] = await Promise.all([
            this.db
                .select(ITEM_COLUMNS)
                .from(items)
                .where(where)
                .orderBy(desc(items.createdAt))
                .limit(pageSize)
                .offset((page - 1) * pageSize),
            this.db.select({ totalCount: count() }).from(items).where(where),
        ]);

        const totalCount = totals?.totalCount ?? 0;

        return { data, page, pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize) };
    }

    /**
     * One item from the workspace.
     *
     * @throws EntityNotFoundError when the caller is not a member, or the item is not in this
     * workspace — the two are deliberately indistinguishable on the wire.
     */
    async get({
        userId,
        workspaceId,
        itemId,
    }: {
        userId: string;
        workspaceId: string;
        itemId: string;
    }): Promise<ItemResponse> {
        await this.membership.require({ userId, workspaceId });

        const [row] = await this.db
            .select(ITEM_COLUMNS)
            .from(items)
            .where(scopedToWorkspace(items, workspaceId, eq(items.id, itemId)));

        if (!row) throw new EntityNotFoundError('Item not found');

        return row;
    }

    /**
     * Creates an item in the workspace.
     *
     * @throws EntityNotFoundError when the caller is not a member of the workspace.
     */
    async create({
        userId,
        workspaceId,
        name,
        description,
    }: {
        userId: string;
        workspaceId: string;
        name: string;
        description?: string | null;
    }): Promise<ItemResponse> {
        await this.membership.require({ userId, workspaceId });

        const [row] = await this.db
            .insert(items)
            .values({ workspaceId, createdByUserId: userId, name, description: description ?? null })
            .returning(ITEM_COLUMNS);

        return row;
    }

    /**
     * Updates an item. Only the fields present are written.
     *
     * @throws EntityNotFoundError when the caller is not a member, or the item is not in this
     * workspace.
     */
    async update({
        userId,
        workspaceId,
        itemId,
        name,
        description,
    }: {
        userId: string;
        workspaceId: string;
        itemId: string;
        name?: string;
        description?: string | null;
    }): Promise<ItemResponse> {
        await this.membership.require({ userId, workspaceId });

        const [row] = await this.db
            .update(items)
            .set({
                ...(name === undefined ? {} : { name }),
                ...(description === undefined ? {} : { description }),
                updatedAt: new Date().toISOString(),
            })
            .where(scopedToWorkspace(items, workspaceId, eq(items.id, itemId)))
            .returning(ITEM_COLUMNS);

        if (!row) throw new EntityNotFoundError('Item not found');

        return row;
    }

    /**
     * Deletes an item.
     *
     * @throws EntityNotFoundError when the caller is not a member, or the item is not in this
     * workspace.
     */
    async remove({
        userId,
        workspaceId,
        itemId,
    }: {
        userId: string;
        workspaceId: string;
        itemId: string;
    }): Promise<void> {
        await this.membership.require({ userId, workspaceId });

        const deleted = await this.db
            .delete(items)
            .where(scopedToWorkspace(items, workspaceId, eq(items.id, itemId)))
            .returning({ id: items.id });

        if (deleted.length === 0) throw new EntityNotFoundError('Item not found');
    }
}

const ITEM_COLUMNS = {
    id: items.id,
    name: items.name,
    description: items.description,
    createdAt: items.createdAt,
    updatedAt: items.updatedAt,
};
