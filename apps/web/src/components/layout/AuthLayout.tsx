import type { ReactNode } from 'react';
import { ArrowUpRight, Check } from 'lucide-react';
import { Brand } from '@/components/layout/Brand';

/** A calm, shared welcome for signing in and creating an account. */
export function AuthLayout({ children }: { children: ReactNode }): JSX.Element {
    return (
        <div className="auth-shell">
            <aside className="auth-story">
                <Brand />
                <div className="training-rings right-[-140px] top-[27%] h-[500px] w-[500px]" aria-hidden />
                <div className="relative max-w-md py-20">
                    <p className="mb-6 text-xs font-medium uppercase tracking-[.2em] text-[#c8dfac]">
                        A little stronger, every day
                    </p>
                    <h1 className="text-6xl font-medium leading-[1.08] tracking-[-.05em]">
                        Your space.
                        <br />
                        Your pace.
                        <br />
                        <span className="text-[#c8dfac]">Your progress.</span>
                    </h1>
                    <p className="mt-7 max-w-xs text-base leading-relaxed text-[#d0dfd5]">
                        Less time on your phone.
                        <br />
                        More focus on your next rep.
                    </p>
                    <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-xs text-[#d0dfd5]">
                        <span className="flex items-center gap-2">
                            <Check className="h-4 w-4" />
                            Simple tracking
                        </span>
                        <span className="flex items-center gap-2">
                            <Check className="h-4 w-4" />
                            Space to grow
                        </span>
                    </div>
                </div>
                <p className="flex items-center gap-2 text-xs text-[#d0dfd5]">
                    Built for the way you train.
                    <ArrowUpRight className="h-4 w-4" />
                </p>
            </aside>
            <main className="auth-form">
                <div className="w-full max-w-sm">
                    <div className="mb-10 lg:hidden">
                        <Brand />
                    </div>
                    {children}
                    <p className="mt-8 text-center text-xs text-muted-foreground">One workout at a time.</p>
                </div>
            </main>
        </div>
    );
}
