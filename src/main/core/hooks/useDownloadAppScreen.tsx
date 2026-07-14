import { Navigate } from "react-router-dom";
import { MINIMUM_WIDTH } from "@/core/config";
import useWindowSize from "./useWindowSize";

export default function useDownloadAppScreen() {
    const { width } = useWindowSize();
    const isMobile = width < MINIMUM_WIDTH;

    return {
        isMobile,
        navigate: isMobile ? <Navigate to="/download-app" replace /> : null
    };
}