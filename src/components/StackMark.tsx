/**
 * Home-screen mark: the money stack frozen at full.
 *
 * Same geometry and palette as CashPile, but standalone: literal colors
 * instead of CSS variables, a fixed 180-unit canvas, and a scale factor so
 * the exact same composition renders at 512 (manifest icon) and 180
 * (apple-touch icon). Satori-safe: only absolute positioning, radii and
 * opacity, no filters or shadows.
 */
export function StackMark({ scale = 1 }: { scale?: number }) {
  const u = (n: number) => Math.round(n * scale);

  // Paper tile is drawn by the caller; this is just the pile.
  return (
    <div
      style={{
        position: "relative",
        width: u(180),
        height: u(180),
        display: "flex",
      }}
    >
      {/* ground shadow, flat like the in-app pile */}
      <div
        style={{
          position: "absolute",
          left: u(34),
          top: u(139),
          width: u(112),
          height: u(9),
          borderRadius: u(999),
          background: "#1c1c1e",
          opacity: 0.08,
          display: "flex",
        }}
      />
      {/* back, tallest cylinder */}
      <Cylinder
        u={u}
        left={68}
        top={46}
        h={88}
        capH={15}
        body="#67a875"
      />
      {/* front-left */}
      <Cylinder
        u={u}
        left={40}
        top={76}
        h={66}
        capH={14}
        body="#3f7d4f"
      />
      {/* front-right, shortest */}
      <Cylinder
        u={u}
        left={96}
        top={87}
        h={55}
        capH={12}
        body="#57976a"
      />
    </div>
  );
}

function Cylinder({
  u,
  left,
  top,
  h,
  capH,
  body,
}: {
  u: (n: number) => number;
  left: number;
  top: number;
  h: number;
  capH: number;
  body: string;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: u(left),
        top: u(top),
        width: u(44),
        height: u(h),
        borderRadius: `${u(14)}px ${u(14)}px ${u(10)}px ${u(10)}px`,
        background: body,
        display: "flex",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: u(capH),
          borderRadius: `${u(14)}px ${u(14)}px ${u(6)}px ${u(6)}px`,
          background: "#8cc79b",
          display: "flex",
        }}
      />
    </div>
  );
}
