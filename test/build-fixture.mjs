// One-off: build test/fixtures/week11 from raw Sleeper pulls (Thu Nov 19 2026, ~4:50am CT)
// plus the prototype's Vegas lines and forecasts (reference-week11.html).
// Usage: node test/build-fixture.mjs <rawDir>
import { readFile, writeFile } from "node:fs/promises";
import { STADIUMS } from "../js/constants.js";
import { impliedTotals, byeTeams } from "../js/engine.js";
import { buildLogs, buildProj, compactPlayers, scheduleWeek } from "../scripts/lib/sleeper.mjs";
import { parseInjuryReport, mergeReport } from "../scripts/lib/injuries.mjs";
import { snapshot } from "../scripts/lib/depth.mjs";

const raw = process.argv[2];
const R = async (f) => JSON.parse(await readFile(`${raw}/${f}`, "utf8"));
const OUT = new URL("./fixtures/week11/", import.meta.url);
const W = (f, o) => writeFile(new URL(f, OUT), JSON.stringify(o) + "\n");

// [away, home, homeSpread, total, hiF, windMph, rainPct, precipIn]  (from the prototype's Games tab).
// The prototype didn't display precipitation amounts. Its scores show the rain penalty fired at KC and NYG
// (Emmett Johnson env 55, Nabers 21, Cam Little 58) and not at CHI, so precip is set to match.
const LINES = [
  ["IND", "HOU", -12.5, 43.5], ["MIA", "BUF", -16.5, 45.5, 65, 11, 24], ["BAL", "CAR", -2.5, 43.5, 68, 11, 18],
  ["NO", "CHI", -11.5, 48.5, 59, 13, 71, 0.15], ["TEN", "DAL", -8.5, 55.5], ["LV", "DEN", -10, 40.5, 47, 5, 0],
  ["TB", "DET", -7, 43.5], ["ARI", "KC", -15.5, 40.5, 59, 17, 94, 0.5], ["JAX", "NYG", 6, 46.5, 59, 8, 61, 0.3],
  ["PIT", "PHI", 4.5, 37.5, 59, 10, 59], ["NYJ", "LAC", -3, 41.5], ["MIN", "SF", -3, 45.5, 58, 5, 22],
  ["CIN", "WAS", 6.5, 54.5, 63, 15, 30],
];

const state = await R("state.json");
const week = state.week, season = Number(state.season);
const statsByWeek = {};
for (let w = 1; w < week; w++) statsByWeek[w] = await R(`stats${w}.json`);
const { logs, meta } = buildLogs(statsByWeek);
const proj = buildProj(await R("proj11.json"));
const players = compactPlayers(await R("players.json"), logs, meta);
// keep the fixture small: players with logs, projections, or on a league roster
const rosters = await R("rosters.json");
const rostered = new Set(rosters.flatMap((r) => [...(r.players || []), ...(r.reserve || [])]));
for (const id of Object.keys(players)) if (!logs[id] && proj[id] == null && !rostered.has(id)) delete players[id];
for (const id of Object.keys(proj)) if (!players[id]) delete proj[id];

const sched = scheduleWeek(await R("schedule.json"), week);
const games = sched.map((g) => {
  const L = LINES.find((l) => l[0] === g.away && l[1] === g.home);
  const dome = STADIUMS[g.home][2] ? 1 : 0;
  const { homeTT, awayTT } = impliedTotals(L?.[2], L?.[3]);
  return {
    id: g.game_id, date: g.date, day: new Date(g.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
    away: g.away, home: g.home, status: g.status, dome, kickoff: null,
    spread: L?.[2] ?? null, total: L?.[3] ?? null, homeTT, awayTT,
    wx: dome || !L || L[4] == null ? null : { hi: L[4], lo: null, pop: L[6], precip: L[7] ?? 0, wind: L[5] },
  };
}).sort((a, b) => a.date.localeCompare(b.date) || a.home.localeCompare(b.home));

const inj = mergeReport({}, parseInjuryReport(await readFile(`${raw}/inj11.html`, "utf8")), "Wed");
await W("players.json", { asOf: "2026-11-19T10:50:00Z", season, week, players, logs, proj });
await W("latest.json", {
  generatedAt: "2026-11-19T10:50:00Z", season, week,
  sources: { odds: { status: "ok", provider: "VegasInsider consensus (prototype)" }, weather: { status: "ok", provider: "Open-Meteo (prototype)" } },
  games, byes: byeTeams(games, Object.keys(STADIUMS)), injuries: inj, depthChanges: [], depthPrev: snapshot(players),
});
for (const f of ["league", "users", "rosters", "trending", "state"]) await W(`${f}.json`, await R(`${f}.json`));
await W("matchups.json", await R("matchups11.json"));
await W("transactions.json", [...(await R("tx11.json")), ...(await R("tx10.json"))]);
console.log("fixture written", Object.keys(players).length, "players");
