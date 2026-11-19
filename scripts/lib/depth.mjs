// Depth-chart snapshots. One snapshot per week (overwritten each run that week).
// Changes = current order vs the latest snapshot from an earlier week.

export function snapshot(players) {
  const order = {};
  for (const [id, p] of Object.entries(players)) {
    if (p.dc != null && p.tm && ["QB", "RB", "WR", "TE"].includes(p.pos)) order[id] = p.dc;
  }
  return order;
}

export function baseline(history, week) {
  const weeks = Object.keys(history?.weeks || {}).map(Number).filter((w) => w < week).sort((a, b) => b - a);
  return weeks.length ? { week: weeks[0], ...history.weeks[weeks[0]] } : null;
}

export function diffDepth(prevOrder, curOrder, players) {
  const changes = [];
  for (const [id, cur] of Object.entries(curOrder)) {
    const prev = prevOrder?.[id];
    if (prev == null || prev === cur) continue;
    const p = players[id];
    changes.push({ id, n: p?.n, pos: p?.pos, tm: p?.tm, from: prev, to: cur });
  }
  return changes.sort((a, b) => (a.tm || "").localeCompare(b.tm || "") || a.to - b.to);
}

export function updateHistory(history, week, season, order, date) {
  const h = { season, weeks: { ...(history?.season === season ? history.weeks : {}) } };
  h.weeks[week] = { date, order };
  const keep = Object.keys(h.weeks).map(Number).sort((a, b) => b - a).slice(0, 4);
  for (const w of Object.keys(h.weeks)) if (!keep.includes(Number(w))) delete h.weeks[w];
  return h;
}
