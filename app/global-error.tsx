"use client";

import * as React from "react";

// Root error boundary: catches what app/(console)/error.tsx cannot (a throw in
// a layout, or in the root layout itself). It replaces the root layout, so it
// renders its own <html>/<body>. Like the console boundary it never prints
// `error.message` (it could carry a connection string); only the digest.
export default function GlobalError({
  error,
  reset,
  retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  // Next 16 passes retry(), which re-fetches; reset() re-renders from the
  // cached payload, so a server-thrown error re-throws.
  retry?: () => void;
}) {
  React.useEffect(() => {
    console.error("Global route error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}
      >
        <div
          style={{
            maxWidth: "40rem",
            margin: "0 auto",
            padding: "4rem 1rem",
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Something went wrong
          </p>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>This screen didn&apos;t load</h1>
          <p style={{ fontSize: "0.875rem", opacity: 0.75 }}>
            The error has been logged. This console only writes when you
            explicitly act, but if you had just made a change, check the audit
            log before repeating it.
          </p>
          {error.digest ? (
            <p style={{ fontFamily: "monospace", fontSize: "0.75rem", opacity: 0.75 }}>
              Reference: {error.digest}
            </p>
          ) : null}
          <button type="button" onClick={() => (retry ?? reset)()} style={{ marginRight: "0.5rem" }}>
            Try again
          </button>
          <a href="/inbox">Back to Inbox</a>
        </div>
      </body>
    </html>
  );
}
