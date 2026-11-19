// Open-Meteo daily forecast at the home stadium (skips domes).
import { STADIUMS } from "../../js/constants.js";
import { getJSON } from "./http.mjs";

export function weatherUrl(lat, lon, date) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&start_date=${date}&end_date=${date}`;
}

export function parseWeather(j) {
  const d = j?.daily;
  if (!d || !d.time?.length) return null;
  return {
    hi: d.temperature_2m_max?.[0] ?? null, lo: d.temperature_2m_min?.[0] ?? null,
    pop: d.precipitation_probability_max?.[0] ?? null, precip: d.precipitation_sum?.[0] ?? null,
    wind: d.wind_speed_10m_max?.[0] ?? null,
  };
}

// Open-Meteo only forecasts ~16 days ahead.
export async function fetchGameWeather(game) {
  const s = STADIUMS[game.home];
  if (!s) return null;
  if (s[2]) return "dome";
  return parseWeather(await getJSON(weatherUrl(s[0], s[1], game.date)));
}
