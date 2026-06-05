import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Machine from '#models/machine'

/** Retorna IDs de máquinas que não existem no banco. */
export async function findMissingMachineIds(machineIds: number[]): Promise<number[]> {
  const uniqueIds = [...new Set(machineIds)]
  if (uniqueIds.length === 0) return []

  const found = await Machine.query().whereIn('id', uniqueIds).select('id')
  const foundIds = new Set(found.map((m) => m.id))
  return uniqueIds.filter((id) => !foundIds.has(id))
}

/**
 * Sincroniza máquinas de um grupo: define machineGroupId nas listadas e remove as demais do grupo.
 * Chame `findMissingMachineIds` antes, ou use dentro de transação com validação prévia.
 */
export async function syncGroupMachines(
  groupId: number,
  machineIds: number[],
  trx?: TransactionClientContract
): Promise<void> {
  const uniqueIds = [...new Set(machineIds)]
  const machineQuery = () => (trx ? Machine.query({ client: trx }) : Machine.query())

  await machineQuery()
    .where('machineGroupId', groupId)
    .whereNotIn('id', uniqueIds.length > 0 ? uniqueIds : [-1])
    .update({ machineGroupId: null })

  if (uniqueIds.length > 0) {
    await machineQuery().whereIn('id', uniqueIds).update({ machineGroupId: groupId })
  }
}
