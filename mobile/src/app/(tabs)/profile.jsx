import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
} from "@expo-google-fonts/poppins";
import {
  Settings,
  Bell,
  Shield,
  HelpCircle,
  LogOut,
  ChevronRight,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useColors } from "@/components/useColors.jsx";
import Header from "@/components/Header.jsx";
import useUser from "@/utils/auth/useUser";
import { useAuth } from "@/utils/auth/useAuth";
import GoogleAuthWebView from "@/components/GoogleAuthWebView";

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { data: user, loading } = useUser();
  const {
    signOut,
    signIn,
    showAuthWebView,
    closeAuthWebView,
    handleAuthMessage,
  } = useAuth();

  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
  });

  const settingsOptions = [
    {
      icon: Settings,
      label: "Account Settings",
      onPress: () => handleOptionPress("Account Settings"),
    },
    {
      icon: Bell,
      label: "Notifications",
      onPress: () => handleOptionPress("Notifications"),
    },
    {
      icon: Shield,
      label: "Privacy & Security",
      onPress: () => handleOptionPress("Privacy"),
    },
    {
      icon: HelpCircle,
      label: "Help & Support",
      onPress: () => handleOptionPress("Help"),
    },
  ];

  const handleOptionPress = (option) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(option, "This feature is coming soon!");
  };

  const handleLogout = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert("Log Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log Out",
        style: "destructive",
        onPress: async () => {
          await signOut();
        },
      },
    ]);
  };

  const handleSignIn = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    signIn();
  };

  if (!fontsLoaded) {
    return null;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Header
        title="Profile"
        showCredits={false}
        onMenuPress={() => {}}
        onProfilePress={() => {}}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 24,
          paddingBottom: insets.bottom + 24,
        }}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={{ padding: 40, alignItems: "center" }}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : !user ? (
          <View style={{ alignItems: "center", paddingVertical: 40 }}>
            <Text
              style={{
                fontSize: 18,
                fontFamily: "Poppins_500Medium",
                color: colors.text,
                marginBottom: 24,
                textAlign: "center",
              }}
            >
              Sign in to track your health events
            </Text>
            <TouchableOpacity
              style={{
                backgroundColor: colors.primary,
                borderRadius: 16,
                paddingVertical: 14,
                paddingHorizontal: 32,
              }}
              onPress={handleSignIn}
            >
              <Text
                style={{
                  fontSize: 16,
                  fontFamily: "Poppins_600SemiBold",
                  color: colors.background,
                }}
              >
                Sign In with Google
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View
              style={{
                backgroundColor: colors.cardBackground,
                borderRadius: 16,
                padding: 20,
                borderWidth: 1,
                borderColor: colors.outline,
                marginBottom: 24,
                alignItems: "center",
              }}
            >
              <View
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 40,
                  backgroundColor: colors.primary,
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 16,
                }}
              >
                <Text
                  style={{
                    fontSize: 32,
                    fontFamily: "Poppins_600SemiBold",
                    color: colors.background,
                  }}
                >
                  {user.name
                    ? user.name.charAt(0).toUpperCase()
                    : user.email.charAt(0).toUpperCase()}
                </Text>
              </View>

              <Text
                style={{
                  fontSize: 20,
                  fontFamily: "Poppins_600SemiBold",
                  color: colors.text,
                  marginBottom: 4,
                }}
              >
                {user.name || "User"}
              </Text>

              <Text
                style={{
                  fontSize: 15,
                  fontFamily: "Poppins_400Regular",
                  color: colors.textSecondary,
                }}
              >
                {user.email}
              </Text>
            </View>

            <View
              style={{
                backgroundColor: colors.cardBackground,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.outline,
                marginBottom: 24,
                overflow: "hidden",
              }}
            >
              {settingsOptions.map((option, index) => {
                const Icon = option.icon;
                return (
                  <TouchableOpacity
                    key={option.label}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      padding: 16,
                      borderBottomWidth:
                        index < settingsOptions.length - 1 ? 1 : 0,
                      borderBottomColor: colors.outline,
                    }}
                    onPress={option.onPress}
                    accessibilityLabel={option.label}
                  >
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        backgroundColor: colors.accentLilac,
                        alignItems: "center",
                        justifyContent: "center",
                        marginRight: 12,
                      }}
                    >
                      <Icon size={20} color={colors.primary} />
                    </View>

                    <Text
                      style={{
                        flex: 1,
                        fontSize: 16,
                        fontFamily: "Poppins_500Medium",
                        color: colors.text,
                      }}
                    >
                      {option.label}
                    </Text>

                    <ChevronRight size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              style={{
                backgroundColor: colors.cardBackground,
                borderRadius: 16,
                padding: 16,
                borderWidth: 1,
                borderColor: colors.outline,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
              }}
              onPress={handleLogout}
              accessibilityLabel="Log out"
            >
              <LogOut size={20} color="#EF4444" />
              <Text
                style={{
                  fontSize: 16,
                  fontFamily: "Poppins_600SemiBold",
                  color: "#EF4444",
                  marginLeft: 8,
                }}
              >
                Log Out
              </Text>
            </TouchableOpacity>
          </>
        )}

        <Text
          style={{
            fontSize: 13,
            fontFamily: "Poppins_400Regular",
            color: colors.textSecondary,
            textAlign: "center",
            marginTop: 24,
          }}
        >
          HealthLog v1.0.0
        </Text>
      </ScrollView>

      <GoogleAuthWebView
        visible={showAuthWebView}
        onClose={closeAuthWebView}
        onMessage={handleAuthMessage}
      />
    </View>
  );
}
