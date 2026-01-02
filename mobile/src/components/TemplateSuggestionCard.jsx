/**
 * TemplateSuggestionCard - Shows template suggestions on home screen
 *
 * Displays when:
 * - User has templates matching current time of day
 * - Template hasn't been logged today
 *
 * Features:
 * - Shows template name and item count
 * - One-tap to log all items
 * - Dismiss button
 * - Subtle animation on mount
 */

import React from 'react';
import { View, Text, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/components/useColors';
import * as Haptics from 'expo-haptics';
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
} from '@expo-google-fonts/poppins';

export default function TemplateSuggestionCard({
  template,
  onAccept,
  onDismiss,
  style,
}) {
  const colors = useColors();
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
  });

  // Animated entry
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const slideAnim = React.useRef(new Animated.Value(20)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  if (!template || !fontsLoaded) return null;

  const itemCount = template.items?.length || 0;
  const itemNames = template.items?.slice(0, 3).map(i => i.name) || [];

  const handleAccept = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onAccept?.(template);
  };

  const handleDismiss = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onDismiss?.(template);
  };

  return (
    <Animated.View
      style={[
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        },
        style,
      ]}
    >
      <View
        style={{
          backgroundColor: colors.cardBackground,
          borderRadius: 16,
          padding: 16,
          borderWidth: 2,
          borderColor: colors.primary,
          shadowColor: colors.primary,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.1,
          shadowRadius: 8,
          elevation: 3,
        }}
      >
        {/* Header Row */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 12,
          }}
        >
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Text style={{ fontSize: 18 }}>⚡</Text>
              <Text
                style={{
                  fontSize: 16,
                  fontFamily: 'Poppins_600SemiBold',
                  color: colors.text,
                }}
              >
                Quick Log
              </Text>
            </View>
            <Text
              style={{
                fontSize: 18,
                fontFamily: 'Poppins_600SemiBold',
                color: colors.primary,
              }}
            >
              {template.template_name}
            </Text>
          </View>

          {/* Dismiss Button */}
          <TouchableOpacity
            onPress={handleDismiss}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{
              padding: 4,
            }}
          >
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Items Preview */}
        <View
          style={{
            backgroundColor: colors.background,
            borderRadius: 12,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <Text
            style={{
              fontSize: 13,
              fontFamily: 'Poppins_500Medium',
              color: colors.textSecondary,
              marginBottom: 8,
            }}
          >
            {itemCount} item{itemCount !== 1 ? 's' : ''}
          </Text>

          <View style={{ gap: 6 }}>
            {itemNames.map((name, index) => (
              <View
                key={index}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <View
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 3,
                    backgroundColor: colors.primary,
                  }}
                />
                <Text
                  style={{
                    fontSize: 14,
                    fontFamily: 'Poppins_400Regular',
                    color: colors.text,
                  }}
                  numberOfLines={1}
                >
                  {name}
                </Text>
              </View>
            ))}
            {itemCount > 3 && (
              <Text
                style={{
                  fontSize: 13,
                  fontFamily: 'Poppins_400Regular',
                  color: colors.textSecondary,
                  marginLeft: 13,
                }}
              >
                +{itemCount - 3} more
              </Text>
            )}
          </View>
        </View>

        {/* Action Button */}
        <TouchableOpacity
          onPress={handleAccept}
          style={{
            backgroundColor: colors.primary,
            borderRadius: 12,
            paddingVertical: 14,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <Ionicons name="flash" size={20} color={colors.background} />
          <Text
            style={{
              fontSize: 15,
              fontFamily: 'Poppins_600SemiBold',
              color: colors.background,
            }}
          >
            Log Now
          </Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}
