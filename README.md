# Fantasy Command Center

A weekly fantasy football assistant for a Sleeper league, hosted as a static site on GitHub Pages.
It recommends a start/sit call for every lineup slot, ranks waiver adds with suggested drops, and
lists risks to watch before kickoff. Built for Team Esau in Tod's BBQ (12-team keeper, full PPR),
but any Sleeper league works: change the league and team in **Settings**.

Read-only: it never changes your Sleeper lineup and has no betting features.

## Setup (one time, about 10 minutes)

1. **Get a free odds key (optional but recommended).** Sign up at <https://the-odds-api.com> (free tier: 500 requests/month; this site uses about 60).
   Without a key the site uses the last saved lines, and you can type lines in on the *Games & weather* tab.
2. **Add the key as a repo secret.** GitHub → this repo → *Settings* → *Secrets and variables* → *Actions* → *New repository secret*.
   Name: `ODDS_API` (or `ODDS_API_KEY`), value: your key. The key stays in GitHub Actions and is never sent to the browser.
3. **Merge to the default branch.** Scheduled workflows only run on the default branch (`main`).
4. **Enable Pages.** *Settings* → *Pages* → *Build and deployment* → Source: **Deploy from a branch**, Branch: `main`, folder `/ (root)`.
   The site appears at `https://<owner>.github.io/<repo>/` within a minute or two.
5. **Run the workflow once.** *Actions* → *Refresh data* → *Run workflow*. It refreshes `data/` and commits it.
   You can do this from the GitHub mobile app too, or from the link in the site's Settings tab.

Open the site on your phone and add it to your home screen.

## How it works

```
index.html, css/, js/          static site (vanilla JS modules, no build step)
js/engine.js                   scoring engine (pure functions, shared with the tests)
js/analyze.js                  turns data + Sleeper league responses into lineup / waivers / risks
js/app.js                      UI
data/players.json              written by the Action: trimmed player map, game logs, projections
data/latest.json               written by the Action: games, odds, weather, injury report, depth changes
data/depth-history.json        written by the Action: one depth-chart snapshot per week
scripts/fetch.mjs              the Action's fetch script (Node 22, no dependencies)
.github/workflows/refresh.yml  schedule + manual trigger
test/                          unit tests and the saved Week 11 fixture
```

**In the browser, live from Sleeper:** NFL state, league settings, users, rosters, this week's matchups,
transactions (this week and last), schedule status (for games that have kicked off) and trending adds.
So your roster is always current.

**From the Action, on a schedule:** Sleeper's player map (15 MB, trimmed to about 320 KB), game logs for
weeks 1 to the previous week, this week's projections, The Odds API lines, Open-Meteo forecasts, the
NFL.com official injury report (with practice status by day), and a depth-chart snapshot.

If the Action couldn't get a forecast, the browser fetches it from Open-Meteo directly (marked †).

Every section shows when its data was pulled. The Settings tab lists each source's status, and shows whether the
odds key is set (never the key itself).

### Refresh schedule (America/Chicago)

| When | Why |
|---|---|
| Tue & Wed ~2:15 pm | Waiver run (Wednesday also catches the first practice report) |
| Thu ~2:45 pm | Thursday night game check |
| Fri ~4:15 pm | Game designations (Out/Doubtful/Questionable) are out |
| Sun ~8:40 am and ~10:45 am | Morning news, then inactives for noon games |
| Mon ~5:05 pm | Monday-night players |

Times are an hour later during daylight time (September to early November), since cron runs in UTC. GitHub sometimes starts scheduled runs late.
Use *Run workflow* any time you want fresh data.

## Scoring model

Each player gets five factors, each a 0–100 percentile against a pool of starting-caliber players at the same
position (≥ 2 games, top N by season PPG: QB 36, RB 72, WR 96, TE 36, K 32, DEF 32).

