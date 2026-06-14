import { test } from '@japa/runner'
import type Machine from '#models/machine'
import {
  applySyncSpecsIfEmpty,
  apiGbToWire,
  normalizeAdminMachineWireFields,
} from '#services/machine_specs_merge'
import { mergeDiskPartitionsFromAgent } from '#services/disk_partitions'

test.group('machine_specs_merge', () => {
  test('applySyncSpecsIfEmpty preenche campos vazios', ({ assert }) => {
    const machine = {
      cpuModel: null,
      gpuModel: null,
      totalRamGb: null,
      totalVramGb: null,
      ipAddress: null,
      hostFingerprint: null,
      disks: [],
    } as Machine

    applySyncSpecsIfEmpty(machine, {
      cpuModel: 'Intel i7',
      gpuModel: 'RTX 4090',
      totalRamGb: 480,
      totalVramGb: 240,
      ipAddress: '10.0.0.5',
      hostFingerprint: 'SHA256:abc',
    })

    assert.equal(machine.cpuModel, 'Intel i7')
    assert.equal(machine.gpuModel, 'RTX 4090')
    assert.equal(machine.totalRamGb, 480)
    assert.equal(machine.totalVramGb, 240)
    assert.equal(machine.ipAddress, '10.0.0.5')
    assert.equal(machine.hostFingerprint, 'SHA256:abc')
  })

  test('applySyncSpecsIfEmpty não sobrescreve valores existentes', ({ assert }) => {
    const machine = {
      cpuModel: 'Admin CPU',
      gpuModel: 'Admin GPU',
      totalRamGb: 320,
      totalVramGb: 120,
      ipAddress: '192.168.1.10',
      hostFingerprint: 'SHA256:old',
      disks: [],
    } as Machine

    applySyncSpecsIfEmpty(machine, {
      cpuModel: 'Agent CPU',
      gpuModel: 'Agent GPU',
      totalRamGb: 960,
      totalVramGb: 480,
      ipAddress: '10.0.0.99',
      hostFingerprint: 'SHA256:new',
    })

    assert.equal(machine.cpuModel, 'Admin CPU')
    assert.equal(machine.gpuModel, 'Admin GPU')
    assert.equal(machine.totalRamGb, 320)
    assert.equal(machine.totalVramGb, 120)
    assert.equal(machine.ipAddress, '192.168.1.10')
    assert.equal(machine.hostFingerprint, 'SHA256:old')
  })

  test('applySyncSpecsIfEmpty repreenche após admin limpar string', ({ assert }) => {
    const machine = {
      cpuModel: '',
      gpuModel: '  ',
      ipAddress: null,
      hostFingerprint: null,
      totalRamGb: 0,
      totalVramGb: null,
      disks: [],
    } as Machine

    applySyncSpecsIfEmpty(machine, {
      cpuModel: 'Detected CPU',
      gpuModel: 'Detected GPU',
      totalRamGb: 480,
      totalVramGb: 240,
      ipAddress: 'lab.local',
    })

    assert.equal(machine.cpuModel, 'Detected CPU')
    assert.equal(machine.gpuModel, 'Detected GPU')
    assert.equal(machine.totalRamGb, 480)
    assert.equal(machine.totalVramGb, 240)
    assert.equal(machine.ipAddress, 'lab.local')
  })

  test('applySyncSpecsIfEmpty preenche totalDiskGb vazio', ({ assert }) => {
    const machine = { totalDiskGb: null, disks: [] } as Machine
    applySyncSpecsIfEmpty(machine, { totalDiskGb: 24800 })
    assert.equal(machine.totalDiskGb, 24800)
  })

  test('normalizeAdminMachineWireFields converte GB decimal para wire', ({ assert }) => {
    const payload: Record<string, unknown> = {
      totalRamGb: 48,
      totalVramGb: 24,
      totalDiskGb: 2480,
    }
    normalizeAdminMachineWireFields(payload)
    assert.equal(payload.totalRamGb, 480)
    assert.equal(payload.totalVramGb, 240)
    assert.equal(payload.totalDiskGb, 24800)
    assert.equal(apiGbToWire(48), 480)
  })

  test('mergeDiskPartitionsFromAgent sobrescreve totalGb e freeGb do agente', ({ assert }) => {
    const merged = mergeDiskPartitionsFromAgent(
      [{ mountpoint: '/', device: '/dev/nvme0n1p2', totalGb: 400, freeGb: 180 }],
      [{ mountpoint: '/', device: '/dev/nvme0n1p2', totalGb: 500, freeGb: 200, role: 'user' }]
    )

    assert.lengthOf(merged, 1)
    assert.equal(merged[0].totalGb, 400)
    assert.equal(merged[0].freeGb, 180)
  })

  test('mergeDiskPartitionsFromAgent preenche totalGb vazio', ({ assert }) => {
    const merged = mergeDiskPartitionsFromAgent(
      [{ mountpoint: '/data', device: '/dev/sdb1', totalGb: 1920, freeGb: 900 }],
      []
    )

    assert.equal(merged[0].totalGb, 1920)
    assert.equal(merged[0].freeGb, 900)
  })
})
