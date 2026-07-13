import { MaterialIcon } from "@/utils/material";
import { avatarGradientFromUserId } from "@/core/avatarGradient";
import styles from "@/pages/chat/css/deleted-user-avatar.module.scss";

interface DeletedUserAvatarProps {
    userId: number;
    className?: string;
    iconClassName?: string;
}

export function DeletedUserAvatar({ userId, className, iconClassName }: DeletedUserAvatarProps) {
    return (
        <div
            className={className ?? styles.deletedUserAvatar}
            style={{ background: avatarGradientFromUserId(userId) }}
        >
            <MaterialIcon
                name="account_circle_off--outlined"
                className={iconClassName ?? styles.deletedUserAvatarIcon}
            />
        </div>
    );
}
