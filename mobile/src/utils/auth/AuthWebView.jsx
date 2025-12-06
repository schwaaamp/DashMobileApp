import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { WebView } from "react-native-webview";
import { useAuthStore } from "./store";
import * as SupabaseAuth from "@/utils/supabaseAuth";

const callbackUrl = "/api/auth/token";
const callbackQueryString = `callbackUrl=${callbackUrl}`;

/**
 * This renders a WebView for authentication and handles both web and native platforms.
 */
export const AuthWebView = ({ mode, proxyURL, baseURL }) => {
  const [currentURI, setURI] = useState(
    `${baseURL}/account/${mode}?${callbackQueryString}`,
  );
  const { auth, setAuth, isReady } = useAuthStore();
  const isAuthenticated = isReady ? !!auth : null;
  const iframeRef = useRef(null);

  useEffect(() => {
    if (Platform.OS === "web") {
      return;
    }
    if (isAuthenticated) {
      router.back();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      return;
    }
    setURI(`${baseURL}/account/${mode}?${callbackQueryString}`);
  }, [mode, baseURL, isAuthenticated]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.addEventListener) {
      return;
    }
    const handleMessage = (event) => {
      // Verify the origin for security
      if (event.origin !== process.env.EXPO_PUBLIC_PROXY_BASE_URL) {
        return;
      }
      if (event.data.type === "AUTH_SUCCESS") {
        setAuth({
          jwt: event.data.jwt,
          user: event.data.user,
        });
      } else if (event.data.type === "AUTH_ERROR") {
        console.error("Auth error:", event.data.error);
      }
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [setAuth]);

  // Handle messages from WebView (for Supabase OAuth)
  const handleWebViewMessage = async (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);

      if (data.type === "SUPABASE_AUTH_SUCCESS") {
        // Save Supabase session
        const session = {
          access_token: data.accessToken,
          refresh_token: data.refreshToken,
          expires_at: data.expiresIn
            ? Math.floor(Date.now() / 1000) + parseInt(data.expiresIn)
            : null,
        };

        await SupabaseAuth.saveSession(session);

        // Also set in old auth store for compatibility
        setAuth({
          jwt: data.accessToken,
          user: null,
        });

        router.back();
      } else if (data.type === "SUPABASE_AUTH_ERROR") {
        console.error("Supabase auth error:", data.error, data.description);
      }
    } catch (error) {
      console.error("Error handling WebView message:", error);
    }
  };

  if (Platform.OS === "web") {
    const handleIframeError = () => {
      console.error("Failed to load auth iframe");
    };

    return (
      <iframe
        ref={iframeRef}
        title="Authentication"
        src={`${proxyURL}/account/${mode}?callbackUrl=/api/auth/expo-web-success`}
        style={{ width: "100%", height: "100%", border: "none" }}
        onError={handleIframeError}
      />
    );
  }

  return (
    <WebView
      sharedCookiesEnabled
      source={{
        uri: currentURI,
      }}
      headers={{
        "x-createxyz-project-group-id":
          process.env.EXPO_PUBLIC_PROJECT_GROUP_ID,
        host: process.env.EXPO_PUBLIC_HOST,
        "x-forwarded-host": process.env.EXPO_PUBLIC_HOST,
        "x-createxyz-host": process.env.EXPO_PUBLIC_HOST,
      }}
      onMessage={handleWebViewMessage}
      onShouldStartLoadWithRequest={(request) => {
        if (request.url === `${baseURL}${callbackUrl}`) {
          fetch(request.url).then(async (response) => {
            response.json().then((data) => {
              setAuth({ jwt: data.jwt, user: data.user });
            });
          });
          return false;
        }
        if (request.url === currentURI) return true;

        // Add query string properly by checking if URL already has parameters
        const hasParams = request.url.includes("?");
        const separator = hasParams ? "&" : "?";
        const newURL = request.url.replaceAll(proxyURL, baseURL);
        if (newURL.endsWith(callbackUrl)) {
          setURI(newURL);
          return false;
        }
        setURI(`${newURL}${separator}${callbackQueryString}`);
        return false;
      }}
      style={{ flex: 1 }}
    />
  );
};
