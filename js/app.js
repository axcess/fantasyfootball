// Browser entry point. All API-derived strings go through textContent (never innerHTML).
import { DEFAULT_SETTINGS, DEFAULT_WEIGHTS, FACTORS, STADIUMS } from "./constants.js";
import { analyze, prepareGames } from "./analyze.js";
import { gameStarted } from "./engine.js";

const API = "https://api.sleeper.app";
const $ = (id) => document.getElementById(id);
const el = (t, cls, txt) => { const e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const store = {
  get(k, fb) { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch { return fb; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const TZ = "America/Chicago";
const fmtTime = (iso) => iso ? new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ }) + " CT" : "unknown";
const ago = (iso) => {
  if (!iso) return "";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

const S = {
  settings: { ...DEFAULT_SETTINGS, ...store.get("ff.settings", {}) },
  W: (() => { const w = store.get("ffw", null); return Array.isArray(w) && w.length === 5 ? w : DEFAULT_WEIGHTS.slice(); })(),
  loadedAt: null,
};

async function getJSON(url, opts = {}) {
  const r = await fetch(url, { cache: opts.cache || "default" });
  if (!r.ok) throw new Error(`${r.status} ${url.replace(API, "Sleeper")}`);
  return r.json();
}

// ---------- weather fallback from the browser ----------
async function browserWeather(games) {
  const cacheKey = "ff.wx";
  const cache = (() => { try { return JSON.parse(sessionStorage.getItem(cacheKey) || "{}"); } catch { return {}; } })();
  const out = {};
  const need = games.filter((g) => !g.dome && !g.wx && STADIUMS[g.home] && (Date.parse(g.date) - Date.now()) / 86400000 < 15);
  await Promise.all(need.map(async (g) => {
    if (cache[g.id]) { out[g.id] = cache[g.id]; return; }
    const [lat, lon] = STADIUMS[g.home];
    try {
      const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&start_date=${g.date}&end_date=${g.date}`);
      const d = j.daily;
      if (d?.time?.length) out[g.id] = { hi: d.temperature_2m_max[0], lo: d.temperature_2m_min[0], pop: d.precipitation_probability_max[0], precip: d.precipitation_sum[0], wind: d.wind_speed_10m_max[0], asOf: new Date().toISOString() };
    } catch { /* leave it blank */ }
  }));
  try { sessionStorage.setItem(cacheKey, JSON.stringify({ ...cache, ...out })); } catch { /* ignore */ }
  return out;
}

// ---------- load ----------
async function load() {
  const { leagueId } = S.settings;
  const [pdata, latest, state, league, users, rosters] = await Promise.all([
    getJSON("data/players.json", { cache: "no-cache" }),
    getJSON("data/latest.json", { cache: "no-cache" }),
    getJSON(`${API}/v1/state/nfl`),
    getJSON(`${API}/v1/league/${encodeURIComponent(leagueId)}`),
    getJSON(`${API}/v1/league/${encodeURIComponent(leagueId)}/users`),
    getJSON(`${API}/v1/league/${encodeURIComponent(leagueId)}/rosters`),
  ]);
  if (!league) throw new Error("League not found. Check the league ID in Settings.");
  const week = latest.week;
  const [matchups, tx1, tx0, schedule, trending] = await Promise.all([
    getJSON(`${API}/v1/league/${leagueId}/matchups/${week}`).catch(() => []),
    getJSON(`${API}/v1/league/${leagueId}/transactions/${week}`).catch(() => []),
    week > 1 ? getJSON(`${API}/v1/league/${leagueId}/transactions/${week - 1}`).catch(() => []) : [],
    getJSON(`${API}/schedule/nfl/regular/${latest.season}`).catch(() => null),
    getJSON(`${API}/v1/players/nfl/trending/add?lookback_hours=48&limit=60`).catch(() => []),
  ]);
  S.data = {
    pdata, latest, state, league, users, rosters, matchups: matchups || [], transactions: [...(tx1 || []), ...(tx0 || [])],
    liveSchedule: schedule ? schedule.filter((g) => g.week === week) : null,
    trending: new Map((trending || []).map((t) => [t.player_id, t.count])),
  };
  S.loadedAt = new Date().toISOString();
  S.browserWx = {};
  recomputeGames();
  run();
  // fill missing forecasts in the background, then re-render
  browserWeather(S.games).then((wx) => { if (Object.keys(wx).length) { S.browserWx = wx; recomputeGames(); run(); } });
}

const overridesKey = () => `ff.lines.${S.data.latest.season}.${S.data.latest.week}`;
function recomputeGames() {
  const d = S.data;
  S.games = prepareGames(d.latest, { oddsOverrides: store.get(overridesKey(), {}), browserWx: S.browserWx, liveSchedule: d.liveSchedule });
  S.model = null;
}

function run() {
  const d = S.data;
  const res = analyze({
    pdata: d.pdata, latest: d.latest, league: d.league, users: d.users, rosters: d.rosters, matchups: d.matchups,
    transactions: d.transactions, userId: S.settings.userId, weights: S.W, games: S.games, model: S.model,
  });
  S.model = res.model;
  S.res = res;
  render(res);
}

// ---------- render helpers ----------
const scoreColor = (s) => s >= 75 ? "var(--s1)" : s >= 60 ? "var(--s2)" : s >= 45 ? "var(--s3)" : "var(--s4)";
function scoreCell(s) {
  const d = el("div", "sc"); const b = el("div", "bar"); const i = el("i");
  i.style.width = `${s}%`; i.style.background = scoreColor(s); b.append(i);
  d.append(el("span", "num", String(s)), b); d.title = `Score ${s} of 100`;
  return d;
}
const vsText = (r) => r.bye ? "BYE" : r.opp ? `${r.home ? "vs" : "@"} ${r.opp}` : "no team";
const projText = (r) => r.proj != null && !r.bye ? ` · proj ${r.proj.toFixed(1)}` : "";
function injuryChip(r) {
  const st = r.injury?.status;
  if (!st) return null;
  const cls = ["Out", "IR", "Doubtful", "PUP", "Sus"].includes(st) ? "tag forced" : "tag q";
  return el("span", cls, st === "Questionable" ? "Q" : st);
}
function playerRow({ slot, r, tagCls, tagTxt, extra }) {
  const row = el("div", slot != null ? "pr" : "pr noslot");
  if (slot != null) row.append(el("div", "slot", slot));
  const main = el("div", "main");
  const nm = el("div", "nm", r.n);
  nm.append(el("span", "meta", ` ${r.pos} · ${r.tm || "FA"} ${vsText(r)}${projText(r)}`));
  const chip = injuryChip(r); if (chip) nm.append(chip);
  if (r.change) nm.append(el("span", "chg", "← lineup change"));
  main.append(nm, el("div", "why", r.why));
  const prac = r.injury?.days && Object.entries(r.injury.days).map(([k, v]) => `${k}: ${v}`).join(", ");
  if (prac) main.append(el("div", "meta", `Practice: ${prac}${r.injury.injury ? ` (${r.injury.injury})` : ""}`));
  if (extra) main.append(extra);
  const right = el("div", "right");
  right.append(el("span", tagCls, tagTxt), scoreCell(r.s));
  row.append(main, right);
  return row;
}
function banner(kind, text) { const b = el("div", `banner ${kind}`, text); $("banners").append(b); }

// ---------- render ----------
function render(res) {
  const d = S.data;
  $("banners").replaceChildren();
  if (res.error) { banner("bad", res.error); showTab("settings"); fillSettings(); return; }
  const { latest, league } = d;
  const lw = Number(d.state.week), ls = Number(d.state.season);
  if (d.state.season_type === "regular" && (ls !== latest.season || lw !== latest.week))
    banner("warn", `Sleeper is on week ${lw}, but the saved data is for week ${latest.week}. Run the "Refresh data" workflow to catch up.`);
  const age = (Date.now() - Date.parse(latest.generatedAt)) / 3600000;
  if (age > 72) banner("warn", `Data was last refreshed ${ago(latest.generatedAt)}. Scores may be stale.`);
  if (league.season && Number(league.season) !== latest.season) banner("warn", `This league is for the ${league.season} season; the data is for ${latest.season}.`);

  const me = res.me;
  document.title = `${me.name} · Week ${latest.week}`;
  $("title").textContent = `${me.name} · Week ${latest.week}`;
  const rec = `${me.wins ?? 0}–${me.losses ?? 0}${me.ties ? `–${me.ties}` : ""}`;
  const type = league.settings?.type === 2 ? "dynasty" : league.settings?.type === 1 ? "keeper" : "redraft";
  const ppr = league.scoring_settings?.rec === 1 ? "PPR" : league.scoring_settings?.rec === 0.5 ? "half-PPR" : "standard";
  $("subtitle").textContent = `${league.name} · ${league.total_rosters}-team ${type} ${ppr} · ${rec}${me.waiverPos ? ` · waiver priority #${me.waiverPos}` : ""} · data ${fmtTime(latest.generatedAt)}`;
  if (res.opp) {
    $("mu").classList.remove("hide");
    $("mu-me-t").textContent = "You (Sleeper proj.)"; $("mu-me").textContent = me.sleeperProj.toFixed(1);
    $("mu-opp-t").textContent = res.opp.name; $("mu-opp").textContent = res.opp.sleeperProj.toFixed(1);
  }

  // lineup
  $("lu-note").textContent = res.changes ? `${res.changes} change(s) from your Sleeper lineup` : "matches your current Sleeper lineup";
  $("lu-asof").textContent = `Rosters live from Sleeper (${fmtTime(S.loadedAt)}) · stats & projections ${fmtTime(d.pdata.asOf)} · injury report ${fmtTime(latest.sources?.injuries?.asOf)}`;
  const LU = $("lu"); LU.replaceChildren();
  for (const { slot, rec: r } of res.lineup) {
    if (!r) { const row = el("div", "pr"); row.append(el("div", "slot", slot), el("div", "why", "No eligible player. Check waivers."), el("div")); LU.append(row); continue; }
    LU.append(playerRow({ slot, r, tagCls: "tag start", tagTxt: "START" }));
  }
  if (me.recProj !== me.sleeperProj) LU.append(el("div", "note", `Recommended lineup projects ${me.recProj.toFixed(1)} (Sleeper) vs ${me.sleeperProj.toFixed(1)} for your current one.`));
  $("sleeper-link").href = `https://sleeper.com/leagues/${encodeURIComponent(S.settings.leagueId)}/team`;
  const BN = $("bn"); BN.replaceChildren();
  for (const r of res.bench) {
    const t = r.reserve ? (r.injury?.status || "IR") : r.bye ? "BYE" : r.forced ? (r.injury?.status || "OUT") : "SIT";
    const extra = r.wasStarter && !r.forced ? el("div", "chg", "Currently in your Sleeper lineup") : r.wasStarter ? el("div", "chg", "In your Sleeper lineup, but can't play: swap him out") : null;
    BN.append(playerRow({ r, tagCls: r.forced ? "tag forced" : "tag sit", tagTxt: t, extra }));
  }
  const OP = $("opp"); OP.replaceChildren();
  if (res.opp) {
    $("opp-h").textContent = `Opponent: ${res.opp.name} (${res.opp.wins ?? 0}–${res.opp.losses ?? 0})`;
    for (const { slot, rec: r } of res.opp.lineup) {
      if (!r) { const row = el("div", "pr"); row.append(el("div", "slot", slot || ""), el("div", "why", "Empty slot"), el("div")); OP.append(row); continue; }
      OP.append(playerRow({ slot, r, tagCls: "tag sit", tagTxt: r.proj != null ? r.proj.toFixed(1) : "–" }));
    }
  } else { $("opp-h").textContent = "Opponent"; OP.append(el("div", "note", "No matchup found for this week.")); }

  // waivers
  $("wv-asof").textContent = `Transactions live (${fmtTime(S.loadedAt)}) · stats ${fmtTime(d.pdata.asOf)}`;
  const n = res.adds.length;
  $("wv-note").textContent = `${n < 5 ? `Only ${n} player${n === 1 ? "" : "s"} cleared the bar this week` : "Top 5 adds"} (a value gain of at least 8 over the player you'd drop, or 5 for K/DEF). Value = 60% rest-of-season score + 40% this week's score. ${res.faConsidered} free agents checked.`;
  const WV = $("wv"); WV.replaceChildren();
  const LBL = { claim: ["tag claim", "Claim now"], free: ["tag free", "Free agent"], hold: ["tag hold", "Hold priority"], locked: ["tag forced", "Locked"] };
  res.adds.forEach((a, i) => {
    const r = { ...a.rec, s: a.score };
    const drop = el("div", "drop");
    drop.append(document.createTextNode("Drop "), el("b", null, a.drop.n), document.createTextNode(` (value ${Math.round(a.dropVal)}) → +${Math.round(a.gain)} gain · value ${Math.round(a.val)}`));
    const tr = d.trending.get(a.rec.id);
    if (tr) drop.append(el("span", "meta", ` · ${tr.toLocaleString()} Sleeper adds in 48h`));
    if (a.onWaivers && a.label !== "locked") drop.append(el("span", "meta", " · on waivers"));
    const [cls, txt] = LBL[a.label];
    WV.append(playerRow({ slot: `#${i + 1}`, r, tagCls: cls, tagTxt: txt, extra: drop }));
  });
  if (!n) WV.append(el("div", "note", "Nobody available beats your bench by enough this week."));

  // risks
  $("rk-asof").textContent = `Injury report ${fmtTime(latest.sources?.injuries?.asOf)}${latest.sources?.injuries?.day ? ` (${latest.sources.injuries.day} practice)` : ""} · forecast ${fmtTime(latest.sources?.weather?.asOf)}`;
  const RK = $("rk"); RK.replaceChildren();
  for (const k of res.risks) {
    const row = el("div", "risk");
    row.append(el("span", `tag lvl-${k.lvl}`, k.lvl === "h" ? "High" : k.lvl === "m" ? "Watch" : "Low"));
    const t = el("div"); t.append(el("div", "nm", k.n), el("div", "why", k.items.join(" "))); row.append(t);
    RK.append(row);
  }
  if (!res.risks.length) RK.append(el("div", "note", "Nothing flagged."));
  const DC = $("depth"); DC.replaceChildren();
  $("depth-card").classList.toggle("hide", !res.myDepth.length && latest.sources?.depth?.baselineWeek == null);
  if (latest.sources?.depth?.baselineWeek == null) DC.append(el("div", "note", "No earlier snapshot yet. Changes will show from next week."));
  for (const c of res.myDepth) DC.append(el("div", "why", `${c.n} (${c.tm}): ${c.pos}${c.from} → ${c.pos}${c.to}`));
  if (latest.sources?.depth?.baselineWeek != null && !res.myDepth.length) DC.append(el("div", "note", `No changes on your roster since week ${latest.sources.depth.baselineWeek}.`));

  renderGames(res);
  renderPlan(res);
  renderSources();
}

function renderGames(res) {
  const d = S.data, latest = d.latest, src = latest.sources || {};
  const editing = S.editLines;
  const o = src.odds || {};
  const oddsTxt = o.status === "ok" ? `Lines: ${o.provider}, ${fmtTime(o.asOf)}` : o.status === "seed" ? `Lines: ${o.provider} (${fmtTime(o.asOf)})` : `Lines: ${o.status === "missing" ? "no odds key set" : "odds fetch failed"}${o.asOf ? `, last saved ${fmtTime(o.asOf)}` : ""}`;
  $("gm-asof").textContent = `${oddsTxt} · forecast ${src.weather?.provider || "Open-Meteo"} ${fmtTime(src.weather?.asOf)}`;
  const mine = new Set([...res.lineup.map((l) => l.rec?.tm), ...res.bench.map((b) => b.tm)].filter(Boolean));
  const G = $("gm"); G.replaceChildren();
  const h = el("tr"); ["Day", "Matchup · forecast", "Spread", "Total", "Away TT", "Home TT"].forEach((x) => h.append(el("th", null, x))); G.append(h);
  const ov = store.get(overridesKey(), {});
  for (const g of S.games) {
    const r = el("tr"); if (mine.has(g.home) || mine.has(g.away)) r.className = "mine";
    const mc = el("td"); mc.append(el("div", "nm nw", `${g.away} @ ${g.home}`));
    const started = gameStarted(g) ? (g.status === "complete" ? " · final" : " · in progress") : "";
    const wx = g.dome ? "Dome" : g.wx ? `${Math.round(g.wx.hi)}°F · ${Math.round(g.wx.wind)} mph · ${g.wx.pop ?? 0}% rain${g.wx.precip ? ` (${g.wx.precip.toFixed(2)} in)` : ""}${g.wxSource === "browser" ? " †" : ""}` : "no forecast yet";
    mc.append(el("div", "meta", wx + started));
    r.append(el("td", "n", g.day || g.date), mc);
    if (editing) {
      const sp = el("input"); sp.type = "text"; sp.inputMode = "decimal"; sp.value = ov[g.id]?.spread ?? g.spread ?? ""; sp.dataset.g = g.id; sp.dataset.k = "spread"; sp.placeholder = "home";
      const to = el("input"); to.type = "text"; to.inputMode = "decimal"; to.value = ov[g.id]?.total ?? g.total ?? ""; to.dataset.g = g.id; to.dataset.k = "total";
      const a = el("td"); a.append(sp); const b = el("td"); b.append(to); r.append(a, b);
    } else {
      const spTxt = g.spread == null ? "–" : g.spread === 0 ? "PK" : `${g.spread < 0 ? g.home : g.away} −${Math.abs(g.spread)}`;
      r.append(el("td", "n", spTxt + (g.manual ? "*" : "")), el("td", "n", g.total ?? "–"));
    }
    r.append(el("td", "n", g.awayTT ?? "–"), el("td", "n", g.homeTT ?? "–"));
    G.append(r);
  }
  $("lines-btns").classList.toggle("hide", !editing);
  $("edit-lines").textContent = editing ? "Cancel" : "Edit lines";
  const anyManual = S.games.some((g) => g.manual), anyBrowser = S.games.some((g) => g.wxSource === "browser");
  $("gm-note").textContent = `Implied team total = total ÷ 2 ∓ home spread ÷ 2. Highlighted rows involve your players. Byes this week: ${latest.byes?.join(", ") || "none"}.${anyManual ? " * manual line." : ""}${anyBrowser ? " † forecast fetched by your browser." : ""} Wind and rain penalties apply outdoors only.`;
}

function chicagoDay() { return new Date().toLocaleDateString("en-US", { weekday: "short", timeZone: TZ }); }
function renderPlan(res) {
  const day = chicagoDay();
  const starters = res.lineup.map((l) => l.rec).filter(Boolean);
  const roster = [...starters, ...res.bench];
  const firstDate = S.games[0]?.date;
  const thu = S.games.filter((g) => g.day === "Thu");
  const thuTeams = new Set(thu.flatMap((g) => [g.home, g.away]));
  const thuMine = roster.filter((r) => thuTeams.has(r.tm) && !r.reserve);
  const thuStart = thuMine.filter((r) => starters.includes(r));
  const mon = S.games.filter((g) => g.day === "Mon");
  const monTeams = new Set(mon.flatMap((g) => [g.home, g.away]));
  const monMine = roster.filter((r) => monTeams.has(r.tm) && !r.reserve);
  const steps = [
    { days: ["Tue", "Wed"], t: "Tue / Wed · waiver run", n: `Check the Waivers tab: ${res.adds.length} suggested add${res.adds.length === 1 ? "" : "s"}, each with a drop and a label.` },
    { days: ["Thu"], t: "Thu afternoon · TNF check", n: thu.length ? `${thu.map((g) => `${g.away} @ ${g.home}`).join(", ")}. ${thuStart.length ? `Starting: ${thuStart.map((r) => r.n).join(", ")}. Set them before kickoff.` : "None of your starters play."}${thuMine.length && !thuStart.length ? ` On your bench: ${thuMine.map((r) => r.n).join(", ")}.` : ""}` : "No Thursday game this week." },
    { days: ["Fri", "Sat", "Sun"], t: "Sun morning · final lineup", n: "Data refreshes Friday after game designations and twice Sunday morning (around 8:40 and 10:45 CT, after inactives). Re-check the Risk list." },
    { days: ["Mon"], t: "Mon · Monday-night check", n: mon.length ? `${mon.map((g) => `${g.away} @ ${g.home}`).join(", ")}${monMine.length ? `: ${monMine.length} of your players (${monMine.map((r) => r.n).join(", ")}).` : "."}` : "No Monday game this week." },
  ];
  const SC = $("sched"); SC.replaceChildren();
  for (const s of steps) {
    const box = el("div", s.days.includes(day) ? "now" : null);
    box.append(el("div", "d", s.t + (s.days.includes(day) ? " · today" : "")), el("div", "note", s.n));
    SC.append(box);
  }
  void firstDate;
}

function renderSources() {
  const src = S.data.latest.sources || {};
  const SR = $("src"); SR.replaceChildren();
  const rows = [
    ["Sleeper (live)", "ok", `Loaded ${fmtTime(S.loadedAt)}`],
    ["Players & stats", src.players?.status || "ok", `${fmtTime(S.data.pdata.asOf)} · ${ago(S.data.pdata.asOf)}`],
    ["Odds", src.odds?.status, src.odds?.status === "ok" ? `Key configured · ${fmtTime(src.odds.asOf)}${src.odds.remaining != null ? ` · ${src.odds.remaining} requests left this month` : ""}`
      : src.odds?.status === "missing" ? "No ODDS_API_KEY secret. Lines are from the last save or your manual entries."
        : src.odds?.status === "seed" ? `Seeded lines (${src.odds.provider}). Add an ODDS_API_KEY secret for automatic updates.`
          : `Key configured, but the last fetch failed${src.odds?.error ? `: ${src.odds.error}` : ""}`],
    ["Weather", src.weather?.status, `${fmtTime(src.weather?.asOf)}${src.weather?.note ? ` · ${src.weather.note}` : ""}`],
    ["Injury report", src.injuries?.status, `${fmtTime(src.injuries?.asOf)}${src.injuries?.rows != null ? ` · ${src.injuries.rows} players` : ""}${src.injuries?.error ? ` · ${src.injuries.error}` : ""}`],
    ["Depth charts", src.depth?.status, src.depth?.baselineWeek != null ? `Compared with week ${src.depth.baselineWeek} · ${src.depth.changes} changes league-wide` : "First snapshot saved; changes show from next week"],
  ];
  for (const [k, st, txt] of rows) {
    const r = el("div", "src");
    const cls = st === "ok" ? "ok" : st === "error" ? "err" : "wrn";
    const a = el("div"); a.append(el("span", cls, "● "), document.createTextNode(k));
    r.append(a, el("div", "meta", txt || "–"));
    SR.append(r);
  }
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  const repo = location.pathname.split("/").filter(Boolean)[0];
  const link = $("actions-link");
  if (m && repo) link.href = `https://github.com/${m[1]}/${repo}/actions/workflows/refresh.yml`;
  else link.classList.add("hide");
}

// ---------- settings ----------
function fillSettings() {
  $("set-league").value = S.settings.leagueId;
  const sel = $("set-user"); sel.replaceChildren();
  const users = S.data?.users || [];
  const rosters = S.data?.rosters || [];
  for (const r of rosters) {
    const u = users.find((x) => x.user_id === r.owner_id);
    const o = el("option", null, `${u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`}${u ? ` (${u.display_name})` : ""}`);
    o.value = r.owner_id || ""; if (r.owner_id === S.settings.userId) o.selected = true;
    sel.append(o);
  }
  if (!rosters.length) { const o = el("option", null, S.settings.userId); o.value = S.settings.userId; sel.append(o); }
}
async function saveSettings() {
  const leagueId = $("set-league").value.trim();
  let userId = $("set-user").value;
  const uname = $("set-username").value.trim();
  $("set-msg").textContent = "";
  if (!/^\d{6,25}$/.test(leagueId)) { $("set-msg").textContent = "League IDs are long numbers, from the league URL in Sleeper."; return; }
  if (uname) {
    try { const u = await getJSON(`${API}/v1/user/${encodeURIComponent(uname)}`); if (!u?.user_id) throw new Error(); userId = u.user_id; }
    catch { $("set-msg").textContent = "Couldn't find that Sleeper username."; return; }
  }
  if (leagueId !== S.settings.leagueId && !uname) {
    // new league: keep the user, they'll pick a team after reload
  }
  S.settings = { leagueId, userId };
  store.set("ff.settings", S.settings);
  location.reload();
}

// ---------- weights ----------
function buildWeights() {
  const WT = $("wts"); WT.replaceChildren();
  FACTORS.forEach((n, i) => {
    const row = el("div", "w"); const lab = el("label", null, n);
    const inp = el("input"); inp.type = "range"; inp.min = 0; inp.max = 50; inp.value = S.W[i]; inp.id = `w${i}`; lab.htmlFor = inp.id;
    const b = el("b", null, `${S.W[i]}%`);
    inp.addEventListener("input", () => { S.W[i] = +inp.value; b.textContent = `${S.W[i]}%`; store.set("ffw", S.W); if (S.data) run(); });
    row.append(lab, inp, b); WT.append(row);
  });
}

function showTab(t) {
  document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x.dataset.t === t));
  document.querySelectorAll("section").forEach((s) => s.classList.toggle("hide", s.id !== t));
  try { sessionStorage.setItem("ff.tab", t); } catch { /* ignore */ }
}

function wire() {
  document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => { showTab(b.dataset.t); if (b.dataset.t === "settings") fillSettings(); }));
  $("reset").addEventListener("click", () => { S.W = DEFAULT_WEIGHTS.slice(); store.del("ffw"); buildWeights(); if (S.data) run(); });
  $("save-settings").addEventListener("click", saveSettings);
  $("reset-settings").addEventListener("click", () => { store.del("ff.settings"); location.reload(); });
  $("edit-lines").addEventListener("click", () => { S.editLines = !S.editLines; renderGames(S.res); });
  $("save-lines").addEventListener("click", () => {
    const ov = {};
    document.querySelectorAll("#gm input").forEach((i) => {
      const g = i.dataset.g; const v = i.value.trim().replace("−", "-");
      (ov[g] ||= {})[i.dataset.k] = v === "" ? null : Number(v);
    });
    // keep only rows that differ from the Action's lines
    for (const g of S.data.latest.games) {
      const o = ov[g.id];
      if (!o || o.spread == null || o.total == null || Number.isNaN(o.spread) || Number.isNaN(o.total) || (o.spread === g.spread && o.total === g.total)) delete ov[g.id];
    }
    store.set(overridesKey(), ov);
    S.editLines = false; recomputeGames(); run();
  });
  $("clear-lines").addEventListener("click", () => { store.del(overridesKey()); S.editLines = false; recomputeGames(); run(); });
  let tab = "lineup"; try { tab = sessionStorage.getItem("ff.tab") || "lineup"; } catch { /* ignore */ }
  showTab(tab);
}

wire();
buildWeights();
load().catch((e) => {
  console.error(e);
  $("subtitle").textContent = "Couldn't load data.";
  banner("bad", `${e.message}. Check your connection and the league ID in Settings.`);
  fillSettings();
});
