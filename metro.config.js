// Sentry's Expo metro config adds debug IDs so stack traces can be symbolicated.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
