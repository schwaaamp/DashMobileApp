/**
 * Edit Template Screen
 *
 * Allows editing template:
 * - Name
 * - Time range
 * - Items (add/remove/reorder)
 * - Default quantities
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Trash2, GripVertical, Clock, Save } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/components/useColors';
import Header from '@/components/Header';
import useUser from '@/utils/auth/useUser';
import { getTemplateById, updateTemplate } from '@/utils/mealPatterns';
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
} from '@expo-google-fonts/poppins';

const TIME_SLOTS = [
  { label: 'Morning', value: '06:00-10:59', icon: '🌅' },
  { label: 'Midday', value: '11:00-13:59', icon: '☀️' },
  { label: 'Afternoon', value: '14:00-17:59', icon: '🌤️' },
  { label: 'Evening', value: '18:00-21:59', icon: '🌆' },
  { label: 'Night', value: '22:00-05:59', icon: '🌙' },
  { label: 'Any time', value: null, icon: '⏰' },
];

export default function EditTemplateScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { data: user } = useUser();
  const templateId = params.templateId;

  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [template, setTemplate] = useState(null);
  const [templateName, setTemplateName] = useState('');
  const [timeRange, setTimeRange] = useState(null);
  const [items, setItems] = useState([]);

  useEffect(() => {
    loadTemplate();
  }, [templateId]);

  const loadTemplate = async () => {
    if (!templateId || !user?.id) {
      setIsLoading(false);
      return;
    }

    try {
      const data = await getTemplateById(templateId, user.id);

      if (!data) {
        throw new Error('Template not found');
      }

      setTemplate(data);
      setTemplateName(data.template_name || '');
      setTimeRange(data.typical_time_range);
      setItems(data.items || []);
    } catch (error) {
      console.error('[EditTemplate] Error loading:', error);
      Alert.alert('Error', 'Failed to load template');
      router.back();
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuantityChange = (index, value) => {
    const numValue = parseFloat(value) || 0;
    setItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, default_quantity: numValue } : item
      )
    );
  };

  const handleRemoveItem = (index) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (items.length <= 1) {
      Alert.alert('Cannot Remove', 'Template must have at least one item.');
      return;
    }
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleTimeSlotSelect = (slot) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeRange(slot.value);
  };

  const handleSave = async () => {
    if (!templateName.trim()) {
      Alert.alert('Name Required', 'Please enter a template name.');
      return;
    }

    if (items.length === 0) {
      Alert.alert('Items Required', 'Template must have at least one item.');
      return;
    }

    setIsSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const result = await updateTemplate(templateId, user.id, {
        template_name: templateName.trim(),
        typical_time_range: timeRange,
        items: items,
      });

      if (!result) {
        throw new Error('Failed to update template');
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (error) {
      console.error('[EditTemplate] Save error:', error);
      Alert.alert('Error', 'Failed to save changes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const getSelectedTimeSlot = () => {
    return TIME_SLOTS.find((slot) => slot.value === timeRange) || TIME_SLOTS[5];
  };

  if (!fontsLoaded || isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Header title="Edit Template" showCredits={false} />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (!template) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Header title="Edit Template" showCredits={false} />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: colors.text, fontFamily: 'Poppins_400Regular' }}>
            Template not found
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Header title="Edit Template" showCredits={false} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 20,
          paddingBottom: insets.bottom + 100,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Template Name */}
        <View style={{ marginBottom: 24 }}>
          <Text
            style={{
              fontSize: 14,
              fontFamily: 'Poppins_500Medium',
              color: colors.textSecondary,
              marginBottom: 8,
            }}
          >
            Template Name
          </Text>
          <TextInput
            value={templateName}
            onChangeText={setTemplateName}
            placeholder="e.g., Morning Vitamins"
            placeholderTextColor={colors.textSecondary}
            style={{
              backgroundColor: colors.cardBackground,
              borderRadius: 12,
              borderWidth: 2,
              borderColor: colors.outline,
              paddingHorizontal: 16,
              paddingVertical: 14,
              fontSize: 16,
              fontFamily: 'Poppins_500Medium',
              color: colors.text,
            }}
          />
        </View>

        {/* Time Range */}
        <View style={{ marginBottom: 24 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              marginBottom: 12,
            }}
          >
            <Clock size={18} color={colors.textSecondary} />
            <Text
              style={{
                fontSize: 14,
                fontFamily: 'Poppins_500Medium',
                color: colors.textSecondary,
              }}
            >
              Suggested Time
            </Text>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {TIME_SLOTS.map((slot) => {
              const isSelected = getSelectedTimeSlot().value === slot.value;
              return (
                <TouchableOpacity
                  key={slot.label}
                  onPress={() => handleTimeSlotSelect(slot)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 10,
                    backgroundColor: isSelected ? colors.primary : colors.cardBackground,
                    borderWidth: 2,
                    borderColor: isSelected ? colors.primary : colors.outline,
                  }}
                >
                  <Text style={{ fontSize: 16 }}>{slot.icon}</Text>
                  <Text
                    style={{
                      fontSize: 14,
                      fontFamily: 'Poppins_500Medium',
                      color: isSelected ? colors.background : colors.text,
                    }}
                  >
                    {slot.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Items */}
        <View style={{ marginBottom: 24 }}>
          <Text
            style={{
              fontSize: 14,
              fontFamily: 'Poppins_500Medium',
              color: colors.textSecondary,
              marginBottom: 12,
            }}
          >
            Items ({items.length})
          </Text>

          {items.map((item, index) => (
            <View
              key={index}
              style={{
                backgroundColor: colors.cardBackground,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.outline,
                marginBottom: 10,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                }}
              >
                <View
                  style={{
                    marginRight: 12,
                    opacity: 0.4,
                  }}
                >
                  <GripVertical size={20} color={colors.textSecondary} />
                </View>

                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: 15,
                      fontFamily: 'Poppins_500Medium',
                      color: colors.text,
                    }}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  {item.event_type && (
                    <Text
                      style={{
                        fontSize: 12,
                        fontFamily: 'Poppins_400Regular',
                        color: colors.textSecondary,
                        textTransform: 'capitalize',
                      }}
                    >
                      {item.event_type}
                    </Text>
                  )}
                </View>

                {/* Quantity Input */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <TextInput
                    value={String(item.default_quantity || 1)}
                    onChangeText={(value) => handleQuantityChange(index, value)}
                    keyboardType="numeric"
                    style={{
                      width: 50,
                      height: 36,
                      borderRadius: 8,
                      borderWidth: 2,
                      borderColor: colors.outline,
                      backgroundColor: colors.background,
                      textAlign: 'center',
                      fontSize: 14,
                      fontFamily: 'Poppins_500Medium',
                      color: colors.text,
                    }}
                  />
                  <Text
                    style={{
                      fontSize: 12,
                      fontFamily: 'Poppins_400Regular',
                      color: colors.textSecondary,
                      width: 40,
                    }}
                  >
                    {item.units || item.form || 'units'}
                  </Text>
                </View>

                {/* Delete Button */}
                <TouchableOpacity
                  onPress={() => handleRemoveItem(index)}
                  style={{
                    padding: 8,
                    marginLeft: 4,
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Trash2 size={18} color="#EF4444" />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>

        {/* Auto-generated indicator */}
        {template.auto_generated && (
          <View
            style={{
              backgroundColor: colors.accentLilac,
              borderRadius: 10,
              padding: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Text style={{ fontSize: 16 }}>✨</Text>
            <Text
              style={{
                flex: 1,
                fontSize: 13,
                fontFamily: 'Poppins_400Regular',
                color: colors.textSecondary,
              }}
            >
              This template was auto-created from your logging patterns
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Bottom Save Button */}
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
        <TouchableOpacity
          onPress={handleSave}
          disabled={isSaving}
          style={{
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
              <Save size={20} color={colors.background} />
              <Text
                style={{
                  fontSize: 16,
                  fontFamily: 'Poppins_600SemiBold',
                  color: colors.background,
                }}
              >
                Save Changes
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
