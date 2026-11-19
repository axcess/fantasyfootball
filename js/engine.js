// Pure scoring engine. No DOM, no fetch: the browser and the Node tests both import it.
// See README "Scoring model" for the formulas; they follow the handoff spec §5.

import {
  POSITIONS, POOL_SIZE, DEFAULT_WEIGHTS, FORCED_STATUSES, FA_EXCLUDED_STATUSES, FLEX_SLOTS,
} from "./constants.js";

const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const r1 = (v) => Math.round(v * 10) / 10;
export const pct = (v, pool) => (pool.length ? (100 * pool.filter((x) => x < v).length) / pool.length : 50);

// ---------- game logs ----------
// Compact log row written by the Action: [week, pts, snapShare, tgt, car, rz, passAtt, opp]
export function decodeLog(row) {
  const [w, pts, snp, tgt, car, rz, pa, opp] = row;
  return { w, pts, snp, tgt, car, rz, pa, opp };
}

// Turn a Sleeper /stats row into a compact log row, or null if the player didn't play.
export function logFromStatsRow(row) {
  const s = row.stats || {};
  const played = (s.gp || 0) > 0 || (s.off_snp || 0) > 0;
  if (!played) return null;
  const snp = s.tm_off_snp ? (s.off_snp || 0) / s.tm_off_snp : 0;
  const rz = (s.rec_rz_tgt || 0) + (s.rush_rz_att || 0) + 0.3 * (s.pass_rz_att || 0);
  return [row.week, r1(s.pts_ppr || 0), Math.round(snp * 1000) / 1000, s.rec_tgt || 0, s.rush_att || 0,
    Math.round(rz * 10) / 10, s.pass_att || 0, row.opponent || null];
}

// ---------- games / Vegas / weather ----------
export function impliedTotals(homeSpread, total) {
  if (homeSpread == null || total == null) return { homeTT: null, awayTT: null };
  return { homeTT: total / 2 - homeSpread / 2, awayTT: total / 2 + homeSpread / 2 };
}

// Base penalty from forecast (outdoor only). Positive number = points removed.
export function weatherPenalty(wx, dome) {
  if (dome || !wx) return 0;
  let p = 0;
  if (wx.wind >= 20) p += 25; else if (wx.wind >= 15) p += 12;
  if ((wx.pop ?? 0) >= 60 && (wx.precip ?? 0) >= 0.25) p += 10;
  if (wx.hi != null && wx.hi < 30) p += 5;
  return p;
}

// team -> { opp, home, game }
export function teamGames(games) {
  const m = new Map();
  for (const g of games) {
    m.set(g.home, { opp: g.away, home: true, game: g, tt: g.homeTT });
    m.set(g.away, { opp: g.home, home: false, game: g, tt: g.awayTT });
  }
  return m;
}

export function byeTeams(games, allTeams) {
  const playing = new Set(games.flatMap((g) => [g.home, g.away]));
  return allTeams.filter((t) => !playing.has(t)).sort();
}

// Has this game kicked off (or finished)?
export function gameStarted(g, now = Date.now()) {
  if (!g) return false;
  if (g.status && g.status !== "pre_game" && g.status !== "scheduled") return true;
  if (g.kickoff && Date.parse(g.kickoff) <= now) return true;
  return false;
}

// ---------- matchup (defense vs position) ----------
// key `${defenseTeam}|${pos}` -> avg PPR points per week allowed to that position
export function computeDvP(players, logs) {
  const byKeyWeek = new Map();
  for (const [id, rows] of Object.entries(logs)) {
    const pos = players[id]?.pos;
    if (!pos) continue;
    for (const row of rows) {
      const l = Array.isArray(row) ? decodeLog(row) : row;
      if (!l.opp) continue;
      const k = `${l.opp}|${pos}`;
      if (!byKeyWeek.has(k)) byKeyWeek.set(k, new Map());
      const wk = byKeyWeek.get(k);
      wk.set(l.w, (wk.get(l.w) || 0) + l.pts);
    }
  }
  const out = new Map();
  for (const [k, wk] of byKeyWeek) out.set(k, avg([...wk.values()]));
  return out;
}

