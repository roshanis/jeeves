import { ImageResponse } from "next/og";

// Apple touch icon, generated rather than committed as a binary: the shield
// mark is the same one in app/icon.svg, and generating it keeps a single
// definition of the colours instead of a PNG that silently drifts from it.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0d2b33",
        }}
      >
        <svg width="124" height="124" viewBox="0 0 32 32">
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
      </div>
    ),
    size,
  );
}
