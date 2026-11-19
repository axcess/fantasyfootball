import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInjuryReport, mergeReport } from "../scripts/lib/injuries.mjs";
import { parseOdds, applyOdds } from "../scripts/lib/odds.mjs";
import { parseWeather } from "../scripts/lib/weather.mjs";
import { diffDepth, baseline, updateHistory } from "../scripts/lib/depth.mjs";

const HTML = `<section class="nfl-o-injury-report__unit"><span class="nfl-c-matchup-strip__team-abbreviation"> AZ </span>
<span class="nfl-c-matchup-strip__team-abbreviation"> KC </span>
<div class="d3-o-section-sub-title"><span>Cardinals</span></div><table><thead><tr><th>Player</th></tr></thead><tbody>
<tr><td><a href="#"> Marvin Harrison Jr. </a></td><td>WR</td><td>Hamstring</td><td>Did Not Participate In Practice</td><td>Questionable</td></tr></tbody></table>
<div class="d3-o-section-sub-title"><span>Chiefs</span></div><table><thead><tr><th>Player</th></tr></thead><tbody>
<tr><td><a href="#"> Josh Downs </a></td><td>WR</td><td>Knee</td><td>Limited Participation in Practice</td><td></td></tr></tbody></table></section>`;

test("NFL.com injury report parser", () => {
  const rows = parseInjuryReport(HTML);
  assert.deepEqual(rows, [
    { n: "Marvin Harrison Jr.", tm: "ARI", pos: "WR", injury: "Hamstring", practice: "DNP", game: "Questionable" },
    { n: "Josh Downs", tm: "KC", pos: "WR", injury: "Knee", practice: "Limited", game: null },
  ]);
  const m1 = mergeReport({}, rows, "Wed");
  const m2 = mergeReport(m1, [{ ...rows[1], practice: "Full" }], "Thu");
  assert.deepEqual(m2["joshdowns|KC"].days, { Wed: "Limited", Thu: "Full" });
});

test("odds parser takes the median across books", () => {
  const book = (sp, tot) => ({ markets: [
    { key: "spreads", outcomes: [{ name: "Kansas City Chiefs", point: sp }, { name: "Arizona Cardinals", point: -sp }] },
    { key: "totals", outcomes: [{ name: "Over", point: tot }, { name: "Under", point: tot }] }] });
  const ev = [{ home_team: "Kansas City Chiefs", away_team: "Arizona Cardinals", commence_time: "2026-11-22T18:00:00Z",
    bookmakers: [book(-15.5, 40.5), book(-15, 41), book(-16, 40.5)] }];
  const o = parseOdds(ev).get("ARI@KC");
  assert.equal(o.homeSpread, -15.5);
  assert.equal(o.total, 40.5);
  const g = applyOdds({ home: "KC", away: "ARI" }, o);
  assert.equal(g.homeTT, 28);
  assert.equal(g.awayTT, 12.5);
});

test("weather parser", () => {
  assert.deepEqual(parseWeather({ daily: { time: ["2026-11-22"], temperature_2m_max: [59], temperature_2m_min: [44],
    precipitation_probability_max: [94], precipitation_sum: [0.6], wind_speed_10m_max: [17] } }),
  { hi: 59, lo: 44, pop: 94, precip: 0.6, wind: 17 });
  assert.equal(parseWeather({}), null);
});

test("depth snapshots diff against the previous week", () => {
  let h = updateHistory({}, 10, 2026, { a: 1, b: 2 }, "t1");
  h = updateHistory(h, 11, 2026, { a: 2, b: 1 }, "t2");
  const base = baseline(h, 11);
  assert.equal(base.week, 10);
  const d = diffDepth(base.order, { a: 2, b: 1 }, { a: { n: "A", pos: "WR", tm: "KC" }, b: { n: "B", pos: "WR", tm: "KC" } });
  assert.deepEqual(d.map((x) => [x.id, x.from, x.to]), [["b", 2, 1], ["a", 1, 2]]);
  for (let w = 12; w < 16; w++) h = updateHistory(h, w, 2026, {}, "t");
  assert.equal(Object.keys(h.weeks).length, 4);
});
