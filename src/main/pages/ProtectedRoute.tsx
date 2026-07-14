import type { ReactNode } from "react";
import { useUserStore } from "@/state/user";
import { Navigate } from "react-router-dom";

interface ProtectedRouteProps {
    children: ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
    const { user } = useUserStore();

    return !user.authToken ? <Navigate to="/login" /> : children;
}
