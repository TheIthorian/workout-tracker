import { useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTheme } from '@/components/theme-provider';
import { toast } from '@/hooks/use-toast';
import { DateFormat, readDateFormat } from '@/lib/date-format';

/** Immediate theme and date choices, remembered on this device. */
export function PreferencesSettings(): JSX.Element {
    const { theme, setTheme } = useTheme();
    const [dateFormat, setDateFormat] = useState(readDateFormat);
    const themes = [
        { value: 'light', label: 'Light', icon: Sun },
        { value: 'dark', label: 'Dark', icon: Moon },
        { value: 'system', label: 'System', icon: Monitor },
    ] as const;
    return (
        <Card className="shadow-none">
            <CardHeader>
                <CardTitle className="text-xl">Make yourself comfortable</CardTitle>
                <CardDescription>Your preferences are remembered on this device.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
                <fieldset>
                    <legend className="mb-3 text-sm font-medium">Appearance</legend>
                    <div className="grid grid-cols-3 gap-3">
                        {themes.map(({ value, label, icon: Icon }) => (
                            <label
                                key={value}
                                className={`relative cursor-pointer rounded-xl border p-3 text-center ${theme === value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-secondary'}`}
                            >
                                <input
                                    type="radio"
                                    name="theme"
                                    checked={theme === value}
                                    onChange={() => {
                                        setTheme(value);
                                        toast({ title: `${label} theme selected` });
                                    }}
                                    className="peer sr-only"
                                />
                                <span
                                    className={`mb-3 flex h-16 items-center justify-center rounded-lg border peer-focus-visible:ring-2 peer-focus-visible:ring-ring ${value === 'dark' ? 'bg-[#1c2923] text-[#d8e6cb]' : value === 'light' ? 'bg-[#f8f7f2] text-[#345741]' : 'bg-secondary text-foreground'}`}
                                >
                                    <Icon className="h-6 w-6" aria-hidden />
                                </span>
                                <span className="text-sm font-medium">{label}</span>
                            </label>
                        ))}
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                        System follows your device’s light or dark setting.
                    </p>
                </fieldset>
                <div className="space-y-3 border-t pt-6">
                    <Label htmlFor="date-format">Date format</Label>
                    <Select
                        value={dateFormat}
                        onValueChange={(value) => {
                            const next = Object.values(DateFormat).find((item) => item === value);
                            if (!next) return;
                            try {
                                localStorage.setItem('userPreferences', JSON.stringify({ dateFormat: next }));
                                setDateFormat(next);
                                toast({ title: 'Date format saved' });
                            } catch {
                                toast({ title: 'Could not save your preference', variant: 'destructive' });
                            }
                        }}
                    >
                        <SelectTrigger id="date-format" className="max-w-sm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={DateFormat.DayFirst}>DD/MM/YYYY · 24/01/2026</SelectItem>
                            <SelectItem value={DateFormat.MonthFirst}>MM/DD/YYYY · 01/24/2026</SelectItem>
                            <SelectItem value={DateFormat.YearFirst}>YYYY-MM-DD · 2026-01-24</SelectItem>
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        Used for dates in your workout history and connections.
                    </p>
                </div>
            </CardContent>
        </Card>
    );
}
