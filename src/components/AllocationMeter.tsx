/**
 * The allocation bar: one thin strip showing where every peso of the flexible
 * pool sits: one segment per category, one for what the plans reserve, and a
 * hatched remainder for money nobody has claimed. Same idea as the storage bar
 * in iOS Settings: the shape of the whole budget in a glance.
 *
 * Inline styles on purpose so it renders identically anywhere its markup goes.
 */
export function AllocationMeter({
  flex,
  planReserved,
  unallocated,
  height = 10,
}: {
  flex: { id: string; cap: number }[];
  planReserved: number;
  unallocated: number;
  height?: number;
}) {
  const total = flex.reduce((s, c) => s + c.cap, 0) + planReserved + unallocated;
  if (total <= 0) {
    return <div style={{ height, borderRadius: 999, background: "var(--paper-2)" }} aria-hidden />;
  }
  const seg = (width: number): React.CSSProperties => ({
    width: `${(width / total) * 100}%`,
    height: "100%",
    minWidth: 3,
    borderRadius: 3,
    transition: "width 450ms cubic-bezier(0.2,0.7,0.2,1)",
  });

  return (
    <div
      role="img"
      aria-label="How your budget is divided"
      style={{
        display: "flex",
        gap: 2,
        height,
        width: "100%",
        borderRadius: 999,
        background: "var(--paper-2)",
        overflow: "hidden",
      }}
    >
      {flex.map((c, i) => (
        <div key={c.id} style={{ ...seg(c.cap), background: `var(--seg-${(i % 6) + 1})` }} />
      ))}
      {planReserved > 0 && <div style={{ ...seg(planReserved), background: "var(--plan)" }} />}
      {unallocated > 0.005 && (
        <div style={{ ...seg(unallocated), background: "var(--hairline-strong)" }} />
      )}
    </div>
  );
}
