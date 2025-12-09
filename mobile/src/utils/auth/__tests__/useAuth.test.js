import { renderHook, waitFor, act } from '@testing-library/react-native';
import { useAuth } from '../useAuth';
import * as SupabaseAuth from '@/utils/supabaseAuth';
import { signInWithGoogleWebBrowser } from '../googleAuth';
import { Platform } from 'react-native';

// Mock dependencies
jest.mock('@/utils/supabaseAuth');
jest.mock('../googleAuth');

describe('useAuth Hook', () => {
  const mockSession = {
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    expires_at: Date.now() / 1000 + 3600,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    SupabaseAuth.getSession.mockResolvedValue(null);
    SupabaseAuth.saveSession.mockResolvedValue();
    SupabaseAuth.signOut.mockResolvedValue();
  });

  describe('Initialization', () => {
    it('should check session on mount', async () => {
      SupabaseAuth.getSession.mockResolvedValue(mockSession);

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      expect(SupabaseAuth.getSession).toHaveBeenCalled();
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.session).toEqual(mockSession);
    });

    it('should set isAuthenticated to false when no session exists', async () => {
      SupabaseAuth.getSession.mockResolvedValue(null);

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.session).toBeNull();
    });
  });

  describe('Google Sign-In', () => {
    it('should successfully sign in with Google', async () => {
      SupabaseAuth.getSession.mockResolvedValue(null);
      signInWithGoogleWebBrowser.mockResolvedValue({
        session: mockSession,
        error: null,
      });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      // Call signIn
      let signInResult;
      await act(async () => {
        signInResult = await result.current.signIn();
      });

      expect(signInWithGoogleWebBrowser).toHaveBeenCalled();
      expect(SupabaseAuth.saveSession).toHaveBeenCalledWith(mockSession);
      expect(signInResult.error).toBeNull();

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
        expect(result.current.session).toEqual(mockSession);
      });
    });

    it('should handle sign-in errors', async () => {
      const mockError = 'Google sign-in failed';
      signInWithGoogleWebBrowser.mockResolvedValue({
        session: null,
        error: mockError,
      });

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      let signInResult;
      await act(async () => {
        signInResult = await result.current.signIn();
      });

      expect(signInResult.error).toBe(mockError);
      expect(result.current.isAuthenticated).toBe(false);
      expect(SupabaseAuth.saveSession).not.toHaveBeenCalled();
    });

    it('should handle sign-in exceptions', async () => {
      const mockError = new Error('Network error');
      signInWithGoogleWebBrowser.mockRejectedValue(mockError);

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      let signInResult;
      await act(async () => {
        signInResult = await result.current.signIn();
      });

      expect(signInResult.error).toBe('Network error');
      expect(result.current.isAuthenticated).toBe(false);
    });

    it('should set loading state during sign-in', async () => {
      let resolveSignIn;
      const signInPromise = new Promise((resolve) => {
        resolveSignIn = resolve;
      });

      signInWithGoogleWebBrowser.mockReturnValue(signInPromise);

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      // Start sign-in
      act(() => {
        result.current.signIn();
      });

      // Should be loading
      await waitFor(() => {
        expect(result.current.isLoading).toBe(true);
      });

      // Resolve sign-in
      await act(async () => {
        resolveSignIn({ session: mockSession, error: null });
      });

      // Should no longer be loading
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
  });

  describe('Sign Out', () => {
    it('should successfully sign out', async () => {
      SupabaseAuth.getSession.mockResolvedValue(mockSession);

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      // Sign out
      await act(async () => {
        await result.current.signOut();
      });

      expect(SupabaseAuth.signOut).toHaveBeenCalled();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.session).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });

  describe('Access Token', () => {
    it('should return access token from session', async () => {
      SupabaseAuth.getSession.mockResolvedValue(mockSession);

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      const accessToken = await result.current.getAccessToken();

      expect(accessToken).toBe('mock-access-token');
      expect(SupabaseAuth.getSession).toHaveBeenCalled();
    });

    it('should return undefined when no session exists', async () => {
      SupabaseAuth.getSession.mockResolvedValue(null);

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      const accessToken = await result.current.getAccessToken();

      expect(accessToken).toBeUndefined();
    });
  });

  describe('Platform-specific behavior', () => {
    it('should use WebView on web platform', async () => {
      // Mock web platform
      Platform.OS = 'web';

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      const signInResult = await act(async () => {
        return await result.current.signIn();
      });

      // Should not call Google browser auth on web
      expect(signInWithGoogleWebBrowser).not.toHaveBeenCalled();
      expect(signInResult.error).toBeNull();

      // Restore platform
      Platform.OS = 'ios';
    });
  });
});
