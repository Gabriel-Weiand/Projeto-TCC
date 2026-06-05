/**
 * Testes leves (Node) para conversão de horário do lab.
 * Rode: node apps/web/src/utils/datetime.spec.mjs
 */
import {
  wallClockToUtcIso,
  utcIsoToWallClockFields,
  isoDateToBr,
  brDateToIso,
  normalizeWallClockTime,
  formatWallClockTimeTyping,
} from "./datetime.ts";

const tz = "America/Sao_Paulo";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

const utc = wallClockToUtcIso("2026-06-02", "14:30", tz);
assert(utc === "2026-06-02T17:30:00.000Z", `wall→utc: got ${utc}`);

const back = utcIsoToWallClockFields(utc, tz);
assert(back.date === "2026-06-02" && back.time === "14:30", `roundtrip: ${JSON.stringify(back)}`);

const multiEnd = wallClockToUtcIso("2026-06-05", "10:00", tz);
assert(multiEnd > utc, "multi-day end after start");

assert(isoDateToBr("2026-06-02") === "02/06/2026", "isoDateToBr");
assert(brDateToIso("02/06/2026") === "2026-06-02", "brDateToIso");
assert(brDateToIso("31/02/2026") === null, "brDateToIso invalid");
assert(normalizeWallClockTime("9:05") === "09:05", "normalizeWallClockTime");
assert(normalizeWallClockTime("9:5") === "09:05", "normalizeWallClockTime single minute digit");
assert(normalizeWallClockTime("25:00") === null, "normalizeWallClockTime invalid");
assert(formatWallClockTimeTyping("905") === "09:05", "formatWallClockTimeTyping 905");
assert(formatWallClockTimeTyping("1405") === "14:05", "formatWallClockTimeTyping 1405");
assert(formatWallClockTimeTyping("9") === "9", "formatWallClockTimeTyping partial hour");

console.log("datetime.spec.mjs: OK");
