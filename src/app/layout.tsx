import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BudgetFlow",
  description:
    "The zero-sum financial co-pilot. One number. Rigid savings. Flexible everything else.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // cover is what makes env(safe-area-inset-*) report anything at all. Without
  // it the bottom inset is 0 on iPhone, so the tab bar sat under the home
  // indicator. The shell then pads itself by those insets.
  viewportFit: "cover",
  themeColor: "#fafaf8",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <div className="mx-auto min-h-screen w-full max-w-md">{children}</div>
      </body>
    </html>
  );
}
