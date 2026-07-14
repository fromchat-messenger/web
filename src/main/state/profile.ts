import { create } from "zustand";
import type { ProfileDialogData } from "./types";

interface ProfileStore {
    profileDialog: ProfileDialogData | null;
    setProfileDialog: (data: ProfileDialogData | null) => void;
    closeProfileDialog: () => void;
}

export const useProfileStore = create<ProfileStore>((set) => ({
    profileDialog: null,
    setProfileDialog: (data: ProfileDialogData | null) => set({ profileDialog: data }),
    closeProfileDialog: () => set({ profileDialog: null })
}));
