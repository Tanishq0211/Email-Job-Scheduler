import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMe } from "./useAuth";

/** Redirect to /login when the session check finishes without a user. */
export function useRequireAuth() {
  const { data, isLoading, isError } = useMe();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && (isError || !data)) {
      navigate("/login", { replace: true });
    }
  }, [isLoading, isError, data, navigate]);

  return { user: data, isLoading };
}
