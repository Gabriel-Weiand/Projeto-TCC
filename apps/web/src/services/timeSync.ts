import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3333";

/** Clock offset in milliseconds (server - local). */
let offsetMs = 0;
let synced = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Fetches server UTC time and calculates clock offset.
 * Called automatically on init and every 5 minutes.
 */
async function sync(): Promise<void> {
  try {
    const before = Date.now();
    const { data } = await axios.get<{ utc: string; unixMs: number }>(
      `${API_BASE}/api/time`,
      { timeout: 5000 },
    );
    const after = Date.now();
    const rtt = after - before;
    const localMid = before + rtt / 2;
    offsetMs = data.unixMs - localMid;
    synced = true;
  } catch {
    // keep previous offset if sync fails
  }
}

/** Returns current UTC timestamp (ms) adjusted by server offset. */
export function serverNowMs(): number {
  return Date.now() + offsetMs;
}

/** Returns current UTC as ISO string adjusted by server offset. */
export function serverNowISO(): string {
  return new Date(serverNowMs()).toISOString();
}

/** Whether at least one successful sync has occurred. */
export function isSynced(): boolean {
  return synced;
}

/** Returns the current offset in ms (server - local). */
export function getOffsetMs(): number {
  return offsetMs;
}

/** Starts periodic sync. Safe to call multiple times. */
export function startTimeSync(): void {
  if (intervalId) return;
  sync();
  intervalId = setInterval(sync, 5 * 60_000);
}

/** Stops periodic sync. */
export function stopTimeSync(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
