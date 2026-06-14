import axios from "axios";
import { useLabConfigStore } from "@/stores/labConfig";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:7372";

/** Clock offset in milliseconds (server - local). */
let offsetMs = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Fetches server UTC time and calculates clock offset.
 * Called automatically on init and every 5 minutes.
 */
async function sync(): Promise<void> {
  try {
    const before = Date.now();
    const { data } = await axios.get<{
      utc: string;
      unixMs: number;
      localDate?: string;
    }>(`${API_BASE}/api/time`, { timeout: 5000 });
    const after = Date.now();
    const rtt = after - before;
    const localMid = before + rtt / 2;
    offsetMs = data.unixMs - localMid;
    if (data.localDate) {
      useLabConfigStore().config.now.localDate = data.localDate;
    }
  } catch {
    // keep previous offset if sync fails
  }
}

/** Returns current UTC timestamp (ms) adjusted by server offset. */
export function serverNowMs(): number {
  return Date.now() + offsetMs;
}

/** Starts periodic sync. Safe to call multiple times. */
export function startTimeSync(): void {
  if (intervalId) return;
  sync();
  intervalId = setInterval(sync, 5 * 60_000);
}
