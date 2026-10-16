import { useState } from "react";
import { API_BASE_URL } from "@/core/config";
import { DownloadDialog } from "@/pages/home/DownloadDialog";
import { detectOs, type DownloadOs } from "@/pages/home/os";

export function useAppDownload() {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogOs, setDialogOs] = useState<DownloadOs>(() => detectOs());

    const triggerDownload = (os: DownloadOs): boolean => {
        if (typeof document === "undefined") {
            return false;
        }

        setDialogOs(os);
        setDialogOpen(true);

        const link = document.createElement("a");
        link.href = `${API_BASE_URL}/download/${os}`;
        link.download = "";
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return true;
    };

    return {
        dialogOpen,
        setDialogOpen,
        dialogOs,
        triggerDownload,
        detectedOs: detectOs(),
    };
}

export function DownloadDialogHost({
    dialogOpen,
    setDialogOpen,
    dialogOs,
}: {
    dialogOpen: boolean;
    setDialogOpen: (open: boolean) => void;
    dialogOs: DownloadOs;
}) {
    return <DownloadDialog open={dialogOpen} onOpenChange={setDialogOpen} os={dialogOs} />;
}
