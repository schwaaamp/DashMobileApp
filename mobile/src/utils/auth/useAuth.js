import { useCallback, useEffect, useState } from "react";
import * as SupabaseAuth from "@/utils/supabaseAuth";
import { router } from "expo-router";

export const useAuth = () => {
  const [isReady, setIsReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [session, setSession] = useState(null);
  const [showAuthWebView, setShowAuthWebView] = useState(false);

  const checkSession = useCallback(async () => {
    const currentSession = await SupabaseAuth.getSession();
    setSession(currentSession);
    setIsAuthenticated(!!currentSession);
    setIsReady(true);
  }, []);

  const initiate = checkSession;

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const signIn = useCallback(async () => {
    setShowAuthWebView(true);
    return { error: null };
  }, []);

  const signUp = signIn; // Same as sign in for OAuth

  const signOut = useCallback(async () => {
    await SupabaseAuth.signOut();
    setSession(null);
    setIsAuthenticated(false);
  }, []);

  const getAccessToken = useCallback(async () => {
    const currentSession = await SupabaseAuth.getSession();
    return currentSession?.access_token;
  }, []);

  const handleAuthMessage = useCallback(async (data) => {
    if (data.type === "SUPABASE_AUTH_SUCCESS") {
      const session = {
        access_token: data.accessToken,
        refresh_token: data.refreshToken,
        expires_at: data.expiresIn
          ? Math.floor(Date.now() / 1000) + parseInt(data.expiresIn)
          : null,
      };

      await SupabaseAuth.saveSession(session);
      setSession(session);
      setIsAuthenticated(true);
      setShowAuthWebView(false);
    } else if (data.type === "SUPABASE_AUTH_ERROR") {
      console.error("Auth error:", data.error, data.description);
      setShowAuthWebView(false);
    }
  }, []);

  const closeAuthWebView = useCallback(() => {
    setShowAuthWebView(false);
  }, []);

  return {
    signIn,
    signUp,
    signOut,
    isReady,
    isAuthenticated,
    session,
    getAccessToken,
    initiate,
    auth: session ? { token: session.access_token } : null,
    setAuth: () => {}, // No-op for compatibility
    showAuthWebView,
    closeAuthWebView,
    handleAuthMessage,
  };
};

export const useRequireAuth = (options) => {
  const { isAuthenticated, isReady, signIn } = useAuth();

  useEffect(() => {
    if (!isAuthenticated && isReady) {
      signIn();
    }
  }, [isAuthenticated, isReady, signIn]);
};

export default useAuth;
