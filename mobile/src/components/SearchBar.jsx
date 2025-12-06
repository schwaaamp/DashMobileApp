import React from "react";
import { View, TextInput } from "react-native";
import { Search } from "lucide-react-native";
import { useColors } from "@/components/useColors.jsx";

export default function SearchBar({
  placeholder = "Search",
  value,
  onChangeText,
  style,
}) {
  const colors = useColors();

  return (
    <View
      style={[
        {
          height: 56,
          backgroundColor: colors.searchBackground,
          borderRadius: 12,
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          marginHorizontal: 20,
          marginBottom: 12,
        },
        style,
      ]}
    >
      <Search size={20} color={colors.textSecondary} />
      <TextInput
        style={{
          flex: 1,
          fontSize: 15,
          fontFamily: "Poppins_400Regular",
          color: colors.text,
          marginLeft: 16,
        }}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        value={value}
        onChangeText={onChangeText}
      />
    </View>
  );
}
