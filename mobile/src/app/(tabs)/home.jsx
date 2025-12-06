import React, { useState, useCallback } from "react";
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
import { Mic, Camera, Send } from "lucide-react-native";
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

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const router = useRouter();
  const [upload] = useUpload();
  const { getAccessToken, isAuthenticated, signIn } = useAuth();

  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
  });

  const [textInput, setTextInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const samplePrompts = [
    "Log 6 units of basal insulin",
    "Ate large chicken thigh with broccoli",
    "Started 30 min jog",
    "Took 500mg vitamin C supplement",
    "20 minute sauna session at 180°F",
  ];

  const handleVoicePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      "Voice Recording",
      "Voice recording requires audio transcription service integration. Please use text input for now.",
      [{ text: "OK" }],
    );
  }, []);

  const handleCameraPress = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert(
        "Permission required",
        "Camera permission is needed to capture photos.",
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      await handlePhotoCapture(result.assets[0]);
    }
  }, []);

  const handlePhotoCapture = useCallback(
    async (image) => {
      try {
        setIsProcessing(true);

        const { url, error } = await upload({ reactNativeAsset: image });
        if (error) {
          throw new Error("Failed to upload image");
        }

        const token = await getAccessToken();
        const response = await fetch("/api/photo/analyze", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ imageUrl: url }),
        });

        if (!response.ok) {
          throw new Error("Failed to analyze photo");
        }

        const parsedData = await response.json();

        router.push({
          pathname: "/confirm",
          params: {
            data: JSON.stringify(parsedData),
            captureMethod: "photo",
          },
        });
      } catch (error) {
        console.error("Photo capture error:", error);
        Alert.alert("Error", "Failed to process photo. Please try again.");
      } finally {
        setIsProcessing(false);
      }
    },
    [upload, router, getAccessToken],
  );

  const handleTextSubmit = useCallback(async () => {
    if (!textInput.trim()) return;

    try {
      setIsProcessing(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const token = await getAccessToken();
      const response = await fetch("/api/voice/parse", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: textInput }),
      });

      if (!response.ok) {
        throw new Error("Failed to parse text");
      }

      const parsedData = await response.json();

      router.push({
        pathname: "/confirm",
        params: {
          data: JSON.stringify(parsedData),
          captureMethod: "manual",
        },
      });

      setTextInput("");
    } catch (error) {
      console.error("Text submit error:", error);
      Alert.alert("Error", "Failed to process input. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  }, [textInput, router, getAccessToken]);

  const handlePromptPress = useCallback((prompt) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTextInput(prompt);
  }, []);

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
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Header
        title="HealthLog"
        showCredits={false}
        onMenuPress={() => {}}
        onProfilePress={() => router.push("/(tabs)/profile")}
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
          <TouchableOpacity
            style={{
              width: 120,
              height: 120,
              borderRadius: 60,
              backgroundColor: colors.primary,
              alignSelf: "center",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 24,
              shadowColor: colors.primary,
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.3,
              shadowRadius: 16,
              elevation: 8,
            }}
            onPress={handleVoicePress}
            disabled={isProcessing}
            accessibilityLabel="Record voice"
          >
            {isProcessing ? (
              <ActivityIndicator size="large" color={colors.background} />
            ) : (
              <Mic size={48} color={colors.background} />
            )}
          </TouchableOpacity>

          <TextInput
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
    </View>
  );
}
