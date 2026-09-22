/**
 * Renders the real CashPile component (via react-dom/server) at several
 * depletion states into one static HTML page. Output: cashpile-harness.html
 * at the project root — openable by the preview tool without a server.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CashPile } from "../src/components/CashPile";
import { writeFileSync } from "fs";

const states = [1, 0.9, 0.72, 0.6, 0.45, 0.3, 0.15, 0.03];

const cells = states
  .map(
    (p) => `
    <figure>
      <div class="slot"><div class="ph">${renderToStaticMarkup(<CashPile pct={p} />)}</div></div>
      <figcaption>pct ${p}</figcaption>
    </figure>`
  )
  .join("\n");

const dark = `
    <h2>Dark mode</h2>
    <div class="grid dark">
      ${[1, 0.6, 0.3]
        .map(
          (p) => `
        <figure>
          <div class="slot"><div class="ph">${renderToStaticMarkup(<CashPile pct={p} />)}</div></div>
          <figcaption>pct ${p}</figcaption>
        </figure>`
        )
        .join("")}
    </div>`;

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    --paper: #fafaf8; --paper-2: #f2f1ee; --ink: #1c1c1e; --ink-2: #6e6e73; --ink-3: #aeaeb2;
    --hairline: rgba(0,0,0,0.08); --hairline-strong: rgba(0,0,0,0.14);
    --cash-1: #3f7d4f; --cash-2: #57976a; --cash-3: #67a875; --cash-cap: #8cc79b;
  }
  .dark {
    --paper: #0d0d0f; --paper-2: #141416; --ink: #f5f5f7; --ink-2: #98989d; --ink-3: #636366;
    --hairline: rgba(255,255,255,0.1); --hairline-strong: rgba(255,255,255,0.18);
    --cash-1: #4c8f5e; --cash-2: #63a874; --cash-3: #72b47f; --cash-cap: #93cfa1;
    background: var(--paper);
  }
  body { font-family: -apple-system, "SF Pro Text", Inter, sans-serif; background: var(--paper); color: var(--ink); margin: 24px; }
  h2 { font-size: 15px; margin: 24px 0 8px; }
  .grid { display: flex; flex-wrap: wrap; gap: 18px; padding: 16px; border-radius: 16px; }
  .grid figure { margin: 0; text-align: center; }
  .slot { width: 230px; height: 210px; display: flex; align-items: flex-end; justify-content: center; background: var(--paper-2); border-radius: 14px; padding-bottom: 10px; }
  figcaption { font-size: 11px; color: var(--ink-2); margin-top: 6px; font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
  <h1>CashPile states (real SSR output)</h1>
  <div class="grid">${cells}</div>
  ${dark}
</body>
</html>`;

writeFileSync("cashpile-harness.html", html);
console.log("harness written");
