import { parseApiTimestamp } from "@/utils/utils";

const DELETED_USERNAME_PREFIX = "#deleted";

export function isDeletedUser(user: { deleted?: boolean }): boolean {
    return Boolean(user.deleted);
}

export function isSuspendedUser(user: { suspended?: boolean; deleted?: boolean }): boolean {
    return Boolean(user.suspended) && !user.deleted;
}

export function isDeletedAccountUsername(username: string | undefined | null): boolean {
    return Boolean(username?.startsWith(DELETED_USERNAME_PREFIX));
}

export function isDeletedPeer(user: {
    id?: number;
    deleted?: boolean;
    username?: string | null;
}): boolean {
    return isDeletedUser(user) || isDeletedAccountUsername(user.username);
}

export const DELETED_ACCOUNT_LABEL = "Deleted account";

export function deletedUserLabel(): string {
    return DELETED_ACCOUNT_LABEL;
}

export function displayNameForUser(user: {
    id?: number;
    display_name?: string | null;
    username?: string | null;
    deleted?: boolean;
}): string {
    if (isDeletedPeer(user)) {
        return deletedUserLabel();
    }
    return user.display_name?.trim() || user.username?.trim() || "";
}

export function isEpochLastSeen(lastSeen: string | undefined | null): boolean {
    if (!lastSeen) return false;
    const time = parseApiTimestamp(lastSeen).getTime();
    return !Number.isNaN(time) && time <= 0;
}

export function formatDeletedUserLastSeen(): string {
    return "был(а) давно";
}
