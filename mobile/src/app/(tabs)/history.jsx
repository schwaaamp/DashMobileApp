import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
} from "@expo-google-fonts/poppins";
import {
  Calendar,
  Activity,
  Pill,
  Utensils,
  Droplet,
  Flame,
  FileText,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useColors } from "@/components/useColors.jsx";
import Header from "@/components/Header.jsx";
import SearchBar from "@/components/SearchBar.jsx";
import EmptyState from "@/components/EmptyState.jsx";
import { useAuth } from "@/utils/auth/useAuth";
import useUser from "@/utils/auth/useUser";
import { supabase } from "@/utils/supabaseClient";

const EVENT_TYPE_ICONS = {
  food: Utensils,
  glucose: Droplet,
  insulin: Droplet,
  activity: Activity,
  supplement: Pill,
  sauna: Flame,
  medication: Pill,
  symptom: FileText,
};

const EVENT_TYPE_LABELS = {
  food: "Food",
  glucose: "Glucose",
  insulin: "Insulin",
  activity: "Activity",
  supplement: "Supplement",
  sauna: "Sauna",
  medication: "Medication",
  symptom: "Symptom",
};

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const router = useRouter();
  const { data: user } = useUser();

  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
  });

  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["events", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      const query = supabase
        .from('voice_events')
        .select('*')
        .eq('user_id', user.id)
        .order('event_time', { ascending: false })
        .limit(100);

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching events:', error);
        throw new Error('Failed to fetch events');
      }

      return data || [];
    },
    enabled: !!user?.id,
  });

  const handleEventPress = useCallback(
    (eventId) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      router.push(`/event/${eventId}`);
    },
    [router],
  );

  const formatEventTime = (timestamp) => {
    // Ensure timestamp is properly parsed - handle ISO strings and timestamps
    const date = new Date(timestamp);

    // Check if date is valid
    if (isNaN(date.getTime())) {
      console.error('Invalid timestamp:', timestamp);
      return 'Invalid date';
    }

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    // Handle negative differences (future dates)
    if (diffMs < 0) {
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;

    // For older dates, include year if not current year
    const currentYear = now.getFullYear();
    const eventYear = date.getFullYear();

    if (currentYear === eventYear) {
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } else {
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }
  };

  const getEventSummary = (event) => {
    const data = event.event_data;
    if (!data) return "Event logged";

    switch (event.event_type) {
      case "food":
        return data.description || "Food logged";
      case "glucose":
        return `${data.value} ${data.units || 'mg/dL'}`;
      case "insulin":
        return `${data.value} ${data.units || 'units'} ${data.insulin_type || ''}`;
      case "activity":
        return `${data.activity_type} - ${data.duration}min`;
      case "supplement":
        return `${data.name} ${data.dosage} ${data.units || ''}`.trim();
      case "sauna":
        return `${data.duration}min at ${data.temperature}°${data.temperature_units || 'F'}`;
      case "medication":
        return `${data.name} ${data.dosage} ${data.units || ''}`.trim();
      case "symptom":
        return data.description || "Symptom logged";
      default:
        return "Event logged";
    }
  };

  // Get user initials from user metadata or email
  const getUserInitials = () => {
    if (!user) return "?";

    // Try to get from user metadata first
    if (user.user_metadata?.full_name) {
      const names = user.user_metadata.full_name.split(' ');
      if (names.length >= 2) {
        return (names[0][0] + names[names.length - 1][0]).toUpperCase();
      }
      return user.user_metadata.full_name.substring(0, 2).toUpperCase();
    }

    // Fallback to email - get first and second part before @
    if (user.email) {
      const emailParts = user.email.split('@')[0].split('.');
      if (emailParts.length >= 2) {
        return (emailParts[0][0] + emailParts[1][0]).toUpperCase();
      }
      return user.email.substring(0, 2).toUpperCase();
    }

    return "?";
  };

  if (!fontsLoaded) {
    return null;
  }

  // Filter and deduplicate events to ensure unique keys
  const filteredEvents = React.useMemo(() => {
    if (!data) return [];

    // Filter by search query
    const filtered = data.filter((event) => {
      if (!searchQuery) return true;
      const summary = getEventSummary(event).toLowerCase();
      return summary.includes(searchQuery.toLowerCase());
    });

    // Deduplicate by ID to ensure unique keys
    const seen = new Set();
    return filtered.filter((event) => {
      if (seen.has(event.id)) {
        console.warn('Duplicate event ID detected:', event.id);
        return false;
      }
      seen.add(event.id);
      return true;
    });
  }, [data, searchQuery]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Header
        title="History"
        showCredits={false}
        userInitials={getUserInitials()}
        onMenuPress={() => {}}
        onProfilePress={() => router.push("/(tabs)/profile")}
      />

      {isLoading ? (
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : filteredEvents.length === 0 ? (
        <EmptyState
          icon={<Calendar size={48} color={colors.primary} />}
          title="No events yet"
          description="Start logging your health activities to see them here"
        />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 0,
            paddingBottom: 140,
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
        >
          <View style={{ gap: 12 }}>
            {filteredEvents.map((event) => {
              const Icon = EVENT_TYPE_ICONS[event.event_type] || FileText;
              return (
                <TouchableOpacity
                  key={event.id}
                  style={{
                    backgroundColor: colors.cardBackground,
                    borderRadius: 16,
                    padding: 16,
                    borderWidth: 1,
                    borderColor: colors.outline,
                    flexDirection: "row",
                    alignItems: "center",
                  }}
                  onPress={() => handleEventPress(event.id)}
                  accessibilityLabel={`View ${event.event_type} event`}
                >
                  <View
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 24,
                      backgroundColor: colors.accentLilac,
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 16,
                    }}
                  >
                    <Icon size={24} color={colors.primary} />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: 16,
                        fontFamily: "Poppins_600SemiBold",
                        color: colors.text,
                        marginBottom: 4,
                      }}
                    >
                      {EVENT_TYPE_LABELS[event.event_type]}
                    </Text>
                    <Text
                      style={{
                        fontSize: 14,
                        fontFamily: "Poppins_400Regular",
                        color: colors.textSecondary,
                      }}
                      numberOfLines={1}
                    >
                      {getEventSummary(event)}
                    </Text>
                  </View>

                  <Text
                    style={{
                      fontSize: 13,
                      fontFamily: "Poppins_400Regular",
                      color: colors.textSecondary,
                    }}
                  >
                    {formatEventTime(event.event_time)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      )}

      {/* Search bar at bottom */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: colors.background,
          borderTopWidth: 1,
          borderTopColor: colors.outline,
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: 12 + insets.bottom,
        }}
      >
        <SearchBar
          placeholder="Filter for..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>
    </View>
  );
}