// ---------- per-player raw factors ----------
function rawFactors(pos, logs, proj) {
  const L = logs.slice().sort((a, b) => a.w - b.w);
  const l3 = L.slice(-3);
  const prev3 = L.slice(-6, -3);
  const snap = avg(l3.map((l) => l.snp));
  const prevSnap = prev3.length ? avg(prev3.map((l) => l.snp)) : null;
  let opp;
  if (pos === "QB") opp = avg(l3.map((l) => l.pa + 2 * l.car + 3 * l.rz)) + 10 * snap;
  else if (pos === "RB") opp = avg(l3.map((l) => l.car + 1.5 * l.tgt + 3 * l.rz)) + 20 * snap;
  else if (pos === "WR" || pos === "TE") opp = avg(l3.map((l) => 1.5 * l.tgt + l.car + 3 * l.rz)) + 20 * snap;
  else opp = proj || 0; // K / DEF
  return {
    opp,
    form: avg(l3.map((l) => l.pts)),
    season: avg(L.map((l) => l.pts)),
    games: L.length,
    l3, snap, prevSnap,
    tgt: avg(l3.map((l) => l.tgt)),
    car: avg(l3.map((l) => l.car)),
    pa: avg(l3.map((l) => l.pa)),
  };
}

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/**
 * prepare(bundle) computes every player's 5 factor percentiles (weights not needed yet).
 * bundle: { season, week, players, logs, proj, games, injuries?, depthPrev? }
 */
export function prepare(bundle) {
  const { players, proj = {}, games } = bundle;
  const logs = {};
  for (const [id, rows] of Object.entries(bundle.logs || {})) logs[id] = rows.map((r) => (Array.isArray(r) ? decodeLog(r) : r));

  const tg = teamGames(games);
  const dvp = computeDvP(players, logs);
  const playingTeams = [...tg.keys()];
  const ttPool = playingTeams.map((t) => tg.get(t).tt).filter((v) => v != null);

  // dvp rank (1 = most generous) per position, among teams playing this week
  const dvpPool = {}; const dvpRank = {};
  for (const pos of POSITIONS) {
    const vals = playingTeams.map((t) => [t, dvp.get(`${t}|${pos}`)]).filter(([, v]) => v != null);
    dvpPool[pos] = vals.map(([, v]) => v);
    vals.sort((a, b) => b[1] - a[1]).forEach(([t], i) => { dvpRank[`${t}|${pos}`] = i + 1; });
  }

  // raw factors for everyone we know about
  const raw = new Map();
  for (const [id, p] of Object.entries(players)) {
    if (!POSITIONS.includes(p.pos)) continue;
    raw.set(id, rawFactors(p.pos, logs[id] || [], proj[id]));
  }

  // comparison pools
  const pools = {};
  for (const pos of POSITIONS) {
    const cands = [...raw.entries()].filter(([id, r]) => players[id].pos === pos && r.games >= 2)
      .sort((a, b) => b[1].season - a[1].season).slice(0, POOL_SIZE[pos]).map(([, r]) => r);
    pools[pos] = { opp: cands.map((r) => r.opp), form: cands.map((r) => r.form), season: cands.map((r) => r.season) };
  }

  const recs = new Map();
  for (const [id, r] of raw) {
    const p = players[id];
    const pos = p.pos;
    const g = p.tm ? tg.get(p.tm) : null;
    const bye = !!p.tm && !g;
    const pool = pools[pos];
    const cOpp = pct(r.opp, pool.opp);
    const cForm = pct(r.form, pool.form);
    const cSeason = pct(r.season, pool.season);
    let cMatch = 50, cEnv = 50, wxPen = 0, dvpVal = null, tt = null, oppTT = null;
    if (g) {
      dvpVal = dvp.get(`${g.opp}|${pos}`) ?? null;
      cMatch = dvpVal == null ? 50 : pct(dvpVal, dvpPool[pos]);
      tt = g.tt;
      oppTT = tg.get(g.opp)?.tt ?? null;
      const base = weatherPenalty(g.game.wx, g.game.dome);
      if (pos === "DEF") {
        // fewer opponent points is better for a defense; weather helps
        cEnv = oppTT == null ? 50 : 100 - pct(oppTT, ttPool);
        wxPen = -0.5 * base;
      } else {
        cEnv = tt == null ? 50 : pct(tt, ttPool);
        wxPen = pos === "K" ? 1.5 * base : base;
      }
      cEnv = clamp(cEnv - wxPen);
    }
    recs.set(id, {
      id, n: p.n, pos, tm: p.tm, opp: g ? g.opp : bye ? "BYE" : null, home: g?.home, game: g?.game || null,
      bye, proj: proj[id] ?? (bye ? 0 : null),
      c: [cOpp, cForm, cMatch, cEnv, cSeason].map((v) => Math.round(v)),
      raw: r, dvp: dvpVal, dvpRank: g ? dvpRank[`${g.opp}|${pos}`] : null, tt, oppTT, wxPen,
      inj: p.inj || null, body: p.body || null, dc: p.dc ?? null, active: p.active,
    });
  }
  return { recs, dvp, tg, pools, week: bundle.week, season: bundle.season };
}

