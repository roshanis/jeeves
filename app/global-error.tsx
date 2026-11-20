"use client";

import * as React from "react";

// Root error boundary: catches what app/(console)/error.tsx cannot (a throw in
// a layout, or in the root layout itself). It replaces the root layout, so it
// renders its own <html>/<body>. Like the console boundary it never prints
// `error.message` (it could carry a connection string); only the digest.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
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
            The error has been logged. Nothing you were looking at was changed —
            this failure happened while reading.
          </p>
          {error.digest ? (
            <p style={{ fontFamily: "monospace", fontSize: "0.75rem", opacity: 0.75 }}>
              Reference: {error.digest}
            </p>
          ) : null}
          <button type="button" onClick={reset} style={{ marginRight: "0.5rem" }}>
            Try again
          </button>
          <a href="/inbox">Back to Inbox</a>
        </div>
      </body>
    </html>
  );
}
