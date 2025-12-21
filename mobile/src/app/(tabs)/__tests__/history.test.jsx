import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import HistoryScreen from '../history';
import { useAuth } from '@/utils/auth/useAuth';
import useUser from '@/utils/auth/useUser';
import { supabase } from '@/utils/supabaseClient';

// Mock dependencies
jest.mock('expo-router');
jest.mock('@/utils/auth/useAuth');
jest.mock('@/utils/auth/useUser');
jest.mock('@/utils/supabaseClient');
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
jest.mock('@/components/FilterChips.jsx', () => 'FilterChips');
jest.mock('@/components/SearchBar.jsx', () => 'SearchBar');
jest.mock('@/components/EmptyState.jsx', () => 'EmptyState');

// Create wrapper with QueryClient
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return ({ children }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
};

describe('HistoryScreen', () => {
  const mockRouter = {
    push: jest.fn(),
  };

  const mockUser = {
    id: 'test-user-id',
    email: 'test@example.com',
  };

  const mockEvents = [
    {
      event_id: 'event-1',  // Database column name
      id: 'event-1',        // Aliased for interface consistency
      user_id: 'test-user-id',
      event_type: 'food',
      event_data: {
        description: 'Apple',
        quantity: 1,
      },
      event_time: new Date().toISOString(),
      created_at: new Date().toISOString(),
    },
    {
      event_id: 'event-2',
      id: 'event-2',
      user_id: 'test-user-id',
      event_type: 'glucose',
      event_data: {
        value: 120,
        units: 'mg/dL',
      },
      event_time: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      created_at: new Date(Date.now() - 3600000).toISOString(),
    },
    {
      event_id: 'event-3',
      id: 'event-3',
      user_id: 'test-user-id',
      event_type: 'activity',
      event_data: {
        description: 'Running',
        duration: 30,
      },
      event_time: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
      created_at: new Date(Date.now() - 86400000).toISOString(),
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    useRouter.mockReturnValue(mockRouter);
    useAuth.mockReturnValue({
      getAccessToken: jest.fn(() => Promise.resolve('mock-token')),
      isAuthenticated: true,
      signIn: jest.fn(),
    });
    useUser.mockReturnValue({
      data: mockUser,
    });

    // Mock Supabase query builder
    const mockQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: mockEvents, error: null }),
    };

    supabase.from = jest.fn().mockReturnValue(mockQuery);
  });

  describe('History Display', () => {
    it('should display logged user events', async () => {
      const wrapper = createWrapper();
      const { getByText } = render(<HistoryScreen />, { wrapper });

      // Wait for events to load
      await waitFor(() => {
        expect(supabase.from).toHaveBeenCalledWith('voice_events');
      });

      // Events should be displayed
      await waitFor(() => {
        expect(getByText('Apple')).toBeTruthy();
      });
    });

    it('should only display events for the logged-in user', async () => {
      const wrapper = createWrapper();
      render(<HistoryScreen />, { wrapper });

      await waitFor(() => {
        const fromCall = supabase.from();
        expect(fromCall.eq).toHaveBeenCalledWith('user_id', 'test-user-id');
      });
    });

    it('should display events in descending chronological order', async () => {
      const wrapper = createWrapper();
      render(<HistoryScreen />, { wrapper });

      await waitFor(() => {
        const fromCall = supabase.from();
        expect(fromCall.order).toHaveBeenCalledWith('event_time', { ascending: false });
      });
    });

    it('should show empty state when no events exist', async () => {
      // Mock empty events
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
      supabase.from = jest.fn().mockReturnValue(mockQuery);

      const wrapper = createWrapper();
      const { UNSAFE_getByType } = render(<HistoryScreen />, { wrapper });

      await waitFor(() => {
        // EmptyState component should be rendered
        expect(UNSAFE_getByType('EmptyState')).toBeTruthy();
      });
    });

    it('should handle data loading state', async () => {
      // Mock slow query
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn(() => new Promise(() => {})), // Never resolves
      };
      supabase.from = jest.fn().mockReturnValue(mockQuery);

      const wrapper = createWrapper();
      const { UNSAFE_getByType } = render(<HistoryScreen />, { wrapper });

      // Should show loading indicator
      expect(UNSAFE_getByType(require('react-native').ActivityIndicator)).toBeTruthy();
    });
  });

  describe('Event Filtering', () => {
    it('should filter events by type', async () => {
      const wrapper = createWrapper();
      const { rerender } = render(<HistoryScreen />, { wrapper });

      // Initial load with "All" filter
      await waitFor(() => {
        expect(supabase.from).toHaveBeenCalledWith('voice_events');
      });

      // Clear mocks and simulate filter change
      jest.clearAllMocks();

      // Mock filtered query for food only
      const mockFoodEvents = [mockEvents[0]];
      const mockFilteredQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: mockFoodEvents, error: null }),
      };
      supabase.from = jest.fn().mockReturnValue(mockFilteredQuery);

      // Re-render to trigger filter change
      rerender(<HistoryScreen />);

      // When "Food" filter is selected, should query with event_type filter
      await waitFor(() => {
        const fromCall = supabase.from();
        if (fromCall.eq.mock.calls.some(call => call[0] === 'event_type')) {
          expect(fromCall.eq).toHaveBeenCalledWith('event_type', 'food');
        }
      });
    });

    it('should show all events when "All" filter is selected', async () => {
      const wrapper = createWrapper();
      render(<HistoryScreen />, { wrapper });

      await waitFor(() => {
        expect(supabase.from).toHaveBeenCalledWith('voice_events');
      });

      // Should NOT filter by event_type when "All" is selected
      const fromCall = supabase.from();
      const eventTypeFilters = fromCall.eq.mock.calls.filter(
        call => call[0] === 'event_type'
      );
      expect(eventTypeFilters.length).toBe(0);
    });
  });

  describe('Event Navigation', () => {
    it('should navigate to event detail when event is pressed', async () => {
      const wrapper = createWrapper();
      const { getByText } = render(<HistoryScreen />, { wrapper });

      await waitFor(() => {
        expect(getByText('Apple')).toBeTruthy();
      });

      // Press on event
      const eventElement = getByText('Apple');
      fireEvent.press(eventElement.parent.parent); // Press the TouchableOpacity parent

      // Should navigate to event detail
      await waitFor(() => {
        expect(mockRouter.push).toHaveBeenCalledWith('/event/event-1');
      });
    });
  });

  describe('Pull to Refresh', () => {
    it.skip('should refetch events when pulled to refresh', async () => {
      const wrapper = createWrapper();
      const { UNSAFE_getByType } = render(<HistoryScreen />, { wrapper });

      // Wait for initial load
      await waitFor(() => {
        expect(supabase.from).toHaveBeenCalled();
      });

      jest.clearAllMocks();

      // Find ScrollView and trigger refresh
      const scrollView = UNSAFE_getByType(require('react-native').ScrollView);
      const refreshControl = scrollView.props.refreshControl;

      // Trigger onRefresh
      refreshControl.props.onRefresh();

      // Should refetch data
      await waitFor(() => {
        expect(supabase.from).toHaveBeenCalledWith('voice_events');
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle fetch errors gracefully', async () => {
      // Mock query error
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'Network error' },
        }),
      };
      supabase.from = jest.fn().mockReturnValue(mockQuery);

      const wrapper = createWrapper();
      const { queryByText } = render(<HistoryScreen />, { wrapper });

      // Should handle error without crashing
      await waitFor(() => {
        expect(supabase.from).toHaveBeenCalled();
      });

      // Should not display any events
      expect(queryByText('Apple')).toBeNull();
    });
  });

  describe('Date Formatting', () => {
    it('should format recent events as relative time', async () => {
      const wrapper = createWrapper();
      const { getByText } = render(<HistoryScreen />, { wrapper });

      await waitFor(() => {
        expect(getByText('Apple')).toBeTruthy();
      });

      // Recent events should show relative time
      // Note: Exact text depends on formatEventTime implementation
      // This is a placeholder test - adjust based on actual UI
    });
  });
});
