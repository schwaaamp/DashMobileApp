// Google OAuth with Supabase using expo-web-browser
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { Platform } from "react-native";

// Required for web browser auth to work properly
WebBrowser.maybeCompleteAuthSession();

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_KEY;

// Get the redirect URI that works with Expo
export const redirectUri = Linking.createURL("auth-callback");

/**
 * Sign in with Google via Supabase OAuth
 * Uses implicit flow which is more compatible with mobile apps
 */
export async function signInWithGoogleWebBrowser() {
  try {
    // Build auth URL with implicit flow (returns tokens directly in URL)
    const params = new URLSearchParams({
      provider: "google",
      redirect_to: redirectUri,
    });

    const authUrl = `${supabaseUrl}/auth/v1/authorize?${params.toString()}`;

    console.log("===========================================");
    console.log("REDIRECT URI (add to Supabase):", redirectUri);
    console.log("Auth URL:", authUrl);
    console.log("===========================================");

    // Open browser for authentication
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

    console.log("Auth result type:", result.type);
    console.log("Auth result:", JSON.stringify(result, null, 2));

    if (result.type !== "success") {
      return { session: null, error: result.type };
    }

    // Parse response URL
    const responseUrl = result.url;
    console.log("Response URL:", responseUrl);

    // Check for tokens in URL fragment (implicit flow)
    // URL format: scheme://auth-callback#access_token=xxx&refresh_token=xxx&...
    const hashIndex = responseUrl.indexOf("#");
    if (hashIndex !== -1) {
      const hashParams = new URLSearchParams(responseUrl.substring(hashIndex + 1));
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const expiresIn = hashParams.get("expires_in");

      console.log("Got access token:", !!accessToken);
      console.log("Got refresh token:", !!refreshToken);

      if (accessToken) {
        return {
          session: {
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_at: expiresIn ? Math.floor(Date.now() / 1000) + parseInt(expiresIn) : null,
          },
          error: null,
        };
      }
    }

    // Check for code in query params (PKCE flow)
    const urlObj = new URL(responseUrl);
    const code = urlObj.searchParams.get("code");

    if (code) {
      // Exchange code for tokens (this requires the code_verifier which we don't have in implicit flow)
      console.log("Got authorization code, but implicit flow doesn't use codes");
    }

    // Check for error
    const error = urlObj.searchParams.get("error");
    const errorDescription = urlObj.searchParams.get("error_description");

    if (error) {
      console.error("Auth error:", error, errorDescription);
      return { session: null, error: errorDescription || error };
    }

    return { session: null, error: "No tokens received in response" };

  } catch (error) {
    console.error("Google sign-in error:", error);
    return { session: null, error: error.message };
  }
}

// Alias for backwards compatibility
export const signInWithGoogle = signInWithGoogleWebBrowser;
