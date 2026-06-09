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
  isWallClockHourValid,
  isWallClockMinuteValid,
  isWallClockTimeComplete,
  normalizeWallClockParts,
  splitWallClockTime,
  formatWallClockPartTyping,
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
assert(normalizeWallClockTime("25:00") === null, "normalizeWallClockTime invalid hour");
assert(normalizeWallClockTime("12:60") === null, "normalizeWallClockTime invalid minute");

assert(isWallClockHourValid("9"), "hour valid partial");
assert(isWallClockHourValid("23"), "hour valid max");
assert(!isWallClockHourValid("24"), "hour invalid 24");
assert(isWallClockMinuteValid("5"), "minute valid partial");
assert(isWallClockMinuteValid("59"), "minute valid max");
assert(!isWallClockMinuteValid("60"), "minute invalid 60");

assert(formatWallClockPartTyping("9a5") === "95", "formatWallClockPartTyping strips non-digits");
assert(splitWallClockTime("09:30").hour === "09", "splitWallClockTime hour");
assert(splitWallClockTime("09:30").minute === "30", "splitWallClockTime minute");
assert(isWallClockTimeComplete("10", "20"), "isWallClockTimeComplete full");
assert(isWallClockTimeComplete("10", "2"), "isWallClockTimeComplete padded minute");
assert(!isWallClockTimeComplete("10", ""), "isWallClockTimeComplete missing minute");
assert(normalizeWallClockParts("5", "5") === "05:05", "normalizeWallClockParts 05:05");
assert(normalizeWallClockParts("0", "55") === "00:55", "normalizeWallClockParts 00:55");

console.log("datetime.spec.mjs: OK");
