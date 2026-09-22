import { parseFallback } from "./parse";
import type { TxDraft } from "./budget";

/**
 * Local-first reading of a spend.
 *
 * Routing every message to the model costs a round trip to Google for things
 * the app already knows how to read. This module reads the common cases with
 * keyword groups and reports whether it is *confident*. Confident reads are
 * logged locally with no API call at all; anything else is handed to the model.
 *
 * The group keys map onto whatever the user named their own categories, so a
 * category called "Kain" or "Pamasahe" still matches its group by keyword.
 * Nothing is invented: a group with no matching category is left to the model.
 */
type Cat = { id: string; name: string; flexible: boolean };

type Group = { key: string; names: string[]; words: string[] };

const GROUPS: Group[] = [
  {
    key: "food",
    names: ["food", "dining", "meal", "eat", "kain", "ulam", "grocery", "groceries"],
    words: [
      "food", "lunch", "dinner", "breakfast", "brunch", "merienda", "snack", "snacks",
      "meal", "groceries", "grocery", "market", "palengke", "restaurant", "carinderia",
      "canteen", "cafeteria", "jollibee", "mcdo", "mcdonalds", "kfc", "jabee", "chowking",
      "greenwich", "mang inasal", "burger", "pizza", "ramen", "sushi", "bread", "bakery",
      "pandesal", "rice", "egg", "croissant", "pasta", "noodles", "pancit", "siomai", "lumpia",
    ],
  },
  {
    key: "drinks",
    names: ["drink", "drinks", "beverage", "coffee", "milk tea", "milktea", "inuman"],
    words: [
      "coffee", "matcha", "latte", "cappuccino", "americano", "espresso", "milk tea",
      "milktea", "bubble tea", "starbucks", "chatime", "coke", "juice", "soda", "beer",
      "wine", "cocktail", "smoothie", "frappe", "drink", "drinks",
    ],
  },
  {
    key: "transport",
    names: ["transport", "transpo", "fare", "commute", "travel", "pamasahe", "fuel", "gas"],
    words: [
      "transport", "transpo", "fare", "jeep", "jeepney", "tricycle", "trike", "bus", "taxi",
      "grab", "angkas", "joyride", "lrt", "mrt", "train", "toll", "gas", "fuel", "petrol",
      "diesel", "commute", "ride", "school service", "pedicab", "habal", "pamasahe",
    ],
  },
  {
    key: "shopping",
    names: ["shop", "shopping", "clothes", "retail", "personal", "gamit"],
    words: [
      "shopping", "shop", "clothes", "shirt", "shoes", "sneakers", "pants", "jacket", "bag",
      "lazada", "shopee", "uniqlo", "watsons", "cosmetics", "makeup", "skincare", "gadget",
    ],
  },
  {
    key: "entertainment",
    names: ["fun", "entertainment", "leisure", "gaming", "hobby", "games", "gala"],
    words: [
      "entertainment", "movie", "cinema", "netflix", "spotify", "game", "games", "gaming",
      "steam", "valorant", "mobile legends", "concert", "bar", "club", "hobby", "toy", "tickets",
    ],
  },
  {
    key: "bills",
    names: ["bill", "bills", "utilities", "rent", "subscription", "load", "internet", "bayarin"],
    words: [
      "bill", "bills", "electric", "electricity", "internet", "wifi", "load", "prepaid",
      "postpaid", "rent", "subscription", "insurance", "phone bill", "tuition fee",
    ],
  },
  {
    key: "health",
    names: ["health", "medical", "medicine", "fitness", "gym"],
    words: [
      "medicine", "meds", "paracetamol", "biogesic", "doctor", "checkup", "clinic", "hospital",
      "dentist", "pharmacy", "drugstore", "mercury drug", "gym", "fitness", "vitamins",
    ],
  },
  {
    key: "education",
    names: ["education", "school", "books", "supplies", "academic", "eskwela"],
    words: [
      "school", "tuition", "books", "notebook", "pen", "pencil", "printing", "photocopy",
      "thesis", "project", "lab fee", "uniform", "uniforms",
    ],
  },
];

/**
 * Lowercase, punctuation to spaces, padded so word checks are boundary-safe.
 * Latin ranges rather than a \p{L} class: the project's TS target does not
 * allow the unicode flag, and this app's categories are Latin-script.
 */
function normalise(input: string): string {
  return ` ${input
    .toLowerCase()
    .replace(/[^0-9a-z\u00c0-\u024f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word match, tolerating a trailing plural. */
function mentions(haystack: string, phrase: string): boolean {
  return new RegExp(`(^|\\s)${escapeRe(phrase)}(s|es)?(\\s|$)`).test(haystack);
}

/** Which of the user's categories, if any, this group belongs to. */
function categoryFor(group: Group, cats: Cat[]): Cat | undefined {
  const direct = cats.find((c) => {
    const name = normalise(c.name);
    return (
      group.names.some((alias) => mentions(name, alias)) ||
      mentions(name, group.key) ||
      mentions(normalise(group.key), c.name.toLowerCase())
    );
  });
  if (direct) return direct;

  // Most starter budgets call this whole lane "Food" rather than creating a
  // separate Drinks category. Coffee should still be instant in that common
  // setup; it is not a guess when Food is the only available food lane.
  if (group.key === "drinks") {
    return cats.find((c) => /\b(food|dining|meal|eat|kain|ulam)\b/i.test(c.name));
  }
  return undefined;
}

export type LocalRead = {
  draft: TxDraft;
  categoryId: string | null;
  /** The group the text pointed at, when it pointed anywhere. */
  group: string | null;
  /** True only for an amount plus exactly one unambiguous category. */
  confident: boolean;
};

/**
 * Read a message locally. Returns null when there is no amount to act on, which
 * is not a failure: the caller treats those as conversation, same as before.
 */
export function readLocally(text: string, categories: Cat[]): LocalRead | null {
  const draft = parseFallback(text);
  if (!draft) return null;

  const flexible = categories.filter((c) => c.flexible);
  const haystack = normalise(text);

  // A category named in the message wins outright.
  const named = flexible.find((c) => mentions(haystack, normalise(c.name).trim()));
  if (named) {
    return { draft, categoryId: named.id, group: "named", confident: true };
  }

  // Otherwise: which keyword groups does the text point at, and do they resolve?
  const hits: { group: Group; cat: Cat }[] = [];
  for (const group of GROUPS) {
    const word = group.words.find((w) => mentions(haystack, w));
    if (!word) continue;
    const cat = categoryFor(group, flexible);
    if (cat) hits.push({ group, cat });
  }

  const distinct = hits.filter((h, i) => hits.findIndex((x) => x.cat.id === h.cat.id) === i);
  if (distinct.length === 1 && hits.length >= 1) {
    // Exactly one group, resolving to exactly one category: trusted locally.
    return { draft, categoryId: hits[0].cat.id, group: hits[0].group.key, confident: true };
  }

  // Ambiguous, or keywords the user has no category for. The model decides.
  return { draft, categoryId: null, group: hits[0]?.group.key ?? null, confident: false };
}
