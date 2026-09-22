import type { TxDraft } from "./budget";

/** Sentence-initial verbs people type before the amount, never a merchant. */
const VERB_START = /^(spent|spend|paid|pay|bought|buy|got|get|log|logged|ordered|ordered|i|the|my|just|another|total)$/i;

/** Regex fallback parser, used when the user's Gemini key fails or quota is exhausted. */
export function parseFallback(text: string): TxDraft | null {
  const t = text.trim();
  if (!t) return null;

  const refund = /\b(refund(ed)?|got (money|it)? ?back|returned|reimbursed)\b/i.test(t);

  // 1) Currency-marked amounts: "₱140", "$14.50", "200 pesos"
  let m = t.match(
    /[₱$€£]\s?(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s?(?:pesos?|dollars?|bucks?|php|usd)/i
  );

  // 2) Bare-number fallback: "Spent 500 on food at KFC"
  if (!m) {
    const bare = t.match(/\b(\d+(?:[.,]\d{1,2})?)\b/);
    if (bare) m = [bare[0], undefined, bare[1]] as unknown as RegExpMatchArray;
  }
  if (!m) return null;

  const raw = (m[1] ?? m[2]).replace(",", ".");
  const amount = parseFloat(raw);
  if (!isFinite(amount) || amount <= 0) return null;

  // Vendor guess: "at <vendor>" / "from <vendor>" / capitalized word
  const vendorMatch =
    t.match(/\b(?:at|from|in)\s+([A-Za-z0-9'&.\- ]{2,30})/i) ??
    t.match(/\b([A-Z][A-Za-z0-9'&.\-]+(?:\s+[A-Z][A-Za-z0-9'&.\-]+)?)\b/);
  const candidate = vendorMatch?.[1]?.trim();
  // "Spent 140 on groceries" starts with a capital letter and is not a shop. The
  // note already holds the full sentence, so a verb here would read as a vendor.
  const vendor = candidate && !VERB_START.test(candidate) ? candidate : undefined;

  return {
    amount,
    vendor,
    note: t.slice(0, 280),
    refund,
    confidence: 0.5,
    categoryId: null,
  };
}
