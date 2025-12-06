import React from "react";
import {
  Modal,
  View,
  TouchableOpacity,
  Text,
  SafeAreaView,
} from "react-native";
import { WebView } from "react-native-webview";
import { X } from "lucide-react-native";

export default function GoogleAuthWebView({ visible, onClose, onMessage }) {
  // Load the sign-in page which will handle the OAuth flow
  const baseUrl =
    process.env.EXPO_PUBLIC_BASE_URL ||
    "https://health-activity-logger-148.created.app";
  const authUrl = `${baseUrl}/account/signin`;

  const handleMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      onMessage(data);
    } catch (error) {
      console.error("Error parsing auth message:", error);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderBottomWidth: 1,
            borderBottomColor: "#e5e5e5",
          }}
        >
          <Text style={{ fontSize: 17, fontWeight: "600" }}>Sign In</Text>
          <TouchableOpacity
            onPress={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: "#f5f5f5",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={20} color="#000" />
          </TouchableOpacity>
        </View>

        <WebView
          source={{ uri: authUrl }}
          onMessage={handleMessage}
          style={{ flex: 1 }}
          sharedCookiesEnabled
        />
      </SafeAreaView>
    </Modal>
  );
}
