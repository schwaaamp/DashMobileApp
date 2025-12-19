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

      // Set global.userId for logging infrastructure
      if (currentUser?.id) {
        global.userId = currentUser.id;
      }
    } catch (error) {
      console.error("Error fetching user:", error);
      setUser(null);
      global.userId = null; // Clear on error
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
        global.userId = null; // Clear global userId on logout
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
