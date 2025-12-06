import { useAuth } from "@/utils/auth/useAuth";
import { AuthModal } from "@/utils/auth/useAuthModal";
import GoogleAuthWebView from "@/components/GoogleAuthWebView";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      cacheTime: 1000 * 60 * 30, // 30 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export default function RootLayout() {
  const {
    initiate,
    isReady,
    showAuthWebView,
    closeAuthWebView,
    handleAuthMessage,
  } = useAuth();

  useEffect(() => {
    initiate();
  }, [initiate]);

  useEffect(() => {
    if (isReady) {
      SplashScreen.hideAsync();
    }
  }, [isReady]);

  if (!isReady) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <AuthModal />
        <GoogleAuthWebView
          visible={showAuthWebView}
          onClose={closeAuthWebView}
          onMessage={handleAuthMessage}
        />
        <Stack screenOptions={{ headerShown: false }}>
          {/* Expo Router auto-discovers routes from file system */}
        </Stack>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
