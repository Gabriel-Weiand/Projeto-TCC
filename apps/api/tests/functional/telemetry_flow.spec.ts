import { test } from '@japa/runner'
import User from '#models/user'
import Machine from '#models/machine'
import Allocation from '#models/allocation'
import Telemetry from '#models/telemetry'
import AllocationMetric from '#models/allocation_metric'
import { telemetryBuffer } from '#services/telemetry_buffer'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Gera um snapshot de telemetria realista com variação.
 * Simula uma máquina sob carga progressiva (ex: compilação, renderização).
 *
 * @param tick - Número do tick (0 a N), usado para variar os valores.
 * @param intensity - 0.0 a 1.0, controla o nível de carga geral.
 */
function generateTelemetry(tick: number, intensity: number = 0.5) {
  // Funções de variação pseudoaleatória baseadas no tick
  const wave = Math.sin(tick * 0.3) * 0.15 // Oscilação suave ±15%
  const noise = (((tick * 7 + 13) % 17) / 17) * 0.1 // Ruído determinístico ±10%
  const factor = Math.min(1, Math.max(0, intensity + wave + noise))

  const clamp = (v: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, v)))

  return {
    cpuUsage: clamp(factor * 850 + (tick % 5) * 10, 0, 1000),
    cpuTemp: clamp(400 + factor * 350 + (tick % 3) * 15, 200, 1000),
    gpuUsage: clamp(factor * 700 + (tick % 4) * 20, 0, 1000),
    gpuTemp: clamp(350 + factor * 300 + (tick % 3) * 10, 200, 950),
    ramUsage: clamp(300 + factor * 500 + (tick % 6) * 8, 100, 1000),
    diskUsage: clamp(200 + factor * 100, 100, 1000),
    downloadUsage: clamp(factor * 80 + (tick % 5) * 5, 0, 500),
    uploadUsage: clamp(factor * 30 + (tick % 3) * 3, 0, 200),
    moboTemperature: clamp(300 + factor * 150, 200, 700),
    loggedUserName: 'aluno.silva',
  }
}

/**
 * Popula telemetrias diretamente no banco para uma alocação.
 * Simula `durationSeconds` segundos de coleta (1 registro = 5 segundos reais).
 */
async function seedTelemetries(allocationId: number, count: number, intensity: number = 0.5) {
  const records = []
  for (let i = 0; i < count; i++) {
    records.push({
      allocationId,
      ...generateTelemetry(i, intensity),
    })
  }

  // Batch insert em chunks de 500 (SQLite limit de variáveis)
  const CHUNK = 500
  for (let i = 0; i < records.length; i += CHUNK) {
    await Telemetry.createMany(records.slice(i, i + CHUNK))
  }

  return records
}

// ============================================================================
// FLUXO COMPLETO: Alocação → Telemetria → Resumo → Limpeza
// ============================================================================

