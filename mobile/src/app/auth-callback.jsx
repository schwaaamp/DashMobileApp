import { useEffect } from 'react';
import { router } from 'expo-router';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';

/**
 * This route handles the OAuth callback redirect.
 * After successful authentication, it redirects to the home screen.
 */
export default function AuthCallback() {
  useEffect(() => {
    // Small delay to ensure auth state is updated, then redirect to home
    const timer = setTimeout(() => {
      router.replace('/');
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#007AFF" />
      <Text style={styles.text}>Signing you in...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  text: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
});
