// Sleeper bulk data: trims the 15 MB player map and per-week stats into compact JSON.
import { POSITIONS } from "../../js/constants.js";
import { logFromStatsRow } from "../../js/engine.js";
import { getJSON } from "./http.mjs";

const API = "https://api.sleeper.app";
const POSQ = POSITIONS.map((p) => `position[]=${p}`).join("&");

export const fetchState = () => getJSON(`${API}/v1/state/nfl`);
export const fetchSchedule = (season) => getJSON(`${API}/schedule/nfl/regular/${season}`);
export const fetchPlayers = () => getJSON(`${API}/v1/players/nfl`, { timeout: 120000 });
export const fetchStats = (season, week) => getJSON(`${API}/stats/nfl/${season}/${week}?season_type=regular&${POSQ}`);
export const fetchProjections = (season, week) => getJSON(`${API}/projections/nfl/${season}/${week}?season_type=regular&${POSQ}`);

// statsByWeek: { [week]: rows[] } -> { id: [compact log rows] }
export function buildLogs(statsByWeek) {
  const logs = {};
  const meta = {};
  for (const [, rows] of Object.entries(statsByWeek)) {
    for (const row of rows || []) {
      const l = logFromStatsRow(row);
      if (!l) continue;
      (logs[row.player_id] ||= []).push(l);
      if (row.player) meta[row.player_id] = row.player;
    }
  }
  for (const id in logs) logs[id].sort((a, b) => a[0] - b[0]);
  return { logs, meta };
}

export function buildProj(rows) {
  const out = {};
  for (const r of rows || []) {
    const v = r.stats?.pts_ppr;
    if (v != null) out[r.player_id] = Math.round(v * 10) / 10;
  }
  return out;
}

// Keep fantasy positions only, and only players who are on a team, active, or have logs.
export function compactPlayers(raw, logs, statMeta = {}) {
  const out = {};
  for (const [id, p] of Object.entries(raw || {})) {
    const pos = p.position === "DEF" || id.match(/^[A-Z]{2,3}$/) ? "DEF" : p.position;
    if (!POSITIONS.includes(pos)) continue;
    if (!p.team && !p.active && !logs[id]) continue;
    const n = pos === "DEF" ? `${p.first_name || id} ${p.last_name || ""}`.trim() : (p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim());
    const e = { n, pos, tm: p.team || null };
    if (p.injury_status) e.inj = p.injury_status;
    if (p.injury_body_part) e.body = p.injury_body_part;
    if (p.injury_notes) e.notes = p.injury_notes;
    if (p.depth_chart_order != null) e.dc = p.depth_chart_order;
    if (p.depth_chart_position) e.dcPos = p.depth_chart_position;
    if (p.active === false) e.active = false;
    if (p.practice_participation) e.prac = p.practice_participation;
    out[id] = e;
  }
  // players seen in stats but missing from the map
  for (const id of Object.keys(logs)) {
    if (out[id] || !statMeta[id]) continue;
    const m = statMeta[id];
    const pos = m.position;
    if (!POSITIONS.includes(pos)) continue;
    out[id] = { n: `${m.first_name} ${m.last_name}`.trim(), pos, tm: m.team || null };
  }
  return out;
}

export function scheduleWeek(schedule, week) {
  return schedule.filter((g) => g.week === week);
}
