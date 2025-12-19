import { useEffect } from 'react';
import { useRouter, useSegments } from 'expo-router';
import { useAuth } from '@/utils/auth/useAuth';
import { ActivityIndicator, View } from 'react-native';
import { useColors } from './useColors';

/**
 * ProtectedRoute component
 * Ensures users are authenticated before accessing protected screens
 * Redirects to login if not authenticated
 */
export function ProtectedRoute({ children }) {
  const { isAuthenticated, isReady } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const colors = useColors();

  useEffect(() => {
    if (!isReady) return; // Wait for auth to initialize

    const inAuthGroup = segments?.[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      // Redirect to login
      router.replace('/login');
    } else if (isAuthenticated && inAuthGroup) {
      // Redirect authenticated users away from login
      router.replace('/(tabs)/home');
    }
  }, [isAuthenticated, isReady, segments, router]);

  // Show loading while auth initializes
  if (!isReady) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // If not authenticated, show nothing (will redirect)
  if (!isAuthenticated) {
    return null;
  }

  // Authenticated - render children
  return children;
}
