import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import HomeScreen from '../home';
import { useAuth } from '@/utils/auth/useAuth';
import useUser from '@/utils/auth/useUser';
import { startRecording, stopRecording } from '@/utils/voiceRecording';
import { parseTextWithGemini } from '@/utils/geminiParser';
import { createAuditRecord, getUserRecentEvents } from '@/utils/voiceEventParser';

// Mock dependencies
jest.mock('expo-image-picker');
jest.mock('expo-router');
jest.mock('@/utils/auth/useAuth');
jest.mock('@/utils/auth/useUser');
jest.mock('@/utils/voiceRecording');
jest.mock('@/utils/geminiParser');
jest.mock('@/utils/voiceEventParser');
jest.mock('@/components/useColors.jsx', () => ({
  useColors: jest.fn(() => ({
    background: '#FFFFFF',
    text: '#000000',
    primary: '#007AFF',
  })),
}));
jest.mock('@/components/Header.jsx', () => 'Header');
jest.mock('@/utils/useUpload.js', () => ({
  __esModule: true,
  default: jest.fn(() => [jest.fn()]),
}));
jest.mock('@/utils/productSearch', () => ({
  shouldSearchProducts: jest.fn(() => false),
  searchAllProducts: jest.fn(() => []),
}));

// Spy on Alert
jest.spyOn(Alert, 'alert');

