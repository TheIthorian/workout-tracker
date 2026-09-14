import { Dumbbell, Settings, History, ListChecks, PlayCircle, type LucideIcon } from 'lucide-react';

/** One destination in the workspace navigation, shared by the desktop header and mobile tab bar. */
export type NavItem = {
    to: string;
    icon: LucideIcon;
    label: string;
    end: boolean;
};

/** Primary destinations shared by desktop and mobile navigation. */
export function workspaceNavItems(workspaceId: string): NavItem[] {
    return [
        { to: `/workspaces/${workspaceId}/today`, icon: PlayCircle, label: 'Today', end: true },
        { to: `/workspaces/${workspaceId}/routines`, icon: ListChecks, label: 'Routines', end: false },
        { to: `/workspaces/${workspaceId}/exercises`, icon: Dumbbell, label: 'Exercises', end: false },
        { to: `/workspaces/${workspaceId}/history`, icon: History, label: 'History', end: false },
        { to: `/workspaces/${workspaceId}/settings`, icon: Settings, label: 'Settings', end: false },
    ];
}
