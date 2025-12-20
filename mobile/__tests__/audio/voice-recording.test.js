/**
 * Test Suite for Voice Recording Functionality
 *
 * Tests the voice recording utilities to ensure proper migration
 * from expo-av to expo-audio without breaking functionality.
 */

import {
  requestAudioPermissions,
  startRecording,
  stopRecording,
  deleteAudioFile
} from '@/utils/voiceRecording';
import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import AudioModule from 'expo-audio/build/AudioModule';
import * as FileSystem from 'expo-file-system/legacy';

// Mocks are defined in jest.setup.js

// Mock expo-file-system
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));

describe('Voice Recording Utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('requestAudioPermissions', () => {
    it('should request audio permissions and return true when granted', async () => {
      getRecordingPermissionsAsync.mockResolvedValue({ granted: false });
      requestRecordingPermissionsAsync.mockResolvedValue({ granted: true });

      const result = await requestAudioPermissions();

      expect(getRecordingPermissionsAsync).toHaveBeenCalled();
      expect(requestRecordingPermissionsAsync).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when permission is denied', async () => {
      getRecordingPermissionsAsync.mockResolvedValue({ granted: false });
      requestRecordingPermissionsAsync.mockResolvedValue({ granted: false });

      const result = await requestAudioPermissions();

      expect(getRecordingPermissionsAsync).toHaveBeenCalled();
      expect(requestRecordingPermissionsAsync).toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      getRecordingPermissionsAsync.mockRejectedValue(new Error('Permission error'));

      const result = await requestAudioPermissions();

      expect(result).toBe(false);
    });
  });

  describe('startRecording', () => {
    it('should request permissions before starting recording', async () => {
      getRecordingPermissionsAsync.mockResolvedValue({ granted: false });
      requestRecordingPermissionsAsync.mockResolvedValue({ granted: true });
      setAudioModeAsync.mockResolvedValue();

      const recorder = await startRecording();

      expect(requestRecordingPermissionsAsync).toHaveBeenCalled();
      expect(setAudioModeAsync).toHaveBeenCalledWith({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      expect(AudioModule.AudioRecorder).toHaveBeenCalled();
      expect(recorder).toBeDefined();
    });

    it('should throw error when permission is not granted', async () => {
      getRecordingPermissionsAsync.mockResolvedValue({ granted: false });
      requestRecordingPermissionsAsync.mockResolvedValue({ granted: false });

      await expect(startRecording()).rejects.toThrow('Audio recording permission not granted');
    });
  });

  describe('stopRecording', () => {
    it('should stop recording and return URI', async () => {
      const mockRecorder = {
        stop: jest.fn().mockResolvedValue(),
        uri: 'file://test-recording.m4a',
      };

      setAudioModeAsync.mockResolvedValue();

      const uri = await stopRecording(mockRecorder);

      expect(mockRecorder.stop).toHaveBeenCalled();
      expect(setAudioModeAsync).toHaveBeenCalledWith({
        allowsRecording: false,
      });
      expect(uri).toBe('file://test-recording.m4a');
    });

    it('should handle errors during stop', async () => {
      const mockRecorder = {
        stop: jest.fn().mockRejectedValue(new Error('Stop failed')),
      };

      await expect(stopRecording(mockRecorder)).rejects.toThrow('Stop failed');
    });
  });

  describe('deleteAudioFile', () => {
    it('should delete audio file', async () => {
      FileSystem.deleteAsync.mockResolvedValue();

      await deleteAudioFile('file://test-recording.m4a');

      expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file://test-recording.m4a', {
        idempotent: true,
      });
    });

    it('should handle deletion errors gracefully', async () => {
      FileSystem.deleteAsync.mockRejectedValue(new Error('Delete failed'));

      // Should not throw - errors are logged but swallowed
      await expect(deleteAudioFile('file://test-recording.m4a')).resolves.toBeUndefined();
    });
  });
});
