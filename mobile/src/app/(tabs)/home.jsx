import React, { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Mic, Camera, Send, Check } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
} from "@expo-google-fonts/poppins";
import { useColors } from "@/components/useColors.jsx";
import Header from "@/components/Header.jsx";
import useUpload from "@/utils/useUpload.js";
import { useAuth } from "@/utils/auth/useAuth";
import useUser from "@/utils/auth/useUser";
import { requireUserId } from "@/utils/auth/getUserId";
import { getUserRecentEvents, createAuditRecord, updateAuditStatus, createVoiceEvent } from "@/utils/voiceEventParser";
import { shouldSearchProducts, searchAllProducts } from "@/utils/productSearch";
import {
  startRecording,
  stopRecording,
  deleteAudioFile,
} from "@/utils/voiceRecording";
import { parseAudioWithGemini, parseTextWithGemini, calculateEventTime } from "@/utils/geminiParser";
import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const router = useRouter();
  const [upload] = useUpload();
  const { getAccessToken, isAuthenticated, signIn } = useAuth();
  const { data: user } = useUser();

  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
  });

  const [textInput, setTextInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showSuccessCheckmark, setShowSuccessCheckmark] = useState(false);
  const recordingRef = useRef(null);

  const samplePrompts = [
    "Log 6 units of basal insulin",
    "Ate large chicken thigh with broccoli",
    "Started 30 min jog",
    "Took 500mg vitamin C supplement",
    "20 minute sauna session at 180°F",
  ];

  // Helper function to extract value and units from event data based on event type
  const extractValueAndUnits = (eventType, eventData) => {
    if (!eventData) return { value: null, units: null };

    switch (eventType) {
      case 'sauna':
        // Store duration as value, minutes as units
        return {
          value: eventData.duration || null,
          units: eventData.duration ? 'minutes' : null
        };
      case 'activity':
        // Store duration as value, minutes as units
        return {
          value: eventData.duration || null,
          units: eventData.duration ? 'minutes' : null
        };
      case 'glucose':
        // Already has value and units
        return {
          value: eventData.value || null,
          units: eventData.units || null
        };
      case 'insulin':
        // Already has value and units
        return {
          value: eventData.value || null,
          units: eventData.units || null
        };
      case 'supplement':
        // Store dosage as value
        return {
          value: eventData.dosage || null,
          units: eventData.units || null
        };
      case 'medication':
        // Store dosage as value
        return {
          value: eventData.dosage || null,
          units: eventData.units || null
        };
      case 'food':
        // Store calories as value if available
        return {
          value: eventData.calories || null,
          units: eventData.calories ? 'kcal' : null
        };
      default:
        return { value: null, units: null };
    }
  };

  const handleVoicePress = useCallback(async () => {
    console.log('=== handleVoicePress called, isRecording:', isRecording, 'isProcessing:', isProcessing);

    const geminiApiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;

    if (!geminiApiKey || geminiApiKey === 'your_gemini_api_key_here') {
      Alert.alert(
        "Configuration Required",
        "Please set your Gemini API key in the .env file."
      );
      return;
    }

    try {
      if (isRecording) {
        console.log('Stopping recording...');
        // Stop recording
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setIsRecording(false);
        setIsProcessing(true);

        const audioUri = await stopRecording(recordingRef.current);
        recordingRef.current = null;
        console.log('Recording stopped, URI:', audioUri);

        // Get userId reliably (no race condition with useUser hook)
        const userId = await requireUserId(user?.id);

        console.log('Fetching user history for context...');
        const userHistory = await getUserRecentEvents(userId, 50);
        console.log(`Found ${userHistory.length} recent events`);

        // Parse audio with Gemini (transcription + parsing in one call)
        const parsed = await parseAudioWithGemini(audioUri, geminiApiKey, userHistory);

        console.log(`Transcription: "${parsed.transcription}"`);
        console.log(`Parsing confidence: ${parsed.confidence}%`);

        // Clean up audio file
        await deleteAudioFile(audioUri);

        // CRITICAL: Check user's product registry FIRST (Phase 2 - Self-Learning)
        // This must happen BEFORE we use Gemini's classification
        const { checkUserProductRegistry, fuzzyMatchUserProducts } = require('@/utils/productRegistry');

        let registryMatch = await checkUserProductRegistry(parsed.transcription, userId);
        let fuzzyMatch = null;

        if (registryMatch) {
          console.log(`Found exact match in user product registry: ${registryMatch.product_name} (${registryMatch.times_logged} times)`);

          // Override Gemini's classification with registry data
          parsed.event_type = registryMatch.event_type;
          parsed.event_data = registryMatch.event_type === 'food'
            ? { description: registryMatch.product_name }
            : { name: registryMatch.product_name, dosage: '1', units: 'serving' };
          parsed.confidence = 95;
          parsed.complete = true;

          console.log(`Registry override: ${registryMatch.event_type} - ${registryMatch.product_name}`);
        } else {
          // Try fuzzy match if no exact match
          fuzzyMatch = await fuzzyMatchUserProducts(parsed.transcription, userId);
          if (fuzzyMatch) {
            console.log(`Found fuzzy match in user product registry: ${fuzzyMatch.product_name} (${fuzzyMatch.times_logged} times)`);

            // Override Gemini's classification with fuzzy match
            parsed.event_type = fuzzyMatch.event_type;
            parsed.event_data = fuzzyMatch.event_type === 'food'
              ? { description: fuzzyMatch.product_name }
              : { name: fuzzyMatch.product_name, dosage: '1', units: 'serving' };
            parsed.confidence = 95;
            parsed.complete = true;

            console.log(`Fuzzy match override: ${fuzzyMatch.event_type} - ${fuzzyMatch.product_name}`);
          }
        }

        // Extract value and units based on event type
        const { value, units } = extractValueAndUnits(parsed.event_type, parsed.event_data);

        // Create audit record
        const textModel = process.env.EXPO_PUBLIC_GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
        const geminiModel = registryMatch ? 'registry_bypass' : (fuzzyMatch ? 'registry_fuzzy_bypass' : textModel);
        const matchInfo = registryMatch || fuzzyMatch;
        const auditRecord = await createAuditRecord(
          userId,
          parsed.transcription,
          parsed.event_type,
          value,
          units,
          geminiModel,
          {
            capture_method: 'voice',
            user_history_count: userHistory.length,
            gemini_model: geminiModel,
            confidence: parsed.confidence,
            parsed_at: new Date().toISOString(),
            ...(matchInfo && {
              registry_match: {
                source: matchInfo.source,
                times_logged: matchInfo.times_logged,
                product_name: matchInfo.product_name
              }
            })
          }
        );

        // Check if we should search for products
        let productOptions = null;
        const shouldSearch = shouldSearchProducts(parsed.event_type, parsed.event_data, parsed.confidence);
        console.log(`Product search decision: ${shouldSearch} (confidence: ${parsed.confidence}%, type: ${parsed.event_type})`);

        if (shouldSearch) {
          console.log('Searching product databases...');
          const searchQuery = parsed.event_data.description || parsed.event_data.name || parsed.transcription;
          console.log(`Search query: "${searchQuery}"`);
          const usdaApiKey = process.env.EXPO_PUBLIC_USDA_API_KEY;
          productOptions = await searchAllProducts(searchQuery, usdaApiKey);
          console.log(`Found ${productOptions.length} product options`);
        } else {
          console.log('Skipping product search - confidence is high enough');
        }

        // Determine if we should show confirmation screen
        const needsConfirmation = !parsed.complete || shouldSearch;

        if (parsed.complete && !needsConfirmation) {
          // Save directly
          console.log('Saving directly - complete and no confirmation needed');

          // Calculate actual event time from time_info
          const eventTime = calculateEventTime(parsed.time_info);

          await createVoiceEvent(
            userId,
            parsed.event_type,
            parsed.event_data,
            eventTime,
            auditRecord.id,
            'voice'
          );
          await updateAuditStatus(auditRecord.id, 'parsed');

          // Show success checkmark for 1 second
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setShowSuccessCheckmark(true);
          setTimeout(() => {
            setShowSuccessCheckmark(false);
          }, 1000);
        } else {
          // Show confirmation screen
          console.log(`Going to confirmation screen - complete: ${parsed.complete}, products: ${productOptions?.length || 0}, needs confirmation: ${needsConfirmation}`);
          await updateAuditStatus(auditRecord.id, 'awaiting_user_clarification');

          const missingFields = parsed.complete || !parsed.event_data ? [] : Object.keys(parsed.event_data).filter(
            field => !parsed.event_data[field]
          );

          router.push({
            pathname: "/confirm",
            params: {
              data: JSON.stringify(parsed),
              captureMethod: "voice",
              auditId: auditRecord.id,
              missingFields: JSON.stringify(missingFields),
              productOptions: productOptions ? JSON.stringify(productOptions) : null,
              confidence: parsed.confidence?.toString() || null,
            },
          });
        }
        setIsProcessing(false);
      } else {
        console.log('Starting recording...');
        // Start recording
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        const recording = await startRecording();
        recordingRef.current = recording;
        setIsRecording(true);
        console.log('Recording started successfully');
      }
    } catch (error) {
      console.error("Voice recording error:", error);
      console.error("Error stack:", error.stack);
      Alert.alert("Error", error.message || "Failed to record audio. Please try again.");
      setIsRecording(false);
      setIsProcessing(false);
      recordingRef.current = null;
    }
  }, [isRecording, isProcessing, user, router]);

  const handlePhotoCapture = useCallback(
    async (image) => {
      try {
        setIsProcessing(true);

        const geminiApiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
        if (!geminiApiKey || geminiApiKey === 'your_gemini_api_key_here') {
          Alert.alert("Configuration Required", "Please set your Gemini API key in the .env file.");
          return;
        }

        // Get userId reliably (no race condition with useUser hook)
        const userId = await requireUserId(user?.id);

        // Import photo processing function
        const { processPhotoInput } = require('@/utils/photoEventParser');

        // Process photo end-to-end: upload → Gemini → catalog lookup
        const result = await processPhotoInput(
          image.uri,
          userId,
          geminiApiKey,
          'photo'
        );

        if (!result.success) {
          throw new Error(result.error || 'Failed to process photo');
        }

        // Navigate to confirmation screen with multi-item support
        router.push({
          pathname: "/confirm",
          params: {
            data: JSON.stringify(result.parsed),
            captureMethod: "photo",
            auditId: result.auditId,
            missingFields: JSON.stringify(result.missingFields || []),
            confidence: result.parsed.confidence?.toString() || null,
            metadata: JSON.stringify({
              // Multi-item support
              is_multi_item: result.isMultiItem || false,
              detected_items: result.detectedItems || null,
              matched_count: result.matchedCount || 0,
              needs_label_count: result.needsLabelCount || 0,
              // Single item support (backwards compatible)
              requires_nutrition_label: result.requiresNutritionLabel || false,
              follow_up_question: result.followUpQuestion,
              follow_up_field: 'quantity',
              photo_url: result.photoUrl,
              detected_item: result.detectedItem,
              catalog_match: result.catalogMatch
            })
          },
        });
      } catch (error) {
        console.error("Photo capture error:", error);
        Alert.alert("Error", "Failed to process photo. Please try again.");
      } finally {
        setIsProcessing(false);
      }
    },
    [user, router],
  );

  const handleCameraPress = useCallback(async () => {
    console.log('=== handleCameraPress called, isProcessing:', isProcessing);

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      console.log('Requesting camera permissions...');
      const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
      console.log('Camera permission result:', permissionResult);

      if (!permissionResult.granted) {
        console.log('Camera permission denied');
        Alert.alert(
          "Permission required",
          "Camera permission is needed to capture photos.",
        );
        return;
      }

      console.log('Launching camera...');
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
      });

      console.log('Camera result:', result);

      if (!result.canceled && result.assets[0]) {
        console.log('Photo captured, processing...');
        await handlePhotoCapture(result.assets[0]);
      } else {
        console.log('Camera canceled or no image');
      }
    } catch (error) {
      console.error('Camera error:', error);
      console.error('Camera error stack:', error.stack);
      Alert.alert("Error", error.message || "Failed to open camera. Please try again.");
    }
  }, [isProcessing, handlePhotoCapture]);

  const handleTextSubmit = useCallback(async () => {
    if (!textInput.trim()) return;

    const geminiApiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    if (!geminiApiKey || geminiApiKey === 'your_gemini_api_key_here') {
      Alert.alert(
        "Configuration Required",
        "Please set your Gemini API key in the .env file."
      );
      return;
    }

    try {
      setIsProcessing(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // Get userId reliably (no race condition with useUser hook)
      const userId = await requireUserId(user?.id);

      console.log('Fetching user history for context...');
      const userHistory = await getUserRecentEvents(userId, 50);
      console.log(`Found ${userHistory.length} recent events`);

      // Parse text with Gemini
      const parsed = await parseTextWithGemini(textInput, geminiApiKey, userHistory);

      console.log(`Text input: "${textInput}"`);
      console.log(`Parsing confidence: ${parsed.confidence}%`);

      // Extract value and units based on event type
      const { value, units } = extractValueAndUnits(parsed.event_type, parsed.event_data);

      // Create audit record
      const textModel = process.env.EXPO_PUBLIC_GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
      const auditRecord = await createAuditRecord(
        userId,
        textInput,
        parsed.event_type,
        value,
        units,
        textModel,
        {
          capture_method: 'manual',
          user_history_count: userHistory.length,
          gemini_model: textModel,
          confidence: parsed.confidence,
          parsed_at: new Date().toISOString()
        }
      );

      // Check if we should search for products
      let productOptions = null;
      const shouldSearch = shouldSearchProducts(parsed.event_type, parsed.event_data, parsed.confidence);
      console.log(`Product search decision: ${shouldSearch} (confidence: ${parsed.confidence}%, type: ${parsed.event_type})`);

      if (shouldSearch) {
        console.log('Searching product databases...');
        const searchQuery = parsed.event_data.description || parsed.event_data.name || textInput;
        console.log(`Search query: "${searchQuery}"`);
        const usdaApiKey = process.env.EXPO_PUBLIC_USDA_API_KEY;
        productOptions = await searchAllProducts(searchQuery, usdaApiKey);
        console.log(`Found ${productOptions.length} product options`);
      } else {
        console.log('Skipping product search - confidence is high enough');
      }

      // Determine if we should show confirmation screen
      const needsConfirmation = !parsed.complete || shouldSearch;

      if (parsed.complete && !needsConfirmation) {
        // Save directly
        console.log('Saving directly - complete and no confirmation needed');

        // Calculate actual event time from time_info
        const eventTime = calculateEventTime(parsed.time_info);

        await createVoiceEvent(
          userId,
          parsed.event_type,
          parsed.event_data,
          eventTime,
          auditRecord.id,
          'manual'
        );
        await updateAuditStatus(auditRecord.id, 'parsed');

        setTextInput("");

        // Show success checkmark for 1 second
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setShowSuccessCheckmark(true);
        setTimeout(() => {
          setShowSuccessCheckmark(false);
        }, 1000);
      } else {
        // Show confirmation screen
        console.log(`Going to confirmation screen - complete: ${parsed.complete}, products: ${productOptions?.length || 0}, needs confirmation: ${needsConfirmation}`);
        await updateAuditStatus(auditRecord.id, 'awaiting_user_clarification');

        const missingFields = parsed.complete || !parsed.event_data ? [] : Object.keys(parsed.event_data).filter(
          field => !parsed.event_data[field]
        );

        router.push({
          pathname: "/confirm",
          params: {
            data: JSON.stringify(parsed),
            captureMethod: "manual",
            auditId: auditRecord.id,
            missingFields: JSON.stringify(missingFields),
            productOptions: productOptions ? JSON.stringify(productOptions) : null,
            confidence: parsed.confidence?.toString() || null,
          },
        });
        setTextInput("");
      }
    } catch (error) {
      console.error("Text submit error:", error);
      Alert.alert("Error", error.message || "Failed to process input. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  }, [textInput, router, user]);

  const handlePromptPress = useCallback((prompt) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTextInput(prompt);
  }, []);

  // Get user initials from user metadata or email
  const getUserInitials = () => {
    if (!user) return "?";

    // Try to get from user metadata first
    if (user.user_metadata?.full_name) {
      const names = user.user_metadata.full_name.split(' ');
      if (names.length >= 2) {
        return (names[0][0] + names[names.length - 1][0]).toUpperCase();
      }
      return user.user_metadata.full_name.substring(0, 2).toUpperCase();
    }

    // Fallback to email - get first and second part before @
    if (user.email) {
      const emailParts = user.email.split('@')[0].split('.');
      if (emailParts.length >= 2) {
        return (emailParts[0][0] + emailParts[1][0]).toUpperCase();
      }
      return user.email.substring(0, 2).toUpperCase();
    }

    return "?";
  };

  if (!fontsLoaded) {
    return null;
  }

  // Show sign-in prompt if not authenticated
  if (!isAuthenticated) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Header
          title="HealthLog"
          showCredits={false}
          onMenuPress={() => {}}
          onProfilePress={() => router.push("/(tabs)/profile")}
          userInitials="?"
        />
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 32 }}>
          <Text style={{
            fontSize: 24,
            fontFamily: "Poppins_600SemiBold",
            color: colors.text,
            textAlign: "center",
            marginBottom: 16,
          }}>
            Welcome to HealthLog
          </Text>
          <Text style={{
            fontSize: 16,
            fontFamily: "Poppins_400Regular",
            color: colors.textSecondary,
            textAlign: "center",
            marginBottom: 32,
          }}>
            Sign in to start tracking your health events
          </Text>
          <TouchableOpacity
            style={{
              backgroundColor: colors.primary,
              borderRadius: 16,
              paddingVertical: 14,
              paddingHorizontal: 32,
            }}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              signIn();
            }}
          >
            <Text style={{
              fontSize: 16,
              fontFamily: "Poppins_600SemiBold",
              color: colors.background,
            }}>
              Sign In with Google
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ProtectedRoute>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Header
          title="HealthLog"
          showCredits={false}
          onMenuPress={() => {}}
          onProfilePress={() => router.push("/(tabs)/profile")}
          userInitials={getUserInitials()}
        />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 32,
          paddingBottom: insets.bottom + 24,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            backgroundColor: colors.cardBackground,
            borderRadius: 24,
            padding: 24,
            borderWidth: 1,
            borderColor: colors.outline,
            marginBottom: 32,
          }}
        >
          <View style={{ position: "relative", alignSelf: "center", marginBottom: 24 }}>
            <TouchableOpacity
              testID="mic-button"
              style={{
                width: 120,
                height: 120,
                borderRadius: 60,
                backgroundColor: isRecording ? "#EF4444" : colors.primary,
                alignItems: "center",
                justifyContent: "center",
                shadowColor: isRecording ? "#EF4444" : colors.primary,
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: 0.3,
                shadowRadius: 16,
                elevation: 8,
                opacity: isProcessing ? 0.6 : 1,
              }}
              onPress={handleVoicePress}
              disabled={isProcessing}
              accessibilityLabel={isRecording ? "Stop recording" : "Record voice"}
            >
              {isProcessing ? (
                <ActivityIndicator size="large" color={colors.background} />
              ) : (
                <Mic size={48} color={colors.background} />
              )}
            </TouchableOpacity>
            {isRecording && (
              <View
                style={{
                  position: "absolute",
                  bottom: -8,
                  alignSelf: "center",
                  backgroundColor: "#EF4444",
                  paddingHorizontal: 12,
                  paddingVertical: 4,
                  borderRadius: 12,
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontFamily: "Poppins_500Medium",
                    color: colors.background,
                  }}
                >
                  Recording...
                </Text>
              </View>
            )}
          </View>

          <TextInput
            testID="text-input"
            style={{
              backgroundColor: colors.fieldFill,
              borderRadius: 16,
              paddingHorizontal: 16,
              paddingVertical: 14,
              fontSize: 15,
              fontFamily: "Poppins_400Regular",
              color: colors.text,
              marginBottom: 16,
              minHeight: 52,
            }}
            placeholder="Or type your health event here..."
            placeholderTextColor={colors.textPlaceholder}
            value={textInput}
            onChangeText={setTextInput}
            multiline
          />

          <View style={{ flexDirection: "row", gap: 12 }}>
            <TouchableOpacity
              testID="camera-button"
              style={{
                flex: 1,
                height: 48,
                borderRadius: 12,
                backgroundColor: colors.fieldFill,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
              onPress={handleCameraPress}
              disabled={isProcessing}
              accessibilityLabel="Take photo"
            >
              <Camera size={20} color={colors.text} />
              <Text
                style={{
                  fontSize: 15,
                  fontFamily: "Poppins_500Medium",
                  color: colors.text,
                }}
              >
                Photo
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="submit-button"
              style={{
                flex: 1,
                height: 48,
                borderRadius: 12,
                backgroundColor: textInput.trim()
                  ? colors.primary
                  : colors.fieldFill,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
              onPress={handleTextSubmit}
              disabled={isProcessing || !textInput.trim()}
              accessibilityLabel="Submit text"
            >
              <Send
                size={20}
                color={
                  textInput.trim() ? colors.background : colors.textSecondary
                }
              />
              <Text
                style={{
                  fontSize: 15,
                  fontFamily: "Poppins_500Medium",
                  color: textInput.trim()
                    ? colors.background
                    : colors.textSecondary,
                }}
              >
                Submit
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View>
          <Text
            style={{
              fontSize: 18,
              fontFamily: "Poppins_600SemiBold",
              color: colors.text,
              marginBottom: 16,
            }}
          >
            Try these examples:
          </Text>

          <View style={{ gap: 12 }}>
            {samplePrompts.map((prompt, index) => (
              <TouchableOpacity
                key={index}
                style={{
                  backgroundColor: colors.primaryUltraLight,
                  borderRadius: 12,
                  padding: 16,
                  borderWidth: 1,
                  borderColor: colors.primary + "20",
                }}
                onPress={() => handlePromptPress(prompt)}
                accessibilityLabel={`Use example: ${prompt}`}
              >
                <Text
                  style={{
                    fontSize: 14,
                    fontFamily: "Poppins_400Regular",
                    color: colors.text,
                  }}
                >
                  {prompt}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* Success Checkmark Overlay */}
      {showSuccessCheckmark && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0, 0, 0, 0.3)",
            zIndex: 9999,
          }}
        >
          <View
            style={{
              width: 120,
              height: 120,
              borderRadius: 60,
              backgroundColor: "#10B981",
              alignItems: "center",
              justifyContent: "center",
              shadowColor: "#10B981",
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.3,
              shadowRadius: 16,
              elevation: 8,
            }}
          >
            <Check size={64} color="#FFFFFF" strokeWidth={3} />
          </View>
        </View>
      )}
    </View>
    </ProtectedRoute>
  );
}