// ---------- scores ----------
export function scoreOf(c, W = DEFAULT_WEIGHTS) {
  const t = W.reduce((a, b) => a + b, 0) || 1;
  return Math.round(c.reduce((a, v, i) => a + v * W[i], 0) / t);
}
// Rest-of-season: opportunity, form and season factors only, at the current weights' shares.
export function rosOf(c, W = DEFAULT_WEIGHTS) {
  const t = W[0] + W[1] + W[4];
  if (!t) return 0;
  return (W[0] * c[0] + W[1] * c[1] + W[4] * c[4]) / t;
}
export function valueOf(rec, W = DEFAULT_WEIGHTS) {
  const ros = rosOf(rec.c, W);
  return 0.6 * ros + 0.4 * (rec.bye ? ros : scoreOf(rec.c, W));
}

// ---------- injuries ----------
const normName = (s) => (s || "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");
export const injuryKey = (name, team) => `${normName(name)}|${team || ""}`;

// Merge Sleeper's tag with the NFL.com report (game status wins once posted).
export function injuryInfo(rec, report) {
  const r = report?.[injuryKey(rec.n, rec.tm)] || null;
  const status = r?.game || rec.inj || null;
  return { status, practice: r?.practice || null, days: r?.days || null, injury: r?.injury || rec.body || null };
}

export function isForced(rec, report, reserveSet) {
  if (reserveSet?.has(rec.id)) return true;
  if (rec.bye || !rec.tm) return true;
  const { status } = injuryInfo(rec, report);
  return !!status && FORCED_STATUSES.includes(status);
}

// ---------- lineup ----------
export function lineupSlots(rosterPositions) {
  return rosterPositions.filter((s) => !["BN", "IR", "TAXI"].includes(s));
}
export const slotAccepts = (slot) => FLEX_SLOTS[slot] || [slot];

/**
 * roster: array of player ids (all, incl. reserve). Returns { lineup:[{slot, rec}], bench:[rec], changes }
 */
export function buildLineup(model, { roster, reserve = [], starters = [], slots, W, report }) {
  const reserveSet = new Set(reserve);
  const all = roster.map((id) => model.recs.get(id)).filter(Boolean)
    .map((r) => ({ ...r, s: scoreOf(r.c, W), forced: isForced(r, report, reserveSet), reserve: reserveSet.has(r.id) }));
  const avail = all.filter((p) => !p.forced).sort((a, b) => b.s - a.s);
  const used = new Set();
  const lineup = slots.map((slot) => {
    const ok = slotAccepts(slot);
    const p = avail.find((x) => !used.has(x.id) && ok.includes(x.pos)) || null;
    if (p) used.add(p.id);
    return { slot, rec: p };
  });
  const cur = new Set(starters.filter(Boolean));
  for (const l of lineup) if (l.rec) l.rec.change = !cur.has(l.rec.id);
  const bench = all.filter((p) => !used.has(p.id))
    .map((p) => ({ ...p, wasStarter: cur.has(p.id) }))
    .sort((a, b) => (a.forced - b.forced) || (b.s - a.s));
  const changes = lineup.filter((l) => l.rec?.change).length;
  return { lineup, bench, changes, used };
}

// ---------- waivers ----------
export function waiverSet(transactions, now = Date.now(), clearDays = 2) {
  const cut = now - clearDays * 86400000;
  const out = new Map();
  for (const t of transactions || []) {
    if (t.status !== "complete" || !t.drops) continue;
    if ((t.status_updated || t.created || 0) < cut) continue;
    for (const id of Object.keys(t.drops)) out.set(id, t.status_updated || t.created);
  }
  return out;
}

const LABEL_ORDER = { claim: 0, free: 1, hold: 2, locked: 3 };

/**
 * Returns { adds:[{rec, val, drop, dropVal, gain, label, onWaivers, locked}], considered }
 */