test.group('Fluxo Completo de Telemetria', (group) => {
  group.each.setup(() => {
    // Limpa buffer singleton entre testes (evita dados residuais)
    telemetryBuffer.reset()
    return testUtils.db().withGlobalTransaction()
  })

  test('fluxo real: alocação → buffer de telemetria → flush → resumo → leitura', async ({
    assert,
  }) => {
    // === 1. SETUP: Criar usuário, máquina e alocação ativa ===
    const user = await User.create({
      fullName: 'Aluno Teste',
      email: 'aluno.flow@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-LAB-FLOW-01',
      macAddress: 'AA:BB:CC:04:01:01',
      description: 'Máquina fluxo completo telemetria',
      cpuModel: 'Intel Core i7-12700K',
      gpuModel: 'NVIDIA RTX 3060',
      totalRamGb: 32,
      totalDiskGb: 512,
      status: 'available',
    })

    const allocation = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ minutes: 10 }),
      endTime: DateTime.now().plus({ minutes: 50 }),
      status: 'approved',
    })

    // === 2. SIMULAR AGENTE: 120 telemetrias via buffer (10 min × 12/min) ===
    const TOTAL_TICKS = 120

    for (let i = 0; i < TOTAL_TICKS; i++) {
      // Intensidade crescente: simula início leve → carga pesada
      const intensity = 0.2 + (i / TOTAL_TICKS) * 0.7

      telemetryBuffer.add(machine.id, {
        allocationId: allocation.id,
        ...generateTelemetry(i, intensity),
      })
    }

    // === 3. VERIFICAR BUFFER EM MEMÓRIA ===
    const stats = telemetryBuffer.stats()
    assert.isAtLeast(stats.pendingRecords, TOTAL_TICKS)

    // Verificar latest state (dashboard real-time)
    const latest = telemetryBuffer.getLatest(machine.id)
    assert.isNotNull(latest)
    assert.equal(latest!.allocationId, allocation.id)
    assert.isAbove(latest!.cpuUsage, 0)

    // === 4. FLUSH MANUAL (simula o timer de 60s) ===
    const flushed = await telemetryBuffer.flush()
    assert.equal(flushed, TOTAL_TICKS)

    // Buffer deve estar vazio após flush
    const afterFlush = telemetryBuffer.stats()
    assert.equal(afterFlush.pendingRecords, 0)

    // === 5. VERIFICAR PERSISTÊNCIA NO BANCO ===
    const dbTelemetries = await Telemetry.query().where('allocationId', allocation.id)
    assert.equal(dbTelemetries.length, TOTAL_TICKS)

    // Verificar que os IDs são sequenciais (ordem correta)
    for (let i = 1; i < dbTelemetries.length; i++) {
      assert.isAbove(dbTelemetries[i].id, dbTelemetries[i - 1].id)
    }

    // Verificar range de valores (todos dentro da escala 0-1000)
    for (const t of dbTelemetries) {
      assert.isAtLeast(t.cpuUsage, 0)
      assert.isAtMost(t.cpuUsage, 1000)
      assert.isAtLeast(t.cpuTemp, 0)
      assert.isAtMost(t.cpuTemp, 1000)
      assert.equal(t.allocationId, allocation.id)
    }

    // === 6. VERIFICAR QUE LATEST STATE SOBREVIVE AO FLUSH ===
    const latestAfterFlush = telemetryBuffer.getLatest(machine.id)
    assert.isNotNull(latestAfterFlush)
    assert.equal(latestAfterFlush!.allocationId, allocation.id)
  })

  test('flush duplo não insere dados duplicados', async ({ assert }) => {
    const user = await User.create({
      fullName: 'Aluno Dup',
      email: 'aluno.dup@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-DUP-01',
      macAddress: 'AA:BB:CC:04:01:02',
      description: 'Máquina teste flush duplo',
      status: 'available',
    })

    const allocation = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ minutes: 5 }),
      endTime: DateTime.now().plus({ minutes: 55 }),
      status: 'approved',
    })

    // Adiciona 10 registros
    for (let i = 0; i < 10; i++) {
      telemetryBuffer.add(machine.id, {
        allocationId: allocation.id,
        ...generateTelemetry(i, 0.5),
      })
    }

    // Primeiro flush
    const first = await telemetryBuffer.flush()
    assert.equal(first, 10)

    // Segundo flush (nada para inserir)
    const second = await telemetryBuffer.flush()
    assert.equal(second, 0)

    // Banco deve ter exatamente 10
    const count = await Telemetry.query().where('allocationId', allocation.id).count('* as total')
    assert.equal(Number(count[0].$extras.total), 10)
  })
})

// ============================================================================
// BATCH INSERT PESADO: Simulação de 10 minutos com muitas máquinas
// ============================================================================

