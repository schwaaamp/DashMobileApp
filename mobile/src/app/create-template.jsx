/**
 * Create Template Screen
 *
 * Allows users to manually create a new meal template.
 * Can also be used to confirm a detected pattern as a template.
 *
 * Modes:
 * 1. Manual creation - Start from scratch, search/add items
 * 2. Pattern confirmation - Pre-filled with detected pattern items
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Plus, Trash2, Clock, Search, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/components/useColors';
import Header from '@/components/Header';
import useUser from '@/utils/auth/useUser';
import { createTemplateFromPattern } from '@/utils/mealPatterns';
import { supabase } from '@/utils/supabaseClient';
import { normalizeProductKey } from '@/utils/productCatalog';
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

export default function CreateTemplateScreen() {
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

  // Parse pattern from params if coming from pattern detection
  const patternData = useMemo(() => {
    try {
      return params.pattern ? JSON.parse(params.pattern) : null;
    } catch {
      return null;
    }
  }, [params.pattern]);

  const isPatternMode = !!patternData;

  // Form state
  const [templateName, setTemplateName] = useState('');
  const [timeRange, setTimeRange] = useState(null);
  const [items, setItems] = useState([]);
  const [isSaving, setIsSaving] = useState(false);

  // Search state for adding items
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  // Initialize from pattern data
  useEffect(() => {
    if (patternData) {
      // Suggest a default name based on time of day
      const hour = patternData.typicalHour || new Date().getHours();
      let suggestedName = '';
      if (hour >= 5 && hour < 11) {
        suggestedName = 'Morning Stack';
      } else if (hour >= 11 && hour < 14) {
        suggestedName = 'Lunch Stack';
      } else if (hour >= 17 && hour < 21) {
        suggestedName = 'Evening Stack';
      } else {
        suggestedName = 'My Stack';
      }
      setTemplateName(suggestedName);

      // Set items from pattern
      if (patternData.items) {
        setItems(
          patternData.items.map((item) => ({
            ...item,
            default_quantity: item.default_quantity || 1,
          }))
        );
      }

      // Set time range based on typical hour
      const typicalHour = patternData.typicalHour;
      if (typicalHour !== undefined) {
        if (typicalHour >= 6 && typicalHour < 11) {
          setTimeRange('06:00-10:59');
        } else if (typicalHour >= 11 && typicalHour < 14) {
          setTimeRange('11:00-13:59');
        } else if (typicalHour >= 14 && typicalHour < 18) {
          setTimeRange('14:00-17:59');
        } else if (typicalHour >= 18 && typicalHour < 22) {
          setTimeRange('18:00-21:59');
        } else {
          setTimeRange('22:00-05:59');
        }
      }
    }
  }, [patternData]);

  // Search for products/supplements to add
  const handleSearch = async (query) => {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      // Search product catalog
      const { data: products } = await supabase
        .from('product_catalog')
        .select('id, name, brand, category, form')
        .or(`name.ilike.%${query}%,brand.ilike.%${query}%`)
        .limit(10);

      // Also search recent voice_events for user's logged items
      const { data: recentEvents } = await supabase
        .from('voice_events')
        .select('event_data, event_type, product_catalog_id')
        .eq('user_id', user.id)
        .in('event_type', ['supplement', 'food', 'medication'])
        .order('event_time', { ascending: false })
        .limit(50);

      // Extract unique items from recent events
      const recentItems = new Map();
      recentEvents?.forEach((event) => {
        const name = event.event_data?.name || event.event_data?.description;
        if (name && name.toLowerCase().includes(query.toLowerCase())) {
          const key = event.product_catalog_id || normalizeProductKey(name);
          if (!recentItems.has(key)) {
            recentItems.set(key, {
              id: event.product_catalog_id,
              name: name,
              event_type: event.event_type,
              from_history: true,
            });
          }
        }
      });

      // Combine results, products first
      const combined = [
        ...(products || []).map((p) => ({
          id: p.id,
          name: p.name,
          brand: p.brand,
          event_type: p.category === 'food' ? 'food' : 'supplement',
          form: p.form,
        })),
        ...Array.from(recentItems.values()),
      ];

      setSearchResults(combined);
    } catch (error) {
      console.error('[CreateTemplate] Search error:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddItem = (item) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Check if already added
    const exists = items.some(
      (i) =>
        (i.product_id && i.product_id === item.id) ||
        normalizeProductKey(i.name) === normalizeProductKey(item.name)
    );

    if (exists) {
      Alert.alert('Already Added', 'This item is already in your template.');
      return;
    }

    setItems((prev) => [
      ...prev,
      {
        product_id: item.id || null,
        name: item.name,
        brand: item.brand,
        event_type: item.event_type || 'supplement',
        form: item.form,
        default_quantity: 1,
      },
    ]);

    setShowSearch(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleRemoveItem = (index) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleQuantityChange = (index, value) => {
    const numValue = parseFloat(value) || 0;
    setItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, default_quantity: numValue } : item
      )
    );
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
      Alert.alert('Items Required', 'Please add at least one item to your template.');
      return;
    }

    setIsSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      if (isPatternMode && patternData) {
        // Use existing pattern data to create template
        await createTemplateFromPattern(user.id, patternData, templateName.trim());
      } else {
        // Manual creation - build fingerprint and insert directly
        const fingerprint = items
          .map((item) => item.product_id || normalizeProductKey(item.name))
          .filter(Boolean)
          .sort()
          .join('|');

        const { error } = await supabase.from('user_meal_templates').insert({
          user_id: user.id,
          template_name: templateName.trim(),
          template_key: normalizeProductKey(templateName.trim()),
          fingerprint: fingerprint,
          items: items,
          typical_time_range: timeRange,
          times_logged: 0,
          first_logged_at: new Date().toISOString(),
          auto_generated: false,
        });

        if (error) throw error;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (error) {
      console.error('[CreateTemplate] Save error:', error);
      Alert.alert('Error', 'Failed to create template. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const getSelectedTimeSlot = () => {
    return TIME_SLOTS.find((slot) => slot.value === timeRange) || TIME_SLOTS[5];
  };

  if (!fontsLoaded) return null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Header
        title={isPatternMode ? 'Save as Template' : 'Create Template'}
        showCredits={false}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 20,
          paddingBottom: insets.bottom + 100,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Pattern Info Banner */}
        {isPatternMode && patternData && (
          <View
            style={{
              backgroundColor: colors.accentLilac,
              borderRadius: 12,
              padding: 16,
              marginBottom: 20,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <Text style={{ fontSize: 24 }}>🎯</Text>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 14,
                  fontFamily: 'Poppins_500Medium',
                  color: colors.text,
                  marginBottom: 2,
                }}
              >
                Pattern Detected!
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: 'Poppins_400Regular',
                  color: colors.textSecondary,
                }}
              >
                You've logged these {patternData.items?.length || 0} items together{' '}
                {patternData.occurrences || 2} times
              </Text>
            </View>
          </View>
        )}

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
            placeholder="e.g., Morning Vitamins, Lunch Stack"
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
              Suggested Time (optional)
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
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <Text
              style={{
                fontSize: 14,
                fontFamily: 'Poppins_500Medium',
                color: colors.textSecondary,
              }}
            >
              Items ({items.length})
            </Text>

            {!isPatternMode && (
              <TouchableOpacity
                onPress={() => setShowSearch(true)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  backgroundColor: colors.primary,
                  borderRadius: 8,
                }}
              >
                <Plus size={16} color={colors.background} />
                <Text
                  style={{
                    fontSize: 13,
                    fontFamily: 'Poppins_500Medium',
                    color: colors.background,
                  }}
                >
                  Add Item
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {items.length === 0 ? (
            <View
              style={{
                backgroundColor: colors.cardBackground,
                borderRadius: 12,
                padding: 24,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: colors.outline,
                borderStyle: 'dashed',
              }}
            >
              <Text
                style={{
                  fontSize: 14,
                  fontFamily: 'Poppins_400Regular',
                  color: colors.textSecondary,
                  textAlign: 'center',
                }}
              >
                No items added yet.{'\n'}Tap "Add Item" to search and add items.
              </Text>
            </View>
          ) : (
            items.map((item, index) => (
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
                    {(item.brand || item.event_type) && (
                      <Text
                        style={{
                          fontSize: 12,
                          fontFamily: 'Poppins_400Regular',
                          color: colors.textSecondary,
                        }}
                      >
                        {item.brand ? `${item.brand} • ` : ''}
                        {item.event_type || 'supplement'}
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
                      {item.form || item.units || 'units'}
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
            ))
          )}
        </View>
      </ScrollView>

      {/* Search Modal */}
      {showSearch && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.background,
            paddingTop: insets.top,
          }}
        >
          {/* Search Header */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: colors.outline,
              gap: 12,
            }}
          >
            <TouchableOpacity
              onPress={() => {
                setShowSearch(false);
                setSearchQuery('');
                setSearchResults([]);
              }}
            >
              <X size={24} color={colors.text} />
            </TouchableOpacity>

            <View
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: colors.cardBackground,
                borderRadius: 12,
                paddingHorizontal: 12,
                borderWidth: 1,
                borderColor: colors.outline,
              }}
            >
              <Search size={18} color={colors.textSecondary} />
              <TextInput
                value={searchQuery}
                onChangeText={handleSearch}
                placeholder="Search supplements, foods..."
                placeholderTextColor={colors.textSecondary}
                autoFocus
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  paddingHorizontal: 10,
                  fontSize: 15,
                  fontFamily: 'Poppins_400Regular',
                  color: colors.text,
                }}
              />
            </View>
          </View>

          {/* Search Results */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16 }}
            keyboardShouldPersistTaps="handled"
          >
            {isSearching ? (
              <ActivityIndicator
                size="large"
                color={colors.primary}
                style={{ marginTop: 40 }}
              />
            ) : searchResults.length === 0 && searchQuery.length >= 2 ? (
              <View style={{ alignItems: 'center', marginTop: 40 }}>
                <Text
                  style={{
                    fontSize: 14,
                    fontFamily: 'Poppins_400Regular',
                    color: colors.textSecondary,
                  }}
                >
                  No results found for "{searchQuery}"
                </Text>

                {/* Option to add custom item */}
                <TouchableOpacity
                  onPress={() =>
                    handleAddItem({
                      name: searchQuery,
                      event_type: 'supplement',
                    })
                  }
                  style={{
                    marginTop: 16,
                    paddingHorizontal: 20,
                    paddingVertical: 12,
                    backgroundColor: colors.primary,
                    borderRadius: 12,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 14,
                      fontFamily: 'Poppins_500Medium',
                      color: colors.background,
                    }}
                  >
                    Add "{searchQuery}" anyway
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              searchResults.map((item, index) => (
                <TouchableOpacity
                  key={`${item.id || index}-${item.name}`}
                  onPress={() => handleAddItem(item)}
                  style={{
                    backgroundColor: colors.cardBackground,
                    borderRadius: 12,
                    padding: 14,
                    marginBottom: 10,
                    flexDirection: 'row',
                    alignItems: 'center',
                    borderWidth: 1,
                    borderColor: colors.outline,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: 15,
                        fontFamily: 'Poppins_500Medium',
                        color: colors.text,
                      }}
                    >
                      {item.name}
                    </Text>
                    <Text
                      style={{
                        fontSize: 12,
                        fontFamily: 'Poppins_400Regular',
                        color: colors.textSecondary,
                      }}
                    >
                      {item.brand ? `${item.brand} • ` : ''}
                      {item.event_type}
                      {item.from_history ? ' • From your history' : ''}
                    </Text>
                  </View>
                  <Plus size={20} color={colors.primary} />
                </TouchableOpacity>
              ))
            )}

            {searchQuery.length < 2 && (
              <Text
                style={{
                  fontSize: 14,
                  fontFamily: 'Poppins_400Regular',
                  color: colors.textSecondary,
                  textAlign: 'center',
                  marginTop: 40,
                }}
              >
                Type at least 2 characters to search
              </Text>
            )}
          </ScrollView>
        </View>
      )}

      {/* Bottom Save Button */}
      {!showSearch && (
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
            disabled={isSaving || !templateName.trim() || items.length === 0}
            style={{
              backgroundColor:
                templateName.trim() && items.length > 0
                  ? colors.primary
                  : colors.outline,
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
                <Ionicons
                  name="bookmark"
                  size={20}
                  color={
                    templateName.trim() && items.length > 0
                      ? colors.background
                      : colors.textSecondary
                  }
                />
                <Text
                  style={{
                    fontSize: 16,
                    fontFamily: 'Poppins_600SemiBold',
                    color:
                      templateName.trim() && items.length > 0
                        ? colors.background
                        : colors.textSecondary,
                  }}
                >
                  {isPatternMode ? 'Save Template' : 'Create Template'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
