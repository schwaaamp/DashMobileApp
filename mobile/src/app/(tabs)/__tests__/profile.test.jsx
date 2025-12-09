import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import ProfileScreen from '../profile';
import useAuth from '@/utils/auth/useAuth';
import useUser from '@/utils/auth/useUser';

// Mock dependencies
jest.mock('expo-router');
jest.mock('@/utils/auth/useAuth');
jest.mock('@/utils/auth/useUser');
jest.mock('@/components/useColors.jsx', () => ({
  useColors: jest.fn(() => ({
    background: '#FFFFFF',
    text: '#000000',
    primary: '#007AFF',
    cardBackground: '#F5F5F5',
    outline: '#E0E0E0',
  })),
}));
jest.mock('@/components/Header.jsx', () => 'Header');
jest.mock('@/components/GoogleAuthWebView', () => 'GoogleAuthWebView');

// Spy on Alert
jest.spyOn(Alert, 'alert');

describe('ProfileScreen', () => {
  const mockRouter = {
    push: jest.fn(),
    replace: jest.fn(),
  };

  const mockSignOut = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    useRouter.mockReturnValue(mockRouter);
    useAuth.mockReturnValue({
      isAuthenticated: true,
      isReady: true,
      signOut: mockSignOut,
      showAuthWebView: false,
      closeAuthWebView: jest.fn(),
      handleAuthMessage: jest.fn(),
    });

    // Mock Alert.alert to prevent blocking tests
    Alert.alert.mockImplementation((title, message, buttons) => {
      if (buttons) {
        // For logout confirmation, call the destructive action
        const logoutButton = buttons.find(btn => btn.style === 'destructive');
        if (logoutButton) {
          return logoutButton.onPress();
        }
      }
    });
  });

  describe('User Initials Display', () => {
    it('should display correct initials from full name', () => {
      const mockUser = {
        id: 'user-1',
        email: 'john.doe@example.com',
        user_metadata: {
          full_name: 'John Doe',
        },
      };

      useUser.mockReturnValue({
        data: mockUser,
        loading: false,
      });

      const { UNSAFE_getByType } = render(<ProfileScreen />);

      // Header should receive correct initials
      const header = UNSAFE_getByType('Header');
      expect(header.props.userInitials).toBe('JD');
    });

    it('should display initials from single name', () => {
      const mockUser = {
        id: 'user-1',
        email: 'madonna@example.com',
        user_metadata: {
          full_name: 'Madonna',
        },
      };

      useUser.mockReturnValue({
        data: mockUser,
        loading: false,
      });

      const { UNSAFE_getByType } = render(<ProfileScreen />);

      const header = UNSAFE_getByType('Header');
      // Should take first 2 characters of single name
      expect(header.props.userInitials).toBe('MA');
    });

    it('should fallback to email initials when no full name', () => {
      const mockUser = {
        id: 'user-1',
        email: 'john.smith@example.com',
        user_metadata: {},
      };

      useUser.mockReturnValue({
        data: mockUser,
        loading: false,
      });

      const { UNSAFE_getByType } = render(<ProfileScreen />);

      const header = UNSAFE_getByType('Header');
      // Should extract initials from email parts before @
      expect(header.props.userInitials).toBe('JS');
    });

    it('should fallback to first 2 characters of email when email has no dot', () => {
      const mockUser = {
        id: 'user-1',
        email: 'johndoe@example.com',
        user_metadata: {},
      };

      useUser.mockReturnValue({
        data: mockUser,
        loading: false,
      });

      const { UNSAFE_getByType } = render(<ProfileScreen />);

      const header = UNSAFE_getByType('Header');
      expect(header.props.userInitials).toBe('JO');
    });

    it('should display "?" when user is not loaded', () => {
      useUser.mockReturnValue({
        data: null,
        loading: true,
      });

      const { UNSAFE_getByType } = render(<ProfileScreen />);

      const header = UNSAFE_getByType('Header');
      expect(header.props.userInitials).toBe('?');
    });

    it('should handle complex names correctly', () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        user_metadata: {
          full_name: 'Mary Jane Watson Parker',
        },
      };

      useUser.mockReturnValue({
        data: mockUser,
        loading: false,
      });

      const { UNSAFE_getByType } = render(<ProfileScreen />);

      const header = UNSAFE_getByType('Header');
      // Should take first and last name initials
      expect(header.props.userInitials).toBe('MP');
    });

    it('should uppercase initials correctly', () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        user_metadata: {
          full_name: 'alice bob',
        },
      };

      useUser.mockReturnValue({
        data: mockUser,
        loading: false,
      });

      const { UNSAFE_getByType } = render(<ProfileScreen />);

      const header = UNSAFE_getByType('Header');
      expect(header.props.userInitials).toBe('AB');
    });
  });

  describe('Initials Matching Logged-In User', () => {
    it('should always display initials matching the logged-in user', () => {
      const mockUser1 = {
        id: 'user-1',
        email: 'alice@example.com',
        user_metadata: {
          full_name: 'Alice Anderson',
        },
      };

      useUser.mockReturnValue({
        data: mockUser1,
        loading: false,
      });

      const { UNSAFE_getByType, rerender } = render(<ProfileScreen />);

      let header = UNSAFE_getByType('Header');
      expect(header.props.userInitials).toBe('AA');

      // Simulate user change (different logged-in user)
      const mockUser2 = {
        id: 'user-2',
        email: 'bob@example.com',
        user_metadata: {
          full_name: 'Bob Brown',
        },
      };

      useUser.mockReturnValue({
        data: mockUser2,
        loading: false,
      });

      rerender(<ProfileScreen />);

      header = UNSAFE_getByType('Header');
      expect(header.props.userInitials).toBe('BB');
    });
  });

  describe('Logout Functionality', () => {
    it('should show confirmation dialog when logout button is pressed', () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        user_metadata: {
          full_name: 'Test User',
        },
      };

      useUser.mockReturnValue({
        data: mockUser,
        loading: false,
      });

      const { getByText } = render(<ProfileScreen />);

      // Find and press logout button
      const logoutButton = getByText('Log Out');
      fireEvent.press(logoutButton);

      // Should show confirmation alert
      expect(Alert.alert).toHaveBeenCalledWith(
        'Log Out',
        'Are you sure you want to log out?',
        expect.any(Array)
      );
    });

    it('should call signOut and navigate home after logout confirmation', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        user_metadata: {
          full_name: 'Test User',
        },
      };

      useUser.mockReturnValue({
        data: mockUser,
        loading: false,
      });

      mockSignOut.mockResolvedValue();

      const { getByText } = render(<ProfileScreen />);

      // Press logout button
      const logoutButton = getByText('Log Out');
      fireEvent.press(logoutButton);

      // Wait for async operations
      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/home');
      });
    });

    it('should handle logout errors', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        user_metadata: {
          full_name: 'Test User',
        },
      };

      useUser.mockReturnValue({
        data: mockUser,
        loading: false,
      });

      mockSignOut.mockRejectedValue(new Error('Logout failed'));

      const { getByText } = render(<ProfileScreen />);

      // Press logout button
      const logoutButton = getByText('Log Out');
      fireEvent.press(logoutButton);

      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalled();
      });

      // Should show error alert
      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith(
          'Error',
          'Failed to log out. Please try again.'
        );
      });
    });
  });

  describe('Profile Settings', () => {
    it('should display all settings options', () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        user_metadata: {
          full_name: 'Test User',
        },
      };

      useUser.mockReturnValue({
        data: mockUser,
        loading: false,
      });

      const { getByText } = render(<ProfileScreen />);

      expect(getByText('Account Settings')).toBeTruthy();
      expect(getByText('Notifications')).toBeTruthy();
      expect(getByText('Privacy & Security')).toBeTruthy();
      expect(getByText('Help & Support')).toBeTruthy();
    });

    it('should show coming soon message when settings option is pressed', () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        user_metadata: {
          full_name: 'Test User',
        },
      };

      useUser.mockReturnValue({
        data: mockUser,
        loading: false,
      });

      const { getByText } = render(<ProfileScreen />);

      const accountSettings = getByText('Account Settings');
      fireEvent.press(accountSettings);

      expect(Alert.alert).toHaveBeenCalledWith(
        'Account Settings',
        'This feature is coming soon!'
      );
    });
  });
});
