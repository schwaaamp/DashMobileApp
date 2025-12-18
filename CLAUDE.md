# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DashMobileApp is a monorepo containing a mobile app (React Native/Expo) and web application (React Router) for health event tracking. The app allows users to log health-related events (food, glucose, insulin, activity, supplements, etc.) using voice, text, or camera input, with AI-powered parsing to extract structured data.

## Repository Structure

- `mobile/` - React Native (Expo) mobile application
- `web/` - React Router web application
- `.husky/` - Git hooks for pre-commit tests

## Mobile App (`mobile/`)

### Technology Stack
- **Framework**: Expo 54 with React Native 0.81
- **Routing**: Expo Router (file-based routing)
- **State Management**: Zustand for auth state
- **Data Fetching**: @tanstack/react-query
- **Backend**: Supabase (authentication and database)
- **Testing**: Jest with @testing-library/react-native
- **AI Processing**: Gemini API for voice/text parsing

### Project Structure
```
mobile/
├── src/
│   ├── app/              # File-based routes (Expo Router)
│   │   ├── (tabs)/       # Tab navigation routes
│   │   │   ├── home.jsx      # Main event logging screen
│   │   │   ├── history.jsx   # Event history
│   │   │   └── profile.jsx   # User profile
│   │   ├── event/        # Event detail screens
│   │   │   └── [id].jsx      # Dynamic event detail route
│   │   └── _layout.jsx   # Root layout with providers
│   ├── components/       # Reusable UI components
│   └── utils/           # Utilities and hooks
│       ├── auth/         # Authentication logic (Zustand store, hooks)
│       ├── geminiParser.js    # AI event parsing with Gemini
│       ├── voiceEventParser.js # Voice-to-event processing
│       └── supabaseClient.js  # Supabase client setup
├── __tests__/           # Test files
├── jest.setup.js        # Jest configuration with mocks
└── app.json            # Expo configuration
```

### Common Commands

**Development:**
```bash
cd mobile
npm run android          # Run on Android
npm run ios              # Run on iOS
```

**Testing:**
```bash
cd mobile
npm test                 # Run all tests
npm run test:watch       # Watch mode
npm run test:coverage    # Generate coverage report
npm run test:ci          # CI mode (used in pre-commit hook)
```

### Key Architecture Patterns

**Authentication:**
- Zustand store in `src/utils/auth/store.js` manages auth state
- Token stored in Expo SecureStore
- `useAuth` hook in `src/utils/auth/useAuth.js` provides auth methods
- Supabase client configured with no auto session management (manual handling)

**Event Processing Flow:**
1. User inputs via voice/text/camera on home screen
2. Voice input → `voiceRecording.js` → audio file
3. Audio/text → `voiceEventParser.js` → Gemini API
4. Gemini response → `geminiParser.js` → structured event data
5. Events saved to Supabase `voice_events` table
6. History screen fetches events with React Query

**Environment Variables:**
Required in `mobile/.env`:
- `EXPO_PUBLIC_SUPABASE_URL` - Supabase project URL
- `EXPO_PUBLIC_SUPABASE_KEY` - Supabase anon key
- `EXPO_PUBLIC_GEMINI_API_KEY` - Google Gemini API key

**Path Aliases:**
- `@/*` maps to `src/*` (configured in tsconfig.json)

**Testing:**
- Tests use Jest with jest-expo preset
- Extensive mocking in `jest.setup.js` for Expo modules
- Tests located alongside source files in `__tests__/` directories
- Pre-commit hook runs full test suite

### Event Types Schema
The app supports multiple event types defined in `geminiParser.js`:
- `food` - Nutrition tracking (calories, macros)
- `glucose` - Blood glucose readings
- `insulin` - Insulin administration
- `activity` - Exercise/movement
- `supplement` - Supplement intake
- `sauna` - Sauna sessions
- `medication` - Medication tracking

Each event type has required and optional fields validated during parsing.

## Web App (`web/`)

### Technology Stack
- **Framework**: React Router v7 with SSR
- **UI**: Chakra UI, Tailwind CSS
- **Backend**: Hono API routes (file-based in `src/app/api/`)
- **Database**: Neon (PostgreSQL)
- **State Management**: Zustand
- **Data Fetching**: @tanstack/react-query

### Project Structure
```
web/
├── src/
│   └── app/             # React Router routes
├── plugins/             # Vite plugins for custom functionality
├── __create/            # Route building utilities
└── react-router.config.ts
```

### Common Commands

**Development:**
```bash
cd web
npm run dev              # Start dev server with SSR
npm run typecheck        # Type checking
```

**Path Aliases:**
- `@/*` maps to `./src/*`

## Build System Notes

**Mobile:**
- Uses Metro bundler
- Expo prebuild for native projects (iOS/Android)
- Supports web via `expo-web-browser`

**Web:**
- Vite bundler
- Custom plugins in `plugins/` directory
- SSR enabled by default

## Git Workflow

**Pre-commit Hook:**
- Automatically runs `cd mobile && npm test` before each commit
- Configured in `.husky/pre-commit`
- Tests must pass for commit to succeed

**Committing Code:**
When running tests before committing, ensure you're in the mobile directory or the pre-commit hook will handle it automatically.

## Data Flow Architecture

**Mobile App Data Flow:**
1. **Input Layer**: Home screen captures voice/text/camera input
2. **Processing Layer**: Voice/text sent to Gemini API for parsing
3. **Validation Layer**: `geminiParser.js` validates against event schemas
4. **Storage Layer**: Supabase stores events in `voice_events` table
5. **Display Layer**: React Query fetches and caches events for history screen

**Authentication Flow:**
1. User initiates OAuth via `GoogleAuthWebView` component
2. Supabase handles OAuth redirect
3. JWT token stored in SecureStore
4. Zustand store updates auth state globally
5. Protected routes check auth state from store

## Development Notes

**When modifying event types:**
1. Update schema in `mobile/src/utils/geminiParser.js`
2. Update Gemini prompts in `mobile/src/utils/voiceEventParser.js`
3. Add tests for new event type validation
4. Update Supabase table schema if needed

**When adding new screens:**
- Mobile: Add files to `mobile/src/app/` following Expo Router conventions
- Web: Add files to `web/src/app/` following React Router conventions
- Both use file-based routing with automatic route generation

**Testing best practices:**
- Mock Expo modules are configured in `jest.setup.js`
- Use `@testing-library/react-native` for component testing
- Keep tests close to source files in `__tests__/` directories
- Run tests before committing (enforced by pre-commit hook)