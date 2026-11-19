import { readFile } from "node:fs/promises";
const F = new URL("./fixtures/week11/", import.meta.url);
export async function loadFixture() {
  const R = async (f) => JSON.parse(await readFile(new URL(f, F), "utf8"));
  return {
    pdata: await R("players.json"), latest: await R("latest.json"), league: await R("league.json"),
    users: await R("users.json"), rosters: await R("rosters.json"), matchups: await R("matchups.json"),
    transactions: await R("transactions.json"), userId: "737509404907298816",
    now: Date.parse("2026-11-19T10:30:00Z"),
  };
}
