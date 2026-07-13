import { MaterialIcon } from "@/utils/material";

export type VerificationStatus = "verified" | "warning" | "blocked" | "none";

interface StatusBadgeProps {
    verificationStatus?: VerificationStatus | null;
    /** @deprecated Use verificationStatus instead */
    verified?: boolean;
    size?: "small" | "medium" | "large";
}

function resolveVerificationStatus(
    verificationStatus?: VerificationStatus | null,
    verified?: boolean,
): VerificationStatus {
    if (verificationStatus) {
        return verificationStatus;
    }
    if (verified) {
        return "verified";
    }
    return "none";
}

export function StatusBadge({ verificationStatus, verified, size = "small" }: StatusBadgeProps) {
    const status = resolveVerificationStatus(verificationStatus, verified);
    const className = `status-badge ${size}`;

    if (status === "verified") {
        return (
            <span className={`${className} verified`} title="Подтверждённый аккаунт">
                <MaterialIcon name="verified--filled" />
            </span>
        );
    }

    if (status === "warning") {
        return (
            <span className={`${className} warning`} title="Похож на подтверждённый аккаунт">
                <MaterialIcon name="warning--filled" />
            </span>
        );
    }

    if (status === "blocked") {
        return (
            <span className={`${className} blocked`} title="Аккаунт заблокирован">
                <MaterialIcon name="block--filled" />
            </span>
        );
    }

    return null;
}
