/**
 * Templates Management Screen
 *
 * Lists all user's meal templates with options to:
 * - Quick log a template
 * - Edit template details
 * - Delete templates
 * - Create new templates manually
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ChevronRight, Plus, Trash2, Clock, Zap } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/components/useColors';
import Header from '@/components/Header';
import useUser from '@/utils/auth/useUser';
import { getUserTemplates, deleteTemplate } from '@/utils/mealPatterns';
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
} from '@expo-google-fonts/poppins';

export default function TemplatesScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const router = useRouter();
  const { data: user } = useUser();

  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
  });

  const [templates, setTemplates] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadTemplates = useCallback(async () => {
    if (!user?.id) return;

    try {
      const data = await getUserTemplates(user.id);
      setTemplates(data);
    } catch (error) {
      console.error('[TemplatesScreen] Error loading templates:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadTemplates();
    }, [loadTemplates])
  );

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadTemplates();
  };

  const handleQuickLog = (template) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push({
      pathname: '/template-confirm',
      params: { template: JSON.stringify(template) },
    });
  };

  const handleEdit = (template) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/edit-template',
      params: { templateId: template.id },
    });
  };

  const handleDelete = (template) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Delete Template',
      `Are you sure you want to delete "${template.template_name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const success = await deleteTemplate(template.id, user.id);
            if (success) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setTemplates((prev) => prev.filter((t) => t.id !== template.id));
            } else {
              Alert.alert('Error', 'Failed to delete template. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleCreateNew = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/create-template');
  };

  const formatTimeRange = (timeRange) => {
    if (!timeRange) return 'Any time';
    const [start, end] = timeRange.split('-');
    const formatHour = (time) => {
      const hour = parseInt(time.split(':')[0], 10);
      if (hour === 0) return '12 AM';
      if (hour < 12) return `${hour} AM`;
      if (hour === 12) return '12 PM';
      return `${hour - 12} PM`;
    };
    return `${formatHour(start)} - ${formatHour(end)}`;
  };

  if (!fontsLoaded) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Header title="My Templates" showCredits={false} />

      {isLoading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: insets.bottom + 100,
          }}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
        >
          {/* Info Card */}
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
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: colors.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Zap size={20} color={colors.background} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 14,
                  fontFamily: 'Poppins_500Medium',
                  color: colors.text,
                  marginBottom: 2,
                }}
              >
                Quick Log Templates
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: 'Poppins_400Regular',
                  color: colors.textSecondary,
                }}
              >
                Templates are auto-created from your logging patterns
              </Text>
            </View>
          </View>

          {templates.length === 0 ? (
            <View
              style={{
                backgroundColor: colors.cardBackground,
                borderRadius: 16,
                padding: 32,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: colors.outline,
              }}
            >
              <Text style={{ fontSize: 48, marginBottom: 16 }}>📋</Text>
              <Text
                style={{
                  fontSize: 18,
                  fontFamily: 'Poppins_600SemiBold',
                  color: colors.text,
                  textAlign: 'center',
                  marginBottom: 8,
                }}
              >
                No Templates Yet
              </Text>
              <Text
                style={{
                  fontSize: 14,
                  fontFamily: 'Poppins_400Regular',
                  color: colors.textSecondary,
                  textAlign: 'center',
                  lineHeight: 22,
                }}
              >
                Templates will appear automatically when you log the same items together multiple times.
              </Text>
            </View>
          ) : (
            <>
              {/* Templates List */}
              {templates.map((template) => (
                <View
                  key={template.id}
                  style={{
                    backgroundColor: colors.cardBackground,
                    borderRadius: 16,
                    marginBottom: 12,
                    borderWidth: 1,
                    borderColor: colors.outline,
                    overflow: 'hidden',
                  }}
                >
                  {/* Template Header - Tap to Edit */}
                  <TouchableOpacity
                    onPress={() => handleEdit(template)}
                    style={{
                      padding: 16,
                      flexDirection: 'row',
                      alignItems: 'center',
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 8,
                          marginBottom: 4,
                        }}
                      >
                        <Text style={{ fontSize: 18 }}>⚡</Text>
                        <Text
                          style={{
                            fontSize: 17,
                            fontFamily: 'Poppins_600SemiBold',
                            color: colors.text,
                          }}
                        >
                          {template.template_name}
                        </Text>
                      </View>

                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 12,
                        }}
                      >
                        <View
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                        >
                          <Clock size={14} color={colors.textSecondary} />
                          <Text
                            style={{
                              fontSize: 13,
                              fontFamily: 'Poppins_400Regular',
                              color: colors.textSecondary,
                            }}
                          >
                            {formatTimeRange(template.typical_time_range)}
                          </Text>
                        </View>

                        <Text
                          style={{
                            fontSize: 13,
                            fontFamily: 'Poppins_400Regular',
                            color: colors.textSecondary,
                          }}
                        >
                          {template.items?.length || 0} items
                        </Text>

                        {template.times_logged > 0 && (
                          <Text
                            style={{
                              fontSize: 13,
                              fontFamily: 'Poppins_400Regular',
                              color: colors.textSecondary,
                            }}
                          >
                            Used {template.times_logged}x
                          </Text>
                        )}
                      </View>
                    </View>

                    <ChevronRight size={20} color={colors.textSecondary} />
                  </TouchableOpacity>

                  {/* Items Preview */}
                  <View
                    style={{
                      borderTopWidth: 1,
                      borderTopColor: colors.outline,
                      paddingHorizontal: 16,
                      paddingVertical: 12,
                      backgroundColor: colors.background,
                    }}
                  >
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {template.items?.slice(0, 4).map((item, idx) => (
                        <View
                          key={idx}
                          style={{
                            backgroundColor: colors.cardBackground,
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: colors.outline,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 12,
                              fontFamily: 'Poppins_400Regular',
                              color: colors.text,
                            }}
                          >
                            {item.name}
                          </Text>
                        </View>
                      ))}
                      {template.items?.length > 4 && (
                        <View
                          style={{
                            backgroundColor: colors.accentLilac,
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            borderRadius: 8,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 12,
                              fontFamily: 'Poppins_500Medium',
                              color: colors.primary,
                            }}
                          >
                            +{template.items.length - 4} more
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Action Buttons */}
                  <View
                    style={{
                      flexDirection: 'row',
                      borderTopWidth: 1,
                      borderTopColor: colors.outline,
                    }}
                  >
                    <TouchableOpacity
                      onPress={() => handleQuickLog(template)}
                      style={{
                        flex: 1,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        paddingVertical: 14,
                        gap: 8,
                        backgroundColor: colors.primary,
                      }}
                    >
                      <Ionicons name="flash" size={18} color={colors.background} />
                      <Text
                        style={{
                          fontSize: 14,
                          fontFamily: 'Poppins_600SemiBold',
                          color: colors.background,
                        }}
                      >
                        Quick Log
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => handleDelete(template)}
                      style={{
                        paddingHorizontal: 20,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderLeftWidth: 1,
                        borderLeftColor: colors.outline,
                      }}
                    >
                      <Trash2 size={20} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}

      {/* Floating Create Button */}
      <TouchableOpacity
        onPress={handleCreateNew}
        style={{
          position: 'absolute',
          bottom: insets.bottom + 24,
          right: 20,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: colors.primary,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 8,
          elevation: 5,
        }}
      >
        <Plus size={28} color={colors.background} />
      </TouchableOpacity>
    </View>
  );
}
