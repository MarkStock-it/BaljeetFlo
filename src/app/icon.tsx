import { ImageResponse } from "next/og";
import { StackMark } from "@/components/StackMark";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

/**
 * Manifest icon (Android install, PWA lists). The money stack centered on
 * the paper tile; the platform applies its own corner mask.
 */
export default function icon() {
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
        <div style={{ display: "flex", margin: "0 0 24px 0" }}>
          <StackMark scale={512 / 180} />
        </div>
      </div>
    ),
    { ...size }
  );
}
