// The Odds API (read-only). Median spread/total across books -> implied team totals.
import { TEAM_BY_NAME } from "../../js/constants.js";
import { impliedTotals } from "../../js/engine.js";
import { getRaw, redact } from "./http.mjs";

const median = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export async function fetchOdds(apiKey) {
  const url = `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds?apiKey=${encodeURIComponent(apiKey)}&regions=us&markets=spreads,totals&oddsFormat=american&dateFormat=iso`;
  const res = await getRaw(url, { retries: 1 });
  if (!res.ok) throw new Error(`Odds API HTTP ${res.status} (${redact(url)})`);
  const remaining = res.headers.get("x-requests-remaining");
  return { events: await res.json(), remaining: remaining == null ? null : Number(remaining) };
}

// events -> Map "AWAY@HOME" -> { homeSpread, total, kickoff, books }
export function parseOdds(events) {
  const out = new Map();
  for (const ev of events || []) {
    const home = TEAM_BY_NAME[ev.home_team], away = TEAM_BY_NAME[ev.away_team];
    if (!home || !away) continue;
    const spreads = [], totals = [];
    for (const b of ev.bookmakers || []) {
      for (const m of b.markets || []) {
        if (m.key === "spreads") {
          const h = m.outcomes.find((o) => o.name === ev.home_team);
          if (h?.point != null) spreads.push(h.point);
        } else if (m.key === "totals") {
          const o = m.outcomes.find((x) => x.name === "Over");
          if (o?.point != null) totals.push(o.point);
        }
      }
    }
    out.set(`${away}@${home}`, { homeSpread: median(spreads), total: median(totals), kickoff: ev.commence_time, books: (ev.bookmakers || []).length });
  }
  return out;
}

export function applyOdds(game, o) {
  if (!o) return game;
  const { homeTT, awayTT } = impliedTotals(o.homeSpread, o.total);
  return { ...game, spread: o.homeSpread, total: o.total, homeTT, awayTT, kickoff: game.kickoff || o.kickoff, books: o.books };
}
