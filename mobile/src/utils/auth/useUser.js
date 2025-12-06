import { useState, useEffect, useCallback } from "react";
import * as SupabaseAuth from "@/utils/supabaseAuth";
import { useAuth } from "./useAuth";

export const useUser = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const { isAuthenticated, isReady } = useAuth();

  const fetchUser = useCallback(async () => {
    setLoading(true);
    try {
      const currentUser = await SupabaseAuth.getUser();
      setUser(currentUser);
    } catch (error) {
      console.error("Error fetching user:", error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isReady) {
      if (isAuthenticated) {
        fetchUser();
      } else {
        // Clear user when logged out
        setUser(null);
        setLoading(false);
      }
    }
  }, [isAuthenticated, isReady, fetchUser]);

  return {
    user,
    data: user,
    loading,
    refetch: fetchUser,
  };
};

export default useUser;
