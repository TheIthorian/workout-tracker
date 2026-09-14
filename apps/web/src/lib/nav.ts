import { Dumbbell, Settings, History, ListChecks, PlayCircle, type LucideIcon } from 'lucide-react';

/** One destination in the app navigation, shared by the desktop header and mobile tab bar. */
export type NavItem = {
    to: string;
    icon: LucideIcon;
    label: string;
    end: boolean;
};

/** Primary destinations shared by desktop and mobile navigation. */
export function appNavItems(): NavItem[] {
    return [
        { to: '/today', icon: PlayCircle, label: 'Today', end: true },
        { to: '/routines', icon: ListChecks, label: 'Routines', end: false },
        { to: '/exercises', icon: Dumbbell, label: 'Exercises', end: false },
        { to: '/history', icon: History, label: 'History', end: false },
        { to: '/settings', icon: Settings, label: 'Settings', end: false },
    ];
}
