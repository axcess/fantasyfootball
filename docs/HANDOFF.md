# Handoff: Fantasy Football Command Center (Sleeper)

You're taking over a weekly fantasy football assistant. A prototype exists: `reference-week11.html` in this folder. It's a static snapshot with baked-in data, built in a Claude chat. Your job is to turn it into a **self-updating website in a GitHub repo, hosted on GitHub Pages**, that the owner can open on a phone.

Read this whole file before writing code. The scoring model and the verified data sources below are the important parts.

---

## 1. The owner and league

| Item | Value |
|---|---|
| Platform | Sleeper |
| League | "Tod's BBQ", 12-team keeper league, full PPR (`rec: 1`, `pass_td: 4`) |
| League ID | `1316844568775266304` |
| Owner | Sleeper user `Esau07`, user_id `737509404907298816`, team "Team Esau", roster_id `8` |
| Lineup slots | QB, RB, RB, WR, WR, TE, FLEX (RB/WR/TE), K, DEF, plus 6 bench and an IR/reserve slot |
| Waivers | Rolling (`waiver_type: 0`), `waiver_clear_days: 2`. Owner was #4 priority in Week 11 |
| Season | 2026. Week 1 started 2026-09-10 |

Don't hard-code the IDs. Put them in a settings panel (saved to localStorage), with the values above as defaults. The owner might share this with leaguemates.

---

## 2. What the owner wants (requirements)

**Checked each week**
- My roster and the top available waiver players
- Injury reports and practice status
- Depth-chart changes
- Matchups: points each defense allows by position
- Vegas team totals and weather
- Bye weeks

**Player score, 0–100 (weighted sum of 5 factors)**
| Factor | Default weight |
|---|---|
| Opportunity (targets, carries, snap share, red-zone looks) | 30% |
| Recent form (PPR points over the last 3 games) | 25% |
| Matchup | 20% |
| Game environment (Vegas total and weather) | 15% |
| Season average | 10% |

- Out, Doubtful, IR, PUP, suspended and bye-week players go to the bench whatever their score.
- The weights must be **adjustable in the UI** with sliders, persisted. The owner says they're a starting point and will be tuned after a few weeks.

**Weekly rhythm**
- Tue/Wed: waiver run. Top 5 adds, each with a suggested drop.
- Thu afternoon: check players in the Thursday night game.
- Sun morning: final lineup after the last injury news.

**Waiver labels (rolling waivers), one per add**
- **Claim now**: worth dropping to the back of the waiver order.
- **Free agent**: grab it now, no cost to my priority.
- **Hold priority**: not worth giving up my spot.

**Outputs**
- A start/sit call for every lineup slot, with one line of reasoning
- Ranked waiver adds
- A risk list of players to watch before kickoff

**Caveats shown in the UI:** the weights are the owner's own starting point, not a proven model; projections are estimates; late scratches still happen.

---

## 3. Recommended architecture

Static site on GitHub Pages, plus a **GitHub Actions cron job** that writes JSON into the repo.

```
/                     static site (vanilla JS or a light framework; no backend)
/data/latest.json     written by the Action: odds, weather, NFL.com injury report, depth charts
/scripts/fetch.*      the Action's fetch script (Node or Python)
/.github/workflows/refresh.yml
```

Why both:
- **Sleeper data** (rosters, players, stats, projections, trending, transactions) can be fetched live in the browser, so the roster is always current. ⚠️ **Verify CORS first** (see §4). If the browser can't reach it from `*.github.io`, move all Sleeper fetching into the Action too.
- **Odds** need an API key. Keep it in an Actions secret and never ship it to the browser. **NFL.com practice reports and depth-chart sites** have no CORS, so they need a server-side fetch. **Weather** could go either way; doing it in the Action keeps things simple.

Suggested Action schedule (UTC cron, owner is America/Chicago):
- Tue and Wed ~14:00 CT (waivers)
- Thu ~15:00 CT (TNF check)
- Fri ~16:00 CT (game designations are out)
- Sun ~09:30 CT (final lineup)
- Mon ~17:00 CT (Monday-night players)
- Also `workflow_dispatch` so the owner can trigger it from the phone.

The site shows "data as of …" for every source.

---

## 4. Data sources (verified from a sleeper.com page, Nov 19 2026)

All of these returned 200 from the browser on `sleeper.com`. **None has been tested from another origin yet.** Task 1 is to confirm CORS from GitHub Pages (or localhost).

