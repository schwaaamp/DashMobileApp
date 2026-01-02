/**
 * Template Confirmation Screen
 *
 * Shows when user accepts a template suggestion.
 * Allows adjusting quantities before logging all items.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/components/useColors';
import Header from '@/components/Header';
import * as Haptics from 'expo-haptics';
import { createVoiceEvent } from '@/utils/voiceEventParser';
import { incrementTemplateUsage, learnTemplateQuantities } from '@/utils/mealPatterns';
import useUser from '@/utils/auth/useUser';
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
} from '@expo-google-fonts/poppins';

export default function TemplateConfirmScreen() {
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

  // Parse template from params
  const template = useMemo(() => {
    try {
      return params.template ? JSON.parse(params.template) : null;
    } catch {
      return null;
    }
  }, [params.template]);

  // Initialize quantities from template defaults
  const [quantities, setQuantities] = useState(() => {
    if (!template?.items) return {};
    return template.items.reduce((acc, item, index) => {
      acc[index] = item.default_quantity || item.dosage || 1;
      return acc;
    }, {});
  });

  const [isSaving, setIsSaving] = useState(false);

  // Calculate totals
  const totals = useMemo(() => {
    if (!template?.items) return { items: 0, calories: 0 };

    let calories = 0;
    template.items.forEach((item, index) => {
      const qty = quantities[index] || 1;
      if (item.calories) {
        calories += item.calories * qty;
      }
    });

    return {
      items: template.items.length,
      calories: Math.round(calories),
    };
  }, [template, quantities]);

  const handleQuantityChange = (index, value) => {
    const numValue = parseFloat(value) || 0;
    setQuantities(prev => ({
      ...prev,
      [index]: numValue,
    }));
  };

  const handleQuickQuantity = (index, value) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setQuantities(prev => ({
      ...prev,
      [index]: value,
    }));
  };

  const handleConfirm = async () => {
    if (!user?.id || !template) return;

    try {
      setIsSaving(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const eventTime = new Date().toISOString();
      const savedEvents = [];

      // Create an event for each item in the template
      for (let i = 0; i < template.items.length; i++) {
        const item = template.items[i];
        const quantity = quantities[i] || 1;

        // Build event data based on item type
        const eventData = {
          name: item.name,
          quantity: quantity,
          units: item.units || item.form || 'serving',
          template_id: template.id,
        };

        // Add nutritional data if available
        if (item.dosage) eventData.dosage = item.dosage * quantity;
        if (item.calories) eventData.calories = item.calories * quantity;
        if (item.product_id) eventData.product_catalog_id = item.product_id;

        const eventType = item.event_type || 'supplement';

        await createVoiceEvent(
          user.id,
          eventType,
          eventData,
          eventTime,
          null, // No audit ID for template logging
          'template'
        );

        savedEvents.push(eventData);
      }

      // Increment template usage counter
      await incrementTemplateUsage(template.id);

      // Learn from quantity adjustments (for future defaults)
      await learnTemplateQuantities(template.id, quantities);

      setIsSaving(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      Alert.alert(
        'Logged!',
        `${savedEvents.length} item${savedEvents.length !== 1 ? 's' : ''} logged successfully.`,
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (error) {
      setIsSaving(false);
      console.error('[TemplateConfirm] Error saving:', error);
      Alert.alert('Error', 'Failed to log items. Please try again.');
    }
  };

  const handleCancel = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  if (!fontsLoaded) return null;

  if (!template) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Header title="Log Template" showCredits={false} />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: colors.text, fontFamily: 'Poppins_400Regular' }}>
            No template data found
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Header title={template.template_name} showCredits={false} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 20,
          paddingBottom: insets.bottom + 100,
        }}
      >
        {/* Summary Card */}
        <View
          style={{
            backgroundColor: colors.cardBackground,
            borderRadius: 16,
            padding: 16,
            marginBottom: 20,
            borderWidth: 2,
            borderColor: colors.primary,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Text style={{ fontSize: 20 }}>⚡</Text>
            <Text
              style={{
                fontSize: 18,
                fontFamily: 'Poppins_600SemiBold',
                color: colors.text,
              }}
            >
              {template.template_name}
            </Text>
          </View>

          <Text
            style={{
              fontSize: 14,
              fontFamily: 'Poppins_400Regular',
              color: colors.textSecondary,
            }}
          >
            {totals.items} items{totals.calories > 0 ? ` • ${totals.calories} cal` : ''}
          </Text>
        </View>

        {/* Items List */}
        <Text
          style={{
            fontSize: 14,
            fontFamily: 'Poppins_500Medium',
            color: colors.textSecondary,
            marginBottom: 12,
          }}
        >
          Adjust quantities if needed:
        </Text>

        {template.items?.map((item, index) => (
          <View
            key={index}
            style={{
              backgroundColor: colors.cardBackground,
              borderRadius: 12,
              padding: 16,
              marginBottom: 12,
            }}
          >
            {/* Item Name */}
            <Text
              style={{
                fontSize: 16,
                fontFamily: 'Poppins_600SemiBold',
                color: colors.text,
                marginBottom: 4,
              }}
            >
              {item.name}
            </Text>

            {item.event_type && (
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: 'Poppins_400Regular',
                  color: colors.textSecondary,
                  marginBottom: 12,
                  textTransform: 'capitalize',
                }}
              >
                {item.event_type}
              </Text>
            )}

            {/* Quantity Controls */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {/* Quick buttons */}
              {[1, 2, 3].map(num => (
                <TouchableOpacity
                  key={num}
                  onPress={() => handleQuickQuantity(index, num)}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    backgroundColor:
                      quantities[index] === num ? colors.primary : colors.background,
                    borderWidth: 2,
                    borderColor:
                      quantities[index] === num ? colors.primary : colors.outline,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 16,
                      fontFamily: 'Poppins_600SemiBold',
                      color:
                        quantities[index] === num ? colors.background : colors.text,
                    }}
                  >
                    {num}
                  </Text>
                </TouchableOpacity>
              ))}

              {/* Custom input */}
              <TextInput
                value={
                  quantities[index] && ![1, 2, 3].includes(quantities[index])
                    ? quantities[index].toString()
                    : ''
                }
                onChangeText={value => handleQuantityChange(index, value)}
                placeholder="Other"
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                style={{
                  flex: 1,
                  height: 44,
                  borderRadius: 12,
                  borderWidth: 2,
                  borderColor: colors.outline,
                  paddingHorizontal: 12,
                  fontSize: 15,
                  fontFamily: 'Poppins_400Regular',
                  color: colors.text,
                  backgroundColor: colors.background,
                }}
              />

              {/* Unit label */}
              <Text
                style={{
                  fontSize: 13,
                  fontFamily: 'Poppins_400Regular',
                  color: colors.textSecondary,
                  minWidth: 50,
                }}
              >
                {item.units || item.form || 'units'}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Bottom Actions */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: colors.background,
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: insets.bottom + 16,
          borderTopWidth: 1,
          borderTopColor: colors.outline,
        }}
      >
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity
            onPress={handleCancel}
            style={{
              flex: 1,
              backgroundColor: colors.cardBackground,
              borderRadius: 16,
              paddingVertical: 16,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: colors.outline,
            }}
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
            onPress={handleConfirm}
            disabled={isSaving}
            style={{
              flex: 2,
              backgroundColor: colors.primary,
              borderRadius: 16,
              paddingVertical: 16,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {isSaving ? (
              <ActivityIndicator color={colors.background} size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={22} color={colors.background} />
                <Text
                  style={{
                    fontSize: 16,
                    fontFamily: 'Poppins_600SemiBold',
                    color: colors.background,
                  }}
                >
                  Log {totals.items} Items
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