export function rankWaivers(model, { rostered, myRoster, reserve = [], lineupIds, W, report, waivers, now = Date.now(), max = 5 }) {
  const rset = new Set(rostered);
  const reserveSet = new Set(reserve);
  const fas = [];
  for (const rec of model.recs.values()) {
    if (rset.has(rec.id) || !rec.tm || rec.active === false) continue;
    if (rec.raw.games < 2) continue;
    const st = injuryInfo(rec, report).status;
    if (st && FA_EXCLUDED_STATUSES.includes(st)) continue;
    fas.push({ rec, val: valueOf(rec, W) });
  }
  fas.sort((a, b) => b.val - a.val);

  const mine = myRoster.map((id) => model.recs.get(id)).filter((r) => r && !reserveSet.has(r.id))
    .map((r) => ({ rec: r, val: valueOf(r, W) }));
  const startQB = mine.find((m) => m.rec.pos === "QB" && lineupIds.has(m.rec.id))?.rec.id;
  const usedDrops = new Set();
  const usedPos = new Set();
  const adds = [];
  for (const fa of fas) {
    if (adds.length >= max) break;
    const pos = fa.rec.pos;
    const single = ["K", "DEF", "QB"].includes(pos);
    if (single && usedPos.has(pos)) continue;
    let pool;
    if (single) pool = mine.filter((m) => m.rec.pos === pos && !(pos === "QB" && m.rec.id === startQB));
    else pool = mine.filter((m) => ["RB", "WR", "TE"].includes(m.rec.pos) && !lineupIds.has(m.rec.id));
    pool = pool.filter((m) => !usedDrops.has(m.rec.id)).sort((a, b) => a.val - b.val);
    const drop = pool[0];
    if (!drop) continue;
    const gain = fa.val - drop.val;
    if (gain < (pos === "K" || pos === "DEF" ? 5 : 8)) continue;
    const onW = waivers.has(fa.rec.id);
    const locked = gameStarted(fa.rec.game, now);
    const label = locked ? "locked" : onW ? (gain >= 15 ? "claim" : "hold") : "free";
    usedDrops.add(drop.rec.id);
    if (single) usedPos.add(pos);
    adds.push({ rec: fa.rec, val: fa.val, drop: drop.rec, dropVal: drop.val, gain, label, onWaivers: onW, locked });
  }
  adds.sort((a, b) => (LABEL_ORDER[a.label] - LABEL_ORDER[b.label]) || (b.val - a.val));
  return { adds, considered: fas.length };
}

// ---------- risk list ----------
const LEVEL = { h: 3, m: 2, l: 1 };

export function buildRisks(model, { lineup, roster, reserve = [], oppStarters = [], report, depthPrev = {}, W }) {
  const out = new Map(); // key -> {lvl, n, items[]}
  const add = (key, n, lvl, text) => {
    const e = out.get(key) || { lvl, n, items: [] };
    if (LEVEL[lvl] > LEVEL[e.lvl]) e.lvl = lvl;
    e.items.push(text);
    out.set(key, e);
  };
  const starters = lineup.filter((l) => l.rec).map((l) => ({ ...l.rec, slot: l.slot }));
  for (const p of starters) {
    const key = p.id, n = `${p.n} · ${p.slot}`;
    const inj = injuryInfo(p, report);
    if (inj.status === "Questionable" || inj.status === "Doubtful") add(key, n, "h", `Tagged ${inj.status}${inj.injury ? ` (${inj.injury})` : ""}.`);
    const days = inj.days || {};
    const dnp = Object.entries(days).filter(([, v]) => v === "DNP").map(([d]) => d);
    const lim = Object.entries(days).filter(([, v]) => v === "Limited").map(([d]) => d);
    if (dnp.length) add(key, n, "h", `Did not practice ${dnp.join("/")}.`);
    else if (lim.length) add(key, n, "m", `Limited in practice ${lim.join("/")}.`);
    const { snap, prevSnap } = p.raw;
    if (prevSnap != null && p.pos !== "K" && p.pos !== "DEF") {
      const d = (prevSnap - snap) * 100;
      if (d >= 20) add(key, n, "h", `Snap share fell from ${Math.round(prevSnap * 100)}% to ${Math.round(snap * 100)}%.`);
      else if (d >= 10) add(key, n, "l", `Snaps dipped from ${Math.round(prevSnap * 100)}% to ${Math.round(snap * 100)}%.`);
    }
    if (depthPrev[p.id] != null && p.dc != null && p.dc > depthPrev[p.id]) add(key, n, "h", `Depth chart: moved from ${p.pos}${depthPrev[p.id]} to ${p.pos}${p.dc}.`);
    const g = p.game;
    if (g && !g.dome && g.wx && p.pos !== "DEF") {
      const pen = weatherPenalty(g.wx, false);
      const wtxt = `${g.wx.pop ?? 0}% rain, ${Math.round(g.wx.wind)} mph wind at ${g.home}`;
      if (pen > 0 && (g.wx.wind >= 15 || (g.wx.pop >= 60 && g.wx.precip >= 0.25))) add(key, n, "m", `Forecast: ${wtxt}.`);
      else if ((g.wx.pop ?? 0) >= 50 || g.wx.wind >= 12) add(key, n, "l", `Forecast: ${wtxt} (small ding).`);
    }
  }
  // only healthy player at a QB/TE slot
  const reserveSet = new Set(reserve);
  for (const pos of ["QB", "TE"]) {
    const healthy = roster.map((id) => model.recs.get(id))
      .filter((r) => r && r.pos === pos && !isForced(r, report, reserveSet));
    if (healthy.length === 1) add(`only-${pos}`, `${healthy[0].n} · only ${pos}`, "m",
      `Your only available ${pos}. A late scratch leaves no fallback, so consider a backup if he picks up a tag.`);
  }
  // several starters in the last game window (e.g. Monday night)
  const dates = starters.map((p) => p.game?.date).filter(Boolean).sort();
  const last = dates[dates.length - 1];
  const late = starters.filter((p) => p.game?.date === last);
  const firstDate = dates[0];
  if (last && last !== firstDate && late.length >= 3) {
    const g = late[0].game;
    add(`late-${last}`, `${g.away} @ ${g.home} (${g.day || last})`, "m",
      `${late.map((p) => p.n).join(", ")} play in the final game. You'll have few pivots left.`);
  }
  for (const id of oppStarters) {
    const r = model.recs.get(id);
    if (!r) continue;
    const st = injuryInfo(r, report).status;
    if (st === "Questionable" || st === "Doubtful" || st === "Out") add(`opp-${id}`, `Opponent: ${r.n}`, "l", `Your opponent's ${r.pos} is ${st}.`);
  }
  return [...out.values()].sort((a, b) => LEVEL[b.lvl] - LEVEL[a.lvl]);
}

