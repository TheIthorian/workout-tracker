import { itemApiPath, itemWebPath } from '@app/api-contract';
import type { ResourceUrlGenerator, WithResourceUrls } from '@app/nest-common';

/**
 * Attaches an item's two links to a tool result, from the same path definitions `apps/api` uses -
 * which is what makes an item reached through a tool carry the identical urls to one reached over
 * REST. `ResourceUrlGenerator` itself is resource-agnostic and knows nothing about items.
 */
export function attachItemLinks<T extends { id: string }>({
    urls,
    item,
    workspaceId,
}: {
    urls: ResourceUrlGenerator;
    item: T;
    workspaceId: string;
}): WithResourceUrls<T> {
    return urls.attach({
        resource: item,
        webPath: itemWebPath({ workspaceId, itemId: item.id }),
        apiPath: itemApiPath({ workspaceId, itemId: item.id }),
    });
}
