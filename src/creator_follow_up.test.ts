import assert from "node:assert/strict";
import { test } from "node:test";
import { isDue } from "./creator_follow_up.ts";

test("a scheduled delivery runs at its due time only while pending", () => {
  const dueAt = Date.UTC(2026, 8, 20, 10);
  assert.equal(isDue({ dueAt, state: "pending" }, dueAt - 1), false);
  assert.equal(isDue({ dueAt, state: "pending" }, dueAt), true);
  assert.equal(isDue({ dueAt, state: "done" }, dueAt + 1000), false);
});
