import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  RecordingPresets,
} from 'expo-audio';
import AudioModule from 'expo-audio/build/AudioModule';
import * as FileSystem from 'expo-file-system/legacy';
import { fetch as expoFetch } from 'expo/fetch';

/**
 * Request audio recording permissions
 */
export async function requestAudioPermissions() {
  try {
    console.log('Checking audio permissions...');

    // First check if we already have permissions
    const existingPermission = await getRecordingPermissionsAsync();
    console.log('Existing permission:', existingPermission);

    if (existingPermission.granted) {
      console.log('Permission already granted');
      return true;
    }

    // If not, request permissions
    console.log('Requesting new permission...');
    const permission = await requestRecordingPermissionsAsync();
    console.log('Permission response:', permission);

    // expo-audio returns { granted: boolean }
    const isGranted = permission.granted === true;
    console.log('Permission granted:', isGranted);

    return isGranted;
  } catch (error) {
    console.error('Error requesting audio permissions:', error);
    return false;
  }
}

/**
 * Start recording audio
 */
export async function startRecording() {
  try {
    // Request permissions
    const hasPermission = await requestAudioPermissions();
    if (!hasPermission) {
      throw new Error('Audio recording permission not granted');
    }

    // Set audio mode for recording
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
    });

    // Create and start recording with expo-audio
    const recorder = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);
    await recorder.prepareToRecordAsync();
    recorder.record();

    return recorder;
  } catch (error) {
    console.error('Error starting recording:', error);
    throw error;
  }
}

/**
 * Stop recording and return the URI
 */
export async function stopRecording(recorder) {
  try {
    await recorder.stop();
    const uri = recorder.uri;

    // Reset audio mode
    await setAudioModeAsync({
      allowsRecording: false,
    });

    return uri;
  } catch (error) {
    console.error('Error stopping recording:', error);
    throw error;
  }
}

/**
 * Transcribe audio using OpenAI Whisper API
 */
export async function transcribeAudio(audioUri, apiKey) {
  if (!apiKey || apiKey === 'your_openai_api_key_here') {
    throw new Error('OpenAI API key is required for transcription');
  }

  return new Promise(async (resolve, reject) => {
    try {
      console.log('Transcribing audio from URI:', audioUri);

      // Get file info
      const fileInfo = await FileSystem.getInfoAsync(audioUri);
      console.log('File info:', fileInfo);

      if (!fileInfo.exists) {
        throw new Error('Audio file does not exist');
      }

      // Determine file name and type
      const fileName = audioUri.split('/').pop() || 'recording.m4a';
      const fileType = fileName.endsWith('.caf') ? 'audio/x-caf' : 'audio/m4a';

      console.log('File name:', fileName);
      console.log('File type:', fileType);

      // Create form data
      const formData = new FormData();
      formData.append('file', {
        uri: audioUri,
        type: fileType,
        name: fileName,
      });
      formData.append('model', 'whisper-1');

      console.log('Calling OpenAI Whisper API using XMLHttpRequest...');

      // Use XMLHttpRequest for better FormData support in React Native
      const xhr = new XMLHttpRequest();

      xhr.onload = () => {
        console.log('Whisper API response status:', xhr.status);

        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const result = JSON.parse(xhr.responseText);
            console.log('Transcription result:', result);

            if (!result.text) {
              reject(new Error('No transcription text returned'));
            } else {
              // Return both text and metadata
              resolve({
                text: result.text,
                metadata: {
                  model: 'whisper-1',
                  duration: result.usage?.seconds || null,
                  usage_type: result.usage?.type || null
                }
              });
            }
          } catch (e) {
            console.error('Error parsing response:', e);
            reject(new Error('Failed to parse transcription response'));
          }
        } else {
          console.error('Whisper API error:', xhr.responseText);
          try {
            const error = JSON.parse(xhr.responseText);
            reject(new Error(`Whisper API error: ${error.error?.message || 'Unknown error'}`));
          } catch (e) {
            reject(new Error(`Whisper API error (${xhr.status}): ${xhr.responseText}`));
          }
        }
      };

      xhr.onerror = () => {
        console.error('Network error during transcription');
        reject(new Error('Network error during transcription'));
      };

      xhr.ontimeout = () => {
        console.error('Transcription request timed out');
        reject(new Error('Transcription request timed out'));
      };

      xhr.open('POST', 'https://api.openai.com/v1/audio/transcriptions');
      xhr.setRequestHeader('Authorization', `Bearer ${apiKey}`);
      xhr.timeout = 30000; // 30 second timeout

      xhr.send(formData);
    } catch (error) {
      console.error('Error transcribing audio:', error);
      reject(error);
    }
  });
}

/**
 * Clean up audio file
 */
export async function deleteAudioFile(uri) {
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch (error) {
    console.error('Error deleting audio file:', error);
  }
}
