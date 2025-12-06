// Simple error serializer to avoid ESM issues with serialize-error package
const serializeError = (error) => {
  if (!error) return { message: 'Unknown error' };
  return {
    name: error.name || 'Error',
    message: error.message || String(error),
    stack: error.stack,
    code: error.code,
  };
};

const reportErrorToRemote = async ({ error }) => {
  if (
    !process.env.EXPO_PUBLIC_LOGS_ENDPOINT ||
    !process.env.EXPO_PUBLIC_PROJECT_GROUP_ID ||
    !process.env.EXPO_PUBLIC_CREATE_TEMP_API_KEY
  ) {
    // Silently skip remote reporting if not configured
    return { success: false };
  }
  try {
    await fetch(process.env.EXPO_PUBLIC_LOGS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.EXPO_PUBLIC_CREATE_TEMP_API_KEY}`,
      },
      body: JSON.stringify({
        projectGroupId: process.env.EXPO_PUBLIC_PROJECT_GROUP_ID,
        logs: [
          {
            message: JSON.stringify(serializeError(error)),
            timestamp: new Date().toISOString(),
            level: 'error',
            source: 'BUILDER',
            devServerId: process.env.EXPO_PUBLIC_DEV_SERVER_ID,
          },
        ],
      }),
    });
  } catch (fetchError) {
    return { success: false, error: fetchError };
  }
  return { success: true };
};

module.exports = { reportErrorToRemote };
