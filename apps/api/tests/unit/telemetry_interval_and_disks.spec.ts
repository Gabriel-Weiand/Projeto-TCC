import { test } from '@japa/runner'
import Machine from '#models/machine'
import { buildAgentTelemetryConfig } from '#services/telemetry_presets'
import { normalizeRealtimeTelemetry } from '#services/telemetry_normalize'
import {
  applyMainDiskDefaults,
  classifyDiskPartitionRole,
  enrichDiskPartitions,
  listAllocatableDiskMountpoints,
  normalizeAllocationHomeMount,
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
    assert.equal(classifyDiskPartitionRole('/'), 'system')
    assert.equal(classifyDiskPartitionRole('/boot'), 'system')
    assert.equal(classifyDiskPartitionRole('/home'), 'user')
    assert.equal(classifyDiskPartitionRole('/data'), 'user')
  })

  test('applyMainDiskDefaults picks largest user disk when none marked', async ({ assert }) => {
    const disks = applyMainDiskDefaults([
      { device: 'sda1', mountpoint: '/', role: 'system', totalGb: 100 },
      { device: 'sdb1', mountpoint: '/home', role: 'user', totalGb: 200 },
      { device: 'sdc1', mountpoint: '/data', role: 'user', totalGb: 500 },
    ])
    assert.isFalse(disks.find((d) => d.mountpoint === '/')?.mainDisk)
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
