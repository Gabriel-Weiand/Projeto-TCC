import { test } from '@japa/runner'
import Machine from '#models/machine'
import { buildAgentTelemetryConfig } from '#services/telemetry_presets'
import { normalizeRealtimeTelemetry } from '#services/telemetry_normalize'
import {
  applyMainDiskDefaults,
  classifyDiskPartitionRole,
  enrichDiskPartitions,
  listAllocatableDiskMountpoints,
  mergeDiskPartitionsFromAgent,
  mergeAdminDiskPolicyUpdate,
  sanitizeDiskCapacities,
  diskUsagePercent,
  normalizeAllocationHomeMount,
  resolveDefaultAllocationHomeMount,
  resolveMainDiskMountpoint,
} from '#services/disk_partitions'
import { canChangeAllocationHomeMount } from '#services/allocation_home_mount'
import Allocation from '#models/allocation'
import { DateTime } from 'luxon'

test.group('Telemetry intervals and normalization', () => {
  test('custom interval 5s is preserved in heartbeat config (not clamped to 10)', async ({
    assert,
  }) => {
    const machine = new Machine()
    machine.telemetryPreset = 'custom'
    machine.customAgentConfig = {
      intervalSeconds: 5,
      batchSize: 2,
      telemetrySet: { cpu: true, ramAndSwap: true },
    }

    const config = buildAgentTelemetryConfig(machine, false)
    assert.equal(config.intervalSeconds, 5)
  })

  test('normalizeRealtimeTelemetry keeps null for absent metrics and zero for real zero', async ({
    assert,
  }) => {
    const normalized = normalizeRealtimeTelemetry({
      cpuUsage: 0,
      gpuUsage: null,
      gpuTemp: null,
      diskReadMbps: 0,
      downloadMbps: null,
      timestamp: '2026-01-01T00:00:00.000Z',
    })

    assert.equal(normalized?.cpuUsage, 0)
    assert.isNull(normalized?.gpuUsage)
    assert.isNull(normalized?.gpuTemp)
    assert.equal(normalized?.diskReadMbps, 0)
    assert.isNull(normalized?.downloadMbps)
  })

  test('normalizeRealtimeTelemetry maps legacy disks field to disksInfo', async ({ assert }) => {
    const normalized = normalizeRealtimeTelemetry({
      cpuUsage: 100,
      disks: [{ mountpoint: '/data' }],
      timestamp: '2026-01-01T00:00:00.000Z',
    })
    assert.deepEqual(normalized?.disksInfo, [{ mountpoint: '/data' }])
  })
})

