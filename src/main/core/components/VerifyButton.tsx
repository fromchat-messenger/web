import { useState } from "react";
import api from "@/core/api";
import { useUserStore } from "@/state/user";
import { MaterialButton } from "@/utils/material";

interface VerifyButtonProps {
    userId: number;
    verified: boolean;
    onVerificationChange?: (verified: boolean) => void;
}

export function VerifyButton({ userId, verified, onVerificationChange }: VerifyButtonProps) {
    const [isVerifying, setIsVerifying] = useState(false);
    const { user } = useUserStore();

    // Only show for owner
    if (user.currentUser?.id !== 1) {
        return null;
    }

    async function handleVerifyToggle() {
        if (!user.authToken || isVerifying) return;
        
        setIsVerifying(true);
        try {
            const result = await api.moderation.users.verify(userId, user.authToken);
            if (result) {
                onVerificationChange?.(result.verified);
            }
        } catch (error) {
            console.error('Error toggling verification:', error);
        } finally {
            setIsVerifying(false);
        }
    }

    return (
        <MaterialButton 
            variant="filled"
            loading={isVerifying}
            onClick={handleVerifyToggle}
            title={verified ? "Снять подтверждение" : "Подтвердить аккаунт"}
        >
            {verified ? "Отменить подтверждение" : "Подтвердить"}
        </MaterialButton>
    );
}