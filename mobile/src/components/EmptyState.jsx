import React from "react";
import { View, Text } from "react-native";
import { useColors } from "@/components/useColors.jsx";

export default function EmptyState({ icon, title, description, style }) {
  const colors = useColors();

  return (
    <View
      style={[
        {
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 40,
          paddingTop: 80,
          paddingBottom: 120,
        },
        style,
      ]}
    >
      <View
        style={{
          width: 96,
          height: 96,
          borderRadius: 48,
          backgroundColor: colors.accentLilac,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 24,
        }}
      >
        {icon}
      </View>

      <Text
        style={{
          fontSize: 20,
          fontFamily: "Poppins_600SemiBold",
          color: colors.text,
          textAlign: "center",
          marginBottom: 8,
        }}
      >
        {title}
      </Text>

      <Text
        style={{
          fontSize: 15,
          fontFamily: "Poppins_400Regular",
          color: colors.textSecondary,
          textAlign: "center",
          lineHeight: 22,
        }}
      >
        {description}
      </Text>
    </View>
  );
}
