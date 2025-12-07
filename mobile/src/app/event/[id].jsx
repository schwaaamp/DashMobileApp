import React from 'react';
import { View, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useColors } from '@/components/useColors.jsx';
import Header from '@/components/Header';

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams();
  const colors = useColors();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Header title="Event Details" showCredits={false} />
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <Text style={{ fontSize: 18, color: colors.text }}>
          Event ID: {id}
        </Text>
        <Text style={{ fontSize: 14, color: colors.textSecondary, marginTop: 12 }}>
          Event details coming soon
        </Text>
      </View>
    </View>
  );
}
