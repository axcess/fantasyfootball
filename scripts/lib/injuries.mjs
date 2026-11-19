// NFL.com official injury report (HTML). One fetch per run.
import { TEAM_BY_NAME } from "../../js/constants.js";
import { injuryKey } from "../../js/engine.js";

const ALIAS = { AZ: "ARI", LA: "LAR", WSH: "WAS", JAC: "JAX", LVR: "LV", KAN: "KC", GNB: "GB", NOR: "NO", NWE: "NE", SFO: "SF", TAM: "TB" };
export const normTeam = (t) => ALIAS[t] || t;

const decode = (s) => s.replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

export const PRACTICE = {
  "Did Not Participate In Practice": "DNP",
  "Limited Participation in Practice": "Limited",
  "Full Participation in Practice": "Full",
};
const normPractice = (s) => PRACTICE[s] || Object.entries(PRACTICE).find(([k]) => k.toLowerCase() === s.toLowerCase())?.[1] || (s || null);

export function parseInjuryReport(html) {
  const units = html.split('class="nfl-o-injury-report__unit"').slice(1);
  const rows = [];
  for (const u of units) {
    const abbrs = [...u.matchAll(/nfl-c-matchup-strip__team-abbreviation">\s*([A-Z]{2,3})\s*</g)].map((m) => normTeam(m[1]));
    const tables = [...u.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0]);
    const titles = [...u.matchAll(/d3-o-section-sub-title"><span>([^<]+)<\/span>/g)].map((m) => decode(m[1]));
    tables.forEach((t, i) => {
      // match the sub-title nickname ("Colts") to an abbreviation; fall back to order (away, home)
      let team = abbrs[i] || null;
      const nick = titles[i];
      if (nick) {
        const hit = abbrs.find((a) => Object.entries(TEAM_BY_NAME).some(([full, ab]) => ab === a && full.endsWith(nick)));
        if (hit) team = hit;
      }
      for (const tr of t.split("<tr>").slice(2)) {
        const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => decode(m[1]));
        if (tds.length < 5) continue;
        const [name, pos, injury, practice, game] = tds;
        rows.push({ n: name, tm: team, pos, injury: injury || null, practice: normPractice(practice) || null, game: game || null });
      }
    });
  }
  return rows;
}

// Practice day key for a report fetched at `date`. Teams post reports in the afternoon, so a
// report pulled before noon Central still shows the previous day's practice.
export function practiceDay(date = new Date()) {
  const shifted = new Date(date.getTime() - 12 * 3600000);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/Chicago" }).format(shifted);
}

// Merge this run's report into the week's log: key -> { game, injury, practice, days:{Wed:..., Thu:...} }
export function mergeReport(prev, rows, day) {
  const out = { ...(prev || {}) };
  for (const r of rows) {
    const k = injuryKey(r.n, r.tm);
    const e = { ...(out[k] || { days: {} }) };
    e.n = r.n; e.tm = r.tm; e.pos = r.pos; e.injury = r.injury; e.game = r.game; e.practice = r.practice;
    if (r.practice && ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].includes(day)) e.days = { ...e.days, [day]: r.practice };
    out[k] = e;
  }
  return out;
}
