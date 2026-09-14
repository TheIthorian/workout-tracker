import { Link, NavLink } from 'react-router-dom';
import { UserMenu } from '@/components/layout/UserMenu';
import { Brand } from '@/components/layout/Brand';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { workspaceNavItems } from '@/lib/nav';

/** Persistent navigation with a workspace switcher on every screen size. */
export function AppTopNav({ workspaceId }: { workspaceId: string }): JSX.Element {
    return (
        <header className="sticky top-0 z-30 h-[4.5rem] shrink-0 border-b bg-background/95 backdrop-blur-md">
            <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between gap-4 px-5 md:px-8">
                <Link to={`/workspaces/${workspaceId}/today`} aria-label="Forma home">
                    <Brand />
                </Link>
                <nav aria-label="Primary navigation" className="hidden h-full items-center gap-1 md:flex">
                    {workspaceNavItems(workspaceId).map((item) => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            end={item.end}
                            className="relative flex h-full items-center gap-2 px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-primary aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-3 aria-[current=page]:after:bottom-0 aria-[current=page]:after:h-0.5 aria-[current=page]:after:bg-primary lg:px-4"
                        >
                            <item.icon className="h-4 w-4" aria-hidden />
                            <span className="hidden lg:inline">{item.label}</span>
                            <span className="sr-only lg:hidden">{item.label}</span>
                        </NavLink>
                    ))}
                </nav>
                <div className="flex min-w-0 items-center gap-3">
                    <WorkspaceSwitcher />
                    <div className="hidden border-l pl-4 md:block">
                        <UserMenu workspaceId={workspaceId} />
                    </div>
                </div>
            </div>
        </header>
    );
}