// ---------- one-line reasons ----------
export function reasonFor(rec, model) {
  if (rec.bye) return `Bye week. ${r1(rec.raw.form)} PPR avg last 3.`;
  const r = rec.raw, pos = rec.pos;
  const pctSnap = Math.round(r.snap * 100);
  const trend = r.prevSnap != null && Math.abs(r.prevSnap - r.snap) >= 0.1
    ? `snaps ${Math.round(r.prevSnap * 100)}%→${pctSnap}%` : `${pctSnap}% snaps`;
  const opps = {
    QB: `${r1(r.pa)} att/gm, ${trend}`,
    RB: `${r1(r.car)} car + ${r1(r.tgt)} tgt/gm, ${trend}`,
    WR: `${r1(r.tgt)} tgt/gm, ${trend}`,
    TE: `${r1(r.tgt)} tgt/gm, ${trend}`,
    K: `proj ${r1(rec.proj || 0)}`, DEF: `proj ${r1(rec.proj || 0)}`,
  };
  const n = model?.tg?.size || 32;
  const rk = rec.dvpRank;
  const verb = pos === "DEF" ? "offense gives up" : "allows";
  const match = rk == null ? "matchup unknown"
    : rk <= n / 2 ? `${rec.opp} ${verb} ${rk === 1 ? "the most" : ordinal(rk) + "-most"} ${pos} pts`
      : `${rec.opp} ${verb} ${n - rk + 1 === 1 ? "the fewest" : ordinal(n - rk + 1) + "-fewest"} ${pos} pts`;
  const g = rec.game;
  const wx = g?.dome ? "dome" : g?.wx ? `${g.wx.pop ?? 0}% rain, ${Math.round(g.wx.wind)} mph` : "";
  const envTT = pos === "DEF" ? `${rec.opp} implied ${rec.oppTT ?? "?"}` : `team total ${rec.tt ?? "?"}`;
  const env = [wx, envTT].filter(Boolean).join(", ");
  const phr = [opps[pos], `${r1(r.form)} PPR last 3`, match, env, `${r1(r.season)} PPG season`];
  const order = rec.c.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
  const parts = [];
  const [top, second] = order;
  parts.push(phr[top[1]]);
  if (second && second[0] >= 60) parts.push(phr[second[1]]);
  const low = order[order.length - 1];
  if (low[0] < 45 && !parts.includes(phr[low[1]])) parts.push(`drag: ${phr[low[1]]}`);
  let s = parts.join(" · ");
  if (s.length > 140) s = s.slice(0, 137) + "…";
  return s;
}
