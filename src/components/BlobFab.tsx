"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { CameraIcon, MicIcon, PencilIcon } from "@/components/icons";

export type BlobAction = "mic" | "text" | "camera";

/** How long the finger has to stay down before the menu reads as intentional. */
const HOLD_MS = 160;
/** Blob orbit radius from the centre button. */
const RADIUS = 92;
/** Dead zone around the centre where nothing is considered hovered. */
const DEAD_ZONE = 30;

/**
 * Top, bottom-left, bottom-right — 120° apart. Screen y grows downward, so the
 * bottom pair carry a positive y. Order also drives the stagger delay.
 */
const BLOBS: { action: BlobAction; x: number; y: number; label: string; hint: string }[] = [
  { action: "mic", x: 0, y: -RADIUS, label: "Voice", hint: "Start voice input" },
  { action: "text", x: -80, y: RADIUS / 2, label: "Type", hint: "Focus the message field" },
  { action: "camera", x: 80, y: RADIUS / 2, label: "Receipt", hint: "Check a receipt" },
];

type Props = {
  onMic?: () => void;
  onText?: () => void;
  onCamera?: () => void;
  listening?: boolean;
  /** Non-interactive looping preview for the onboarding tutorial. */
  demo?: boolean;
};

/**
 * The one capture control. Hold to fan out voice, typing and receipt; slide to
 * a blob and let go. A plain tap opens the menu too, so the gesture never
 * traps someone who does not know to hold, and a keyboard can drive it with
 * Enter and Escape.
 */
export function BlobFab({ onMic, onText, onCamera, listening, demo }: Props) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<BlobAction | null>(null);
  /** Opened by a tap rather than a hold: stays out until a choice or an outside tap. */
  const [latched, setLatched] = useState(false);
  /**
   * Pressed-down look, tracked in state rather than left to :active. A stuck
   * :active (common on touch when the pointer is captured) would leave the
   * button looking permanently held down.
   */
  const [pressing, setPressing] = useState(false);

  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedByHold = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // The onboarding preview breathes on its own so the gesture is legible
  // before anyone has learned it.
  useEffect(() => {
    if (!demo) return;
    setOpen(true);
    const id = setInterval(() => setOpen((o) => !o), 1600);
    return () => clearInterval(id);
  }, [demo]);

  // Whatever happens to the pointer, the pressed look lets go on release.
  useEffect(() => {
    if (!pressing) return;
    const release = () => setPressing(false);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, [pressing]);

  useEffect(() => {
    if (!latched || demo) return;
    const close = () => {
      setOpen(false);
      setLatched(false);
      setHovered(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // A tap anywhere outside the button closes a latched menu. This is a
    // document listener rather than a full-screen scrim because the composer
    // carries a transform, which would trap a fixed child inside its own box.
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [latched, demo]);

  function clearHold() {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }

  function fire(action: BlobAction) {
    setOpen(false);
    setLatched(false);
    setHovered(null);
    openedByHold.current = false;
    if (action === "mic") onMic?.();
    else if (action === "text") onText?.();
    else onCamera?.();
  }

  function beginHold(e: ReactPointerEvent<HTMLButtonElement>) {
    if (demo) return;
    // Pointer capture keeps the slide-to-select inside this control instead of
    // scrolling the feed out from under the finger. A capture request can be
    // refused (a stale pointer id), and losing the capture must never cost the
    // user the menu itself.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // fall through: the gesture still works without capture
    }
    openedByHold.current = false;
    setPressing(true);
    clearHold();
    holdTimer.current = setTimeout(() => {
      openedByHold.current = true;
      setLatched(false);
      setOpen(true);
    }, HOLD_MS);
  }

  function moveHold(e: ReactPointerEvent<HTMLButtonElement>) {
    if (!open || !openedByHold.current) return;
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < DEAD_ZONE) {
      setHovered(null);
      return;
    }
    const angle = Math.atan2(dy, dx);
    let best: BlobAction | null = null;
    let bestDiff = Infinity;
    for (const b of BLOBS) {
      const blobAngle = Math.atan2(b.y, b.x);
      let diff = Math.abs(angle - blobAngle);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff < bestDiff) {
        bestDiff = diff;
        best = b.action;
      }
    }
    // Only claim a blob when the finger is actually pointing at one.
    setHovered(bestDiff < Math.PI / 3 ? best : null);
  }

  function endHold() {
    clearHold();
    setPressing(false);
    if (!open) {
      // A quick tap still opens the menu, just latched instead of held.
      openedByHold.current = false;
      setLatched(true);
      setOpen(true);
      return;
    }
    if (openedByHold.current) {
      // Held open: sliding onto a blob commits it, empty space cancels.
      if (hovered) fire(hovered);
      else {
        setOpen(false);
        setHovered(null);
      }
      return;
    }
    // Latched, and the button itself was tapped again. The one control that
    // opens the menu can always close it, so a second tap puts it away.
    setOpen(false);
    setLatched(false);
    setHovered(null);
  }

  function cancelHold() {
    clearHold();
    setPressing(false);
    if (openedByHold.current) {
      setOpen(false);
      setHovered(null);
    }
  }

  // Keyboard activation arrives as a click with detail 0; pointer taps are
  // already handled by the hold machinery, so this only serves the keyboard.
  function onFabClick(e: React.MouseEvent<HTMLButtonElement>) {
    if (demo || e.detail !== 0) return;
    if (open) {
      setOpen(false);
      setLatched(false);
    } else {
      setLatched(true);
      setOpen(true);
    }
  }

  return (
    <div className="blob-fab-wrap" ref={wrapRef}>
      {BLOBS.map((b, i) => (
        <div
          key={b.action}
          className="blob-pos"
          data-open={open}
          // Shut blobs are invisible, so keep them out of the screen-reader
          // tree entirely rather than announcing three unlabeled buttons.
          aria-hidden={!open && !demo}
          style={
            {
              "--bx": `${b.x}px`,
              "--by": `${b.y}px`,
              transitionDelay: open ? `${i * 55}ms` : "0ms",
            } as CSSProperties
          }
        >
          <button
            type="button"
            className="blob-btn"
            data-hover={hovered === b.action}
            aria-label={b.hint}
            tabIndex={demo || !open ? -1 : 0}
            disabled={demo}
            onClick={() => fire(b.action)}
            onPointerEnter={() => !demo && setHovered(b.action)}
            onPointerLeave={() => !demo && setHovered(null)}
          >
            {b.action === "mic" && <MicIcon size={22} />}
            {b.action === "text" && <PencilIcon size={21} />}
            {b.action === "camera" && <CameraIcon size={22} />}
          </button>
          {demo && <span className="blob-caption">{b.label}</span>}
        </div>
      ))}

      <button
        type="button"
        className="blob-fab"
        data-open={open}
        data-pressed={pressing}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Capture actions"
        tabIndex={demo ? -1 : 0}
        onPointerDown={beginHold}
        onPointerMove={moveHold}
        onPointerUp={endHold}
        onPointerCancel={cancelHold}
        onClick={onFabClick}
      >
        {listening ? <MicIcon size={26} /> : <BlobGlyph />}
      </button>
    </div>
  );
}

/** Three dots fanned upward: the menu, hinted in the idle button itself. */
function BlobGlyph() {
  return (
    <span className="blob-glyph" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
