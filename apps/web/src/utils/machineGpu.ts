/** Formata GB de VRAM para exibição (sync-specs / specs estáticas). */
export function formatVramGb(totalVramGb: number | null | undefined): string | null {
  if (totalVramGb == null || totalVramGb <= 0) return null;
  const n = Number(totalVramGb);
  const text = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${text} GB VRAM`;
}

/** Rótulo GPU + VRAM total para cards e listas. */
export function formatGpuWithVram(
  gpuModel: string | null | undefined,
  totalVramGb: number | null | undefined,
): string | null {
  const name = gpuModel?.trim();
  const vram = formatVramGb(totalVramGb);
  if (name && vram) return `${name} · ${vram}`;
  if (name) return name;
  if (vram) return vram;
  return null;
}