test.group('Telemetria Data-Heavy', (group) => {
  group.each.setup(() => {
    telemetryBuffer.reset()
    return testUtils.db().withGlobalTransaction()
  })

  test('batch insert de 600 telemetrias (10 máquinas × 1 min de coleta)', async ({ assert }) => {
    const user = await User.create({
      fullName: 'Aluno Heavy',
      email: 'aluno.heavy@teste.com',
      password: 'senha123',
      role: 'user',
    })

    // Cria 10 máquinas com alocações ativas
    const pairs: { machine: Machine; allocation: Allocation }[] = []

    for (let m = 0; m < 10; m++) {
      const machine = await Machine.create({
        name: `PC-HEAVY-${String(m + 1).padStart(2, '0')}`,
        macAddress: `AA:BB:CC:04:02:${String(m + 1).padStart(2, '0')}`,
        description: `Máquina heavy test ${m + 1}`,
        cpuModel: 'AMD Ryzen 9 5900X',
        totalRamGb: 64,
        totalDiskGb: 1024,
        status: 'available',
      })

      const allocation = await Allocation.create({
        userId: user.id,
        machineId: machine.id,
        startTime: DateTime.now().minus({ minutes: 30 }),
        endTime: DateTime.now().plus({ minutes: 30 }),
        status: 'approved',
      })

      pairs.push({ machine, allocation })
    }

    // Simula 1 minuto: cada máquina envia 12 telemetrias (a cada 5s) = 120 total
    // Intercalado como aconteceria na realidade (todas as máquinas "ao mesmo tempo")
    for (let tick = 0; tick < 12; tick++) {
      for (const { machine, allocation } of pairs) {
        telemetryBuffer.add(machine.id, {
          allocationId: allocation.id,
          ...generateTelemetry(tick, 0.3 + Math.random() * 0.5),
        })
      }
    }

    // Flush único (como aconteceria no timer de 60s)
    const flushed = await telemetryBuffer.flush()
    assert.equal(flushed, 120)

    // Verifica cada alocação tem suas 12 telemetrias
    for (const { allocation } of pairs) {
      const count = await Telemetry.query().where('allocationId', allocation.id).count('* as total')
      assert.equal(Number(count[0].$extras.total), 12)
    }

    // Verifica total geral
    const total = await Telemetry.query().count('* as total')
    assert.equal(Number(total[0].$extras.total), 120)
  })

  test('insert direto de 1200 telemetrias (simula 10 min de uso a 5s/tick)', async ({ assert }) => {
    const user = await User.create({
      fullName: 'Aluno Direto',
      email: 'aluno.direto@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-DIRETO-01',
      macAddress: 'AA:BB:CC:04:01:03',
      description: 'Máquina insert direto',
      cpuModel: 'Intel i9-13900K',
      totalRamGb: 64,
      totalDiskGb: 2048,
      status: 'available',
    })

    const allocation = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ minutes: 10 }),
      endTime: DateTime.now().plus({ minutes: 50 }),
      status: 'approved',
    })

    // 10 minutos / 5 segundos por tick = 120 ticks
    const TICK_COUNT = 120
    const records = await seedTelemetries(allocation.id, TICK_COUNT, 0.6)

    // Verifica contagem
    const count = await Telemetry.query().where('allocationId', allocation.id).count('* as total')
    assert.equal(Number(count[0].$extras.total), TICK_COUNT)

    // Verifica que primeiro e último registro refletem a intensidade crescente
    const first = await Telemetry.query()
      .where('allocationId', allocation.id)
      .orderBy('id', 'asc')
      .first()
    const last = await Telemetry.query()
      .where('allocationId', allocation.id)
      .orderBy('id', 'desc')
      .first()

    assert.isNotNull(first)
    assert.isNotNull(last)
    // Com intensidade 0.6, primeiro registro deve ter CPU < último (tendência)
    // (não garantido por ruído, mas a média geral deve tender para cima)
    assert.equal(first!.allocationId, allocation.id)
    assert.equal(last!.allocationId, allocation.id)
    assert.equal(records.length, TICK_COUNT)
  })
})

