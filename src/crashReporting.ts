import type React from 'react';
import * as Sentry from '@sentry/react-native';

// Crash reports from testers' phones, through Sentry — so a crash on
// someone else's phone arrives with the reason instead of being invisible.
//
// Off until a project key is set (EXPO_PUBLIC_SENTRY_DSN in .env). The key
// only lets the app SEND reports; it is not a secret.
//
// PRIVATE BY SETTING, because this is a memory app: a report carries the
// error, the stack and the device model — never the user's memories. So:
// no console logs as breadcrumbs (they can quote names and places), no
// screenshots, no screen recordings, no request or response bodies, no
// user identity.

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

export const crashReportingOn = !!DSN;

/** A deliberate test report, so it can be confirmed reports arrive. */
export function sendTestCrashReport(): void {
  if (!DSN) return;
  Sentry.captureException(new Error('Recall test report — safe to ignore'));
  console.log('[crash] test report sent');
}

export function startCrashReporting(): void {
  if (!DSN) return;
  Sentry.init({
    dsn: DSN,
    environment: __DEV__ ? 'development' : 'testflight',
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableUserInteractionTracing: false,
    tracesSampleRate: 0,
    maxBreadcrumbs: 30,
    integrations: (defaults) => defaults.filter((i) => i.name !== 'ReplayIntegration'),
    beforeBreadcrumb(crumb) {
      // Console output and network payloads stay on the phone.
      if (crumb.category === 'console') return null;
      if (crumb.category === 'xhr' || crumb.category === 'fetch') {
        return { ...crumb, data: { method: crumb.data?.method, status_code: crumb.data?.status_code } };
      }
      return crumb;
    },
    beforeSend(event) {
      delete event.user;
      delete event.request;
      return event;
    },
  });
}

/** Sentry's wrapper around the root, only when reporting is on — wrapping
 *  without starting Sentry just produces a warning. */
export function wrapWithCrashReporting(root: React.ComponentType): React.ComponentType {
  return DSN ? (Sentry.wrap(root as React.ComponentType<Record<string, unknown>>) as React.ComponentType) : root;
}
