// Glue between raw data (data/*.json + live Sleeper league calls) and the engine.
// Pure: no DOM, no fetch. Used by js/app.js and by the tests.
import { DEFAULT_WEIGHTS } from "./constants.js";
import {
  prepare, scoreOf, valueOf, buildLineup, lineupSlots, rankWaivers, waiverSet, buildRisks, reasonFor,
  injuryInfo, impliedTotals, teamGames,
} from "./engine.js";

// Apply manual Vegas overrides { gameId: {spread, total} } on top of the Action's lines.
export function withOverrides(games, overrides = {}) {
  return games.map((g) => {
    const o = overrides[g.id];
    if (!o || o.total == null || o.spread == null || o.total === "" || o.spread === "") return g;
    const spread = Number(o.spread), total = Number(o.total);
    return { ...g, spread, total, ...impliedTotals(spread, total), manual: true };
  });
}

// Merge browser-fetched forecasts { gameId: wx } for games the Action couldn't cover.
export function withWeather(games, wxById = {}) {
  return games.map((g) => (g.wx || g.dome || !wxById[g.id] ? g : { ...g, wx: wxById[g.id], wxSource: "browser" }));
}

/**
 * input: { pdata, latest, league, users, rosters, matchups, transactions, userId, weights, now, oddsOverrides, browserWx, liveSchedule }
 */
export function prepareGames(latest, { oddsOverrides, browserWx, liveSchedule } = {}) {
  let games = withWeather(withOverrides(latest.games || [], oddsOverrides), browserWx);
  if (liveSchedule) {
    const st = new Map(liveSchedule.map((g) => [g.game_id, g.status]));
    games = games.map((g) => (st.has(g.id) ? { ...g, status: st.get(g.id) } : g));
  }
  return games;
}

export function analyze(input) {
  const { pdata, latest, league, users = [], rosters, matchups = [], transactions = [], userId } = input;
  const W = input.weights || DEFAULT_WEIGHTS;
  const now = input.now ?? Date.now();
  const games = input.games || prepareGames(latest, input);
  // percentiles don't depend on weights, so callers may pass the previous model back in
  const model = input.model && input.model.games === games ? input.model
    : prepare({ season: pdata.season, week: pdata.week, players: pdata.players, logs: pdata.logs, proj: pdata.proj, games });
  model.games = games;
  const report = latest.injuries || {};

  // make sure every rostered id resolves to a record (e.g. a player with no team)
  for (const r of rosters) for (const id of [...(r.players || []), ...(r.reserve || [])]) {
    if (!model.recs.has(id)) {
      const p = pdata.players[id];
      model.recs.set(id, {
        id, n: p?.n || `Player ${id}`, pos: p?.pos || "?", tm: p?.tm || null, opp: null, bye: false, proj: pdata.proj?.[id] ?? null,
        c: [0, 0, 50, 50, 0], raw: { opp: 0, form: 0, season: 0, games: 0, l3: [], snap: 0, prevSnap: null, tgt: 0, car: 0, pa: 0 },
        inj: p?.inj || null, dc: p?.dc ?? null, active: p?.active, game: null,
      });
    }
  }

  const mine = rosters.find((r) => r.owner_id === userId || (r.co_owners || []).includes(userId));
  if (!mine) return { error: "That user has no team in this league. Check Settings.", model, games };
  const userOf = (r) => users.find((u) => u.user_id === r?.owner_id);
  const teamName = (r) => { const u = userOf(r); return u?.metadata?.team_name || u?.display_name || `Team ${r?.roster_id}`; };

  const slots = lineupSlots(league.roster_positions);
  const roster = [...new Set([...(mine.players || []), ...(mine.reserve || [])])];
  const reserve = mine.reserve || [];
  const lu = buildLineup(model, { roster, reserve, starters: mine.starters || [], slots, W, report });
  const lineupIds = new Set(lu.lineup.filter((l) => l.rec).map((l) => l.rec.id));

  const decorate = (rec) => ({
    ...rec, s: rec.s ?? scoreOf(rec.c, W), why: reasonFor(rec, model), injury: injuryInfo(rec, report),
  });
  const lineup = lu.lineup.map((l) => ({ slot: l.slot, rec: l.rec ? decorate(l.rec) : null }));
  const bench = lu.bench.map(decorate);

  // opponent
  const myM = matchups.find((m) => m.roster_id === mine.roster_id);
  const oppM = myM ? matchups.find((m) => m.matchup_id === myM.matchup_id && m.roster_id !== mine.roster_id) : null;
  const oppR = oppM ? rosters.find((r) => r.roster_id === oppM.roster_id) : null;
  const oppStarters = oppM?.starters || oppR?.starters || [];
  const opp = oppR ? {
    name: teamName(oppR), wins: oppR.settings?.wins, losses: oppR.settings?.losses, ties: oppR.settings?.ties,
    lineup: oppStarters.map((id, i) => {
      const rec = model.recs.get(id);
      return { slot: slots[i], rec: rec ? decorate(rec) : null, id };
    }),
  } : null;
  const projSum = (ids) => Math.round(ids.reduce((a, id) => a + (pdata.proj?.[id] || 0), 0) * 10) / 10;

  // waivers
  const rostered = rosters.flatMap((r) => [...(r.players || []), ...(r.reserve || []), ...(r.taxi || [])]);
  const wset = waiverSet(transactions, now, league.settings?.waiver_clear_days ?? 2);
  const wv = rankWaivers(model, { rostered, myRoster: roster, reserve, lineupIds, W, report, waivers: wset, now });
  const adds = wv.adds.map((a) => ({ ...a, rec: decorate(a.rec), score: scoreOf(a.rec.c, W) }));

  const risks = buildRisks(model, {
    lineup: lu.lineup, roster, reserve, oppStarters, report, depthPrev: latest.depthPrev || {}, W,
  });

  // depth changes touching my roster
  const myDepth = (latest.depthChanges || []).filter((d) => roster.includes(d.id));

  return {
    model, games, W,
    me: {
      roster_id: mine.roster_id, name: teamName(mine), wins: mine.settings?.wins, losses: mine.settings?.losses, ties: mine.settings?.ties,
      waiverPos: mine.settings?.waiver_position, sleeperProj: projSum((mine.starters || []).filter(Boolean)),
      recProj: projSum([...lineupIds]),
    },
    opp: opp && { ...opp, sleeperProj: projSum(oppStarters.filter(Boolean)) },
    lineup, bench, changes: lu.changes, adds, faConsidered: wv.considered, risks, myDepth,
    valueOf: (rec) => valueOf(rec, W),
  };
}

export { teamGames };
