import { useState, useEffect, useCallback } from "react";
import * as SupabaseAuth from "@/utils/supabaseAuth";

export const useUser = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

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
    fetchUser();
  }, [fetchUser]);

  return {
    user,
    data: user,
    loading,
    refetch: fetchUser,
  };
};

export default useUser;
