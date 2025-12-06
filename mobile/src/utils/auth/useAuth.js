import { useCallback, useEffect, useState } from "react";
import * as SupabaseAuth from "@/utils/supabaseAuth";
import { signInWithGoogleWebBrowser, redirectUri } from "./googleAuth";
import { Platform } from "react-native";

export const useAuth = () => {
  const [isReady, setIsReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [session, setSession] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Legacy: Keep for compatibility but no longer used
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

  // New direct Google OAuth sign-in
  const signIn = useCallback(async () => {
    // On web, fall back to WebView approach
    if (Platform.OS === "web") {
      setShowAuthWebView(true);
      return { error: null };
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log("Starting Google sign-in...");
      console.log("Redirect URI:", redirectUri);

      const result = await signInWithGoogleWebBrowser();

      if (result.error) {
        console.error("Sign-in error:", result.error);
        setError(result.error);
        setIsLoading(false);
        return { error: result.error };
      }

      if (result.session) {
        await SupabaseAuth.saveSession(result.session);
        setSession(result.session);
        setIsAuthenticated(true);
        console.log("Sign-in successful!");
      }

      setIsLoading(false);
      return { error: null };
    } catch (err) {
      console.error("Sign-in exception:", err);
      setError(err.message);
      setIsLoading(false);
      return { error: err.message };
    }
  }, []);

  const signUp = signIn; // Same as sign in for OAuth

  const signOut = useCallback(async () => {
    await SupabaseAuth.signOut();
    setSession(null);
    setIsAuthenticated(false);
    setError(null);
  }, []);

  const getAccessToken = useCallback(async () => {
    const currentSession = await SupabaseAuth.getSession();
    return currentSession?.access_token;
  }, []);

  // Legacy: Keep for WebView compatibility on web platform
  const handleAuthMessage = useCallback(async (data) => {
    if (data.type === "SUPABASE_AUTH_SUCCESS") {
      const newSession = {
        access_token: data.accessToken,
        refresh_token: data.refreshToken,
        expires_at: data.expiresIn
          ? Math.floor(Date.now() / 1000) + parseInt(data.expiresIn)
          : null,
      };

      await SupabaseAuth.saveSession(newSession);
      setSession(newSession);
      setIsAuthenticated(true);
      setShowAuthWebView(false);
    } else if (data.type === "SUPABASE_AUTH_ERROR") {
      console.error("Auth error:", data.error, data.description);
      setError(data.error || data.description);
      setShowAuthWebView(false);
    }
  }, []);

  const closeAuthWebView = useCallback(() => {
    setShowAuthWebView(false);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    signIn,
    signUp,
    signOut,
    isReady,
    isAuthenticated,
    isLoading,
    error,
    clearError,
    session,
    getAccessToken,
    initiate,
    auth: session ? { token: session.access_token } : null,
    setAuth: () => {}, // No-op for compatibility
    // Legacy WebView props (used on web platform)
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
