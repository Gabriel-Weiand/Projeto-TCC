import { defineStore } from "pinia";
import { ref, computed } from "vue";
import axios from "axios";
import api from "@/services/api";
import {
  DEFAULT_LAB_TELEMETRY_PRESETS,
  type LabTelemetryPresets,
} from "@/utils/telemetryPresets";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3333";

export interface LabPublicConfig {
  timezone: string;
  now: {
    utc: string;
    unixMs: number;
    localIso: string;
    localDate: string;
  };
  calendar: {
    pastDays: number;
    futureDaysOptions: number[];
    defaultFutureDays: number;
  };
  allocation: {
    maxFutureDays: number;
    minDurationMinutes: number;
    scheduleStartHour: number;
    scheduleEndHour: number;
    /** true = calendário mostra nome de quem reservou; false = só admin */
    publicNames: boolean;
  };
  auth: {
    tokenExpiresIn: string;
  };
  telemetry?: {
    defaultOfflinePreset: "eco";
    presets: LabTelemetryPresets;
  };
}

const DEFAULT_CONFIG: LabPublicConfig = {
  timezone: "America/Sao_Paulo",
  now: {
    utc: new Date().toISOString(),
    unixMs: Date.now(),
    localIso: new Date().toISOString(),
    localDate: new Date().toISOString().slice(0, 10),
  },
  calendar: {
    pastDays: 30,
    futureDaysOptions: [90, 180, 365],
    defaultFutureDays: 90,
  },
  allocation: {
    maxFutureDays: 365,
    minDurationMinutes: 15,
    scheduleStartHour: 0,
    scheduleEndHour: 24,
    publicNames: false,
  },
  auth: {
    tokenExpiresIn: "6 hours",
  },
  telemetry: {
    defaultOfflinePreset: "eco",
    presets: DEFAULT_LAB_TELEMETRY_PRESETS,
  },
};

export const useLabConfigStore = defineStore("labConfig", () => {
  const config = ref<LabPublicConfig>(DEFAULT_CONFIG);
  const loaded = ref(false);
  const loading = ref(false);

  const todayIso = computed(() => config.value.now.localDate);
  const pastDays = computed(() => config.value.calendar.pastDays);
  const futureOptions = computed(
    () => config.value.calendar.futureDaysOptions,
  );
  const defaultFutureDays = computed(
    () => config.value.calendar.defaultFutureDays,
  );
  const timezone = computed(() => config.value.timezone);
  const publicAllocationNames = computed(
    () => config.value.allocation.publicNames,
  );
  const telemetryPresets = computed(
    () => config.value.telemetry?.presets ?? DEFAULT_LAB_TELEMETRY_PRESETS,
  );

  async function fetchConfig() {
    if (loading.value) return config.value;
    loading.value = true;
    try {
      const { data } = await axios.get<LabPublicConfig>(
        `${API_BASE}/api/config`,
        { timeout: 8000 },
      );
      config.value = data;
      loaded.value = true;
      return data;
    } catch {
      config.value = {
        ...DEFAULT_CONFIG,
        now: {
          ...DEFAULT_CONFIG.now,
          localDate: new Date().toISOString().slice(0, 10),
        },
      };
      loaded.value = true;
      return config.value;
    } finally {
      loading.value = false;
    }
  }

  /** Atualiza "hoje" a partir de /api/time (útil após sync de relógio). */
  async function refreshToday() {
    try {
      const { data } = await axios.get<{
        localDate?: string;
        unixMs: number;
      }>(`${API_BASE}/api/time`, { timeout: 5000 });
      if (data.localDate) {
        config.value.now.localDate = data.localDate;
        config.value.now.unixMs = data.unixMs;
      }
    } catch {
      /* mantém valor anterior */
    }
  }

  async function fetchLabTelemetryPresets(): Promise<LabTelemetryPresets> {
    const { data } = await api.get<LabTelemetryPresets>(
      "/api/v1/lab/telemetry-presets",
    );
    return data;
  }

  async function saveLabTelemetryPresets(
    presets: LabTelemetryPresets,
  ): Promise<LabTelemetryPresets> {
    const { data } = await api.put<LabTelemetryPresets>(
      "/api/v1/lab/telemetry-presets",
      presets,
    );
    if (config.value.telemetry) {
      config.value.telemetry.presets = data;
    }
    return data;
  }

  return {
    config,
    loaded,
    loading,
    todayIso,
    pastDays,
    futureOptions,
    defaultFutureDays,
    timezone,
    publicAllocationNames,
    telemetryPresets,
    fetchConfig,
    refreshToday,
    fetchLabTelemetryPresets,
    saveLabTelemetryPresets,
  };
});
