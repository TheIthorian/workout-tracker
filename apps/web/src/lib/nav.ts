import { Dumbbell, History, ListChecks, PlayCircle, type LucideIcon } from 'lucide-react';

/** One destination in the workspace navigation, shared by the desktop header and mobile tab bar. */
export type NavItem = {
    to: string;
    icon: LucideIcon;
    label: string;
    end: boolean;
};

/**
 * The workspace destinations shown in both the desktop header and the mobile tab bar.
 *
 * Settings is deliberately not one of them: it lives in the account menu behind the avatar, so the
 * bar stays about the workspace's content rather than the account.
 */
export function workspaceNavItems(workspaceId: string): NavItem[] {
    return [
        { to: `/workspaces/${workspaceId}/today`, icon: PlayCircle, label: 'Today', end: true },
        { to: `/workspaces/${workspaceId}/routines`, icon: ListChecks, label: 'Routines', end: false },
        { to: `/workspaces/${workspaceId}/exercises`, icon: Dumbbell, label: 'Exercises', end: false },
        { to: `/workspaces/${workspaceId}/history`, icon: History, label: 'History', end: false },
    ];
}
