#!/usr/bin/env node
// GitHub Action entry point. Writes:
//   data/players.json        trimmed Sleeper players + game logs (weeks 1..week-1) + this week's projections
//   data/latest.json         games (odds, implied totals, weather), byes, NFL.com injury report, depth changes
//   data/depth-history.json  one depth-chart snapshot per week (last 4 weeks)
// Usage: node scripts/fetch.mjs [--week N] [--skip-players]
// Env:   ODDS_API_KEY (optional; read-only odds)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { STADIUMS } from "../js/constants.js";
import { byeTeams } from "../js/engine.js";
import { fetchState, fetchSchedule, fetchPlayers, fetchStats, fetchProjections, buildLogs, buildProj, compactPlayers, scheduleWeek } from "./lib/sleeper.mjs";
import { fetchOdds, parseOdds, applyOdds } from "./lib/odds.mjs";
import { fetchGameWeather } from "./lib/weather.mjs";
import { parseInjuryReport, mergeReport, practiceDay } from "./lib/injuries.mjs";
import { snapshot, baseline, diffDepth, updateHistory } from "./lib/depth.mjs";
import { getText } from "./lib/http.mjs";

const DATA = new URL("../data/", import.meta.url);
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const readJSON = async (name, fb = null) => { try { return JSON.parse(await readFile(new URL(name, DATA), "utf8")); } catch { return fb; } };
const writeJSON = (name, obj) => writeFile(new URL(name, DATA), JSON.stringify(obj) + "\n");
const nowIso = () => new Date().toISOString();
const dayName = (date) => new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
const log = (...a) => console.log("[fetch]", ...a);

async function main() {
  await mkdir(DATA, { recursive: true });
  const prev = await readJSON("latest.json", {});
  const state = await fetchState();
  const season = Number(state.season);
  // During the regular season Sleeper's `week` is the upcoming/current week.
  const week = Number(arg("--week") || state.week);
  if (state.season_type !== "regular" && !arg("--week")) log(`season_type=${state.season_type}; continuing with week ${week}`);
  const sameWeek = prev.season === season && prev.week === week;
  const sources = { sleeper: { asOf: nowIso(), ok: true } };

  // ---- schedule ----
  const schedule = await fetchSchedule(season);
  const wk = scheduleWeek(schedule, week);
  const allTeams = Object.keys(STADIUMS);
  const prevGames = new Map((sameWeek ? prev.games || [] : []).map((g) => [g.id, g]));
  let games = wk.map((g) => {
    const p = prevGames.get(g.game_id) || {};
    return {
      id: g.game_id, date: g.date, day: dayName(g.date), away: g.away, home: g.home, status: g.status,
      dome: STADIUMS[g.home]?.[2] ? 1 : 0,
      kickoff: p.kickoff || null, spread: p.spread ?? null, total: p.total ?? null,
      homeTT: p.homeTT ?? null, awayTT: p.awayTT ?? null, books: p.books ?? null, wx: p.wx || null,
    };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.home.localeCompare(b.home));

  // ---- odds (read-only) ----
  const key = process.env.ODDS_API_KEY;
  if (!key) {
    sources.odds = { ...(sameWeek ? prev.sources?.odds : {}), status: "missing", note: "ODDS_API_KEY secret not set; using last saved lines or manual entry" };
  } else {
    try {
      const { events, remaining } = await fetchOdds(key);
      const odds = parseOdds(events);
      let n = 0;
      games = games.map((g) => { const o = odds.get(`${g.away}@${g.home}`); if (o && o.total != null) n++; return o ? applyOdds(g, o) : g; });
      sources.odds = { asOf: nowIso(), status: "ok", provider: "The Odds API (median across US books)", games: n, remaining };
      log(`odds for ${n}/${games.length} games, ${remaining} requests left`);
    } catch (e) {
      sources.odds = { ...(sameWeek ? prev.sources?.odds : {}), status: "error", error: e.message.replace(/apiKey=[^&\s)]+/g, "apiKey=***") };
      log("odds failed:", sources.odds.error);
    }
  }

  // ---- weather ----
  let wxOk = 0, wxFail = 0;
  for (const g of games) {
    if (g.dome) continue;
    const days = (Date.parse(g.date) - Date.now()) / 86400000;
    if (days > 15 || days < -1) continue;
    try { const w = await fetchGameWeather(g); if (w && w !== "dome") { g.wx = { ...w, asOf: nowIso() }; wxOk++; } }
    catch (e) { wxFail++; log(`weather ${g.home} failed: ${e.message}`); }
    await new Promise((r) => setTimeout(r, 400)); // be gentle with the free API
  }
  sources.weather = {
    asOf: nowIso(), provider: "Open-Meteo", games: wxOk, failed: wxFail,
    status: !wxFail ? "ok" : wxOk ? "partial" : "error",
    ...(wxFail ? { note: `${wxFail} forecasts failed (kept earlier ones); the site retries from your browser` } : {}),
  };

  // ---- players, logs, projections ----
  let players;
  if (!process.argv.includes("--skip-players")) {
    const raw = await fetchPlayers();
    const statsByWeek = {};
    for (let w = 1; w < week; w++) statsByWeek[w] = await fetchStats(season, w);
    const { logs, meta } = buildLogs(statsByWeek);
    const proj = buildProj(await fetchProjections(season, week));
    players = compactPlayers(raw, logs, meta);
    await writeJSON("players.json", { asOf: nowIso(), season, week, players, logs, proj });
    sources.players = { asOf: nowIso(), status: "ok", count: Object.keys(players).length };
    log(`players ${Object.keys(players).length}, logs ${Object.keys(logs).length}, proj ${Object.keys(proj).length}`);
  } else {
    players = (await readJSON("players.json", {})).players || {};
    sources.players = prev.sources?.players;
  }

  // ---- NFL.com injury report ----
  let report = sameWeek ? prev.injuries || {} : {};
  try {
    const html = await getText(`https://www.nfl.com/injuries/league/${season}/REG${week}`);
    const rows = parseInjuryReport(html);
    report = mergeReport(report, rows, practiceDay());
    sources.injuries = { asOf: nowIso(), status: "ok", provider: "NFL.com official injury report", rows: rows.length, day: practiceDay() };
    log(`injury report rows ${rows.length}`);
  } catch (e) {
    sources.injuries = { ...(sameWeek ? prev.sources?.injuries : {}), status: "error", error: e.message };
  }

  // ---- depth charts ----
  const history = await readJSON("depth-history.json", {});
  const cur = snapshot(players);
  const base = baseline(history, week);
  const depthChanges = base ? diffDepth(base.order, cur, players) : [];
  await writeJSON("depth-history.json", updateHistory(history, week, season, cur, nowIso()));
  sources.depth = { asOf: nowIso(), status: "ok", baselineWeek: base?.week ?? null, changes: depthChanges.length };

  const out = {
    generatedAt: nowIso(), season, week, sources, games,
    byes: byeTeams(games, allTeams),
    injuries: report,
    depthChanges,
    depthPrev: base ? base.order : {},
  };
  await writeJSON("latest.json", out);
  log(`wrote latest.json for ${season} week ${week}: ${games.length} games, byes ${out.byes.join(",")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
