import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFixture } from "./load-fixture.mjs";
import { analyze, withOverrides } from "../js/analyze.js";
import {
  pct, impliedTotals, weatherPenalty, scoreOf, rosOf, waiverSet, logFromStatsRow, gameStarted, injuryKey,
} from "../js/engine.js";
import { DEFAULT_WEIGHTS } from "../js/constants.js";

const fx = await loadFixture();
const res = analyze(fx);
const byName = (n) => [...res.lineup.map((l) => l.rec), ...res.bench].find((r) => r?.n === n);

test("week 11 lineup matches the acceptance table", () => {
  const want = [
    ["QB", "Josh Allen", 74], ["RB", "D'Andre Swift", 88], ["RB", "Emmett Johnson", 63],
    ["WR", "George Pickens", 89], ["WR", "Malik Nabers", 60], ["TE", "Chig Okonkwo", 53],
    ["FLEX", "Josh Downs", 47], ["K", "Evan McPherson", 63], ["DEF", "Cincinnati Bengals", 49],
  ];
  assert.equal(res.lineup.length, 9);
  want.forEach(([slot, n, s], i) => {
    assert.equal(res.lineup[i].slot, slot);
    assert.equal(res.lineup[i].rec.n, n);
    assert.ok(Math.abs(res.lineup[i].rec.s - s) <= 1, `${n}: ${res.lineup[i].rec.s} vs ${s}`);
  });
  assert.equal(res.changes, 0, "matches the owner's Sleeper lineup");
});

test("factor percentiles match the prototype", () => {
  assert.deepEqual(byName("Josh Allen").c, [78, 81, 35, 92, 94]);
  assert.deepEqual(byName("George Pickens").c, [77, 94, 96, 96, 88]);
  assert.deepEqual(byName("Emmett Johnson").c, [51, 92, 54, 55, 60]);
  assert.deepEqual(byName("Cincinnati Bengals").c, [59, 31, 38, 48, 84]);
  assert.deepEqual(byName("C.J. Stroud").c, [44, 89, 50, 77, 89]);
});

test("bench, byes and IR", () => {
  assert.equal(byName("C.J. Stroud").s, 66);
  assert.equal(byName("Rachaad White").s, 44);
  assert.equal(byName("Aaron Jones Sr.").s, 33);
  for (const n of ["Kyren Williams", "Christian Watson", "Seattle Seahawks"]) {
    const r = byName(n);
    assert.ok(r.bye && r.forced, `${n} on bye and forced to bench`);
  }
  const mp = byName("Michael Pittman Jr.");
  assert.ok(mp.forced && mp.reserve);
});

test("waiver adds", () => {
  const got = res.adds.map((a) => [a.rec.n, Math.round(a.val), a.drop.n, a.label]);
  assert.deepEqual(got, [
    ["Makai Lemon", 72, "Aaron Jones Sr.", "free"],
    ["Adonai Mitchell", 69, "Rachaad White", "free"],
    ["Tampa Bay Buccaneers", 65, "Seattle Seahawks", "free"],
    ["Cam Little", 77, "Evan McPherson", "hold"],
  ]);
});

test("implied totals and byes", () => {
  const tt = {};
  for (const g of fx.latest.games) { tt[g.home] = g.homeTT; tt[g.away] = g.awayTT; }
  assert.deepEqual([tt.DAL, tt.BUF, tt.CIN, tt.CHI, tt.HOU, tt.KC], [32, 31, 30.5, 30, 28, 28]);
  assert.deepEqual(fx.latest.byes, ["ATL", "CLE", "GB", "LAR", "NE", "SEA"]);
});

test("matchup header projections", () => {
  assert.equal(res.me.sleeperProj, 120.9);
  assert.equal(res.opp.name, "HeGibbeth&HeTakethAway");
});

test("risk list flags Downs high and the Monday stack", () => {
  const downs = res.risks.find((r) => r.n.startsWith("Josh Downs"));
  assert.equal(downs.lvl, "h");
  assert.ok(res.risks.some((r) => r.n.startsWith("CIN @ WAS") && r.lvl === "m"));
  assert.ok(res.risks.some((r) => r.n.includes("only TE")));
  assert.ok(res.risks.some((r) => r.n === "Opponent: Bhayshul Tuten"));
});

test("reasons stay short", () => {
  for (const l of res.lineup) assert.ok(l.rec.why.length <= 140 && l.rec.why.length > 10, l.rec.why);
});

test("helpers", () => {
  assert.equal(pct(5, [1, 2, 5, 9]), 50);
  assert.deepEqual(impliedTotals(-16.5, 45.5), { homeTT: 31, awayTT: 14.5 });
  assert.equal(weatherPenalty({ wind: 22, pop: 80, precip: 0.4, hi: 25 }, false), 40);
  assert.equal(weatherPenalty({ wind: 22, pop: 80, precip: 0.4, hi: 25 }, true), 0);
  assert.equal(scoreOf([78, 81, 35, 92, 94], DEFAULT_WEIGHTS), 74);
  assert.ok(Math.abs(rosOf([90, 82, 46, 15, 35], DEFAULT_WEIGHTS) - 78.46) < 0.01);
  assert.equal(scoreOf([100, 0, 0, 0, 0], [0, 0, 0, 0, 0]), 0);
  assert.equal(injuryKey("Michael Pittman Jr.", "PIT"), injuryKey("Michael Pittman", "PIT"));
  assert.deepEqual(logFromStatsRow({ week: 3, opponent: "NYJ", stats: { gp: 1, pts_ppr: 20, off_snp: 50, tm_off_snp: 60, rec_tgt: 8, rec_rz_tgt: 2, pass_rz_att: 1 } }),
    [3, 20, 0.833, 8, 0, 2.3, 0, "NYJ"]);
  assert.equal(logFromStatsRow({ week: 3, stats: { gp: 0 } }), null);
  assert.equal(gameStarted({ status: "complete" }), true);
  assert.equal(gameStarted({ status: "pre_game", kickoff: "2099-01-01T00:00:00Z" }), false);
});

test("waivers: recent drops are on waivers, old ones clear", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  const tx = [
    { status: "complete", drops: { a: 1 }, status_updated: now - 86400000 },
    { status: "complete", drops: { b: 1 }, status_updated: now - 3 * 86400000 },
    { status: "failed", drops: { c: 1 }, status_updated: now },
  ];
  const w = waiverSet(tx, now, 2);
  assert.ok(w.has("a") && !w.has("b") && !w.has("c"));
});

test("weights recompute the lineup", () => {
  const r2 = analyze({ ...fx, weights: [0, 0, 0, 0, 50] });
  assert.equal(r2.lineup.find((l) => l.slot === "QB").rec.n, "Josh Allen");
  const r3 = analyze({ ...fx, weights: [0, 50, 0, 0, 0] });
  assert.equal(r3.lineup.find((l) => l.slot === "QB").rec.n, "C.J. Stroud", "form-only favours Stroud (89 vs 81)");
});

test("manual odds override recomputes implied totals", () => {
  const g = withOverrides(fx.latest.games, { [fx.latest.games[0].id]: { spread: "-3", total: "50" } })[0];
  assert.equal(g.homeTT, 26.5);
  assert.equal(g.awayTT, 23.5);
});

test("a kicked-off free agent is locked", () => {
  const live = fx.latest.games.map((g) => ({ game_id: g.id, status: "complete" }));
  const r = analyze({ ...fx, liveSchedule: live });
  assert.ok(r.adds.every((a) => a.label === "locked"));
});
