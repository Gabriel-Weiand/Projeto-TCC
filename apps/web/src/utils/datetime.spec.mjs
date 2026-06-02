/**
 * Testes leves (Node) para conversão de horário do lab.
 * Rode: node apps/web/src/utils/datetime.spec.mjs
 */
import {
  wallClockToUtcIso,
  utcIsoToWallClockFields,
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

console.log("datetime.spec.mjs: OK");
