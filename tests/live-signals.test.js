import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLiveSignals, signalOverlapIds } from "../lib/live-signals.js";

const now = Date.parse("2026-11-25T15:00:00Z");
function game(overrides = {}) {
  return {
    id: "123", matchup: "Away at Home", period: 2, clock: "10:00",
    home: { score: 58 }, away: { score: 46 }, ...overrides
  };
}
function projection(overrides = {}) {
  return { elapsedMinutes: 30, remainingMinutes: 10, total: 145, ...overrides };
}

test("detects the 5.0–5.5 PPM pace window only with a clear model direction", () => {
  const signals = evaluateLiveSignals({
    game: game(), marketLine: 159, projection: projection(),
    marketUpdatedAt: new Date(now - 30_000).toISOString(), now
  });
  assert.ok(signals.some(signal => signal.id === "pace_5_5" && signal.pick === "UNDER"));
  assert.ok(!evaluateLiveSignals({
    game: game(), marketLine: 159, projection: projection({ total: 158 }),
    marketUpdatedAt: new Date(now - 30_000).toISOString(), now
  }).some(signal => signal.id === "pace_5_5"));
});

test("detects the 8–12 minute window and records the direction", () => {
  const signals = evaluateLiveSignals({
    game: game(), marketLine: 159, projection: projection(),
    marketUpdatedAt: new Date(now - 30_000).toISOString(), now
  });
  assert.ok(signals.some(signal => signal.id === "time_8_12" && signal.pick === "UNDER"));
});

test("Triple Dipper requires second half, 20–32 elapsed, >8 margin, 4.7+ needed and 1.3+ gap", () => {
  const signals = evaluateLiveSignals({
    game: game(), marketLine: 159.5, projection: projection({ total: 150 }),
    marketUpdatedAt: new Date(now - 30_000).toISOString(), now
  });
  assert.ok(signals.some(signal => signal.id === "triple_dipper"));
  const closeGame = evaluateLiveSignals({
    game: game({ away: { score: 50 } }), marketLine: 159.5,
    projection: projection({ total: 150 }),
    marketUpdatedAt: new Date(now - 30_000).toISOString(), now
  });
  assert.ok(!closeGame.some(signal => signal.id === "triple_dipper"));
});

test("rejects stale market snapshots", () => {
  const signals = evaluateLiveSignals({
    game: game(), marketLine: 159, projection: projection(),
    marketUpdatedAt: new Date(now - 7 * 60_000).toISOString(), now
  });
  assert.deepEqual(signals, []);
});

test("overlap identifiers are unique", () => {
  assert.deepEqual(signalOverlapIds([{id:"pace_5_5"},{id:"time_8_12"},{id:"pace_5_5"}]), ["pace_5_5","time_8_12"]);
});
