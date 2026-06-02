# Horários no frontend (`apps/web`)

## Regra de ouro

| Camada | Formato |
|--------|---------|
| API / banco | **UTC** (`2026-06-02T04:25:00.000Z`) |
| Inputs `date` + `time` | Relógio de parede no fuso do laboratório (`America/Sao_Paulo` via `labConfig.timezone`) |
| Tabelas, Gantt, modais | Sempre converter UTC → fuso do lab antes de mostrar |

**Nunca** usar `new Date(iso).toLocaleString()` sem `timeZone` explícito — depende do SO do usuário.

## Utilitário central

Arquivo: `src/utils/datetime.ts`

| Função | Uso |
|--------|-----|
| `wallClockToUtcIso(date, time, zone?)` | Criar reserva (formulários) |
| `formatLabDateTime(iso, zone?)` | Listas, perfil, admin |
| `parseApiUtc(iso)` | Comparações (conectar, extender) |
| `normalizeApiUtcIso(iso)` | Strings da API sem `Z` |
| `isNowInUtcRange` / `isNowBeforeUtc` | Botões Conectar / Estender |

`src/utils/allocationLabels.ts` reexporta formatadores para compatibilidade.

## Por componente

| Componente | Envio (→ API) | Exibição (← API) |
|------------|---------------|------------------|
| `HomeView` (nova reserva) | `wallClockToUtcIso` + `labConfig.timezone` | `formatLabDateTime` em listas |
| `NewAllocationModal` | idem | — |
| `MachineDetailView` | idem | — |
| `MyAllocationsView` / `ProfileMyAllocationsTab` | — | `formatLabDateTime` |
| `AllocationUsageStatsModal` | — | `formatLabDateTime` / `formatLabTime` |
| `ExtendAllocationOverlay` | `wallClockToUtcIso` (fim) | `utcIsoToWallClockFields` / `formatLabDateTime` |
| `CalendarGanttScroll` | — | `parseApiUtc` → Date para posição no eixo |
| `AdminAllocationsView` | — | `formatLabDateTime` |
| `ProfileAllocationConnectModal` | — | — |

## Servidor

- `GET /api/time` e `labConfig.timezone`: fuso oficial do laboratório.
- `timeSync.ts`: offset de relógio (UTC ms), não substitui conversão de exibição.

## Erro típico (+3 h no Brasil)

1. **Exibição sem fuso do lab** — mostrar hora UTC crua.
2. **Envio sem conversão** — enviar `2026-06-02T01:25:00` sem `Z` (servidor trata como UTC).
3. **API com `TZ=America/Sao_Paulo`** — Lucid lia/gravava `dateTime` no SQLite como hora local (+3 h ao reler). Corrigido em `Allocation` com `prepare`/`consume` UTC (`#utils/datetime`).

Correção: sempre `wallClockToUtcIso` ao enviar, `formatLabDateTime` ao exibir, API com colunas UTC no modelo.
