import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Menu } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useColors } from "@/components/useColors.jsx";

export default function Header({
  title,
  showBorder = false,
  showCredits = true,
  credits = "120",
  onMenuPress,
  onProfilePress,
  rightComponent,
}) {
  const insets = useSafeAreaInsets();
  const colors = useColors();

  const handleMenuPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (onMenuPress) {
      onMenuPress();
    }
  };

  const handleProfilePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (onProfilePress) {
      onProfilePress();
    }
  };

  return (
    <View
      style={{
        backgroundColor: colors.background,
        borderBottomWidth: showBorder ? 1 : 0,
        borderBottomColor: colors.outline,
      }}
    >
      <View
        style={{
          height: insets.top + 56,
          paddingTop: insets.top,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 20,
        }}
      >
        <TouchableOpacity
          style={{
            width: 48,
            height: 48,
            borderRadius: 16,
            backgroundColor: colors.cardBackground,
            borderWidth: 1,
            borderColor: colors.outline,
            alignItems: "center",
            justifyContent: "center",
          }}
          onPress={handleMenuPress}
          accessibilityLabel="Open menu"
        >
          <Menu size={20} color={colors.text} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleProfilePress}
          accessibilityLabel="Profile"
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: colors.primary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                fontSize: 16,
                fontFamily: "Poppins_600SemiBold",
                color: colors.background,
              }}
            >
              JD
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          paddingHorizontal: 20,
          paddingBottom: 20,
        }}
      >
        <Text
          style={{
            fontSize: 22,
            fontFamily: "Poppins_600SemiBold",
            color: colors.text,
          }}
        >
          {title}
        </Text>

        {rightComponent}
      </View>
    </View>
  );
}
