import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "./memory";

const tradeOff = {
  id: "to1",
  userId: "u1",
  transactionId: "tx1",
  overshoot: 550,
  status: "auto" as const,
  moves: [{ fromCategoryId: "food", amount: 550 }],
};

test("undoTradeOffs hands the moves back and forgets them once", async () => {
  const store = new MemoryStore();
  await store.addTradeOff(tradeOff);

  assert.deepEqual(await store.undoTradeOffs("tx1"), [{ fromCategoryId: "food", amount: 550 }]);
  // Second call must find nothing, so a repeated correction cannot credit the
  // donor twice.
  assert.deepEqual(await store.undoTradeOffs("tx1"), []);
});

test("undoTradeOffs only touches the transaction it was asked about", async () => {
  const store = new MemoryStore();
  await store.addTradeOff(tradeOff);
  await store.addTradeOff({
    ...tradeOff,
    id: "to2",
    transactionId: "tx2",
    moves: [{ fromCategoryId: "fun", amount: 300 }],
    status: "adjusted",
  });

  assert.deepEqual(await store.undoTradeOffs("tx2"), [{ fromCategoryId: "fun", amount: 300 }]);
  assert.deepEqual(await store.undoTradeOffs("tx1"), [{ fromCategoryId: "food", amount: 550 }]);
});

test("a transaction with no trade-off undoes to nothing", async () => {
  const store = new MemoryStore();
  assert.deepEqual(await store.undoTradeOffs("never-existed"), []);
});