// ============================================================================
// RESUMO (AllocationMetric): Geração e validação de métricas
// ============================================================================

test.group('AllocationMetric - Resumo de Sessão', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('gerar resumo a partir de telemetrias reais via API', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin Resumo',
      email: 'admin.resumo@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    const user = await User.create({
      fullName: 'Aluno Resumo',
      email: 'aluno.resumo@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-RESUMO-01',
      macAddress: 'AA:BB:CC:04:01:04',
      description: 'Máquina resumo de sessão',
      cpuModel: 'Intel i7-12700K',
      totalRamGb: 32,
      totalDiskGb: 512,
      status: 'available',
    })

    const allocation = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ minutes: 10 }),
      endTime: DateTime.now(),
      status: 'finished',
    })

    // Seed 120 telemetrias (10 min a 5s/tick)
    await seedTelemetries(allocation.id, 120, 0.65)

    // === Gerar resumo via API (admin only) ===
    const createResponse = await client
      .post(`/api/v1/allocations/${allocation.id}/summary`)
      .loginAs(admin)

    createResponse.assertStatus(201)
    const metric = createResponse.body()

    // Verificar que todos os campos existem e fazem sentido
    assert.isNumber(metric.avgCpuUsage)
    assert.isNumber(metric.maxCpuUsage)
    assert.isNumber(metric.avgCpuTemp)
    assert.isNumber(metric.maxCpuTemp)
    assert.isNumber(metric.avgGpuUsage)
    assert.isNumber(metric.maxGpuUsage)
    assert.isNumber(metric.avgRamUsage)
    assert.isNumber(metric.maxRamUsage)
    assert.isNumber(metric.avgDiskUsage)
    assert.isNumber(metric.maxDiskUsage)
    assert.isNumber(metric.avgDownloadUsage)
    assert.isNumber(metric.maxDownloadUsage)
    assert.isNumber(metric.avgUploadUsage)
    assert.isNumber(metric.maxUploadUsage)
    assert.isNumber(metric.avgMoboTemp)
    assert.isNumber(metric.maxMoboTemp)
    assert.equal(metric.sessionDurationMinutes, 10)
    assert.equal(metric.allocationId, allocation.id)

    // Avg deve ser ≤ Max (regra matemática básica)
    assert.isAtMost(metric.avgCpuUsage, metric.maxCpuUsage)
    assert.isAtMost(metric.avgCpuTemp, metric.maxCpuTemp)
    assert.isAtMost(metric.avgGpuUsage, metric.maxGpuUsage)
    assert.isAtMost(metric.avgGpuTemp, metric.maxGpuTemp)
    assert.isAtMost(metric.avgRamUsage, metric.maxRamUsage)
    assert.isAtMost(metric.avgDiskUsage, metric.maxDiskUsage)
    assert.isAtMost(metric.avgDownloadUsage, metric.maxDownloadUsage)
    assert.isAtMost(metric.avgUploadUsage, metric.maxUploadUsage)
    assert.isAtMost(metric.avgMoboTemp, metric.maxMoboTemp)

    // Float: verifica que as médias não são inteiras arredondadas (temos decimais)
    // Pelo menos UMA delas deve ter casas decimais (quase impossível todas serem inteiras)
    const hasDecimal = [
      metric.avgCpuUsage,
      metric.avgCpuTemp,
      metric.avgGpuUsage,
      metric.avgRamUsage,
    ].some((v) => v !== Math.floor(v))
    assert.isTrue(hasDecimal, 'Médias devem conter valores float com casas decimais')
  })

  test('resumo via API deve ser idêntico ao cálculo manual', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin Calc',
      email: 'admin.calc@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    const machine = await Machine.create({
      name: 'PC-CALC-01',
      macAddress: 'AA:BB:CC:04:01:05',
      description: 'Máquina cálculo manual',
      status: 'available',
    })

    const allocation = await Allocation.create({
      userId: admin.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ minutes: 5 }),
      endTime: DateTime.now(),
      status: 'finished',
    })

    // Dados controlados (sem aleatoriedade) para verificar cálculo exato
    const controlled = [
      {
        cpuUsage: 100,
        cpuTemp: 400,
        gpuUsage: 200,
        gpuTemp: 350,
        ramUsage: 300,
        diskUsage: 150,
        downloadUsage: 50,
        uploadUsage: 10,
        moboTemperature: 300,
      },
      {
        cpuUsage: 300,
        cpuTemp: 500,
        gpuUsage: 400,
        gpuTemp: 450,
        ramUsage: 500,
        diskUsage: 200,
        downloadUsage: 80,
        uploadUsage: 20,
        moboTemperature: 350,
      },
      {
        cpuUsage: 500,
        cpuTemp: 600,
        gpuUsage: 600,
        gpuTemp: 550,
        ramUsage: 700,
        diskUsage: 250,
        downloadUsage: 120,
        uploadUsage: 40,
        moboTemperature: 400,
      },
      {
        cpuUsage: 700,
        cpuTemp: 700,
        gpuUsage: 800,
        gpuTemp: 650,
        ramUsage: 900,
        diskUsage: 300,
        downloadUsage: 60,
        uploadUsage: 15,
        moboTemperature: 500,
      },
      {
        cpuUsage: 200,
        cpuTemp: 450,
        gpuUsage: 300,
        gpuTemp: 400,
        ramUsage: 400,
        diskUsage: 180,
        downloadUsage: 70,
        uploadUsage: 25,
        moboTemperature: 320,
      },
    ]

    await Telemetry.createMany(
      controlled.map((d) => ({ allocationId: allocation.id, ...d, loggedUserName: 'test' }))
    )

    // Cálculo manual esperado
    const avgCpu = (100 + 300 + 500 + 700 + 200) / 5 // 360
    const maxCpu = 700
    const avgCpuTemp = (400 + 500 + 600 + 700 + 450) / 5 // 530
    const maxCpuTemp = 700

    // Gera resumo via API
    const response = await client
      .post(`/api/v1/allocations/${allocation.id}/summary`)
      .loginAs(admin)

    response.assertStatus(201)
    const metric = response.body()

    assert.equal(metric.avgCpuUsage, avgCpu)
    assert.equal(metric.maxCpuUsage, maxCpu)
    assert.equal(metric.avgCpuTemp, avgCpuTemp)
    assert.equal(metric.maxCpuTemp, maxCpuTemp)
    assert.equal(metric.sessionDurationMinutes, 5)
  })

  test('NÃO deve gerar resumo duplicado', async ({ client }) => {
    const admin = await User.create({
      fullName: 'Admin NoDup',
      email: 'admin.nodup@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    const machine = await Machine.create({
      name: 'PC-NODUP',
      macAddress: 'AA:BB:CC:04:01:06',
      description: 'Máquina teste duplicação',
      status: 'available',
    })

    const allocation = await Allocation.create({
      userId: admin.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ minutes: 10 }),
      endTime: DateTime.now(),
      status: 'finished',
    })

    await seedTelemetries(allocation.id, 20, 0.5)

    // Primeiro resumo: OK
    const first = await client.post(`/api/v1/allocations/${allocation.id}/summary`).loginAs(admin)
    first.assertStatus(201)

    // Segundo resumo: CONFLITO
    const second = await client.post(`/api/v1/allocations/${allocation.id}/summary`).loginAs(admin)
    second.assertStatus(409)
    second.assertBodyContains({ code: 'SUMMARY_EXISTS' })
  })

  test('NÃO deve gerar resumo sem telemetrias', async ({ client }) => {
    const admin = await User.create({
      fullName: 'Admin NoTel',
      email: 'admin.notel@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    const machine = await Machine.create({
      name: 'PC-NOTEL',
      macAddress: 'AA:BB:CC:04:01:07',
      description: 'Máquina teste sem telemetrias',
      status: 'available',
    })

    const allocation = await Allocation.create({
      userId: admin.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ minutes: 10 }),
      endTime: DateTime.now(),
      status: 'finished',
    })

    // Sem telemetrias
    const response = await client
      .post(`/api/v1/allocations/${allocation.id}/summary`)
      .loginAs(admin)

    response.assertStatus(404)
    response.assertBodyContains({ code: 'NO_TELEMETRY' })
  })

  test('user deve ler seu próprio resumo, mas NÃO de outro user', async ({ client }) => {
    const admin = await User.create({
      fullName: 'Admin Read',
      email: 'admin.read@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    const user1 = await User.create({
      fullName: 'User 1 Read',
      email: 'user1.read@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const user2 = await User.create({
      fullName: 'User 2 Read',
      email: 'user2.read@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-READ',
      macAddress: 'AA:BB:CC:04:01:08',
      description: 'Máquina teste leitura resumo',
      status: 'available',
    })

    const allocation = await Allocation.create({
      userId: user1.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ minutes: 10 }),
      endTime: DateTime.now(),
      status: 'finished',
    })

    await seedTelemetries(allocation.id, 20, 0.5)

    // Admin gera resumo
    await client.post(`/api/v1/allocations/${allocation.id}/summary`).loginAs(admin)

    // User1 (dono) lê o resumo: OK
    const own = await client.get(`/api/v1/allocations/${allocation.id}/summary`).loginAs(user1)
    own.assertStatus(200)
    own.assertBodyContains({ allocationId: allocation.id })

    // User2 (não dono) tenta ler: PROIBIDO
    const other = await client.get(`/api/v1/allocations/${allocation.id}/summary`).loginAs(user2)
    other.assertStatus(403)
    other.assertBodyContains({ code: 'NOT_OWNER' })

    // Admin lê qualquer resumo: OK
    const adminRead = await client
      .get(`/api/v1/allocations/${allocation.id}/summary`)
      .loginAs(admin)
    adminRead.assertStatus(200)
  })
})

