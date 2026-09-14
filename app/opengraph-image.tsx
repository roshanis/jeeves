import { ImageResponse } from "next/og";

// The link preview card. Generated at request time rather than committed as
// a binary so the wording and the brand colours have exactly one definition;
// it also means no 300KB PNG in the repo to keep compressed.
//
// Deliberately plain: a title, one line of what this is, and the demo
// disclaimer. The disclaimer belongs here as much as on the page — a shared
// link is often the first and only thing someone sees, and "Meridian Health"
// must never read as a real payer.
export const alt =
  "Jeeves — AI Governance Gateway. Intake, risk tiering, domain review, approval and monitoring for AI initiatives. Fictional demo with synthetic data.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0d2b33",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
          <svg width="56" height="56" viewBox="0 0 32 32">
            <path
              d="M16 6.5 25 10v6.4c0 5.3-3.6 9.4-9 11.1-5.4-1.7-9-5.8-9-11.1V10l9-3.5Z"
              fill="none"
              stroke="#4db6ac"
              strokeWidth="2.1"
              strokeLinejoin="round"
            />
            <path
              d="m11.7 16.2 3 3.1 5.6-6"
              fill="none"
              stroke="#4db6ac"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span
            style={{
              color: "#4db6ac",
              fontSize: 30,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            Jeeves
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <span style={{ color: "#f2f7f7", fontSize: 68, lineHeight: 1.1 }}>
            AI Governance Gateway
          </span>
          <span style={{ color: "#a8c4c6", fontSize: 32, lineHeight: 1.35 }}>
            Intake, risk tiering, domain review, approval and continuous
            monitoring — end to end.
          </span>
        </div>

        <span style={{ color: "#7fa3a6", fontSize: 24 }}>
          Fictional demo · synthetic data · no real patient information
        </span>
      </div>
    ),
    size,
  );
}
