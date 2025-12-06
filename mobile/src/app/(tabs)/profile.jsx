import React from "react";
import { View, Text, TouchableOpacity, ScrollView, Alert } from "react-native";
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
import useAuth from "@/utils/auth/useAuth";
import useUser from "@/utils/auth/useUser";
import GoogleAuthWebView from "@/components/GoogleAuthWebView";

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const {
    isAuthenticated,
    isReady,
    signOut,
    showAuthWebView,
    closeAuthWebView,
    handleAuthMessage,
  } = useAuth();
  const { data: user, loading: userLoading } = useUser();

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
      { text: "Log Out", style: "destructive", onPress: () => signOut() },
    ]);
  };

  if (!fontsLoaded || !isReady) {
    return null;
  }

  // Get user initials
  const getUserInitials = () => {
    if (!user?.email) return "?";
    return user.email.substring(0, 2).toUpperCase();
  };

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
              {getUserInitials()}
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
            {user?.name || user?.email?.split("@")[0] || "Guest"}
          </Text>

          <Text
            style={{
              fontSize: 15,
              fontFamily: "Poppins_400Regular",
              color: colors.textSecondary,
            }}
          >
            {user?.email || "Not signed in"}
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
                  borderBottomWidth: index < settingsOptions.length - 1 ? 1 : 0,
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

        {isAuthenticated ? (
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
        ) : null}

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
