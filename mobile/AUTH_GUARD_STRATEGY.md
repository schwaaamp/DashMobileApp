# Authentication Guard Strategy

## Current State Analysis

### Existing Auth Infrastructure

1. **Auth Hooks**:
   - `useAuth()` - Manages authentication state, provides `isAuthenticated`, `isReady`, `signIn()`
   - `useUser()` - Fetches user data, depends on `useAuth()`
   - `useRequireAuth()` - Automatically triggers sign-in if not authenticated (exists but not widely used)

2. **Root Layout** ([_layout.jsx](src/app/_layout.jsx)):
   - Initializes auth on app start
   - Shows splash screen until auth is ready (`isReady`)
   - Renders `<AuthModal />` globally
   - Does NOT guard routes - relies on individual screens

3. **AuthModal** ([useAuthModal.jsx](src/utils/auth/useAuthModal.jsx)):
   - Renders when `isOpen && !auth`
   - Uses Zustand store for state management
   - Can be triggered programmatically via `useAuthModal().open()`

4. **Current Home Screen** ([home.jsx](src/app/(tabs)/home.jsx)):
   - Uses `useAuth()` and `useUser()`
   - Has access to `isAuthenticated` and `signIn()`
   - Does NOT enforce authentication - relies on user data being available

### Problem

**There is no enforcement mechanism** to redirect unauthenticated users to login. Screens can render without a user, leading to:
- Potential crashes when accessing `user.id`
- Poor UX (users see broken UI)
- Security issues (unauthorized access to protected data)

## Recommended Strategy

### Option 1: Route-Level Guards (RECOMMENDED)

**Pros:**
- Explicit and clear
- Works with Expo Router's navigation
- Easy to test
- No hidden magic

**Cons:**
- Requires adding guard to each protected screen

**Implementation:**

#### 1. Create a `ProtectedRoute` Component

```jsx
// /mobile/src/components/ProtectedRoute.jsx
import { useEffect } from 'react';
import { useRouter, useSegments } from 'expo-router';
import { useAuth } from '@/utils/auth/useAuth';
import { ActivityIndicator, View } from 'react-native';
import { useColors } from './useColors';

export function ProtectedRoute({ children }) {
  const { isAuthenticated, isReady, signIn } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const colors = useColors();

  useEffect(() => {
    if (!isReady) return; // Wait for auth to initialize

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      // Redirect to login
      router.replace('/login');
    } else if (isAuthenticated && inAuthGroup) {
      // Redirect authenticated users away from login
      router.replace('/(tabs)/home');
    }
  }, [isAuthenticated, isReady, segments]);

  // Show loading while auth initializes
  if (!isReady) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // If not authenticated, show nothing (will redirect)
  if (!isAuthenticated) {
    return null;
  }

  // Authenticated - render children
  return children;
}
```

#### 2. Wrap Protected Screens

```jsx
// /mobile/src/app/(tabs)/home.jsx
import { ProtectedRoute } from '@/components/ProtectedRoute';

export default function HomeScreen() {
  // ... existing code

  return (
    <ProtectedRoute>
      {/* existing UI */}
    </ProtectedRoute>
  );
}
```

#### 3. Create Login Screen (if doesn't exist)

```jsx
// /mobile/src/app/(auth)/login.jsx
import { useAuth } from '@/utils/auth/useAuth';
import { View, TouchableOpacity, Text } from 'react-native';
import { useColors } from '@/components/useColors';

export default function LoginScreen() {
  const { signIn, isLoading } = useAuth();
  const colors = useColors();

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
      <TouchableOpacity
        onPress={signIn}
        disabled={isLoading}
        style={{
          backgroundColor: colors.primary,
          paddingHorizontal: 32,
          paddingVertical: 16,
          borderRadius: 12,
        }}
      >
        <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '600' }}>
          {isLoading ? 'Signing in...' : 'Sign in with Google'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
```

### Option 2: Root Layout Guard (Alternative)

**Pros:**
- Centralized logic
- No need to wrap individual screens

**Cons:**
- Less flexible
- Harder to customize per-route
- Can cause redirect loops if not careful

**Implementation:**

```jsx
// /mobile/src/app/_layout.jsx (modified)
import { useEffect } from 'react';
import { useRouter, useSegments } from 'expo-router';

export default function RootLayout() {
  const { isReady, isAuthenticated } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (!isReady) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)/home');
    }
  }, [isAuthenticated, isReady, segments]);

  // ... rest of layout
}
```

### Option 3: Use Existing `useRequireAuth` Hook (Simplest)

**Pros:**
- Already exists
- Minimal code changes
- Easy to add to any screen

**Cons:**
- Doesn't redirect - just triggers sign-in modal
- No dedicated login screen
- Less control over UX

**Implementation:**

```jsx
// /mobile/src/app/(tabs)/home.jsx
import { useRequireAuth } from '@/utils/auth/useAuth';

export default function HomeScreen() {
  useRequireAuth(); // Automatically shows login modal if not authenticated

  // ... rest of component
}
```

