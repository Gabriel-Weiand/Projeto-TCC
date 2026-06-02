/** Porta SSH padrão quando `machine.sshPort` é null no banco. */
export const DEFAULT_SSH_PORT = 22;

export function effectiveSshPort(port: number | null | undefined): number {
  if (port == null || !Number.isFinite(port)) return DEFAULT_SSH_PORT;
  return port;
}

/** Monta comando SSH; inclui `-p` somente se a porta não for 22. */
export function buildSshCommand(
  ip: string,
  user: string,
  port?: number | null,
): string {
  const p = effectiveSshPort(port);
  if (p === DEFAULT_SSH_PORT) {
    return `ssh ${user}@${ip}`;
  }
  return `ssh -p ${p} ${user}@${ip}`;
}
