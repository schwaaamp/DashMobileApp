import React from "react";
import { ScrollView, TouchableOpacity, Text } from "react-native";
import * as Haptics from "expo-haptics";
import { useColors } from "@/components/useColors.jsx";

export default function FilterChips({
  filters,
  selectedFilter,
  onFilterPress,
  style,
}) {
  const colors = useColors();

  const handleFilterPress = (filter) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (onFilterPress) {
      onFilterPress(filter);
    }
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[{ marginBottom: 12 }, style]}
      contentContainerStyle={{ paddingHorizontal: 16 }}
    >
      {filters.map((filter, index) => (
        <TouchableOpacity
          key={filter}
          style={{
            minWidth: 90,
            height: 40,
            paddingHorizontal: 16,
            borderRadius: 12,
            backgroundColor:
              selectedFilter === filter ? colors.primary : "transparent",
            borderWidth: selectedFilter === filter ? 0 : 1,
            borderColor: colors.primary,
            alignItems: "center",
            justifyContent: "center",
            marginRight: index < filters.length - 1 ? 12 : 0,
          }}
          onPress={() => handleFilterPress(filter)}
          accessibilityLabel={`Filter ${filter}`}
        >
          <Text
            style={{
              fontSize: 15,
              fontFamily: "Poppins_500Medium",
              color:
                selectedFilter === filter
                  ? colors.cardBackground
                  : colors.primary,
            }}
          >
            {filter}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}
