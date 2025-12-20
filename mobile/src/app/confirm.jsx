import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/components/useColors';
import Header from '@/components/Header';
import * as Haptics from 'expo-haptics';
import { createVoiceEvent, updateAuditStatus } from '@/utils/voiceEventParser';
import { calculateEventTime } from '@/utils/geminiParser';
import useUser from '@/utils/auth/useUser';
import { supabase } from '@/utils/supabaseClient';
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
  const productOptions = params.productOptions ? JSON.parse(params.productOptions) : null;
  const confidence = params.confidence ? parseInt(params.confidence) : null;
  const metadata = params.metadata ? JSON.parse(params.metadata) : null;

  const [selectedProduct, setSelectedProduct] = useState(null);
  const [finalEventData, setFinalEventData] = useState(parsedData?.event_data || {});

  // Follow-up mode state for photo-based multi-item supplements
  const [followUpMode, setFollowUpMode] = useState(false);
  const [followUpQuestion, setFollowUpQuestion] = useState(null);
  const [followUpAnswer, setFollowUpAnswer] = useState('');
  const [followUpField, setFollowUpField] = useState(null);
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  const [detectedItems, setDetectedItems] = useState([]);

  useEffect(() => {
    // Detect follow-up mode from route params (photo-based multi-item supplements)
    if (metadata?.detected_items && Array.isArray(metadata.detected_items)) {
      setFollowUpMode(true);
      setDetectedItems(metadata.detected_items);
      if (metadata.detected_items.length > 0) {
        const firstItem = metadata.detected_items[0];
        setFollowUpQuestion(firstItem.followUpQuestion);
        setFollowUpField('dosage');
      }
    }
  }, [metadata]);

  useEffect(() => {
    // If a product is selected, update the event data with its nutritional info
    if (selectedProduct && selectedProduct !== 'manual') {
      const product = productOptions[selectedProduct];
      const updatedData = { ...parsedData.event_data };

      if (parsedData.event_type === 'food') {
        updatedData.description = `${product.brand ? product.brand + ' ' : ''}${product.name}`;
        if (product.nutrients?.calories) updatedData.calories = product.nutrients.calories;
        if (product.nutrients?.protein) updatedData.protein = product.nutrients.protein;
        if (product.nutrients?.carbs) updatedData.carbs = product.nutrients.carbs;
        if (product.nutrients?.fat) updatedData.fat = product.nutrients.fat;
        if (product.servingSize) updatedData.serving_size = product.servingSize;
      } else if (parsedData.event_type === 'supplement' || parsedData.event_type === 'medication') {
        updatedData.name = `${product.brand ? product.brand + ' ' : ''}${product.name}`;
      }

      setFinalEventData(updatedData);
    } else {
      setFinalEventData(parsedData?.event_data || {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProduct, selectedProduct ? productOptions[selectedProduct] : null]);

  const handleConfirm = async () => {
    try {
      // Handle follow-up mode for photo-based multi-item supplements
      if (followUpMode && followUpAnswer.trim()) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

        const { handleFollowUpResponse } = require('@/utils/photoEventParser');
        const result = await handleFollowUpResponse(
          auditId,
          currentItemIndex,
          followUpAnswer,
          user.id
        );

        if (!result.success) {
          Alert.alert('Error', result.error || 'Failed to save event. Please try again.');
          return;
        }

        // Check if there are more items to process
        if (currentItemIndex < detectedItems.length - 1) {
          // Move to next item
          const nextIndex = currentItemIndex + 1;
          const nextItem = detectedItems[nextIndex];
          setCurrentItemIndex(nextIndex);
          setFollowUpQuestion(nextItem.followUpQuestion);
          setFollowUpAnswer('');
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          // All items processed - update audit status and navigate back
          await updateAuditStatus(auditId, 'awaiting_user_clarification_success');
          Alert.alert('Success', `All ${detectedItems.length} supplement(s) saved successfully!`, [
            { text: 'OK', onPress: () => router.back() }
          ]);
        }
        return;
      }

      // Original confirmation flow for non-photo events
      // If product options exist (not null/undefined) and has items, require selection
      if (productOptions && Array.isArray(productOptions) && productOptions.length > 0 && selectedProduct === null) {
        Alert.alert('Selection Required', 'Please select a product from the list or choose "Other" to proceed.');
        return;
      }

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // Phase 4: Capture classification corrections
      // If user selected a product and its event_type differs from AI classification, log it
      if (selectedProduct && productOptions && productOptions.length > 0) {
        // Determine the event_type of the selected product
        const selectedProductEventType = selectedProduct.event_type ||
                                          selectedProduct.database_category ||
                                          parsedData.event_type;

        // Check if user corrected AI's classification
        if (selectedProductEventType !== parsedData.event_type) {
          try {
            // Get original user input from metadata
            const userInput = metadata?.original_input || params.userInput || '';

            // Log the classification correction
            await supabase.from('classification_corrections').insert({
              user_id: user.id,
              user_input: userInput,
              ai_event_type: parsedData.event_type,
              ai_confidence: confidence,
              corrected_event_type: selectedProductEventType,
              selected_product_id: selectedProduct.id,
              selected_product_name: selectedProduct.name,
              selected_product_brand: selectedProduct.brand,
              voice_record_audit_id: auditId
            });

            console.log(`Captured classification correction: ${parsedData.event_type} -> ${selectedProductEventType}`);
          } catch (correctionError) {
            // Don't block the flow if correction logging fails
            console.error('Error logging classification correction:', correctionError);
          }
        }
      }

      // Calculate actual event time from time_info
      const eventTime = calculateEventTime(parsedData.time_info);

      // Save the event with the final event data (potentially updated with selected product)
      await createVoiceEvent(
        user.id,
        parsedData.event_type,
        finalEventData,
        eventTime,
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
        {/* Product Search Results Section */}
        {productOptions && Array.isArray(productOptions) && productOptions.length === 0 && (
          <View
            style={{
              backgroundColor: colors.cardBackground,
              borderRadius: 16,
              padding: 20,
              borderWidth: 1,
              borderColor: colors.outline,
              marginBottom: 16,
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
              No products found in database. Please verify the information below.
            </Text>
          </View>
        )}

        {/* Product Selection Section */}
        {productOptions && productOptions.length > 0 && (
          <View
            style={{
              backgroundColor: colors.cardBackground,
              borderRadius: 16,
              padding: 20,
              borderWidth: 1,
              borderColor: colors.primary,
              marginBottom: 16,
            }}
          >
            <Text
              style={{
                fontSize: 16,
                fontFamily: 'Poppins_600SemiBold',
                color: colors.text,
                marginBottom: 8,
              }}
            >
              Select Product
            </Text>

            {confidence !== null && (
              <Text
                style={{
                  fontSize: 13,
                  fontFamily: 'Poppins_400Regular',
                  color: colors.textSecondary,
                  marginBottom: 16,
                }}
              >
                Parsing confidence: {confidence}% - Please verify the product
              </Text>
            )}

            {productOptions.map((product, index) => (
              <TouchableOpacity
                key={`${product.source}-${product.id}`}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setSelectedProduct(index);
                }}
                style={{
                  backgroundColor: selectedProduct === index ? colors.accentLilac : colors.background,
                  borderRadius: 12,
                  padding: 14,
                  marginBottom: 10,
                  borderWidth: 2,
                  borderColor: selectedProduct === index ? colors.primary : colors.outline,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: 15,
                        fontFamily: 'Poppins_600SemiBold',
                        color: colors.text,
                        marginBottom: 4,
                      }}
                    >
                      {product.brand ? `${product.brand} - ${product.name}` : product.name}
                    </Text>
                    {product.servingSize && (
                      <Text
                        style={{
                          fontSize: 13,
                          fontFamily: 'Poppins_400Regular',
                          color: colors.textSecondary,
                          marginBottom: 6,
                        }}
                      >
                        Serving: {product.servingSize}
                      </Text>
                    )}
                    {product.nutrients && (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {product.nutrients.calories && typeof product.nutrients.calories === 'number' && (
                          <Text style={{ fontSize: 12, fontFamily: 'Poppins_400Regular', color: colors.textSecondary }}>
                            Cal: {Math.round(product.nutrients.calories)}
                          </Text>
                        )}
                        {product.nutrients.protein && typeof product.nutrients.protein === 'number' && (
                          <Text style={{ fontSize: 12, fontFamily: 'Poppins_400Regular', color: colors.textSecondary }}>
                            P: {Math.round(product.nutrients.protein)}g
                          </Text>
                        )}
                        {product.nutrients.carbs && typeof product.nutrients.carbs === 'number' && (
                          <Text style={{ fontSize: 12, fontFamily: 'Poppins_400Regular', color: colors.textSecondary }}>
                            C: {Math.round(product.nutrients.carbs)}g
                          </Text>
                        )}
                        {product.nutrients.fat && typeof product.nutrients.fat === 'number' && (
                          <Text style={{ fontSize: 12, fontFamily: 'Poppins_400Regular', color: colors.textSecondary }}>
                            F: {Math.round(product.nutrients.fat)}g
                          </Text>
                        )}
                      </View>
                    )}
                  </View>
                  <View
                    style={{
                      backgroundColor: product.confidence >= 80 ? colors.primary : product.confidence >= 60 ? colors.accentYellow : colors.outline,
                      borderRadius: 8,
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      marginLeft: 8,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        fontFamily: 'Poppins_600SemiBold',
                        color: product.confidence >= 60 ? colors.background : colors.text,
                      }}
                    >
                      {product.confidence}%
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSelectedProduct('manual');
              }}
              style={{
                backgroundColor: selectedProduct === 'manual' ? colors.accentLilac : colors.background,
                borderRadius: 12,
                padding: 14,
                borderWidth: 2,
                borderColor: selectedProduct === 'manual' ? colors.primary : colors.outline,
                alignItems: 'center',
              }}
            >
              <Text
                style={{
                  fontSize: 14,
                  fontFamily: 'Poppins_600SemiBold',
                  color: colors.text,
                }}
              >
                Other (use original input)
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Event Data Section */}
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

          {/* Follow-up Question UI for Photo-Based Multi-Item Supplements */}
          {followUpMode && followUpQuestion && (
            <View
              style={{
                backgroundColor: colors.accentLilac,
                borderRadius: 16,
                padding: 20,
                marginBottom: 16,
              }}
            >
              <Text
                style={{
                  fontSize: 16,
                  fontFamily: 'Poppins_600SemiBold',
                  color: colors.primary,
                  marginBottom: 4,
                }}
              >
                {detectedItems.length > 1 && `Item ${currentItemIndex + 1} of ${detectedItems.length}`}
              </Text>
              <Text
                style={{
                  fontSize: 15,
                  fontFamily: 'Poppins_400Regular',
                  color: colors.text,
                  marginBottom: 16,
                }}
              >
                {followUpQuestion}
              </Text>

              {/* Quick selection buttons for common quantities */}
              <View
                style={{
                  flexDirection: 'row',
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                {[1, 2, 3].map((num) => (
                  <TouchableOpacity
                    key={num}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setFollowUpAnswer(num.toString());
                    }}
                    style={{
                      flex: 1,
                      backgroundColor:
                        followUpAnswer === num.toString()
                          ? colors.primary
                          : colors.background,
                      borderRadius: 12,
                      padding: 16,
                      alignItems: 'center',
                      borderWidth: 2,
                      borderColor:
                        followUpAnswer === num.toString()
                          ? colors.primary
                          : colors.border,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 18,
                        fontFamily: 'Poppins_600SemiBold',
                        color:
                          followUpAnswer === num.toString()
                            ? colors.background
                            : colors.text,
                      }}
                    >
                      {num}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Text input for other amounts */}
              <TextInput
                style={{
                  backgroundColor: colors.background,
                  borderRadius: 12,
                  padding: 12,
                  fontSize: 15,
                  fontFamily: 'Poppins_400Regular',
                  color: colors.text,
                  borderWidth: 2,
                  borderColor: colors.border,
                }}
                placeholder="Other amount..."
                placeholderTextColor={colors.textSecondary}
                value={followUpAnswer}
                onChangeText={setFollowUpAnswer}
                keyboardType="numeric"
              />
            </View>
          )}

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
            {Object.entries(finalEventData).map(([key, value]) => (
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
                    flex: 1,
                    textAlign: 'right',
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
