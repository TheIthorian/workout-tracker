import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light' | 'system';
type ThemeProviderState = { theme: Theme; setTheme: (theme: Theme) => void };
const ThemeProviderContext = createContext<ThemeProviderState>({ theme: 'system', setTheme: (): void => {} });

/** Persists a theme choice and follows system changes while system mode is selected. */
export function ThemeProvider({
    children,
    defaultTheme = 'system',
    storageKey = 'vite-ui-theme',
}: {
    children: React.ReactNode;
    defaultTheme?: Theme;
    storageKey?: string;
}): JSX.Element {
    const [theme, setThemeState] = useState<Theme>(() => {
        try {
            const saved = localStorage.getItem(storageKey);
            return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : defaultTheme;
        } catch {
            return defaultTheme;
        }
    });
    useEffect(() => {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const apply = (): void => {
            const dark = theme === 'dark' || (theme === 'system' && media.matches);
            document.documentElement.classList.toggle('dark', dark);
            document.documentElement.classList.toggle('light', !dark);
            document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
        };
        apply();
        media.addEventListener('change', apply);
        return () => media.removeEventListener('change', apply);
    }, [theme]);
    const setTheme = (next: Theme): void => {
        setThemeState(next);
        try {
            localStorage.setItem(storageKey, next);
        } catch {
            /* The selection still applies when browser storage is unavailable. */
        }
    };
    return <ThemeProviderContext.Provider value={{ theme, setTheme }}>{children}</ThemeProviderContext.Provider>;
}

/** Reads the current theme selection. */
export function useTheme(): ThemeProviderState {
    return useContext(ThemeProviderContext);
}