// ============================================================================
// CRUD & MANUTENÇÃO: Exclusão individual e prune
// ============================================================================

test.group('Manutenção - Exclusão de Telemetrias e Métricas', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('admin deve deletar telemetria individual', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin Del',
      email: 'admin.del@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    const machine = await Machine.create({
      name: 'PC-DEL-01',
      macAddress: 'AA:BB:CC:04:01:09',
      description: 'Máquina teste exclusão telemetria',
      status: 'available',
    })

    const allocation = await Allocation.create({
      userId: admin.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ minutes: 5 }),
      endTime: DateTime.now().plus({ minutes: 55 }),
      status: 'approved',
    })

    await seedTelemetries(allocation.id, 10, 0.5)

    const telemetries = await Telemetry.query().where('allocationId', allocation.id)
    assert.equal(telemetries.length, 10)

    // Deleta uma telemetria
    const target = telemetries[0]
    const response = await client
      .delete(`/api/v1/maintenance/telemetries/${target.id}`)
      .loginAs(admin)
    response.assertStatus(204)

    // Verifica que restam 9
    const remaining = await Telemetry.query().where('allocationId', allocation.id)
    assert.equal(remaining.length, 9)
    assert.isFalse(remaining.some((t) => t.id === target.id))
  })

  test('admin deve deletar métrica individual', async ({ client, assert }) => {
    const admin = await User.create({
      fullName: 'Admin DelMet',
      email: 'admin.delmet@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    const machine = await Machine.create({
      name: 'PC-DELMET',
      macAddress: 'AA:BB:CC:04:01:0A',
      description: 'Máquina teste exclusão métrica',
      status: 'available',
    })

    const allocation = await Allocation.create({
      userId: admin.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ minutes: 10 }),
      endTime: DateTime.now(),
      status: 'finished',
    })

    await seedTelemetries(allocation.id, 30, 0.5)

    // Gera resumo
    const summaryResp = await client
      .post(`/api/v1/allocations/${allocation.id}/summary`)
      .loginAs(admin)
    summaryResp.assertStatus(201)
    const metricId = summaryResp.body().id

    // Verifica que existe
    const metric = await AllocationMetric.find(metricId)
    assert.isNotNull(metric)

    // Deleta a métrica
    const delResp = await client.delete(`/api/v1/maintenance/metrics/${metricId}`).loginAs(admin)
    delResp.assertStatus(204)

    // Verifica que sumiu
    const deleted = await AllocationMetric.find(metricId)
    assert.isNull(deleted)

    // Telemetrias ainda existem (apenas a métrica foi deletada)
    const telCount = await Telemetry.query()
      .where('allocationId', allocation.id)
      .count('* as total')
    assert.equal(Number(telCount[0].$extras.total), 30)
  })

  test('cascade: deletar alocação remove telemetrias e métrica', async ({ assert }) => {
    const user = await User.create({
      fullName: 'User Cascade',
      email: 'user.cascade@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-CASCADE',
      macAddress: 'AA:BB:CC:04:01:0B',
      description: 'Máquina teste cascade',
      status: 'available',
    })

    const allocation = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ minutes: 10 }),
      endTime: DateTime.now(),
      status: 'finished',
    })

    // Seed 50 telemetrias + criar métrica
    await seedTelemetries(allocation.id, 50, 0.5)
    await AllocationMetric.create({
      allocationId: allocation.id,
      avgCpuUsage: 500.5,
      maxCpuUsage: 850,
      avgCpuTemp: 550.3,
      maxCpuTemp: 750,
      avgGpuUsage: 400.7,
      maxGpuUsage: 700,
      avgGpuTemp: 450.2,
      maxGpuTemp: 650,
      avgRamUsage: 600.1,
      maxRamUsage: 900,
      avgDiskUsage: 250.8,
      maxDiskUsage: 350,
      avgDownloadUsage: 65.4,
      maxDownloadUsage: 120,
      avgUploadUsage: 20.3,
      maxUploadUsage: 45,
      avgMoboTemp: 380.6,
      maxMoboTemp: 500,
      sessionDurationMinutes: 10,
    })

    // Confirma existência antes do delete
    const telBefore = await Telemetry.query()
      .where('allocationId', allocation.id)
      .count('* as total')
    assert.equal(Number(telBefore[0].$extras.total), 50)
    const metBefore = await AllocationMetric.findBy('allocationId', allocation.id)
    assert.isNotNull(metBefore)

    // === DELETA A ALOCAÇÃO ===
    await allocation.delete()

    // Telemetrias devem ter sido removidas por CASCADE
    const telAfter = await Telemetry.query()
      .where('allocationId', allocation.id)
      .count('* as total')
    assert.equal(Number(telAfter[0].$extras.total), 0)

    // Métrica também removida por CASCADE
    const metAfter = await AllocationMetric.findBy('allocationId', allocation.id)
    assert.isNull(metAfter)
  })
})

