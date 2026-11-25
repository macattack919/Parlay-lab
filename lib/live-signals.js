const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const round2 = value => value === null ? null : Math.round(value * 100) / 100;

export function evaluateLiveSignals({ game, marketLine, projection, marketUpdatedAt, now = Date.now() }) {
  if (!game || !projection || !finite(marketLine)) return [];
  const period = finite(game.period);
  const home = finite(game.home?.score);
  const away = finite(game.away?.score);
  const currentTotal = home === null || away === null ? null : home + away;
  const elapsed = finite(projection.elapsedMinutes);
  const remaining = finite(projection.remainingMinutes);
  const projectedTotal = finite(projection.total);
  if (currentTotal === null || elapsed === null || remaining === null || remaining <= 0) return [];

  const updatedAt = marketUpdatedAt ? Date.parse(marketUpdatedAt) : NaN;
  const ageSeconds = Number.isFinite(updatedAt) ? Math.max(0, (now - updatedAt) / 1000) : null;
  const marketFresh = ageSeconds !== null && ageSeconds <= 360;
  if (!marketFresh) return [];

  const neededPpm = (Number(marketLine) - currentTotal) / remaining;
  const actualPpm = elapsed > 0 ? currentTotal / elapsed : null;
  const gapPpm = actualPpm === null ? null : neededPpm - actualPpm;
  const edge = projectedTotal === null ? null : projectedTotal - Number(marketLine);
  const direction = edge !== null && edge <= -5 ? "UNDER" : edge !== null && edge >= 5 ? "OVER" : null;
  const common = {
    gameId: String(game.id),
    matchup: game.matchup || "NCAA matchup",
    period,
    clock: game.clock || "",
    currentTotal,
    marketLine: Number(marketLine),
    marketAgeSeconds: Math.round(ageSeconds),
    elapsedMinutes: round2(elapsed),
    remainingMinutes: round2(remaining),
    neededPpm: round2(neededPpm),
    actualPpm: round2(actualPpm),
    gapPpm: round2(gapPpm),
    projectedTotal: round2(projectedTotal),
    modelEdge: round2(edge)
  };

  const signals = [];
  // These two performance segments include both sides in TTLU's published aggregate.
  // Preserve direction; only a clear model direction is eligible for an actionable alert.
  if (neededPpm >= 5 && neededPpm < 5.5 && direction) {
    signals.push({ id: "pace_5_5", label: "5.0–5.5 PPM pace window", pick: direction, ...common });
  }
  if (remaining >= 8 && remaining < 12 && direction) {
    signals.push({ id: "time_8_12", label: "8–12 minutes remaining", pick: direction, ...common });
  }

  // TTLU Triple Dipper: NCAA second-half elapsed window, >8-point lead,
  // 4.7+ required PPM, and a 1.3+ PPM deficit versus actual scoring pace.
  const margin = Math.abs(home - away);
  if (period === 2 && elapsed >= 20 && elapsed <= 32 && margin > 8 &&
      neededPpm >= 4.7 && gapPpm !== null && gapPpm >= 1.3) {
    signals.push({
      id: "triple_dipper",
      label: "TTLU Triple Dipper",
      pick: "UNDER",
      scoreMargin: margin,
      ...common
    });
  }
  return signals;
}

export function signalOverlapIds(signals) {
  return [...new Set((signals || []).map(signal => signal.id))];
}
