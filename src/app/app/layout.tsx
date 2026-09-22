"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { warmTabCaches } from "@/lib/tab-cache";
import {
  ChatIcon,
  HistoryIcon,
  InsightsIcon,
  SlidersIcon,
  TargetIcon,
} from "@/components/icons";

/**
 * Five tabs, no more. Chat is where money gets logged, Plans is where it gets
 * committed, History is the record, Insights is the money stack and the weekly
 * read, Setup is every rule the app obeys. Settings lives inside Setup, because a
 * sixth tab would crowd the bar on a 375px screen for no extra reach.
 */
const tabs = [
  { href: "/app", label: "Chat", Icon: ChatIcon },
  { href: "/app/plans", label: "Plans", Icon: TargetIcon },
  { href: "/app/history", label: "History", Icon: HistoryIcon },
  { href: "/app/insights", label: "Insights", Icon: InsightsIcon },
  { href: "/app/setup", label: "Setup", Icon: SlidersIcon },
];

/** Setup stays lit while you're inside its sub-screens; Chat only on itself. */
function isActive(pathname: string, href: string) {
  return href === "/app" ? pathname === "/app" : pathname.startsWith(href);
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("app-mode");
    document.body.classList.add("app-mode");
    return () => {
      document.documentElement.classList.remove("app-mode");
      document.body.classList.remove("app-mode");
    };
  }, []);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => {
        if (!d.user) router.replace("/");
        else if (!d.user.onboardingDone) router.replace("/onboarding");
        else {
          setChecked(true);
          void warmTabCaches();
        }
      })
      .catch(() => router.replace("/"));
  }, [router]);

  if (!checked) return <main className="h-[100svh]" />;

  return (
    <div
      className="app-shell flex h-[100svh] min-h-0 max-h-[100svh] flex-col overflow-hidden"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* The page owns the space above the bar and scrolls inside it. The bar
          is a normal flex child rather than a fixed overlay, so the space it
          takes is always its real height plus the home-indicator inset, never
          a guessed number that left a dead band above the labels. */}
      <div
        className={`app-scroll flex min-h-0 flex-1 flex-col overflow-x-hidden overscroll-none ${
          pathname === "/app" ? "overflow-hidden" : "overflow-y-auto"
        }`}
      >
        {children}
      </div>
      <nav
        className="z-40 shrink-0 border-t backdrop-blur-xl"
        style={{
          borderColor: "var(--hairline)",
          background: "var(--surface)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div className="tabbar grid grid-cols-5 px-1.5">
          {tabs.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className="tabbar-item"
              aria-current={isActive(pathname, href) ? "page" : undefined}
              data-active={isActive(pathname, href)}
            >
              <Icon size={21} />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
