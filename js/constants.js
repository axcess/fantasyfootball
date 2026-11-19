// Shared by the browser (js/app.js) and the GitHub Action (scripts/fetch.mjs).

export const DEFAULT_SETTINGS = {
  leagueId: "1316844568775266304",
  userId: "737509404907298816", // Sleeper user Esau07
};

export const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

// Comparison-pool size per position (top N by season PPG, >= 2 games).
export const POOL_SIZE = { QB: 36, RB: 72, WR: 96, TE: 36, K: 32, DEF: 32 };

export const FACTORS = ["Opportunity", "Recent form", "Matchup", "Game environment", "Season average"];
export const DEFAULT_WEIGHTS = [30, 25, 20, 15, 10];

// Statuses that force a player to the bench regardless of score.
export const FORCED_STATUSES = ["Out", "Doubtful", "IR", "PUP", "Sus", "NA", "DNR", "COV"];
// Statuses that exclude a free agent from waiver suggestions.
export const FA_EXCLUDED_STATUSES = ["IR", "Out", "PUP", "Sus", "NA", "DNR"];

export const FLEX_SLOTS = {
  FLEX: ["RB", "WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
};

// [lat, lon, dome]. Retractable roofs are treated as domes.
export const STADIUMS = {
  ARI: [33.53, -112.26, 1], ATL: [33.76, -84.40, 1], BAL: [39.28, -76.62], BUF: [42.77, -78.79],
  CAR: [35.23, -80.85], CHI: [41.86, -87.62], CIN: [39.10, -84.52], CLE: [41.51, -81.70],
  DAL: [32.75, -97.09, 1], DEN: [39.74, -105.02], DET: [42.34, -83.05, 1], GB: [44.50, -88.06],
  HOU: [29.68, -95.41, 1], IND: [39.76, -86.16, 1], JAX: [30.32, -81.64], KC: [39.05, -94.48],
  LV: [36.09, -115.18, 1], LAC: [33.95, -118.34, 1], LAR: [33.95, -118.34, 1], MIA: [25.96, -80.24],
  MIN: [44.97, -93.26, 1], NE: [42.09, -71.26], NO: [29.95, -90.08, 1], NYG: [40.81, -74.07],
  NYJ: [40.81, -74.07], PHI: [39.90, -75.17], PIT: [40.45, -80.02], SF: [37.40, -121.97],
  SEA: [47.60, -122.33], TB: [27.98, -82.50], TEN: [36.17, -86.77], WAS: [38.91, -76.86],
};

// Full names as The Odds API and NFL.com use them.
export const TEAM_NAMES = {
  ARI: "Arizona Cardinals", ATL: "Atlanta Falcons", BAL: "Baltimore Ravens", BUF: "Buffalo Bills",
  CAR: "Carolina Panthers", CHI: "Chicago Bears", CIN: "Cincinnati Bengals", CLE: "Cleveland Browns",
  DAL: "Dallas Cowboys", DEN: "Denver Broncos", DET: "Detroit Lions", GB: "Green Bay Packers",
  HOU: "Houston Texans", IND: "Indianapolis Colts", JAX: "Jacksonville Jaguars", KC: "Kansas City Chiefs",
  LV: "Las Vegas Raiders", LAC: "Los Angeles Chargers", LAR: "Los Angeles Rams", MIA: "Miami Dolphins",
  MIN: "Minnesota Vikings", NE: "New England Patriots", NO: "New Orleans Saints", NYG: "New York Giants",
  NYJ: "New York Jets", PHI: "Philadelphia Eagles", PIT: "Pittsburgh Steelers", SF: "San Francisco 49ers",
  SEA: "Seattle Seahawks", TB: "Tampa Bay Buccaneers", TEN: "Tennessee Titans", WAS: "Washington Commanders",
};
export const TEAM_BY_NAME = Object.fromEntries(Object.entries(TEAM_NAMES).map(([k, v]) => [v, k]));
