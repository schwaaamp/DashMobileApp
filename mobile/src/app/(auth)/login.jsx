import { useAuth } from '@/utils/auth/useAuth';
import { View, TouchableOpacity, Text, ActivityIndicator } from 'react-native';
import { useColors } from '@/components/useColors';
import {
  useFonts,
  Poppins_400Regular,
  Poppins_600SemiBold,
} from '@expo-google-fonts/poppins';

export default function LoginScreen() {
  const { signIn, isLoading } = useAuth();
  const colors = useColors();

  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_600SemiBold,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
      padding: 24,
    }}>
      <Text style={{
        fontSize: 32,
        fontFamily: 'Poppins_600SemiBold',
        color: colors.text,
        marginBottom: 12,
      }}>
        Welcome to Dash
      </Text>

      <Text style={{
        fontSize: 16,
        fontFamily: 'Poppins_400Regular',
        color: colors.textSecondary,
        marginBottom: 48,
        textAlign: 'center',
      }}>
        Sign in to track your health journey
      </Text>

      <TouchableOpacity
        onPress={signIn}
        disabled={isLoading}
        style={{
          backgroundColor: colors.primary,
          paddingHorizontal: 32,
          paddingVertical: 16,
          borderRadius: 12,
          minWidth: 200,
          alignItems: 'center',
        }}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color="#FFF" />
        ) : (
          <Text style={{
            color: '#FFF',
            fontSize: 16,
            fontFamily: 'Poppins_600SemiBold',
          }}>
            Sign in with Google
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}
