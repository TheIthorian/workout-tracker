import { NavLink } from 'react-router-dom';
import { workspaceNavItems } from '@/lib/nav';

/** Thumb-reachable primary destinations, with the device safe area reserved below. */
export function AppBottomNav({ workspaceId }: { workspaceId: string }): JSX.Element {
    return (
        <nav
            aria-label="Mobile navigation"
            className="safe-area-pb fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur-md md:hidden"
        >
            <div className="grid grid-cols-5 px-2 py-2">
                {workspaceNavItems(workspaceId).map((item) => (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-muted-foreground aria-[current=page]:bg-secondary aria-[current=page]:text-primary"
                    >
                        <item.icon className="h-5 w-5" aria-hidden />
                        <span className="text-[10px] font-medium">{item.label}</span>
                    </NavLink>
                ))}
            </div>
        </nav>
    );
}