### Sleeper: official public API (no key)
| Endpoint | Use |
|---|---|
| `GET https://api.sleeper.app/v1/state/nfl` | `week`, `season`, `season_type`. On Thu of Week 11, `week` = 11 |
| `GET /v1/league/{league_id}` | `roster_positions`, `scoring_settings`, `settings.waiver_type`, `settings.waiver_clear_days` |
| `GET /v1/league/{id}/users` | `user_id`, `display_name`, `metadata.team_name` |
| `GET /v1/league/{id}/rosters` | `roster_id`, `owner_id`, `players[]`, `starters[]` (in slot order), `reserve[]`, `taxi`, `settings.waiver_position`, `wins`, `losses` |
| `GET /v1/league/{id}/matchups/{week}` | `matchup_id` pairs rosters; opponent's `starters` |
| `GET /v1/league/{id}/transactions/{week}` | Fetch this week and last week. Players in `drops` from a `complete` transaction with `status_updated` < 2 days ago are **on waivers** |
| `GET /v1/players/nfl` | ~5 MB map of player_id to player. Fields: `first_name`, `last_name`, `position`, `team`, `injury_status`, `injury_body_part`, `injury_notes`, `practice_participation` (was **null for everyone** in testing), `depth_chart_order`, `depth_chart_position`, `active`. **Cache it** (IndexedDB, or have the Action write a trimmed copy) and refresh at most daily |
| `GET /v1/players/nfl/trending/add?lookback_hours=48&limit=60` | `[{player_id, count}]`. Counts are Sleeper-wide, not league-specific |

### Sleeper: unofficial endpoints (undocumented; may change)
| Endpoint | Use |
|---|---|
| `GET https://api.sleeper.app/stats/nfl/{season}/{week}?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF` | Array of `{player_id, team, opponent, week, game_id, stats:{...}, player:{...}}`. Useful stats keys: `pts_ppr`, `gp`, `off_snp`, `tm_off_snp`, `rec_tgt`, `rush_att`, `rec_rz_tgt`, `rush_rz_att` (may be missing; treat as 0), `pass_att`, `pass_rz_att` |
| `GET https://api.sleeper.app/projections/nfl/{season}/{week}?season_type=regular&position[]=...` | Same shape. `stats.pts_ppr` is Sleeper's projection |
| `GET https://api.sleeper.app/schedule/nfl/regular/{season}` | `[{week, date:"YYYY-MM-DD", home, away, status, game_id}]`. **No kickoff time.** **Bye teams** = teams absent from that week's games |

Notes: DEF player_ids are team abbreviations (`"CIN"`). Skill players "played" if `gp > 0` or `off_snp > 0`.

### Weather: Open-Meteo (free, no key, CORS ok)
`https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&start_date={date}&end_date={date}`

Use the home team's stadium. `dome: 1` means skip weather. Teams that share a stadium share coordinates:
```js
const STADIUMS={ARI:[33.53,-112.26,1],ATL:[33.76,-84.40,1],BAL:[39.28,-76.62],BUF:[42.77,-78.79],CAR:[35.23,-80.85],CHI:[41.86,-87.62],CIN:[39.10,-84.52],CLE:[41.51,-81.70],DAL:[32.75,-97.09,1],DEN:[39.74,-105.02],DET:[42.34,-83.05,1],GB:[44.50,-88.06],HOU:[29.68,-95.41,1],IND:[39.76,-86.16,1],JAX:[30.32,-81.64],KC:[39.05,-94.48],LV:[36.09,-115.18,1],LAC:[33.95,-118.34,1],LAR:[33.95,-118.34,1],MIA:[25.96,-80.24],MIN:[44.97,-93.26,1],NE:[42.09,-71.26],NO:[29.95,-90.08,1],NYG:[40.81,-74.07],NYJ:[40.81,-74.07],PHI:[39.90,-75.17],PIT:[40.45,-80.02],SF:[37.40,-121.97],SEA:[47.60,-122.33],TB:[27.98,-82.50],TEN:[36.17,-86.77],WAS:[38.91,-76.86]};
```
Retractable roofs (DAL, HOU, ATL, ARI, IND) are treated as domes. International games need a manual override.

