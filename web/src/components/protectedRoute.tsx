import { Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export default function ProtectedRoute({ children }: { children: JSX.Element }) {
  const loc = useLocation();

  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await api.get("/me")).data,
    retry: false,
  });

  if (isLoading) return null; // or loading spinner
  if (!me) return <Navigate to="/" replace state={{ from: loc }} />;

  return children;
}