test.group('Disk partitions', () => {
  test('classifies system vs user mountpoints', async ({ assert }) => {
    assert.equal(classifyDiskPartitionRole('/'), 'user')
    assert.equal(classifyDiskPartitionRole('/boot'), 'system')
    assert.equal(classifyDiskPartitionRole('/home'), 'user')
    assert.equal(classifyDiskPartitionRole('/data'), 'user')
  })

  test('root partition is user and allocatable by default', async ({ assert }) => {
    const disks = enrichDiskPartitions([
      { device: 'nvme0n1p2', mountpoint: '/', totalGb: 480, freeGb: 200 },
      { device: 'nvme0n1p1', mountpoint: '/boot/efi', totalGb: 1, freeGb: 0.5 },
    ])
    const root = disks.find((d) => d.mountpoint === '/')
    assert.equal(root?.role, 'user')
    assert.isTrue(root?.mainDisk)
    assert.isTrue(root?.allocatable)
    assert.deepEqual(listAllocatableDiskMountpoints(disks, false), ['/'])
    assert.equal(normalizeAllocationHomeMount(disks, false, null).mountpoint, '/')
  })

  test('applyMainDiskDefaults prefers / as main when present', async ({ assert }) => {
    const disks = applyMainDiskDefaults([
      { device: 'sda1', mountpoint: '/', role: 'user', totalGb: 100 },
      { device: 'sdb1', mountpoint: '/home', role: 'user', totalGb: 200 },
      { device: 'sdc1', mountpoint: '/data', role: 'user', totalGb: 500 },
    ])
    assert.isTrue(disks.find((d) => d.mountpoint === '/')?.mainDisk)
    assert.isFalse(disks.find((d) => d.mountpoint === '/home')?.mainDisk)
    assert.isFalse(disks.find((d) => d.mountpoint === '/data')?.mainDisk)
  })

  test('applyMainDiskDefaults picks largest user disk when / absent', async ({ assert }) => {
    const disks = applyMainDiskDefaults([
      { device: 'sdb1', mountpoint: '/home', role: 'user', totalGb: 200 },
      { device: 'sdc1', mountpoint: '/data', role: 'user', totalGb: 500 },
    ])
    assert.isFalse(disks.find((d) => d.mountpoint === '/home')?.mainDisk)
    assert.isTrue(disks.find((d) => d.mountpoint === '/data')?.mainDisk)
  })

  test('onlyMainDisk restricts allocatable mounts to main', async ({ assert }) => {
    const disks = enrichDiskPartitions([
      { device: 'sdb1', mountpoint: '/home', role: 'user', totalGb: 200, mainDisk: true },
      { device: 'sdc1', mountpoint: '/data', role: 'user', totalGb: 500 },
    ])
    assert.deepEqual(listAllocatableDiskMountpoints(disks, true), ['/home'])
    assert.deepEqual(listAllocatableDiskMountpoints(disks, false).sort(), ['/data', '/home'])
  })

  test('normalizeAllocationHomeMount rejects non-user mount when onlyMainDisk', async ({
    assert,
  }) => {
    const disks = enrichDiskPartitions([
      { device: 'sdb1', mountpoint: '/home', role: 'user', mainDisk: true },
      { device: 'sdc1', mountpoint: '/data', role: 'user' },
    ])
    const result = normalizeAllocationHomeMount(disks, true, '/data')
    assert.isNotNull(result.error)
    assert.equal(result.mountpoint, null)
  })

  test('normalizeAllocationHomeMount defaults to main disk', async ({ assert }) => {
    const disks = enrichDiskPartitions([
      { device: 'sdb1', mountpoint: '/home', role: 'user', mainDisk: true },
      { device: 'sdc1', mountpoint: '/data', role: 'user' },
    ])
    const result = normalizeAllocationHomeMount(disks, false, null)
    assert.equal(result.mountpoint, '/home')
    assert.isNull(result.error)
  })

  test('resolveMainDiskMountpoint returns marked partition', async ({ assert }) => {
    const disks = enrichDiskPartitions([
      { device: 'sdb1', mountpoint: '/home', role: 'user', mainDisk: true },
    ])
    assert.equal(resolveMainDiskMountpoint(disks), '/home')
  })

  test('allocatable filtra volumes no dropdown quando onlyMainDisk=false', async ({ assert }) => {
    const disks = enrichDiskPartitions([
      { device: 'sdb1', mountpoint: '/home', role: 'user', mainDisk: true, allocatable: true },
      { device: 'sdc1', mountpoint: '/data', role: 'user', allocatable: true },
      { device: 'sdd1', mountpoint: '/scratch', role: 'user', allocatable: false },
    ])
    assert.deepEqual(listAllocatableDiskMountpoints(disks, false).sort(), ['/data', '/home'])
  })

  test('principal permanece allocatable mesmo se admin desmarcar', async ({ assert }) => {
    const disks = enrichDiskPartitions([
      { device: 'sdb1', mountpoint: '/home', role: 'user', mainDisk: true, allocatable: false },
      { device: 'sdc1', mountpoint: '/data', role: 'user', allocatable: true },
    ])
    assert.isTrue(disks.find((d) => d.mountpoint === '/home')?.allocatable)
    assert.deepEqual(listAllocatableDiskMountpoints(disks, false).sort(), ['/data', '/home'])
  })

  test('default de reserva usa principal se allocatable senão primeiro permitido', async ({
    assert,
  }) => {
    const disks = enrichDiskPartitions([
      { device: 'sdb1', mountpoint: '/home', role: 'user', mainDisk: true, allocatable: false },
      { device: 'sdc1', mountpoint: '/data', role: 'user', allocatable: true },
    ])
    assert.equal(resolveDefaultAllocationHomeMount(disks, false), '/home')
    const disks2 = enrichDiskPartitions([
      { device: 'sdb1', mountpoint: '/home', role: 'user', mainDisk: false, allocatable: false },
      { device: 'sdc1', mountpoint: '/data', role: 'user', mainDisk: true, allocatable: true },
    ])
    assert.equal(resolveDefaultAllocationHomeMount(disks2, false), '/data')
  })

  test('sanitizeDiskCapacities limita free ao total (arredondamento EFI)', async ({
    assert,
  }) => {
    const { totalGb, freeGb } = sanitizeDiskCapacities(1.0, 1.04)
    assert.equal(totalGb, 1.0)
    assert.equal(freeGb, 1.0)
    assert.equal(diskUsagePercent(1.0, 1.04), 0)
    assert.equal(diskUsagePercent(1.0, 1.04, 0), 0)
  })

  test('diskUsagePercent limita entre 0 e 100', async ({ assert }) => {
    assert.equal(diskUsagePercent(100, -5), 0)
    assert.equal(diskUsagePercent(100, 150), 0)
    assert.equal(diskUsagePercent(100, 0), 100)
    assert.equal(diskUsagePercent(100, 50, 1050), 100)
  })

  test('mergeAdminDiskPolicyUpdate preserva capacidade e altera só política', async ({
    assert,
  }) => {
    const existing = enrichDiskPartitions([
      {
        device: 'sdb1',
        mountpoint: '/',
        role: 'user',
        mainDisk: true,
        totalGb: 480,
        freeGb: 102,
        allocatable: true,
      },
      {
        device: 'sdc1',
        mountpoint: '/data',
        role: 'user',
        totalGb: 1000,
        freeGb: 500,
        allocatable: true,
      },
    ])

    const merged = mergeAdminDiskPolicyUpdate(
      [
        { mountpoint: '/', mainDisk: false, allocatable: true },
        { mountpoint: '/data', mainDisk: true, allocatable: true },
      ],
      existing
    )

    const root = merged.find((d) => d.mountpoint === '/')
    const data = merged.find((d) => d.mountpoint === '/data')
    assert.equal(root?.totalGb, 480)
    assert.equal(root?.freeGb, 102)
    assert.isFalse(root?.mainDisk)
    assert.isTrue(data?.mainDisk)
    assert.equal(data?.totalGb, 1000)
  })

  test('mergeDiskPartitionsFromAgent preserva allocatable admin', async ({ assert }) => {
    const existing = enrichDiskPartitions([
      { device: 'sdb1', mountpoint: '/home', role: 'user', mainDisk: true, allocatable: true },
      { device: 'sdc1', mountpoint: '/data', role: 'user', allocatable: false },
    ])
    const merged = mergeDiskPartitionsFromAgent(
      [
        { device: 'sdb1', mountpoint: '/home', totalGb: 200 },
        { device: 'sdc1', mountpoint: '/data', totalGb: 500 },
        { device: 'sdd1', mountpoint: '/scratch', totalGb: 1000 },
      ],
      existing
    )
    assert.isFalse(merged.find((d) => d.mountpoint === '/data')?.allocatable)
    assert.isTrue(merged.find((d) => d.mountpoint === '/scratch')?.allocatable)
  })

  test('normalizeAllocationHomeMount rejeita mount não allocatable', async ({ assert }) => {
    const disks = enrichDiskPartitions([
      { device: 'sdb1', mountpoint: '/home', role: 'user', mainDisk: true },
      { device: 'sdc1', mountpoint: '/data', role: 'user', allocatable: false },
    ])
    const result = normalizeAllocationHomeMount(disks, false, '/data')
    assert.isNotNull(result.error)
  })
})

test.group('Allocation home mount policy', () => {
  test('can change home mount only before start when approved', async ({ assert }) => {
    const allocation = new Allocation()
    allocation.status = 'approved'
    allocation.startTime = DateTime.utc().plus({ hours: 1 })
    allocation.endTime = DateTime.utc().plus({ hours: 2 })

    assert.isTrue(canChangeAllocationHomeMount(allocation))

    allocation.startTime = DateTime.utc().minus({ minutes: 1 })
    assert.isFalse(canChangeAllocationHomeMount(allocation))
  })
})