### Vegas odds
- Recommended: **The Odds API** (the-odds-api.com), free tier of about 500 requests/month. Sport `americanfootball_nfl`, markets `spreads,totals`. Key goes in Actions secret `ODDS_API_KEY`. Use a consensus or median across books.
- Implied team total: `home = total/2 − homeSpread/2`, `away = total/2 + homeSpread/2`, where `homeSpread` is negative when home is favored.
- Fallback: a manual-entry table in the UI.
- **Read-only.** No sportsbook logins, no bet placement, no betting features.

### Injury and depth charts (server-side only)
- Official report: `https://www.nfl.com/injuries/league/{season}/REG{week}`. Confirmed to exist for 2026 REG11. It's HTML, so scrape it in the Action (player, team, injury, practice status, game status). Respect robots/ToS. One fetch per run.
- Depth charts: Sleeper's `depth_chart_order` is the baseline. **Detect changes** by diffing against the previous run's snapshot, saved in `/data/depth-history.json`. Optionally add an external depth-chart source later.

---

## 5. Scoring model (exactly what the prototype does)

### Game logs
From weeks `1..currentWeek−1`, per player: `{week, pts:pts_ppr, snp:off_snp/tm_off_snp, tgt:rec_tgt, car:rush_att, rz:rec_rz_tgt+rush_rz_att+0.3*pass_rz_att, pa:pass_att, opp:opponent}`.
- `l3` = last 3 games played.
- `snap` = average snap share over `l3`.
- `prevSnap` = average over the 3 games before `l3`.

### Raw factor values
- **Opportunity (raw)**
  - QB: `avg(pa + 2·car + 3·rz) + 10·snap`
  - RB: `avg(car + 1.5·tgt + 3·rz) + 20·snap`
  - WR/TE: `avg(1.5·tgt + car + 3·rz) + 20·snap`
  - K/DEF: this week's Sleeper projected `pts_ppr`
- **Form:** average `pts` over `l3`
- **Season:** average `pts` over all games played
- **Matchup (DvP):** for each `(defenseTeam, position)`, sum `pts_ppr` of all players at that position whose `opponent == defenseTeam`, grouped by week, then averaged across weeks. For a player, look up `DvP[opponentThisWeek|pos]`. For DEF this naturally measures how generous the opposing offense is to defenses.
- **Environment:** the team's implied total (for DEF, the *opponent's* implied total, inverted).

### Normalize to percentiles (0–100)
Build a comparison pool per position: players with ≥2 games, top N by season PPG, with N = QB 36, RB 72, WR 96, TE 36, K 32, DEF 32.
- `pct(v) = 100 × (count of pool values < v) / pool size`
- Opportunity, Form and Season are compared against the pool's values.
- Matchup is the percentile of the opponent's DvP among all teams playing this week.
- Environment is the percentile of implied total among all teams playing.

### Weather penalty (outdoor only, applied to Environment)
- wind ≥ 20 mph: −25; wind ≥ 15: −12
- rain probability ≥ 60% **and** precipitation ≥ 0.25 in: −10
- high < 30 °F: −5
- Kickers: penalty × 1.5. DEF: weather **helps**, adding +0.5 × the penalty.
- Clamp to 0–100.

### Scores
- `score = Σ wᵢ·cᵢ / Σ wᵢ`, with weights in this order: [opp, form, matchup, env, season]
- `ros` (rest-of-season) = `(0.30·opp + 0.25·form + 0.10·season) / 0.65`, using the current weights' opportunity/form/season shares
- Byes: matchup and environment default to 50, but the player is forced to the bench anyway

### Lineup
Drop forced-bench players. Sort the rest by score, then fill greedily in slot order: QB, RB, RB, WR, WR, TE, FLEX(RB/WR/TE), K, DEF. Flag any slot that differs from Sleeper's `starters`. Exclude `reserve` (IR slot) players from everything except display.

### Waivers
- **Free agents** = players with a team, `active != false`, positions QB/RB/WR/TE/K/DEF, not on any roster in the league, ≥2 games played, and not tagged IR/Out/PUP/Sus.
- **Value** = `0.6·ros + 0.4·(bye ? ros : score)`, for both adds and drop candidates.
- **Drop pool**
  - For a K, DEF or QB add: the owner's player at the same position. For a QB add, exclude the starting QB.
  - Otherwise: the owner's non-starting, non-reserve RB/WR/TE.
  - Each drop is used at most once.
