import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, TextInput, ActivityIndicator, Modal } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/components/useColors';
import Header from '@/components/Header';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { createVoiceEvent, updateAuditStatus } from '@/utils/voiceEventParser';
import { calculateEventTime } from '@/utils/geminiParser';
import useUser from '@/utils/auth/useUser';
import { supabase } from '@/utils/supabaseClient';
import { processNutritionLabelPhoto, confirmAndAddToCatalog, buildSupplementEventData } from '@/utils/photoEventParser';
import { checkForNewPatterns, createTemplateFromPattern } from '@/utils/mealPatterns';
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

  // Multi-item mode state
  const [isMultiItemMode, setIsMultiItemMode] = useState(false);
  const [multiItemStep, setMultiItemStep] = useState('selection'); // 'selection', 'quantity', 'new_item_label', 'new_item_confirm', 'new_item_quantity', 'processing'
  const [pendingNewItems, setPendingNewItems] = useState([]); // Items needing nutrition label capture
  const [currentNewItemIndex, setCurrentNewItemIndex] = useState(0); // Current new item being processed
  const [newItemCatalogProduct, setNewItemCatalogProduct] = useState(null); // Catalog product created for current new item
  const [itemQuantities, setItemQuantities] = useState({}); // {itemIndex: quantity}
  const [currentMultiItemIndex, setCurrentMultiItemIndex] = useState(0);
  const [isProcessingMultiItem, setIsProcessingMultiItem] = useState(false);

  // Nutrition label capture flow state
  const [requiresNutritionLabel, setRequiresNutritionLabel] = useState(false);
  const [nutritionLabelStep, setNutritionLabelStep] = useState('capture'); // 'capture', 'processing', 'confirm', 'quantity'
  const [extractedProductData, setExtractedProductData] = useState(null);
  const [catalogProduct, setCatalogProduct] = useState(null);
  const [isProcessingLabel, setIsProcessingLabel] = useState(false);
  const [editableProductData, setEditableProductData] = useState(null);
  const [quantityInput, setQuantityInput] = useState('');
  const [labelPhotoUrl, setLabelPhotoUrl] = useState(null);

  // Pattern detection modal state
  const [showPatternModal, setShowPatternModal] = useState(false);
  const [detectedPattern, setDetectedPattern] = useState(null);
  const [templateNameInput, setTemplateNameInput] = useState('');
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  // Initialize multi-item mode from metadata - only run once on mount
  useEffect(() => {
    if (metadata?.is_multi_item && metadata?.detected_items) {
      console.log('[confirm.jsx] Initializing multi-item mode');
      console.log('[confirm.jsx] detected_items count:', metadata.detected_items.length);
      setIsMultiItemMode(true);
      setDetectedItems(metadata.detected_items);
      setMultiItemStep('selection');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect if we need nutrition label capture - only set initial state once on mount
  // Skip if this is multi-item mode (check metadata directly, not state)
  useEffect(() => {
    if (metadata?.requires_nutrition_label && !metadata?.is_multi_item) {
      setRequiresNutritionLabel(true);
      setNutritionLabelStep('capture');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect follow-up mode from route params - only run once on mount
  useEffect(() => {
    if (metadata?.follow_up_question && !metadata?.is_multi_item) {
      setFollowUpMode(true);
      setFollowUpQuestion(metadata.follow_up_question);
      setFollowUpField(metadata.follow_up_field || 'quantity');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Check for patterns after event save and show modal if found
  const checkAndShowPatterns = async () => {
    try {
      const patterns = await checkForNewPatterns(user.id, { minOccurrences: 2 });
      if (patterns.length > 0) {
        // Found a pattern that just reached threshold - show modal
        const pattern = patterns[0];
        setDetectedPattern(pattern);

        // Suggest a default name based on time of day
        const hour = pattern.typicalHour;
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
        setTemplateNameInput(suggestedName);
        setShowPatternModal(true);
        return true;
      }
    } catch (error) {
      console.error('[checkAndShowPatterns] Error:', error);
    }
    return false;
  };

  // Handle saving a detected pattern as a template
  const handleSaveTemplate = async () => {
    if (!templateNameInput.trim() || !detectedPattern) return;

    try {
      setIsSavingTemplate(true);
      await createTemplateFromPattern(user.id, detectedPattern, templateNameInput.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowPatternModal(false);
      setDetectedPattern(null);
      setTemplateNameInput('');
      setIsSavingTemplate(false);

      // Navigate back after small delay for UX
      setTimeout(() => router.back(), 300);
    } catch (error) {
      console.error('[handleSaveTemplate] Error:', error);
      setIsSavingTemplate(false);
      Alert.alert('Error', 'Failed to save template. Please try again.');
    }
  };

  // Dismiss pattern modal without saving
  const handleDismissPattern = () => {
    setShowPatternModal(false);
    setDetectedPattern(null);
    setTemplateNameInput('');
    router.back();
  };

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

      // Check for patterns after successful save
      const patternFound = await checkAndShowPatterns();

      // Only show success and navigate if no pattern modal is being shown
      if (!patternFound) {
        Alert.alert('Success', 'Event saved successfully!', [
          { text: 'OK', onPress: () => router.back() }
        ]);
      }
    } catch (error) {
      console.error('Error saving event:', error);
      Alert.alert('Error', 'Failed to save event. Please try again.');
    }
  };

  const handleCancel = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  // Multi-item mode handlers
  const handleToggleItemSelection = (index) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDetectedItems(prev => prev.map((item, i) =>
      i === index ? { ...item, selected: !item.selected } : item
    ));
  };

  const handleSelectAllItems = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDetectedItems(prev => prev.map(item => ({ ...item, selected: true })));
  };

  const handleDeselectAllItems = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDetectedItems(prev => prev.map(item => ({ ...item, selected: false })));
  };

  const handleMultiItemProceed = () => {
    const selectedItems = detectedItems.filter(item => item.selected);

    if (selectedItems.length === 0) {
      Alert.alert('No Items Selected', 'Please select at least one item to log.');
      return;
    }

    // Check if any selected items need nutrition labels (no catalog match)
    const itemsReadyToLog = selectedItems.filter(item => !item.requiresNutritionLabel);
    const needsLabelItems = selectedItems.filter(item => item.requiresNutritionLabel);

    console.log('[handleMultiItemProceed] Ready to log:', itemsReadyToLog.length, 'Needs labels:', needsLabelItems.length);

    // Store the new items that will need label capture later
    setPendingNewItems(needsLabelItems.map(item => ({
      ...item,
      originalIndex: detectedItems.indexOf(item)
    })));

    if (itemsReadyToLog.length > 0) {
      // Start with catalog-matched items - collect quantities
      const firstReadyIndex = detectedItems.findIndex(
        item => item.selected && !item.requiresNutritionLabel
      );
      setCurrentMultiItemIndex(firstReadyIndex >= 0 ? firstReadyIndex : 0);
      setMultiItemStep('quantity');
    } else if (needsLabelItems.length > 0) {
      // Only new items selected - go straight to nutrition label capture
      setCurrentNewItemIndex(0);
      setMultiItemStep('new_item_label');
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleMultiItemQuantitySubmit = (quantity) => {
    if (!quantity || quantity <= 0) {
      Alert.alert('Invalid Quantity', 'Please enter a valid quantity.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Save quantity for current item
    setItemQuantities(prev => ({
      ...prev,
      [currentMultiItemIndex]: quantity
    }));

    // Find next selected item that needs quantity
    const selectedItems = detectedItems.filter(item => item.selected && !item.requiresNutritionLabel);
    const currentSelectedIndex = selectedItems.findIndex((item, idx) =>
      detectedItems.indexOf(item) === currentMultiItemIndex
    );

    if (currentSelectedIndex < selectedItems.length - 1) {
      // More catalog-matched items to process
      const nextItem = selectedItems[currentSelectedIndex + 1];
      setCurrentMultiItemIndex(detectedItems.indexOf(nextItem));
      setQuantityInput('');
    } else {
      // All catalog-matched quantities collected
      const updatedQuantities = {
        ...itemQuantities,
        [currentMultiItemIndex]: quantity
      };

      if (pendingNewItems.length > 0) {
        // Save catalog-matched items first, then process new items
        handleMultiItemSave(updatedQuantities, true); // true = continue to new items after
      } else {
        // No new items, just save and finish
        handleMultiItemSave(updatedQuantities, false);
      }
    }
  };

  const handleMultiItemSave = async (finalQuantities, continueToNewItems = false) => {
    try {
      setIsProcessingMultiItem(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const { createMultiItemEvents } = require('@/utils/photoEventParser');

      // Build items with quantities (only catalog-matched items)
      const itemsToSave = detectedItems
        .filter(item => item.selected && !item.requiresNutritionLabel)
        .map(item => {
          const itemIndex = detectedItems.indexOf(item);
          return {
            item,
            catalogMatch: item.catalogMatch,
            quantity: finalQuantities[itemIndex] || 1
          };
        });

      // Only save if there are catalog-matched items
      let savedCount = 0;
      if (itemsToSave.length > 0) {
        const result = await createMultiItemEvents(
          auditId,
          itemsToSave,
          user.id,
          metadata?.photo_url
        );
        savedCount = result.events?.length || 0;

        if (!result.success && result.errors?.length > 0) {
          console.error('Some events failed to save:', result.errors);
        }
      }

      setIsProcessingMultiItem(false);

      if (continueToNewItems && pendingNewItems.length > 0) {
        // Show success message for catalog-matched items, then continue
        if (savedCount > 0) {
          Alert.alert(
            'Items Logged',
            `${savedCount} item${savedCount > 1 ? 's' : ''} saved. Now let's add ${pendingNewItems.length} new product${pendingNewItems.length > 1 ? 's' : ''} to your catalog.`,
            [{
              text: 'Continue',
              onPress: () => {
                setCurrentNewItemIndex(0);
                setMultiItemStep('new_item_label');
              }
            }]
          );
        } else {
          // No catalog items saved, go directly to new items
          setCurrentNewItemIndex(0);
          setMultiItemStep('new_item_label');
        }
      } else {
        // All done - check for patterns
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        // Check for patterns after multi-item save
        const patternFound = await checkAndShowPatterns();

        if (!patternFound) {
          Alert.alert(
            'Success',
            `${savedCount} event${savedCount !== 1 ? 's' : ''} saved successfully!`,
            [{ text: 'OK', onPress: () => router.back() }]
          );
        }
      }
    } catch (error) {
      setIsProcessingMultiItem(false);
      console.error('Error saving multi-item events:', error);
      Alert.alert('Error', 'Failed to save events. Please try again.');
    }
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

      // Check for patterns after save
      const patternFound = await checkAndShowPatterns();

      if (!patternFound) {
        Alert.alert('Success', 'Event saved successfully!', [
          { text: 'OK', onPress: () => router.back() }
        ]);
      }
    } catch (error) {
      console.error('Error saving event with quantity:', error);
      Alert.alert('Error', 'Failed to save event. Please try again.');
    }
  };

  // ========== Multi-Item New Product Handlers ==========

  // Capture nutrition label for a new item in multi-item mode
  const handleMultiItemCaptureLabel = async () => {
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
      setMultiItemStep('processing');
      setIsProcessingLabel(true);

      const currentItem = pendingNewItems[currentNewItemIndex];
      const frontPhotoUrl = metadata?.photo_url;

      const geminiApiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
      if (!geminiApiKey) {
        setIsProcessingLabel(false);
        Alert.alert('Error', 'Gemini API key not configured.');
        setMultiItemStep('new_item_label');
        return;
      }

      const processResult = await processNutritionLabelPhoto(
        labelPhotoUri,
        currentItem,
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
            'We couldn\'t extract the nutrition information. Please take another photo with better lighting.',
            [{ text: 'Try Again', onPress: () => setMultiItemStep('new_item_label') }]
          );
          return;
        }
        Alert.alert('Error', processResult.error || 'Failed to process nutrition label.');
        setMultiItemStep('new_item_label');
        return;
      }

      // Set extracted data for confirmation
      setExtractedProductData(processResult.extractedData);
      setLabelPhotoUrl(processResult.labelPhotoUrl);
      setEditableProductData({
        product_name: processResult.extractedData.product_name || currentItem?.name || '',
        brand: processResult.extractedData.brand || currentItem?.brand || '',
        serving_quantity: processResult.extractedData.serving_quantity?.toString() || '1',
        serving_unit: processResult.extractedData.serving_unit || 'serving',
        serving_weight_grams: processResult.extractedData.serving_weight_grams?.toString() || '',
      });
      setMultiItemStep('new_item_confirm');
    } catch (error) {
      console.error('Error capturing nutrition label for multi-item:', error);
      setIsProcessingLabel(false);
      Alert.alert('Error', 'Failed to capture nutrition label. Please try again.');
      setMultiItemStep('new_item_label');
    }
  };

  // Confirm extracted product data for new item in multi-item mode
  const handleMultiItemConfirmProduct = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

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

      setNewItemCatalogProduct(result.catalogProduct);
      setQuantityInput('');
      setMultiItemStep('new_item_quantity');
    } catch (error) {
      console.error('Error confirming new product in multi-item:', error);
      Alert.alert('Error', 'Failed to save product. Please try again.');
    }
  };

  // Handle quantity for new item and either continue to next or finish
  const handleMultiItemNewItemQuantitySubmit = async (quantity) => {
    if (!quantity || quantity <= 0) {
      Alert.alert('Invalid Quantity', 'Please enter a valid quantity.');
      return;
    }

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const currentItem = pendingNewItems[currentNewItemIndex];

      // Build event data
      const eventData = buildSupplementEventData(
        newItemCatalogProduct,
        quantity,
        false,
        null,
        currentItem
      );

      // Create the voice event
      const eventTime = new Date().toISOString();
      await createVoiceEvent(
        user.id,
        'supplement',
        eventData,
        eventTime,
        auditId,
        'photo'
      );

      // Check if there are more new items
      if (currentNewItemIndex < pendingNewItems.length - 1) {
        // Move to next new item
        setCurrentNewItemIndex(currentNewItemIndex + 1);
        setNewItemCatalogProduct(null);
        setExtractedProductData(null);
        setEditableProductData({
          product_name: '',
          brand: '',
          serving_quantity: '1',
          serving_unit: 'serving',
          serving_weight_grams: '',
        });
        setQuantityInput('');
        setMultiItemStep('new_item_label');
      } else {
        // All done!
        await updateAuditStatus(auditId, 'awaiting_user_clarification_success');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        // Check for patterns after all items are saved
        const patternFound = await checkAndShowPatterns();

        if (!patternFound) {
          const totalItems = detectedItems.filter(i => i.selected).length;
          Alert.alert(
            'All Done!',
            `${totalItems} supplement${totalItems !== 1 ? 's' : ''} logged successfully!`,
            [{ text: 'OK', onPress: () => router.back() }]
          );
        }
      }
    } catch (error) {
      console.error('Error saving new item event:', error);
      Alert.alert('Error', 'Failed to save event. Please try again.');
    }
  };

  // Skip current new item and move to next (or finish)
  const handleSkipNewItem = () => {
    if (currentNewItemIndex < pendingNewItems.length - 1) {
      setCurrentNewItemIndex(currentNewItemIndex + 1);
      setNewItemCatalogProduct(null);
      setExtractedProductData(null);
      setQuantityInput('');
      setMultiItemStep('new_item_label');
    } else {
      // No more items, finish
      const savedCount = detectedItems.filter(i => i.selected && !i.requiresNutritionLabel).length;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Done',
        savedCount > 0
          ? `${savedCount} item${savedCount !== 1 ? 's' : ''} were logged. Skipped items can be added individually later.`
          : 'No items were logged.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
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
        {/* Multi-Item Mode UI */}
        {isMultiItemMode && multiItemStep === 'selection' && (
          <View style={{ marginBottom: 24 }}>
            {/* Header */}
            <View style={{
              backgroundColor: colors.cardBackground,
              borderRadius: 16,
              padding: 20,
              marginBottom: 16,
            }}>
              <Text style={{
                fontSize: 20,
                fontFamily: 'Poppins_600SemiBold',
                color: colors.text,
                marginBottom: 8,
              }}>
                {detectedItems.length} Items Detected
              </Text>
              <Text style={{
                fontSize: 14,
                fontFamily: 'Poppins_400Regular',
                color: colors.textSecondary,
              }}>
                Select the items you want to log
              </Text>

              {/* Select All / Deselect All buttons */}
              <View style={{ flexDirection: 'row', marginTop: 16, gap: 12 }}>
                <TouchableOpacity
                  onPress={handleSelectAllItems}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: colors.primary,
                  }}
                >
                  <Text style={{
                    fontSize: 14,
                    fontFamily: 'Poppins_500Medium',
                    color: colors.primary,
                    textAlign: 'center',
                  }}>
                    Select All
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleDeselectAllItems}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: colors.textSecondary,
                  }}
                >
                  <Text style={{
                    fontSize: 14,
                    fontFamily: 'Poppins_500Medium',
                    color: colors.textSecondary,
                    textAlign: 'center',
                  }}>
                    Deselect All
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Item List */}
            {detectedItems.map((item, index) => (
              <TouchableOpacity
                key={index}
                onPress={() => handleToggleItemSelection(index)}
                style={{
                  backgroundColor: colors.cardBackground,
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 12,
                  flexDirection: 'row',
                  alignItems: 'center',
                  borderWidth: 2,
                  borderColor: item.selected ? colors.primary : 'transparent',
                }}
              >
                {/* Checkbox */}
                <View style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  borderWidth: 2,
                  borderColor: item.selected ? colors.primary : colors.textSecondary,
                  backgroundColor: item.selected ? colors.primary : 'transparent',
                  marginRight: 12,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}>
                  {item.selected && (
                    <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>✓</Text>
                  )}
                </View>

                {/* Item Info */}
                <View style={{ flex: 1 }}>
                  <Text style={{
                    fontSize: 16,
                    fontFamily: 'Poppins_600SemiBold',
                    color: colors.text,
                  }}>
                    {item.name}
                  </Text>
                  <Text style={{
                    fontSize: 14,
                    fontFamily: 'Poppins_400Regular',
                    color: colors.textSecondary,
                  }}>
                    {item.brand}
                  </Text>
                </View>

                {/* Status Badge */}
                <View style={{
                  paddingVertical: 4,
                  paddingHorizontal: 8,
                  borderRadius: 6,
                  backgroundColor: item.catalogMatch ? '#10B98120' : '#F59E0B20',
                }}>
                  <Text style={{
                    fontSize: 12,
                    fontFamily: 'Poppins_500Medium',
                    color: item.catalogMatch ? '#10B981' : '#F59E0B',
                  }}>
                    {item.catalogMatch ? 'In Catalog' : 'New'}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}

            {/* Proceed Button */}
            <TouchableOpacity
              onPress={handleMultiItemProceed}
              style={{
                backgroundColor: colors.primary,
                borderRadius: 12,
                paddingVertical: 16,
                marginTop: 8,
              }}
            >
              <Text style={{
                fontSize: 16,
                fontFamily: 'Poppins_600SemiBold',
                color: '#fff',
                textAlign: 'center',
              }}>
                Continue ({detectedItems.filter(i => i.selected).length} selected)
              </Text>
            </TouchableOpacity>

            {/* Cancel Button */}
            <TouchableOpacity
              onPress={handleCancel}
              style={{
                paddingVertical: 12,
                marginTop: 8,
              }}
            >
              <Text style={{
                fontSize: 14,
                fontFamily: 'Poppins_500Medium',
                color: colors.textSecondary,
                textAlign: 'center',
              }}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Multi-Item Quantity Collection */}
        {isMultiItemMode && multiItemStep === 'quantity' && (
          <View style={{ marginBottom: 24 }}>
            <View style={{
              backgroundColor: colors.cardBackground,
              borderRadius: 16,
              padding: 24,
            }}>
              {/* Progress Indicator */}
              <Text style={{
                fontSize: 12,
                fontFamily: 'Poppins_500Medium',
                color: colors.textSecondary,
                marginBottom: 8,
              }}>
                Item {detectedItems.filter((_, i) => i <= currentMultiItemIndex && detectedItems[i].selected && !detectedItems[i].requiresNutritionLabel).length} of {detectedItems.filter(i => i.selected && !i.requiresNutritionLabel).length}
              </Text>

              {/* Current Item */}
              <Text style={{
                fontSize: 20,
                fontFamily: 'Poppins_600SemiBold',
                color: colors.text,
                marginBottom: 4,
              }}>
                {detectedItems[currentMultiItemIndex]?.name}
              </Text>
              <Text style={{
                fontSize: 14,
                fontFamily: 'Poppins_400Regular',
                color: colors.textSecondary,
                marginBottom: 24,
              }}>
                {detectedItems[currentMultiItemIndex]?.brand}
              </Text>

              {/* Quantity Question */}
              <Text style={{
                fontSize: 16,
                fontFamily: 'Poppins_500Medium',
                color: colors.text,
                marginBottom: 16,
              }}>
                How many {detectedItems[currentMultiItemIndex]?.form || 'units'} did you take?
              </Text>

              {/* Quick Select Buttons */}
              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
                {[1, 2, 3].map(num => (
                  <TouchableOpacity
                    key={num}
                    onPress={() => handleMultiItemQuantitySubmit(num)}
                    style={{
                      flex: 1,
                      paddingVertical: 16,
                      borderRadius: 12,
                      backgroundColor: colors.primary + '20',
                      borderWidth: 1,
                      borderColor: colors.primary,
                    }}
                  >
                    <Text style={{
                      fontSize: 20,
                      fontFamily: 'Poppins_600SemiBold',
                      color: colors.primary,
                      textAlign: 'center',
                    }}>
                      {num}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Custom Input */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <TextInput
                  value={quantityInput}
                  onChangeText={setQuantityInput}
                  placeholder="Other amount"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="numeric"
                  style={{
                    flex: 1,
                    height: 48,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 12,
                    paddingHorizontal: 16,
                    fontSize: 16,
                    fontFamily: 'Poppins_400Regular',
                    color: colors.text,
                    backgroundColor: colors.inputBackground,
                  }}
                />
                <TouchableOpacity
                  onPress={() => handleMultiItemQuantitySubmit(parseInt(quantityInput) || 0)}
                  disabled={!quantityInput}
                  style={{
                    paddingHorizontal: 20,
                    paddingVertical: 12,
                    borderRadius: 12,
                    backgroundColor: quantityInput ? colors.primary : colors.primary + '40',
                  }}
                >
                  <Text style={{
                    fontSize: 16,
                    fontFamily: 'Poppins_600SemiBold',
                    color: '#fff',
                  }}>
                    Next
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Multi-Item Processing */}
        {isMultiItemMode && (isProcessingMultiItem || multiItemStep === 'processing') && (
          <View style={{
            padding: 48,
            justifyContent: 'center',
            alignItems: 'center',
          }}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={{
              fontSize: 16,
              fontFamily: 'Poppins_500Medium',
              color: colors.text,
              marginTop: 16,
            }}>
              {isProcessingLabel ? 'Processing label...' : 'Saving events...'}
            </Text>
          </View>
        )}

        {/* Multi-Item New Product: Label Capture */}
        {isMultiItemMode && multiItemStep === 'new_item_label' && pendingNewItems.length > 0 && (
          <View style={{ marginBottom: 24 }}>
            <View style={{
              backgroundColor: colors.cardBackground,
              borderRadius: 16,
              padding: 24,
              borderWidth: 2,
              borderColor: colors.primary,
            }}>
              {/* Progress */}
              <Text style={{
                fontSize: 12,
                fontFamily: 'Poppins_500Medium',
                color: colors.textSecondary,
                marginBottom: 8,
              }}>
                New Product {currentNewItemIndex + 1} of {pendingNewItems.length}
              </Text>

              <Text style={{
                fontSize: 18,
                fontFamily: 'Poppins_600SemiBold',
                color: colors.text,
                marginBottom: 4,
              }}>
                {pendingNewItems[currentNewItemIndex]?.name}
              </Text>
              <Text style={{
                fontSize: 14,
                fontFamily: 'Poppins_400Regular',
                color: colors.textSecondary,
                marginBottom: 16,
              }}>
                {pendingNewItems[currentNewItemIndex]?.brand}
              </Text>

              <Text style={{
                fontSize: 14,
                fontFamily: 'Poppins_400Regular',
                color: colors.text,
                marginBottom: 20,
                textAlign: 'center',
              }}>
                This product isn't in your catalog yet. Take a photo of the nutrition/supplement facts label to add it.
              </Text>

              <TouchableOpacity
                onPress={handleMultiItemCaptureLabel}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.primary,
                  paddingVertical: 16,
                  borderRadius: 12,
                  marginBottom: 12,
                }}
              >
                <Ionicons name="camera" size={24} color="#fff" style={{ marginRight: 8 }} />
                <Text style={{
                  fontSize: 16,
                  fontFamily: 'Poppins_600SemiBold',
                  color: '#fff',
                }}>
                  Take Photo of Label
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleSkipNewItem}
                style={{
                  paddingVertical: 12,
                  alignItems: 'center',
                }}
              >
                <Text style={{
                  fontSize: 14,
                  fontFamily: 'Poppins_500Medium',
                  color: colors.textSecondary,
                }}>
                  Skip this item
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Multi-Item New Product: Confirm Extracted Data */}
        {isMultiItemMode && multiItemStep === 'new_item_confirm' && extractedProductData && (
          <View style={{ marginBottom: 24 }}>
            <View style={{
              backgroundColor: colors.cardBackground,
              borderRadius: 16,
              padding: 24,
            }}>
              <Text style={{
                fontSize: 12,
                fontFamily: 'Poppins_500Medium',
                color: colors.textSecondary,
                marginBottom: 8,
              }}>
                New Product {currentNewItemIndex + 1} of {pendingNewItems.length}
              </Text>

              <Text style={{
                fontSize: 18,
                fontFamily: 'Poppins_600SemiBold',
                color: colors.text,
                marginBottom: 16,
              }}>
                Confirm Product Details
              </Text>

              {/* Editable Fields */}
              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: 12, fontFamily: 'Poppins_500Medium', color: colors.textSecondary, marginBottom: 4 }}>
                  Product Name
                </Text>
                <TextInput
                  value={editableProductData.product_name}
                  onChangeText={(text) => setEditableProductData(prev => ({ ...prev, product_name: text }))}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    fontSize: 16,
                    fontFamily: 'Poppins_400Regular',
                    color: colors.text,
                    backgroundColor: colors.inputBackground,
                  }}
                />
              </View>

              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: 12, fontFamily: 'Poppins_500Medium', color: colors.textSecondary, marginBottom: 4 }}>
                  Brand
                </Text>
                <TextInput
                  value={editableProductData.brand}
                  onChangeText={(text) => setEditableProductData(prev => ({ ...prev, brand: text }))}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    fontSize: 16,
                    fontFamily: 'Poppins_400Regular',
                    color: colors.text,
                    backgroundColor: colors.inputBackground,
                  }}
                />
              </View>

              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontFamily: 'Poppins_500Medium', color: colors.textSecondary, marginBottom: 4 }}>
                    Serving Size
                  </Text>
                  <TextInput
                    value={editableProductData.serving_quantity}
                    onChangeText={(text) => setEditableProductData(prev => ({ ...prev, serving_quantity: text }))}
                    keyboardType="numeric"
                    style={{
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 8,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      fontSize: 16,
                      fontFamily: 'Poppins_400Regular',
                      color: colors.text,
                      backgroundColor: colors.inputBackground,
                    }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontFamily: 'Poppins_500Medium', color: colors.textSecondary, marginBottom: 4 }}>
                    Unit
                  </Text>
                  <TextInput
                    value={editableProductData.serving_unit}
                    onChangeText={(text) => setEditableProductData(prev => ({ ...prev, serving_unit: text }))}
                    style={{
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 8,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      fontSize: 16,
                      fontFamily: 'Poppins_400Regular',
                      color: colors.text,
                      backgroundColor: colors.inputBackground,
                    }}
                  />
                </View>
              </View>

              {/* Nutrients Preview */}
              {extractedProductData.micros && Object.keys(extractedProductData.micros).length > 0 && (
                <View style={{ marginBottom: 16 }}>
                  <Text style={{ fontSize: 12, fontFamily: 'Poppins_500Medium', color: colors.textSecondary, marginBottom: 8 }}>
                    Nutrients Detected
                  </Text>
                  <View style={{ backgroundColor: colors.background, borderRadius: 8, padding: 12 }}>
                    {Object.entries(extractedProductData.micros).slice(0, 5).map(([name, value]) => (
                      <Text key={name} style={{ fontSize: 14, fontFamily: 'Poppins_400Regular', color: colors.text }}>
                        {name}: {value.amount} {value.unit}
                      </Text>
                    ))}
                    {Object.keys(extractedProductData.micros).length > 5 && (
                      <Text style={{ fontSize: 12, fontFamily: 'Poppins_400Regular', color: colors.textSecondary, marginTop: 4 }}>
                        +{Object.keys(extractedProductData.micros).length - 5} more
                      </Text>
                    )}
                  </View>
                </View>
              )}

              <TouchableOpacity
                onPress={handleMultiItemConfirmProduct}
                style={{
                  backgroundColor: colors.primary,
                  paddingVertical: 16,
                  borderRadius: 12,
                  alignItems: 'center',
                }}
              >
                <Text style={{
                  fontSize: 16,
                  fontFamily: 'Poppins_600SemiBold',
                  color: '#fff',
                }}>
                  Add to Catalog
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Multi-Item New Product: Quantity */}
        {isMultiItemMode && multiItemStep === 'new_item_quantity' && newItemCatalogProduct && (
          <View style={{ marginBottom: 24 }}>
            <View style={{
              backgroundColor: colors.cardBackground,
              borderRadius: 16,
              padding: 24,
            }}>
              <Text style={{
                fontSize: 12,
                fontFamily: 'Poppins_500Medium',
                color: colors.textSecondary,
                marginBottom: 8,
              }}>
                New Product {currentNewItemIndex + 1} of {pendingNewItems.length}
              </Text>

              <Text style={{
                fontSize: 20,
                fontFamily: 'Poppins_600SemiBold',
                color: colors.text,
                marginBottom: 4,
              }}>
                {newItemCatalogProduct.product_name}
              </Text>
              <Text style={{
                fontSize: 14,
                fontFamily: 'Poppins_400Regular',
                color: colors.textSecondary,
                marginBottom: 24,
              }}>
                {newItemCatalogProduct.brand}
              </Text>

              <Text style={{
                fontSize: 16,
                fontFamily: 'Poppins_500Medium',
                color: colors.text,
                marginBottom: 16,
              }}>
                How many {newItemCatalogProduct.serving_unit || 'servings'} did you take?
              </Text>

              {/* Quick Select Buttons */}
              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
                {[1, 2, 3].map(num => (
                  <TouchableOpacity
                    key={num}
                    onPress={() => handleMultiItemNewItemQuantitySubmit(num)}
                    style={{
                      flex: 1,
                      paddingVertical: 16,
                      borderRadius: 12,
                      backgroundColor: colors.primary + '20',
                      borderWidth: 1,
                      borderColor: colors.primary,
                    }}
                  >
                    <Text style={{
                      fontSize: 20,
                      fontFamily: 'Poppins_600SemiBold',
                      color: colors.primary,
                      textAlign: 'center',
                    }}>
                      {num}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Custom Input */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <TextInput
                  value={quantityInput}
                  onChangeText={setQuantityInput}
                  placeholder="Other amount"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="numeric"
                  style={{
                    flex: 1,
                    height: 48,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 12,
                    paddingHorizontal: 16,
                    fontSize: 16,
                    fontFamily: 'Poppins_400Regular',
                    color: colors.text,
                    backgroundColor: colors.inputBackground,
                  }}
                />
                <TouchableOpacity
                  onPress={() => handleMultiItemNewItemQuantitySubmit(parseInt(quantityInput) || 0)}
                  disabled={!quantityInput}
                  style={{
                    paddingHorizontal: 20,
                    paddingVertical: 12,
                    borderRadius: 12,
                    backgroundColor: quantityInput ? colors.primary : colors.primary + '40',
                  }}
                >
                  <Text style={{
                    fontSize: 16,
                    fontFamily: 'Poppins_600SemiBold',
                    color: '#fff',
                  }}>
                    {currentNewItemIndex < pendingNewItems.length - 1 ? 'Next' : 'Done'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

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

        {/* Original content - only show when not in nutrition label flow AND not in multi-item mode */}
        {!requiresNutritionLabel && !isMultiItemMode && (
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

      {/* Pattern Detection Modal */}
      <Modal
        visible={showPatternModal}
        animationType="slide"
        transparent={true}
        onRequestClose={handleDismissPattern}
      >
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          justifyContent: 'flex-end',
        }}>
          <View style={{
            backgroundColor: colors.cardBackground,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 24,
            paddingBottom: insets.bottom + 24,
          }}>
            {/* Header */}
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <View style={{
                width: 40,
                height: 4,
                backgroundColor: colors.outline,
                borderRadius: 2,
                marginBottom: 20,
              }} />
              <Text style={{
                fontSize: 24,
                marginBottom: 8,
              }}>
                🎯
              </Text>
              <Text style={{
                fontSize: 20,
                fontFamily: 'Poppins_600SemiBold',
                color: colors.text,
                textAlign: 'center',
              }}>
                Pattern Detected!
              </Text>
            </View>

            {/* Pattern Info */}
            {detectedPattern && (
              <View style={{
                backgroundColor: colors.background,
                borderRadius: 16,
                padding: 16,
                marginBottom: 20,
              }}>
                <Text style={{
                  fontSize: 14,
                  fontFamily: 'Poppins_400Regular',
                  color: colors.textSecondary,
                  marginBottom: 12,
                  textAlign: 'center',
                }}>
                  You've logged these {detectedPattern.items?.length || 0} items together {detectedPattern.occurrences} times. Save as a quick-log template?
                </Text>

                {/* Item List Preview */}
                <View style={{ gap: 8 }}>
                  {detectedPattern.items?.slice(0, 4).map((item, index) => (
                    <View key={index} style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                    }}>
                      <View style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: colors.primary,
                      }} />
                      <Text style={{
                        fontSize: 14,
                        fontFamily: 'Poppins_500Medium',
                        color: colors.text,
                      }}>
                        {item.name}
                      </Text>
                    </View>
                  ))}
                  {detectedPattern.items?.length > 4 && (
                    <Text style={{
                      fontSize: 13,
                      fontFamily: 'Poppins_400Regular',
                      color: colors.textSecondary,
                      marginLeft: 14,
                    }}>
                      +{detectedPattern.items.length - 4} more
                    </Text>
                  )}
                </View>
              </View>
            )}

            {/* Template Name Input */}
            <Text style={{
              fontSize: 14,
              fontFamily: 'Poppins_500Medium',
              color: colors.textSecondary,
              marginBottom: 8,
            }}>
              Template Name
            </Text>
            <TextInput
              value={templateNameInput}
              onChangeText={setTemplateNameInput}
              placeholder="e.g., Morning Stack, Breakfast Vitamins"
              placeholderTextColor={colors.textSecondary}
              style={{
                backgroundColor: colors.background,
                borderRadius: 12,
                padding: 16,
                fontSize: 16,
                fontFamily: 'Poppins_400Regular',
                color: colors.text,
                borderWidth: 2,
                borderColor: colors.outline,
                marginBottom: 20,
              }}
              autoFocus={true}
            />

            {/* Actions */}
            <View style={{ gap: 12 }}>
              <TouchableOpacity
                onPress={handleSaveTemplate}
                disabled={!templateNameInput.trim() || isSavingTemplate}
                style={{
                  backgroundColor: templateNameInput.trim() ? colors.primary : colors.outline,
                  borderRadius: 16,
                  padding: 16,
                  alignItems: 'center',
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                {isSavingTemplate ? (
                  <ActivityIndicator color={colors.background} size="small" />
                ) : (
                  <>
                    <Ionicons name="bookmark" size={20} color={templateNameInput.trim() ? colors.background : colors.textSecondary} />
                    <Text style={{
                      fontSize: 16,
                      fontFamily: 'Poppins_600SemiBold',
                      color: templateNameInput.trim() ? colors.background : colors.textSecondary,
                    }}>
                      Save Template
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleDismissPattern}
                style={{
                  padding: 16,
                  alignItems: 'center',
                }}
              >
                <Text style={{
                  fontSize: 14,
                  fontFamily: 'Poppins_500Medium',
                  color: colors.textSecondary,
                }}>
                  Not Now
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
