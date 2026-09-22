import { ImageResponse } from "next/og";
import { StackMark } from "@/components/StackMark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * iOS home-screen icon (Add to Home Screen reads /apple-icon). The stack
 * sits centered, lifted slightly like the in-app pile; iOS applies its own
 * corner mask, so the background runs edge to edge.
 */
export default function appleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fafaf8",
        }}
      >
        <div style={{ display: "flex", margin: "0 0 10px 0" }}>
          <StackMark scale={1} />
        </div>
      </div>
    ),
    { ...size }
  );
}
