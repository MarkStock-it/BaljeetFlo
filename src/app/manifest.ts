import type { MetadataRoute } from "next";

/**
 * Installability metadata. iOS ignores the manifest and reads /apple-icon,
 * Android and desktop installs read the icons here. The maskable entry lets
 * Android crop into a circle without clipping the stack.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BudgetFlow",
    short_name: "BudgetFlow",
    description:
      "The zero-sum financial co-pilot. One number. Rigid savings. Flexible everything else.",
    start_url: "/app",
    display: "standalone",
    background_color: "#fafaf8",
    theme_color: "#fafaf8",
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
