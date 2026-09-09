import { NavLink } from 'react-router-dom';
import { Boxes } from 'lucide-react';
import { UserMenu } from '@/components/layout/UserMenu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { APP_NAME } from '@/constants';
import { workspaceNavItems } from '@/lib/nav';

type AppTopNavProps = {
    workspaceId: string;
};

/** The desktop header. */
export function AppTopNav({ workspaceId }: AppTopNavProps) {
    // The height is pinned rather than left to the content because pages stick their own bars
    // directly beneath this one and need a known offset.
    return (
        <header className='sticky top-0 z-30 hidden h-[4.5rem] min-w-0 items-center justify-between gap-4 border-b border-border bg-card/80 px-4 backdrop-blur-sm md:flex lg:px-8'>
            <div className='flex min-w-0 flex-1 items-center gap-3 lg:gap-4'>
                <div className='flex min-w-0 shrink items-center gap-2'>
                    <Boxes className='h-7 w-7 shrink-0 text-primary' aria-hidden />
                    <h1 className='font-heading truncate text-xl tracking-tight text-foreground'>{APP_NAME}</h1>
                </div>
                <WorkspaceSwitcher />
            </div>
            <nav className='flex min-w-0 shrink items-center gap-1'>
                {workspaceNavItems(workspaceId).map(item => (
                    // Below lg the links are icons only, so the tooltip carries the label for
                    // sighted pointer users. It is hidden again once the label is back in the link.
                    <Tooltip key={item.to} delayDuration={200}>
                        <TooltipTrigger asChild>
                            <NavLink
                                to={item.to}
                                end={item.end}
                                // A string, not the usual isActive callback: TooltipTrigger's Slot
                                // merges className with clsx, which silently drops a function and
                                // leaves the link unstyled. NavLink sets aria-current instead.
                                className='flex shrink-0 items-center gap-2 rounded-lg p-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary lg:px-4 lg:py-2'
                            >
                                <item.icon className='h-4 w-4 shrink-0' aria-hidden />
                                <span className='hidden lg:inline'>{item.label}</span>
                                <span className='sr-only lg:hidden'>{item.label}</span>
                            </NavLink>
                        </TooltipTrigger>
                        <TooltipContent side='bottom' className='lg:hidden'>
                            {item.label}
                        </TooltipContent>
                    </Tooltip>
                ))}

                {/* Settings and logout live behind the avatar, the way GitHub does it. */}
                <UserMenu workspaceId={workspaceId} align='end' side='bottom' />
            </nav>
        </header>
    );
}