| Factor | Default weight | Raw value |
|---|---|---|
| Opportunity | 30% | Last 3 games. QB: att + 2·rush + 3·RZ + 10·snap%. RB: car + 1.5·tgt + 3·RZ + 20·snap%. WR/TE: 1.5·tgt + car + 3·RZ + 20·snap%. K/DEF: Sleeper projection |
| Recent form | 25% | PPR points per game, last 3 games played |
| Matchup | 20% | PPR points the opponent allows per game to the position (percentile among teams playing this week) |
| Game environment | 15% | Implied team total (DEF: opponent's, inverted), minus weather |
| Season average | 10% | PPR points per game this season |

- Weather (outdoors only): wind ≥ 20 mph −25, ≥ 15 mph −12; rain ≥ 60% **and** ≥ 0.25 in −10; high < 30 °F −5. Kickers ×1.5. For a DEF, weather adds half the penalty.
- `score = Σ wᵢ·cᵢ / Σ wᵢ`. Weights are sliders on the *Model weights* tab, saved on your device.
- Out, Doubtful, IR, PUP, suspended, bye and IR-slot players go to the bench whatever their score.
- Lineup: sort available players by score and fill slots in order (QB, RB, RB, WR, WR, TE, FLEX, K, DEF).
- Waivers: value = 0.6·ROS + 0.4·this week (ROS uses only opportunity, form and season). An add needs a gain of ≥ 8 over the drop (≥ 5 for K/DEF).
  Labels: **Claim now** (on waivers, gain ≥ 15), **Hold priority** (on waivers, smaller gain), **Free agent**, **Locked** (his game has started).
  The list shows Claim now first, then Free agents, then Hold priority, each sorted by value.

These weights are a starting point, not a proven model. Projections are estimates, and late scratches still happen.

## Data source check (CORS), Nov 19 2026

Requests were sent with `Origin: https://axcess.github.io`. Every one is a simple GET, so browsers don't send a preflight.

| Endpoint | Status | `Access-Control-Allow-Origin` | Used from |
|---|---|---|---|
| `api.sleeper.app/v1/state/nfl` | 200 | `*` | browser + Action |
| `/v1/league/{id}`, `/users`, `/rosters` | 200 | `*` | browser |
| `/v1/league/{id}/matchups/{week}`, `/transactions/{week}` | 200 | `*` | browser |
| `/v1/players/nfl` (15 MB) | 200 | `*` | Action only (too big for a phone) |
| `/v1/players/nfl/trending/add` | 200 | `*` | browser |
| `api.sleeper.app/stats/nfl/{season}/{week}` (unofficial) | 200 | `*` | Action |
| `api.sleeper.app/projections/nfl/{season}/{week}` (unofficial) | 200 | `*` | Action |
| `api.sleeper.app/schedule/nfl/regular/{season}` (unofficial) | 200 | `*` | browser + Action |
| `api.open-meteo.com/v1/forecast` | 200 | `*` | Action, browser fallback |
| `www.nfl.com/injuries/league/{season}/REG{week}` | 200 | `*` (HTML) | Action (scraped; robots.txt allows `/injuries/`) |
| `api.the-odds-api.com/v4/...` | needs key | n/a | Action only (key is secret) |

Findings:
- `practice_participation` in Sleeper's player map was `null` for everyone, so practice status comes from NFL.com.
- Open-Meteo returns 429 when a shared IP has used its daily quota. The Action spaces out its requests, and the browser retries for any game that's still missing a forecast.

## Development

```bash
npm test
```

```bash
npm run serve
```

```bash
ODDS_API_KEY=... node scripts/fetch.mjs
```

The first command runs the unit tests (Week 11 acceptance check, scrapers, helpers). The second serves the site at http://localhost:8080.
The third runs the Action's fetch locally; add `--week N` to target a specific week.

The Week 11 fixture (`test/fixtures/week11/`) is real Sleeper data pulled Thursday Nov 19 2026, about 4:50 am CT, with the
prototype's Vegas lines and forecasts. `test/build-fixture.mjs` rebuilds it from raw API dumps.
The tests check that the engine reproduces the prototype's lineup, scores, bench and waiver adds.

## Guardrails

- No betting features or sportsbook accounts. Odds are read-only inputs.
- No automated lineup changes. The site links to your team in Sleeper.
- No secrets in the repo. League and user IDs are public Sleeper data, and the defaults live in `js/constants.js`.