- **Rules**
  - Walk free agents by value, descending.
  - At most one add per position among K, DEF and QB.
  - Gain must be ≥ 8 (≥ 5 for K/DEF).
  - Stop at 5 adds. Show fewer if fewer qualify, with a note saying so.
- **Label**
  - On waivers (dropped < 2 days ago, see §4): **Claim now** if gain ≥ 15, otherwise **Hold priority**.
  - Not on waivers: **Free agent**.
  - A player whose game has already kicked off this week is locked. Mark them unavailable until waivers clear.

### Risk list (prototype rules; refine)
- **High:** a starter with an injury tag (Q/D), or snap share down ≥ 20 points (prev3 → last3), or depth order worse than last snapshot.
- **Watch:**
  - a starter outdoors with wind ≥ 15 or rain ≥ 60%
  - the only rostered player at a slot (e.g. a single TE)
  - several starters in a Monday game (limited pivots)
- **Low:**
  - snap dip of 10–20 points
  - light weather
  - the opponent's starters with Q tags
- Also add NFL.com practice status: DNP or limited on Wed/Thu for any starter.

### One-line reasons
Generate from the data. Lead with the strongest positive factor, then name the biggest drag. Example: `"9.3 tgt/gm, 22 PPR last 3 · TEN allows most WR pts · dome, team total 32"`. Keep under ~140 characters.

---

## 6. UI (match the prototype's layout; mobile-first)

Tabs:
- **Lineup:** slot, player, opponent, score bar, START/SIT/BYE/injury tag, reason. Then bench, then the opponent's lineup with Sleeper projections. Header shows the matchup with projected totals (sum of Sleeper projections).
- **Waivers:** ranked adds, suggested drop with value gain, label, plus a label legend.
- **Risk list**
- **Games & weather:** spread, total, implied totals, forecast, byes.
- **Model weights:** 5 sliders (0–50) and a reset button; everything recomputes live.
- **Weekly plan:** highlight today's step based on day of week.
- **Settings:** league ID, user, odds key status (never show the key itself).

Every section shows its "as of" time. Must read well at 380 px wide. Use `textContent`, never `innerHTML`, for API-derived strings.

---

## 7. Acceptance check (Week 11, 2026, data pulled Thu Nov 19 ~4:30 CT)

With default weights, the prototype produced the results below. Small differences are fine once the data updates, but large ones mean a formula bug.

**Lineup** (matched the owner's Sleeper lineup)
| Slot | Player | Score |
|---|---|---|
| QB | Josh Allen | 74 |
| RB | D'Andre Swift | 88 |
| RB | Emmett Johnson | 63 |
| WR | George Pickens | 89 |
| WR | Malik Nabers | 60 |
| TE | Chig Okonkwo | 53 |
| FLEX | Josh Downs | 47 |
| K | Evan McPherson | 63 |
| DEF | Cincinnati | 49 |

**Bench:** C.J. Stroud 66, Rachaad White 44, Aaron Jones 33. On bye: Kyren Williams, Christian Watson, SEA DEF. Michael Pittman is on IR in the reserve slot.

**Adds**
1. Makai Lemon (WR PHI), value 72, drop Aaron Jones, Free agent
2. Adonai Mitchell (WR NYJ), value 69, drop Rachaad White, Free agent
3. TB DEF, value 65, drop SEA DEF, Free agent
4. Cam Little (K JAX), value 77, drop McPherson, Hold priority (was on waivers)

**Implied totals:** DAL 32, BUF 31, CIN 30.5, CHI 30, HOU 28, KC 28.

**Byes:** ATL, CLE, GB, LAR, NE, SEA.

---

## 8. Suggested task order
1. Scaffold the repo and Pages deploy. **Test CORS** for every Sleeper endpoint (official and unofficial) and Open-Meteo from the Pages origin, and record the results in the README.
2. Port the scoring engine as a pure module with unit tests, using a saved Week 11 fixture.
3. Build the Action: odds, weather, NFL.com injury scrape, depth snapshot diff, then commit `/data/*.json`.
4. Build the UI, following §6.
5. Write README setup steps: create a free Odds API key, add the repo secret, enable Pages, run the workflow manually once.

## 9. Out of scope / guardrails
- No betting features and no sportsbook accounts. Odds are read-only inputs.
- Sleeper's API is read-only, so no automated lineup changes. Show recommendations and link to `https://sleeper.com/leagues/{league_id}/team`.
- Don't commit secrets. Sleeper league data is public, so committing IDs is fine.
