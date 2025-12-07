import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/components/useColors';
import Header from '@/components/Header';
import * as Haptics from 'expo-haptics';
import { createVoiceEvent, updateAuditStatus } from '@/utils/voiceEventParser';
import useUser from '@/utils/auth/useUser';
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
} from '@expo-google-fonts/poppins';

export default function ConfirmScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { data: user } = useUser();

  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
  });

  const parsedData = params.data ? JSON.parse(params.data) : null;
  const auditId = params.auditId;
  const missingFields = params.missingFields ? JSON.parse(params.missingFields) : [];
  const captureMethod = params.captureMethod || 'manual';

  const handleConfirm = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // Save the event
      await createVoiceEvent(
        user.id,
        parsedData.event_type,
        parsedData.event_data,
        parsedData.event_time,
        auditId,
        captureMethod
      );

      // Update audit status
      await updateAuditStatus(auditId, 'awaiting_user_clarification_success');

      Alert.alert('Success', 'Event saved successfully!', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (error) {
      console.error('Error saving event:', error);
      Alert.alert('Error', 'Failed to save event. Please try again.');
    }
  };

  const handleCancel = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  if (!fontsLoaded) {
    return null;
  }

  if (!parsedData) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Header title="Confirm" showCredits={false} />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: colors.text, fontFamily: 'Poppins_400Regular' }}>No data to display</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Header title="Confirm Event" showCredits={false} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 24,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <View
          style={{
            backgroundColor: colors.cardBackground,
            borderRadius: 16,
            padding: 20,
            borderWidth: 1,
            borderColor: colors.outline,
            marginBottom: 24,
          }}
        >
          <Text
            style={{
              fontSize: 18,
              fontFamily: 'Poppins_600SemiBold',
              color: colors.text,
              marginBottom: 16,
            }}
          >
            Event Type: {parsedData.event_type}
          </Text>

          {missingFields.length > 0 && (
            <View
              style={{
                backgroundColor: colors.accentLilac,
                borderRadius: 12,
                padding: 12,
                marginBottom: 16,
              }}
            >
              <Text
                style={{
                  fontSize: 14,
                  fontFamily: 'Poppins_500Medium',
                  color: colors.primary,
                }}
              >
                Missing fields: {missingFields.join(', ')}
              </Text>
            </View>
          )}

          <View>
            {Object.entries(parsedData.event_data).map(([key, value]) => (
              <View
                key={key}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingVertical: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.outline,
                }}
              >
                <Text
                  style={{
                    fontSize: 15,
                    fontFamily: 'Poppins_500Medium',
                    color: colors.textSecondary,
                  }}
                >
                  {key}:
                </Text>
                <Text
                  style={{
                    fontSize: 15,
                    fontFamily: 'Poppins_400Regular',
                    color: colors.text,
                  }}
                >
                  {value?.toString() || 'N/A'}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity
            style={{
              flex: 1,
              backgroundColor: colors.cardBackground,
              borderRadius: 16,
              padding: 16,
              borderWidth: 1,
              borderColor: colors.outline,
              alignItems: 'center',
            }}
            onPress={handleCancel}
          >
            <Text
              style={{
                fontSize: 16,
                fontFamily: 'Poppins_600SemiBold',
                color: colors.text,
              }}
            >
              Cancel
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={{
              flex: 1,
              backgroundColor: colors.primary,
              borderRadius: 16,
              padding: 16,
              alignItems: 'center',
            }}
            onPress={handleConfirm}
          >
            <Text
              style={{
                fontSize: 16,
                fontFamily: 'Poppins_600SemiBold',
                color: colors.background,
              }}
            >
              Confirm
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}
