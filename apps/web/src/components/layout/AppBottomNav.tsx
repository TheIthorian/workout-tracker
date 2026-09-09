import { NavLink } from 'react-router-dom';
import { UserMenu } from '@/components/layout/UserMenu';
import { workspaceNavItems } from '@/lib/nav';

type AppBottomNavProps = {
    workspaceId: string;
};

/** The mobile tab bar. */
export function AppBottomNav({ workspaceId }: AppBottomNavProps) {
    return (
        <nav className='safe-area-pb fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 backdrop-blur-md md:hidden'>
            <div className='flex items-center justify-around overflow-x-auto py-2'>
                {workspaceNavItems(workspaceId).map(item => (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        className={({ isActive }) =>
                            `flex min-w-[3.25rem] shrink-0 flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 transition-colors ${
                                isActive ? 'text-primary' : 'text-muted-foreground'
                            }`
                        }
                    >
                        <item.icon className='h-5 w-5' />
                        <span className='max-w-[4.5rem] truncate text-center text-[10px] font-medium'>
                            {item.label}
                        </span>
                    </NavLink>
                ))}

                {/* Settings and logout sit behind the avatar here too, opening upwards. */}
                <div className='flex min-w-[3.25rem] shrink-0 items-center justify-center px-2 py-1.5'>
                    <UserMenu workspaceId={workspaceId} align='end' side='top' />
                </div>
            </div>
        </nav>
    );
}