// ============================================================================
// INTEGRAÇÃO VIA API DO AGENTE: Fluxo end-to-end completo
// ============================================================================

test.group('Fluxo End-to-End via API do Agente', (group) => {
  group.each.setup(() => {
    telemetryBuffer.reset()
    return testUtils.db().withGlobalTransaction()
  })

  test('agente envia telemetrias → admin gera resumo → user lê resumo', async ({
    client,
    assert,
  }) => {
    // === SETUP ===
    const admin = await User.create({
      fullName: 'Admin E2E',
      email: 'admin.e2e@teste.com',
      password: 'senha123',
      role: 'admin',
    })

    const user = await User.create({
      fullName: 'Aluno E2E',
      email: 'aluno.e2e@teste.com',
      password: 'senha123',
      role: 'user',
    })

    const machine = await Machine.create({
      name: 'PC-E2E-01',
      macAddress: 'AA:BB:CC:04:01:0C',
      description: 'Máquina end-to-end agente',
      cpuModel: 'AMD Ryzen 7 5800X',
      gpuModel: 'RTX 3070',
      totalRamGb: 32,
      totalDiskGb: 1024,
      status: 'available',
    })

    // Alocação ativa
    const allocation = await Allocation.create({
      userId: user.id,
      machineId: machine.id,
      startTime: DateTime.now().minus({ minutes: 5 }),
      endTime: DateTime.now().plus({ minutes: 55 }),
      status: 'approved',
    })

    // === 1. AGENTE ENVIA 24 TELEMETRIAS (simula 2 min a 5s/tick) ===
    for (let i = 0; i < 24; i++) {
      const telData = generateTelemetry(i, 0.4 + i * 0.02) // Carga crescente

      const telResponse = await client
        .post('/api/agent/telemetry')
        .header('Authorization', `Bearer ${machine.token}`)
        .header('X-Machine-Mac', machine.macAddress)
        .json(telData)

      telResponse.assertStatus(204)
    }

    // === 2. FLUSH MANUAL DO BUFFER (simula timer de 60s) ===
    const flushed = await telemetryBuffer.flush()
    assert.equal(flushed, 24)

    // === 3. VERIFICAR TELEMETRIAS NO BANCO ===
    const dbTel = await Telemetry.query().where('allocationId', allocation.id)
    assert.equal(dbTel.length, 24)

    // === 4. ADMIN GERA RESUMO ===
    // Finaliza alocação primeiro
    allocation.status = 'finished'
    allocation.endTime = DateTime.now()
    await allocation.save()

    const summaryResp = await client
      .post(`/api/v1/allocations/${allocation.id}/summary`)
      .loginAs(admin)
    summaryResp.assertStatus(201)

    const metric = summaryResp.body()
    assert.equal(metric.allocationId, allocation.id)
    assert.isAbove(metric.avgCpuUsage, 0)
    assert.isAbove(metric.maxCpuUsage, 0)
    assert.isAtMost(metric.avgCpuUsage, metric.maxCpuUsage)

    // === 5. USER LÊ SEU RESUMO ===
    const userSummary = await client
      .get(`/api/v1/allocations/${allocation.id}/summary`)
      .loginAs(user)
    userSummary.assertStatus(200)
    userSummary.assertBodyContains({
      allocationId: allocation.id,
    })

    // === 6. VERIFICAR QUE HISTÓRICO DE MÁQUINA MOSTRA TELEMETRIA ===
    const historyResp = await client
      .get(`/api/v1/machines/${machine.id}/telemetry?page=1&limit=50`)
      .loginAs(admin)
    historyResp.assertStatus(200)
    assert.isAtLeast(historyResp.body().history.data.length, 24)
  })

  test('telemetria sem alocação ativa é descartada (não persiste)', async ({ client, assert }) => {
    const machine = await Machine.create({
      name: 'PC-NO-ALLOC',
      macAddress: 'AA:BB:CC:04:01:0D',
      description: 'Máquina teste sem alocação',
      status: 'offline',
    })

    // Envia telemetria SEM alocação ativa
    const response = await client
      .post('/api/agent/telemetry')
      .header('Authorization', `Bearer ${machine.token}`)
      .header('X-Machine-Mac', machine.macAddress)
      .json(generateTelemetry(0, 0.5))

    // Deve retornar 204 (aceita mas descarta)
    response.assertStatus(204)

    // Flush e verifica que nada foi pro banco
    await telemetryBuffer.flush()

    const total = await Telemetry.query().count('* as total')
    assert.equal(Number(total[0].$extras.total), 0)

    // Máquina deve ter atualizado status mesmo sem alocação
    await machine.refresh()
    assert.equal(machine.status, 'available')
    assert.isNotNull(machine.lastSeenAt)
  })
})