## Decision: Recommended Approach

**Use Option 1 (Route-Level Guards)** for the following reasons:

1. **Explicit & Testable**: Each protected screen clearly declares it requires auth
2. **Flexible**: Can customize behavior per route if needed
3. **Better UX**: Can have a proper login screen instead of modal
4. **Aligns with Expo Router**: Works well with `(auth)` and `(tabs)` route groups
5. **Easy to Debug**: Clear where auth checks happen

## Implementation Plan

### Step 1: Create ProtectedRoute Component
- File: `/mobile/src/components/ProtectedRoute.jsx`
- Handles loading state, auth check, redirects

### Step 2: Create Login Screen
- File: `/mobile/src/app/(auth)/login.jsx`
- Simple Google sign-in button
- Redirects to home after successful login

### Step 3: Wrap Protected Screens
- Wrap `home.jsx`, `history.jsx`, `profile.jsx` with `<ProtectedRoute>`
- Public screens (if any) don't need wrapping

### Step 4: Update Tests
- Mock `useAuth` to return `isAuthenticated: true` by default
- Add specific tests for unauthenticated state
- Verify redirects work correctly

## Testing Strategy

### Unit Tests

```javascript
describe('ProtectedRoute', () => {
  it('should show loading spinner when auth is not ready', () => {
    useAuth.mockReturnValue({ isAuthenticated: false, isReady: false });
    const { getByTestId } = render(<ProtectedRoute><Text>Content</Text></ProtectedRoute>);
    expect(getByTestId('loading-spinner')).toBeTruthy();
  });

  it('should redirect to login when not authenticated', () => {
    const mockRouter = { replace: jest.fn() };
    useRouter.mockReturnValue(mockRouter);
    useAuth.mockReturnValue({ isAuthenticated: false, isReady: true });

    render(<ProtectedRoute><Text>Content</Text></ProtectedRoute>);

    expect(mockRouter.replace).toHaveBeenCalledWith('/login');
  });

  it('should render children when authenticated', () => {
    useAuth.mockReturnValue({ isAuthenticated: true, isReady: true });
    const { getByText } = render(<ProtectedRoute><Text>Protected Content</Text></ProtectedRoute>);
    expect(getByText('Protected Content')).toBeTruthy();
  });
});
```

### Integration Tests

```javascript
describe('Home Screen - Auth Integration', () => {
  it('should require authentication to view home screen', async () => {
    useAuth.mockReturnValue({
      isAuthenticated: false,
      isReady: true,
      signIn: jest.fn(),
    });

    const mockRouter = { replace: jest.fn() };
    useRouter.mockReturnValue(mockRouter);

    render(<HomeScreen />);

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith('/login');
    });
  });

  it('should render home screen when user is authenticated', () => {
    useAuth.mockReturnValue({
      isAuthenticated: true,
      isReady: true,
      signIn: jest.fn(),
    });
    useUser.mockReturnValue({
      data: { id: 'user-123', email: 'test@example.com' },
      loading: false,
    });

    const { getByTestId } = render(<HomeScreen />);

    expect(getByTestId('camera-button')).toBeTruthy();
    expect(getByTestId('mic-button')).toBeTruthy();
  });
});
```

## Migration Checklist

- [ ] Create `ProtectedRoute.jsx` component
- [ ] Create `login.jsx` screen in `(auth)` group
- [ ] Wrap `home.jsx` with `<ProtectedRoute>`
- [ ] Wrap `history.jsx` with `<ProtectedRoute>`
- [ ] Wrap `profile.jsx` with `<ProtectedRoute>`
- [ ] Update `home.test.jsx` to verify auth requirement
- [ ] Add tests for `ProtectedRoute` component
- [ ] Add tests for `login.jsx` screen
- [ ] Test manual flow: app launch → login → home
- [ ] Test logout flow: home → logout → login
- [ ] Verify session persistence (close app, reopen)

## Edge Cases to Handle

1. **Session Expiry**: What happens when session expires mid-use?
   - Solution: Auth state listener in `useAuth` should catch this

2. **Network Failure**: User can't connect to Supabase
   - Solution: Show error message, retry button

3. **Logout Redirect**: Where to send user after logout?
   - Solution: Always redirect to `/login`

4. **Deep Links**: User clicks deep link but not authenticated
   - Solution: Store intended route, redirect to login, then to intended route after auth

5. **Back Button**: User presses back from login screen
   - Solution: Disable back button or exit app (depends on UX requirements)

## Security Considerations

1. **Token Storage**: Tokens are stored in `expo-secure-store` (good)
2. **Token Refresh**: Supabase handles token refresh automatically (good)
3. **Session Validation**: Always validate session on app start (already doing this)
4. **API Calls**: All API calls should use `getAccessToken()` (already doing this)

## Next Steps

1. Implement `ProtectedRoute` component
2. Create login screen
3. Update home screen test to verify authentication
4. Test the full flow manually
