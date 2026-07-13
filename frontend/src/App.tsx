import { BrowserRouter, Routes, Route, useNavigate, useLocation, matchRoutes, Navigate, type RouteObject } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ElectronTitleBar } from "./Electron";
import { useUserStore } from "./state/user";
import { lazy, useEffect, useRef, useState } from "react";
import { parseProfileLink } from "./core/profileLinks";
import NotFoundPage from "./pages/not-found/NotFoundPage";
import ProtectedRoute from "./pages/ProtectedRoute";
import DownloadAppPage from "./pages/download-app/DownloadAppPage";
import { SuspensionDialog } from "./pages/chat/ui/SuspensionDialog";
import { AlertDialogProvider } from "./core/components/AlertDialog";
import { delay } from "./utils/utils";

// Lazy load route components
const HomePage = lazy(() => import("./pages/home/HomePage"));
const AuthPage = lazy(() => import("./pages/auth/AuthPage"));
const ChatPage = lazy(() => import("./pages/chat/ui/ChatPage"));
const PrivacyPage = lazy(() => import("./pages/legal/LegalPages").then(m => ({ default: m.PrivacyPage })));
const TermsPage = lazy(() => import("./pages/legal/LegalPages").then(m => ({ default: m.TermsPage })));

const routeConfig: RouteObject[] = [
    { path: "/", element: <HomePage /> },
    { path: "/auth", element: <AuthPage /> },
    { path: "/login", element: <Navigate to="/auth?mode=login" replace /> },
    { path: "/register", element: <Navigate to="/auth?mode=register" replace /> },
    { path: "/download-app", element: <DownloadAppPage /> },
    { path: "/privacy", element: <PrivacyPage /> },
    { path: "/terms", element: <TermsPage /> },
    {
        path: "/chat",
        element: (
            <ProtectedRoute>
                <ChatPage />
            </ProtectedRoute>
        )
    },
    { path: "*", element: <SmartCatchAll /> }
];

function SmartCatchAll() {
    const navigate = useNavigate();
    const [showNotFound, setShowNotFound] = useState(false);

    function isValidRoute(path: string): boolean {
        const validRoutes = routeConfig.filter(route => route.path !== "*");
        const matches = matchRoutes(validRoutes, path);
        
        return Boolean(matches && matches.length > 0);
    }

    useEffect(() => {
        if (isValidRoute(location.pathname)) {
            setShowNotFound(false);
            return;
        }
        
        const profileInfo = parseProfileLink(); // No URL specified intentionally to let it use the current URL
        
        if (profileInfo) {
            setShowNotFound(false);
            navigate("/chat", { 
                replace: true,
                state: { profileInfo }
            });
        } else {
            setShowNotFound(true);
        }
    }, [navigate]);

    // Show 404 page
    if (showNotFound) {
        return <NotFoundPage />;
    }
}

function AnimatedRoutes() {
    const location = useLocation();
    const prevPathnameRef = useRef(location.pathname);

    return (
        <AnimatePresence mode="sync" initial={false}>
            <motion.div
                key={location.pathname}
                onAnimationStart={() => {
                    if (prevPathnameRef.current !== location.pathname) {
                        prevPathnameRef.current = location.pathname;
                        document.body.style.overflow = "hidden";
                    }
                }}
                onAnimationComplete={async () => {
                    await delay(500);
                    document.body.style.overflow = "";
                }}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 1, scale: 1.1 }}
                transition={{ 
                    type: "spring",
                    stiffness: 300,
                    damping: 30,
                    mass: 0.8
                }}
                style={{ 
                    transformOrigin: "center center",
                    width: "100%",
                    height: "100%",
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0
                }}
            >
                <Routes location={location}>
                    {routeConfig.map((route, index) => (
                        <Route key={index} path={route.path} element={route.element} />
                    ))}
                </Routes>
            </motion.div>
        </AnimatePresence>
    );
}

export default function App() {
    const { restoreFromStorage, user } = useUserStore();
    const [authReady, setAuthReady] = useState(false);

    useEffect(() => {
        restoreFromStorage().finally(() => {
            setAuthReady(true);
        });
    }, [restoreFromStorage]);
    
    return authReady && (
        <BrowserRouter>
            <ElectronTitleBar />
            <AlertDialogProvider />
            <div id="main-wrapper">
                <AnimatedRoutes />
            </div>
            {user.isSuspended && (
                <SuspensionDialog 
                    reason={user.suspensionReason || "No reason provided"} 
                    open={true}
                    onOpenChange={() => {}} // Suspended users can't close the dialog
                />
            )}
        </BrowserRouter>
    )
}