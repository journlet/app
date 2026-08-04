// First run on a fresh install: sign in before there is a journal at all
// (decision 3, spec device-identity-design.md).
//
// Presentational. The sign-in form itself is SyncView's, passed in as a child
// rather than reimplemented here: it holds the email and code flow, the resend
// and change-address escapes, and the pending-key handling, none of which
// should exist twice.

import type { ReactNode } from "react";
import { S } from "./styles";

interface OnboardingViewProps {
  children: ReactNode;
}

export default function OnboardingView({ children }: OnboardingViewProps) {
  return (
    <section style={{ maxWidth: 480 }}>
      <h2
        style={{
          fontFamily: "'Fraunces', serif",
          fontSize: 24,
          fontWeight: 600,
          margin: "8px 0 10px",
          color: "var(--ink)",
        }}
      >
        Start your journal
      </h2>
      <p style={S.onboardLede}>
        Journlet keeps your journal on every device you use, and encrypts it so
        that nobody else can read it — not even whoever runs the service.
      </p>
      <p style={S.onboardLede}>
        That needs an account, so sign in with your email to begin. There is no
        password: we email you a six-digit code, and you type it in here.
      </p>
      {/* Deliberately said before the email field rather than after it: someone
          setting up a second device needs to know the first one has a part to
          play, at the point where they can still go and fetch it. */}
      <p style={S.onboardNote}>
        Already journalling on another device? Sign in with the same email and
        this one will ask for your journal key to unlock what is already there.
      </p>
      {children}
    </section>
  );
}
