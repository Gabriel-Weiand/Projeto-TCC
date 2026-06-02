import assert from "node:assert/strict";
import { displayNotificationMessage } from "./notificationMessage.ts";

assert.equal(
  displayNotificationMessage("[machine#1#] PC-LAB-01 sem heartbeat desde nunca."),
  "PC-LAB-01 sem heartbeat desde nunca.",
);
assert.equal(
  displayNotificationMessage("[alloc#42#] Sua reserva começa em breve."),
  "Sua reserva começa em breve.",
);

console.log("notificationMessage.spec.mjs: ok");