describe('HomeScreen', () => {
  const mockRouter = {
    push: jest.fn(),
  };

  const mockUser = {
    id: 'test-user-id',
    email: 'test@example.com',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up default mocks
    useRouter.mockReturnValue(mockRouter);
    useAuth.mockReturnValue({
      getAccessToken: jest.fn(() => Promise.resolve('mock-token')),
      isAuthenticated: true,
      signIn: jest.fn(),
    });
    useUser.mockReturnValue({
      data: mockUser,
    });

    Haptics.impactAsync.mockResolvedValue();
    getUserRecentEvents.mockResolvedValue([]);
    createAuditRecord.mockResolvedValue({ id: 'audit-123' });

    // Mock environment variables
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'mock-gemini-key';
  });

  describe('Camera Button', () => {
    it('should launch camera when Photo button is pressed', async () => {
      // Mock camera permission as granted
      ImagePicker.requestCameraPermissionsAsync.mockResolvedValue({
        granted: true,
        status: 'granted',
      });

      // Mock camera result
      ImagePicker.launchCameraAsync.mockResolvedValue({
        canceled: false,
        assets: [{
          uri: 'file://photo.jpg',
          width: 1000,
          height: 1000,
        }],
      });

      const { getByTestId } = render(<HomeScreen />);

      // Find and press the camera button
      const cameraButton = getByTestId('camera-button');
      fireEvent.press(cameraButton);

      // Wait for async operations
      await waitFor(() => {
        expect(ImagePicker.requestCameraPermissionsAsync).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(ImagePicker.launchCameraAsync).toHaveBeenCalledWith({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          quality: 0.8,
        });
      });

      // Verify haptic feedback
      expect(Haptics.impactAsync).toHaveBeenCalled();
    });

    it('should show alert when camera permission is denied', async () => {
      // Mock camera permission as denied
      ImagePicker.requestCameraPermissionsAsync.mockResolvedValue({
        granted: false,
        status: 'denied',
      });

      const { getByTestId } = render(<HomeScreen />);

      const cameraButton = getByTestId('camera-button');
      fireEvent.press(cameraButton);

      await waitFor(() => {
        expect(ImagePicker.requestCameraPermissionsAsync).toHaveBeenCalled();
      });

      // Should show permission alert
      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith(
          'Permission required',
          'Camera permission is needed to capture photos.'
        );
      });

      // Should NOT launch camera
      expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
    });

    it('should handle camera errors gracefully', async () => {
      // Mock camera to throw error
      ImagePicker.requestCameraPermissionsAsync.mockRejectedValue(
        new Error('Camera not available')
      );

      const { getByTestId } = render(<HomeScreen />);

      const cameraButton = getByTestId('camera-button');
      fireEvent.press(cameraButton);

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith(
          'Error',
          'Camera not available'
        );
      });
    });
  });

  describe('Microphone Button', () => {
    it('should start audio recording when microphone button is pressed', async () => {
      const mockRecording = { id: 'recording-123' };
      startRecording.mockResolvedValue(mockRecording);

      const { getByTestId } = render(<HomeScreen />);

      const micButton = getByTestId('mic-button');
      fireEvent.press(micButton);

      await waitFor(() => {
        expect(startRecording).toHaveBeenCalled();
      });

      // Verify haptic feedback
      expect(Haptics.impactAsync).toHaveBeenCalled();
    });

    it('should stop recording and process audio when pressed again', async () => {
      const mockRecording = { id: 'recording-123' };
      const mockAudioUri = 'file://audio.m4a';

      startRecording.mockResolvedValue(mockRecording);
      stopRecording.mockResolvedValue(mockAudioUri);

      const { getByTestId } = render(<HomeScreen />);

      const micButton = getByTestId('mic-button');

      // Start recording
      fireEvent.press(micButton);
      await waitFor(() => {
        expect(startRecording).toHaveBeenCalled();
      });

      // Stop recording
      fireEvent.press(micButton);
      await waitFor(() => {
        expect(stopRecording).toHaveBeenCalledWith(mockRecording);
      });
    });

    it('should handle recording errors gracefully', async () => {
      startRecording.mockRejectedValue(new Error('Microphone permission denied'));

      const { getByTestId } = render(<HomeScreen />);

      const micButton = getByTestId('mic-button');
      fireEvent.press(micButton);

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith(
          'Error',
          'Microphone permission denied'
        );
      });
    });
  });

  describe('Text Input Submit', () => {
    it('should process text input when submit button is pressed', async () => {
      const mockParsedData = {
        event_type: 'food',
        event_data: {
          description: 'apple',
          quantity: 1,
        },
        confidence: 95,
        complete: true,
      };

      parseTextWithGemini.mockResolvedValue(mockParsedData);

      const { getByTestId } = render(<HomeScreen />);

      const textInput = getByTestId('text-input');
      const submitButton = getByTestId('submit-button');

      // Enter text
      fireEvent.changeText(textInput, 'Ate an apple');

      // Submit
      fireEvent.press(submitButton);

      await waitFor(() => {
        expect(parseTextWithGemini).toHaveBeenCalledWith(
          'Ate an apple',
          'mock-gemini-key',
          []
        );
      });

      await waitFor(() => {
        expect(createAuditRecord).toHaveBeenCalled();
      });

      // Verify haptic feedback
      expect(Haptics.impactAsync).toHaveBeenCalled();
    });

    it('should not submit when text input is empty', async () => {
      const { getByTestId } = render(<HomeScreen />);

      const submitButton = getByTestId('submit-button');

      // Press submit without entering text
      fireEvent.press(submitButton);

      // Should not call parsing functions
      expect(parseTextWithGemini).not.toHaveBeenCalled();
    });

    it('should navigate to confirmation screen when data needs confirmation', async () => {
      const mockParsedData = {
        event_type: 'food',
        event_data: {
          description: 'chicken',
        },
        confidence: 70,
        complete: false,
      };

      parseTextWithGemini.mockResolvedValue(mockParsedData);

      const { getByTestId } = render(<HomeScreen />);

      const textInput = getByTestId('text-input');
      const submitButton = getByTestId('submit-button');

      fireEvent.changeText(textInput, 'Ate chicken');
      fireEvent.press(submitButton);

      await waitFor(() => {
        expect(mockRouter.push).toHaveBeenCalledWith(
          expect.objectContaining({
            pathname: '/confirm',
          })
        );
      });
    });

    it('should show alert when Gemini API key is not configured', async () => {
      process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'your_gemini_api_key_here';

      const { getByTestId } = render(<HomeScreen />);

      const textInput = getByTestId('text-input');
      const submitButton = getByTestId('submit-button');

      fireEvent.changeText(textInput, 'Test input');
      fireEvent.press(submitButton);

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith(
          'Configuration Required',
          'Please set your Gemini API key in the .env file.'
        );
      });
    });
  });

  describe('Integration Tests', () => {
    it('should maintain proper state during recording lifecycle', async () => {
      const mockRecording = { id: 'recording-123' };
      startRecording.mockResolvedValue(mockRecording);
      stopRecording.mockResolvedValue('file://audio.m4a');

      const { getByTestId } = render(<HomeScreen />);
      const micButton = getByTestId('mic-button');

      // Camera should work before recording
      const cameraButton = getByTestId('camera-button');
      ImagePicker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true });
      ImagePicker.launchCameraAsync.mockResolvedValue({ canceled: true });

      fireEvent.press(cameraButton);
      await waitFor(() => expect(ImagePicker.launchCameraAsync).toHaveBeenCalled());

      // Start recording
      fireEvent.press(micButton);
      await waitFor(() => expect(startRecording).toHaveBeenCalled());

      // Stop recording
      fireEvent.press(micButton);
      await waitFor(() => expect(stopRecording).toHaveBeenCalled());
    });
  });
});
