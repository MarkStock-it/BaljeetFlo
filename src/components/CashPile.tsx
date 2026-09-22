import React from "react";

/**
 * Money stack, flat Apple-Savings style: three soft green cylinders with
 * rounded caps, grouped and overlapping. The pile empties from the top down:
 * the tall back cylinder shrinks first, then the left, and the short front
 * cylinder holds out longest before the pile is gone.
 *
 * All geometry is inline-styled on purpose: the component carries no Tailwind
 * dependency, so it renders identically in the app, SSR harnesses, and anywhere
 * else the markup travels.
 */
export function CashPile({ pct, size = "lg" }: { pct: number; size?: "sm" | "lg" }) {
  const clamped = Math.max(0, Math.min(1, pct));

  const S =
    size === "lg"
      ? { w: 74, back: 148, left: 114, right: 96, r: 16, lift: 30, box: { w: 214, h: 192 } }
      : { w: 44, back: 90, left: 70, right: 59, r: 11, lift: 19, box: { w: 130, h: 118 } };

  // u = remaining "units" of money, 0..3. Each cylinder owns one unit:
  // back is full only while u is 3, left while u ≥ 2, right while u ≥ 1.
  const u = clamped * 3;
  const fBack = Math.min(1, Math.max(0, u - 2));
  const fLeft = Math.min(1, Math.max(0, u - 1));
  const fRight = Math.min(1, Math.max(0, u));

  // Grouping: the moment the back cylinder starts shrinking, the two fronts
  // drift together so the pile never reads as scattered towers. When only one
  // is left, it glides the rest of the way to true center.
  const slide = Math.max(0, Math.min(1, (3 - u) / 1.1));
  const lastCenter = Math.max(0, Math.min(1, (1 - u) / 0.6));
  const centerX = Math.round((S.box.w - S.w) / 2);
  const pairInset = Math.round((S.box.w - 2 * S.w - 12) / 2); // fronts adjacent, 12px apart

  function Cylinder({
    factor,
    maxH,
    body,
    pos,
    minShow = 6,
    fadeRange = 16,
  }: {
    factor: number;
    maxH: number;
    body: string;
    pos: React.CSSProperties;
    minShow?: number;
    fadeRange?: number;
  }) {
    const h = Math.round(maxH * factor);
    if (h < minShow) return null;
    const capH = Math.max(6, Math.min(Math.round(h * 0.18), h - 2, 20));
    const fade = Math.min(1, h / fadeRange); // soft exit as a cylinder finishes
    return (
      <div
        style={{
          position: "absolute",
          width: S.w,
          height: h,
          opacity: fade,
          borderRadius: `${S.r}px ${S.r}px ${Math.round(S.r * 0.8)}px ${Math.round(S.r * 0.8)}px`,
          background: body,
          transition: "height 0.5s ease-out, opacity 0.5s ease-out",
          ...pos,
        }}
        aria-hidden
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: capH,
            borderRadius: `${S.r}px ${S.r}px ${Math.round(S.r * 0.45)}px ${Math.round(S.r * 0.45)}px`,
            background: "var(--cash-cap)",
          }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        margin: "0 auto",
        width: S.box.w,
        height: S.box.h,
      }}
      role="img"
      aria-label={`Cash stack ${Math.round(clamped * 100)} percent full`}
    >
      {/* back, tallest: shrinks first (top of the pile goes first).
          Long dissolve + settling bottom so it melts behind the fronts. */}
      <Cylinder
        factor={fBack}
        maxH={S.back}
        minShow={8}
        fadeRange={44}
        body="var(--cash-3)"
        pos={{
          left: "50%",
          transform: "translateX(-50%)",
          bottom: Math.round(S.lift * (0.55 + 0.45 * fBack)),
          zIndex: 0,
        }}
      />
      {/* front-left: drifts inward as the pile empties */}
      <Cylinder
        factor={fLeft}
        maxH={S.left}
        body="var(--cash-1)"
        pos={{ left: Math.round(slide * pairInset), bottom: 0, zIndex: 10 }}
      />
      {/* front-right, shortest: last to go; glides to center when alone */}
      <Cylinder
        factor={fRight}
        maxH={S.right}
        body="var(--cash-2)"
        pos={{
          right: Math.round(slide * pairInset + lastCenter * (centerX - pairInset)),
          bottom: 0,
          zIndex: 10,
        }}
      />
      {/* ground shadow: hugs whatever remains of the pile */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: "50%",
          transform: "translateX(-50%)",
          bottom: -4,
          width: S.box.w * 0.82 - slide * (S.box.w * 0.82 - (S.w + 24)),
          height: size === "lg" ? 10 : 7,
          borderRadius: 999,
          background: "var(--ink)",
          opacity: 0.07 * clamped,
          filter: "blur(3px)",
          transition: "width 0.5s ease-out, opacity 0.5s ease-out",
        }}
      />
    </div>
  );
}
