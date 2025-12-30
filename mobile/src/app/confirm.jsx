import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, TextInput, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/components/useColors';
import Header from '@/components/Header';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { createVoiceEvent, updateAuditStatus } from '@/utils/voiceEventParser';
import { calculateEventTime } from '@/utils/geminiParser';
import useUser from '@/utils/auth/useUser';
import { supabase } from '@/utils/supabaseClient';
import { processNutritionLabelPhoto, confirmAndAddToCatalog, buildSupplementEventData } from '@/utils/photoEventParser';
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

  // Nutrition label capture flow state
  const [requiresNutritionLabel, setRequiresNutritionLabel] = useState(false);
  const [nutritionLabelStep, setNutritionLabelStep] = useState('capture'); // 'capture', 'processing', 'confirm', 'quantity'
  const [extractedProductData, setExtractedProductData] = useState(null);
  const [catalogProduct, setCatalogProduct] = useState(null);
  const [isProcessingLabel, setIsProcessingLabel] = useState(false);
  const [editableProductData, setEditableProductData] = useState(null);
  const [quantityInput, setQuantityInput] = useState('');
  const [labelPhotoUrl, setLabelPhotoUrl] = useState(null);

  // Detect if we need nutrition label capture - only set initial state once
  useEffect(() => {
    if (metadata?.requires_nutrition_label && !requiresNutritionLabel) {
      setRequiresNutritionLabel(true);
      setNutritionLabelStep('capture');
    }
  }, [metadata, requiresNutritionLabel]);

  useEffect(() => {
    // Detect follow-up mode from route params (photo-based supplements)
    if (metadata?.follow_up_question) {
      setFollowUpMode(true);
      setFollowUpQuestion(metadata.follow_up_question);
      setFollowUpField(metadata.follow_up_field || 'quantity');
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
      // Handle follow-up mode for photo-based supplements
      if (followUpMode && followUpAnswer.trim()) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

        const { handleFollowUpResponse } = require('@/utils/photoEventParser');
        const result = await handleFollowUpResponse(
          auditId,
          followUpAnswer,
          user.id
        );

        if (!result.success) {
          Alert.alert('Error', result.error || 'Failed to save event. Please try again.');
          return;
        }

        if (result.complete) {
          // Event saved successfully
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert('Success', 'Event saved successfully!', [
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

  // Nutrition label capture handler
  const handleCaptureNutritionLabel = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsEditing: false,
      });

      if (result.canceled) {
        return;
      }

      const labelPhotoUri = result.assets[0].uri;
      setNutritionLabelStep('processing');
      setIsProcessingLabel(true);

      // Process the nutrition label photo
      const detectedItem = metadata?.detected_item;
      const frontPhotoUrl = metadata?.photo_url;

      const geminiApiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
      if (!geminiApiKey) {
        setIsProcessingLabel(false);
        Alert.alert('Error', 'Gemini API key not configured.');
        setNutritionLabelStep('capture');
        return;
      }

      const processResult = await processNutritionLabelPhoto(
        labelPhotoUri,
        detectedItem,
        frontPhotoUrl,
        auditId,
        user.id,
        geminiApiKey
      );

      setIsProcessingLabel(false);

      if (!processResult.success) {
        if (processResult.needsRetake) {
          Alert.alert(
            'Could Not Read Label',
            'We couldn\'t extract the nutrition information. Please take another photo with better lighting and ensure the label is clearly visible.',
            [{ text: 'Try Again', onPress: () => setNutritionLabelStep('capture') }]
          );
          return;
        }
        Alert.alert('Error', processResult.error || 'Failed to process nutrition label.');
        setNutritionLabelStep('capture');
        return;
      }

      // Set extracted data for confirmation
      setExtractedProductData(processResult.extractedData);
      setLabelPhotoUrl(processResult.labelPhotoUrl);
      setEditableProductData({
        product_name: processResult.extractedData.product_name || detectedItem?.name || '',
        brand: processResult.extractedData.brand || detectedItem?.brand || '',
        serving_quantity: processResult.extractedData.serving_quantity?.toString() || '1',
        serving_unit: processResult.extractedData.serving_unit || 'serving',
        serving_weight_grams: processResult.extractedData.serving_weight_grams?.toString() || '',
      });
      setNutritionLabelStep('confirm');
    } catch (error) {
      console.error('Error capturing nutrition label:', error);
      setIsProcessingLabel(false);
      Alert.alert('Error', 'Failed to capture nutrition label. Please try again.');
      setNutritionLabelStep('capture');
    }
  };

  // Confirm extracted product data and add to catalog
  const handleConfirmProductData = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // Build product data with user edits
      const productData = {
        ...extractedProductData,
        product_name: editableProductData.product_name,
        brand: editableProductData.brand,
        serving_quantity: parseFloat(editableProductData.serving_quantity) || 1,
        serving_unit: editableProductData.serving_unit,
        serving_weight_grams: editableProductData.serving_weight_grams
          ? parseFloat(editableProductData.serving_weight_grams)
          : null,
        front_photo_url: metadata?.photo_url,
        label_photo_url: labelPhotoUrl,
      };

      const result = await confirmAndAddToCatalog(productData, auditId, user.id);

      if (!result.success) {
        Alert.alert('Error', result.error || 'Failed to add product to catalog.');
        return;
      }

      setCatalogProduct(result.catalogProduct);
      setNutritionLabelStep('quantity');
    } catch (error) {
      console.error('Error confirming product data:', error);
      Alert.alert('Error', 'Failed to save product. Please try again.');
    }
  };

  // Handle quantity input and create final event
  const handleQuantityConfirm = async () => {
    try {
      const quantity = parseFloat(quantityInput);
      if (!quantity || quantity <= 0) {
        Alert.alert('Invalid Quantity', 'Please enter a valid quantity.');
        return;
      }

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // Build event data with calculated nutrients
      const eventData = buildSupplementEventData(
        catalogProduct,
        quantity,
        false, // not manual override
        null,  // no user-edited nutrients
        metadata?.detected_item
      );

      // Create the voice event
      const eventTime = new Date().toISOString();
      await createVoiceEvent(
        user.id,
        parsedData?.event_type || 'supplement',
        eventData,
        eventTime,
        auditId,
        'photo'
      );

      await updateAuditStatus(auditId, 'awaiting_user_clarification_success');

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Success', 'Event saved successfully!', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (error) {
      console.error('Error saving event with quantity:', error);
      Alert.alert('Error', 'Failed to save event. Please try again.');
    }
  };

  // Format micros for display
  const formatMicros = (micros) => {
    if (!micros || typeof micros !== 'object') return [];
    return Object.entries(micros).map(([key, value]) => ({
      name: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '),
      amount: value.amount,
      unit: value.unit
    }));
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
        {/* Nutrition Label Capture Flow */}
        {requiresNutritionLabel && nutritionLabelStep === 'capture' && (
          <View
            style={{
              backgroundColor: colors.cardBackground,
              borderRadius: 16,
              padding: 24,
              borderWidth: 2,
              borderColor: colors.primary,
              marginBottom: 24,
            }}
          >
            <Text
              style={{
                fontSize: 18,
                fontFamily: 'Poppins_600SemiBold',
                color: colors.text,
                marginBottom: 8,
                textAlign: 'center',
              }}
            >
              New Product Detected
            </Text>

            {metadata?.detected_item && (
              <Text
                style={{
                  fontSize: 16,
                  fontFamily: 'Poppins_500Medium',
                  color: colors.primary,
                  marginBottom: 16,
                  textAlign: 'center',
                }}
              >
                {metadata.detected_item.brand} {metadata.detected_item.name}
              </Text>
            )}

            <Text
              style={{
                fontSize: 14,
                fontFamily: 'Poppins_400Regular',
                color: colors.textSecondary,
                marginBottom: 24,
                textAlign: 'center',
              }}
            >
              To save this product to your catalog, please take a photo of the nutrition label or supplement facts panel.
            </Text>

            <TouchableOpacity
              onPress={handleCaptureNutritionLabel}
              style={{
                backgroundColor: colors.primary,
                borderRadius: 16,
                padding: 16,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Text style={{ fontSize: 24 }}>📷</Text>
              <Text
                style={{
                  fontSize: 16,
                  fontFamily: 'Poppins_600SemiBold',
                  color: colors.background,
                }}
              >
                Take Photo of Label
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleCancel}
              style={{
                marginTop: 16,
                padding: 12,
                alignItems: 'center',
              }}
            >
              <Text
                style={{
                  fontSize: 14,
                  fontFamily: 'Poppins_500Medium',
                  color: colors.textSecondary,
                }}
              >
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Processing State */}
        {requiresNutritionLabel && nutritionLabelStep === 'processing' && (
          <View
            style={{
              backgroundColor: colors.cardBackground,
              borderRadius: 16,
              padding: 48,
              borderWidth: 1,
              borderColor: colors.outline,
              marginBottom: 24,
              alignItems: 'center',
            }}
          >
            <ActivityIndicator size="large" color={colors.primary} />
            <Text
              style={{
                fontSize: 16,
                fontFamily: 'Poppins_500Medium',
                color: colors.text,
                marginTop: 16,
                textAlign: 'center',
              }}
            >
              Analyzing nutrition label...
            </Text>
            <Text
              style={{
                fontSize: 14,
                fontFamily: 'Poppins_400Regular',
                color: colors.textSecondary,
                marginTop: 8,
                textAlign: 'center',
              }}
            >
              Extracting serving size and nutrients
            </Text>
          </View>
        )}

        {/* Confirm Extracted Data */}
        {requiresNutritionLabel && nutritionLabelStep === 'confirm' && editableProductData && (
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
              Confirm Product Details
            </Text>

            <Text
              style={{
                fontSize: 14,
                fontFamily: 'Poppins_400Regular',
                color: colors.textSecondary,
                marginBottom: 16,
              }}
            >
              Please verify and correct the extracted information.
            </Text>

            {/* Product Name */}
            <Text style={{ fontSize: 13, fontFamily: 'Poppins_500Medium', color: colors.textSecondary, marginBottom: 4 }}>
              Product Name
            </Text>
            <TextInput
              style={{
                backgroundColor: colors.background,
                borderRadius: 12,
                padding: 12,
                fontSize: 15,
                fontFamily: 'Poppins_400Regular',
                color: colors.text,
                borderWidth: 1,
                borderColor: colors.outline,
                marginBottom: 12,
              }}
              value={editableProductData.product_name}
              onChangeText={(text) => setEditableProductData(prev => ({ ...prev, product_name: text }))}
            />

            {/* Brand */}
            <Text style={{ fontSize: 13, fontFamily: 'Poppins_500Medium', color: colors.textSecondary, marginBottom: 4 }}>
              Brand
            </Text>
            <TextInput
              style={{
                backgroundColor: colors.background,
                borderRadius: 12,
                padding: 12,
                fontSize: 15,
                fontFamily: 'Poppins_400Regular',
                color: colors.text,
                borderWidth: 1,
                borderColor: colors.outline,
                marginBottom: 12,
              }}
              value={editableProductData.brand}
              onChangeText={(text) => setEditableProductData(prev => ({ ...prev, brand: text }))}
            />

            {/* Serving Size Row */}
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontFamily: 'Poppins_500Medium', color: colors.textSecondary, marginBottom: 4 }}>
                  Serving Size
                </Text>
                <TextInput
                  style={{
                    backgroundColor: colors.background,
                    borderRadius: 12,
                    padding: 12,
                    fontSize: 15,
                    fontFamily: 'Poppins_400Regular',
                    color: colors.text,
                    borderWidth: 1,
                    borderColor: colors.outline,
                  }}
                  value={editableProductData.serving_quantity}
                  onChangeText={(text) => setEditableProductData(prev => ({ ...prev, serving_quantity: text }))}
                  keyboardType="numeric"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontFamily: 'Poppins_500Medium', color: colors.textSecondary, marginBottom: 4 }}>
                  Unit
                </Text>
                <TextInput
                  style={{
                    backgroundColor: colors.background,
                    borderRadius: 12,
                    padding: 12,
                    fontSize: 15,
                    fontFamily: 'Poppins_400Regular',
                    color: colors.text,
                    borderWidth: 1,
                    borderColor: colors.outline,
                  }}
                  value={editableProductData.serving_unit}
                  onChangeText={(text) => setEditableProductData(prev => ({ ...prev, serving_unit: text }))}
                />
              </View>
            </View>

            {/* Serving Weight (optional) */}
            <Text style={{ fontSize: 13, fontFamily: 'Poppins_500Medium', color: colors.textSecondary, marginBottom: 4 }}>
              Serving Weight (grams, optional)
            </Text>
            <TextInput
              style={{
                backgroundColor: colors.background,
                borderRadius: 12,
                padding: 12,
                fontSize: 15,
                fontFamily: 'Poppins_400Regular',
                color: colors.text,
                borderWidth: 1,
                borderColor: colors.outline,
                marginBottom: 16,
              }}
              value={editableProductData.serving_weight_grams}
              onChangeText={(text) => setEditableProductData(prev => ({ ...prev, serving_weight_grams: text }))}
              keyboardType="numeric"
              placeholder="e.g., 30"
              placeholderTextColor={colors.textSecondary}
            />

            {/* Nutrients Display */}
            {extractedProductData?.micros && Object.keys(extractedProductData.micros).length > 0 && (
              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: 13, fontFamily: 'Poppins_500Medium', color: colors.textSecondary, marginBottom: 8 }}>
                  Nutrients (per serving)
                </Text>
                <View
                  style={{
                    backgroundColor: colors.background,
                    borderRadius: 12,
                    padding: 12,
                    borderWidth: 1,
                    borderColor: colors.outline,
                  }}
                >
                  {formatMicros(extractedProductData.micros).map((nutrient, index) => (
                    <View
                      key={index}
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        paddingVertical: 4,
                        borderBottomWidth: index < formatMicros(extractedProductData.micros).length - 1 ? 1 : 0,
                        borderBottomColor: colors.outline,
                      }}
                    >
                      <Text style={{ fontSize: 14, fontFamily: 'Poppins_400Regular', color: colors.text }}>
                        {nutrient.name}
                      </Text>
                      <Text style={{ fontSize: 14, fontFamily: 'Poppins_500Medium', color: colors.primary }}>
                        {nutrient.amount} {nutrient.unit}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Action Buttons */}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                onPress={() => setNutritionLabelStep('capture')}
                style={{
                  flex: 1,
                  backgroundColor: colors.background,
                  borderRadius: 16,
                  padding: 16,
                  borderWidth: 1,
                  borderColor: colors.outline,
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: colors.text }}>
                  Retake Photo
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleConfirmProductData}
                style={{
                  flex: 1,
                  backgroundColor: colors.primary,
                  borderRadius: 16,
                  padding: 16,
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: colors.background }}>
                  Save to Catalog
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Quantity Input after catalog save */}
        {requiresNutritionLabel && nutritionLabelStep === 'quantity' && catalogProduct && (
          <View
            style={{
              backgroundColor: colors.cardBackground,
              borderRadius: 16,
              padding: 24,
              borderWidth: 2,
              borderColor: colors.primary,
              marginBottom: 24,
            }}
          >
            <Text
              style={{
                fontSize: 18,
                fontFamily: 'Poppins_600SemiBold',
                color: colors.text,
                marginBottom: 8,
                textAlign: 'center',
              }}
            >
              Product Saved! 🎉
            </Text>

            <Text
              style={{
                fontSize: 16,
                fontFamily: 'Poppins_500Medium',
                color: colors.primary,
                marginBottom: 16,
                textAlign: 'center',
              }}
            >
              {catalogProduct.brand} {catalogProduct.product_name}
            </Text>

            <Text
              style={{
                fontSize: 14,
                fontFamily: 'Poppins_400Regular',
                color: colors.textSecondary,
                marginBottom: 16,
                textAlign: 'center',
              }}
            >
              How many {catalogProduct.serving_unit}s did you take?
            </Text>

            {/* Quick selection buttons */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              {[1, 2, 3].map((num) => (
                <TouchableOpacity
                  key={num}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setQuantityInput(num.toString());
                  }}
                  style={{
                    flex: 1,
                    backgroundColor: quantityInput === num.toString() ? colors.primary : colors.background,
                    borderRadius: 12,
                    padding: 16,
                    alignItems: 'center',
                    borderWidth: 2,
                    borderColor: quantityInput === num.toString() ? colors.primary : colors.outline,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 18,
                      fontFamily: 'Poppins_600SemiBold',
                      color: quantityInput === num.toString() ? colors.background : colors.text,
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
                borderColor: colors.outline,
                marginBottom: 16,
              }}
              placeholder="Other amount..."
              placeholderTextColor={colors.textSecondary}
              value={quantityInput}
              onChangeText={setQuantityInput}
              keyboardType="numeric"
            />

            {/* Calculated nutrients preview */}
            {quantityInput && parseFloat(quantityInput) > 0 && catalogProduct.micros && (
              <View
                style={{
                  backgroundColor: colors.accentLilac,
                  borderRadius: 12,
                  padding: 12,
                  marginBottom: 16,
                }}
              >
                <Text style={{ fontSize: 13, fontFamily: 'Poppins_500Medium', color: colors.text, marginBottom: 8 }}>
                  Estimated nutrients for {quantityInput} {catalogProduct.serving_unit}(s):
                </Text>
                {formatMicros(catalogProduct.micros).slice(0, 4).map((nutrient, index) => {
                  const ratio = parseFloat(quantityInput) / (catalogProduct.serving_quantity || 1);
                  const calculatedAmount = Math.round(nutrient.amount * ratio * 10) / 10;
                  return (
                    <Text key={index} style={{ fontSize: 12, fontFamily: 'Poppins_400Regular', color: colors.textSecondary }}>
                      {nutrient.name}: {calculatedAmount} {nutrient.unit}
                    </Text>
                  );
                })}
              </View>
            )}

            <TouchableOpacity
              onPress={handleQuantityConfirm}
              disabled={!quantityInput || parseFloat(quantityInput) <= 0}
              style={{
                backgroundColor: quantityInput && parseFloat(quantityInput) > 0 ? colors.primary : colors.outline,
                borderRadius: 16,
                padding: 16,
                alignItems: 'center',
              }}
            >
              <Text
                style={{
                  fontSize: 16,
                  fontFamily: 'Poppins_600SemiBold',
                  color: quantityInput && parseFloat(quantityInput) > 0 ? colors.background : colors.textSecondary,
                }}
              >
                Log Event
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Original content - only show when not in nutrition label flow */}
        {!requiresNutritionLabel && (
          <>
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
              {metadata?.detected_item && (
                <Text
                  style={{
                    fontSize: 16,
                    fontFamily: 'Poppins_600SemiBold',
                    color: colors.primary,
                    marginBottom: 4,
                  }}
                >
                  {metadata.detected_item.brand} {metadata.detected_item.name}
                </Text>
              )}
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
          </>
        )}
      </ScrollView>
    </View>
  );
}
