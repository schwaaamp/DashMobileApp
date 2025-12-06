// Supabase Auth via REST API for mobile
import * as SecureStore from "expo-secure-store";
import * as Linking from "expo-linking";
import { Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_KEY",
  );
}

const SESSION_KEY = "supabase_session";

// Get stored session
export async function getSession() {
  try {
    const sessionStr = await SecureStore.getItemAsync(SESSION_KEY);
    if (!sessionStr) return null;

    const session = JSON.parse(sessionStr);

    // Check if token expired
    if (session.expires_at && session.expires_at < Date.now() / 1000) {
      // Try to refresh
      return await refreshSession(session.refresh_token);
    }

    return session;
  } catch (error) {
    console.error("Error getting session:", error);
    return null;
  }
}

// Save session
export async function saveSession(session) {
  try {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  } catch (error) {
    console.error("Error saving session:", error);
  }
}

// Clear session
export async function clearSession() {
  try {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  } catch (error) {
    console.error("Error clearing session:", error);
  }
}

// Refresh session
export async function refreshSession(refreshToken) {
  try {
    const response = await fetch(
      `${supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      },
    );

    if (!response.ok) {
      await clearSession();
      return null;
    }

    const session = await response.json();
    await saveSession(session);
    return session;
  } catch (error) {
    console.error("Error refreshing session:", error);
    await clearSession();
    return null;
  }
}

// Get current user
export async function getUser() {
  const session = await getSession();
  if (!session?.access_token) return null;

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: supabaseKey,
      },
    });

    if (!response.ok) return null;

    return await response.json();
  } catch (error) {
    console.error("Error getting user:", error);
    return null;
  }
}

// Sign in with Google - returns URL to open in WebView
export function getGoogleAuthUrl() {
  // For web, this won't be used
  if (Platform.OS === "web") {
    return null;
  }

  // For native mobile - use the callback URL that will handle the tokens
  const redirectUrl = `${process.env.EXPO_PUBLIC_BASE_URL}/api/auth/callback`;
  const authUrl = `${supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectUrl)}`;

  return authUrl;
}

// Legacy function for compatibility - now returns auth URL instead
export async function signInWithGoogle() {
  return { authUrl: getGoogleAuthUrl(), error: null };
}

// Sign out
export async function signOut() {
  const session = await getSession();

  if (session?.access_token) {
    try {
      await fetch(`${supabaseUrl}/auth/v1/logout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: supabaseKey,
        },
      });
    } catch (error) {
      console.error("Error signing out:", error);
    }
  }

  await clearSession();
}
