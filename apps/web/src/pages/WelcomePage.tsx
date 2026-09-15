import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { EquipmentTileGrid } from '@/components/equipment/EquipmentTileGrid';
import { FullPageSpinner } from '@/components/FullPageSpinner';
import { Brand } from '@/components/layout/Brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCreateEquipmentPreset } from '@/hooks/use-equipment-presets';
import { toast } from '@/hooks/use-toast';
import { writeActiveEquipmentPresetId } from '@/lib/active-equipment-preset';
import { onboardingApi } from '@/lib/api';
import { OnboardingStage, type Equipment } from '@/models/equipment';

/** First-run equipment setup, presented before the main application shell. */
export default function WelcomePage(): JSX.Element {
    const { refreshUser } = useAuth();
    const { currentWorkspace, workspaceId, isLoading } = useWorkspace();
    const navigate = useNavigate();
    const createPreset = useCreateEquipmentPreset({ workspaceId });
    const [name, setName] = useState('My gym');
    const [equipment, setEquipment] = useState<Equipment[]>([]);
    const [isSkipping, setSkipping] = useState(false);

    if (isLoading) return <FullPageSpinner />;
    if (!currentWorkspace) return <Navigate to="/" replace />;
    if (currentWorkspace.onboardingStage !== OnboardingStage.Equipment) return <Navigate to="/" replace />;

    const complete = async (): Promise<void> => {
        await onboardingApi.setStage({ workspaceId, stage: OnboardingStage.Complete });
        await refreshUser();
        navigate('/', { replace: true });
    };

    const handleContinue = (event: React.FormEvent): void => {
        event.preventDefault();
        const trimmed = name.trim();

        if (!trimmed || createPreset.isPending) return;

        createPreset.mutate(
            { name: trimmed, equipment },
            {
                onSuccess: (preset) => {
                    writeActiveEquipmentPresetId(preset.id);
                    void complete().catch(() =>
                        toast({ title: 'Saved your equipment, but couldn’t finish setup. Try again.' }),
                    );
                },
                onError: () => toast({ title: 'Couldn’t save your equipment. Try again.' }),
            },
        );
    };

    const handleSkip = (): void => {
        setSkipping(true);
        void complete()
            .catch(() => toast({ title: 'Couldn’t finish setup. Try again.' }))
            .finally(() => setSkipping(false));
    };

    const busy = createPreset.isPending || isSkipping;

    return (
        <div className="min-h-screen bg-background">
            <form
                onSubmit={handleContinue}
                className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-4 py-8 md:px-8"
            >
                <Brand />
                <div className="mt-8">
                    <p className="eyebrow mb-3">Welcome</p>
                    <h1 className="page-title">What do you train with?</h1>
                    <p className="mt-2 text-muted-foreground">
                        Tap everything you have. We’ll hide exercises that need gear you don’t. You can add more setups
                        later, like a home and a gym.
                    </p>
                </div>
                <div className="mt-8 space-y-2">
                    <Label htmlFor="preset-name">Call this setup</Label>
                    <Input
                        id="preset-name"
                        value={name}
                        maxLength={60}
                        onChange={(event) => setName(event.target.value)}
                        className="h-12"
                    />
                </div>
                <div className="mt-6">
                    <EquipmentTileGrid
                        value={equipment}
                        onChange={setEquipment}
                        disabled={busy}
                        aria-label="Equipment you have"
                    />
                    <p className="mt-3 text-xs text-muted-foreground">Nothing selected means bodyweight only.</p>
                </div>
                <div className="mt-auto flex flex-col gap-3 pt-8">
                    <Button type="submit" size="lg" className="h-12 gap-2" disabled={!name.trim() || busy}>
                        {createPreset.isPending ? 'Saving…' : 'Continue'}
                        <ArrowRight aria-hidden />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        className="text-muted-foreground"
                        disabled={busy}
                        onClick={handleSkip}
                    >
                        Skip for now
                    </Button>
                </div>
            </form>
        </div>
    );
}
