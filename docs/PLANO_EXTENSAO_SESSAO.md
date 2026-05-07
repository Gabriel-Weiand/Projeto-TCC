# Plano: Extensão de Sessão (Alocação em Andamento)

## Diagnóstico da API atual

### O que já existe

| Componente | Status |
|---|---|
| `PATCH /api/v1/allocations/:id` | Existe — usado pelo admin para alterar qualquer campo |
| `updateAllocationValidator` | Aceita `startTime` e `endTime` opcionais |
| Verificação de conflito no `store()` | Existe — gap de 5 min entre alocações |
| `shouldBlock` no heartbeat | Lê `endTime` diretamente do banco |
| `SshSession.expiresAt` | Campo existe — vinculado ao `allocation.endTime` original |

### O que bloqueia o usuário hoje

Em `AllocationsController.update()`, linha responsável pela restrição:

```typescript
// User normal não pode alterar horários
if (data.startTime || data.endTime) {
  return response.forbidden({
    code: 'CANNOT_CHANGE_TIME',
    message: 'Você não pode alterar os horários da alocação.',
  })
}
```

O PATCH geral não pode ser relaxado para isso sem risco — ele mistura alteração de status, de horário e de motivo num único endpoint sem distinção de intenção. Portanto, **um endpoint dedicado é a abordagem correta**.

### O que falta

1. **Endpoint de extensão** — nenhum existe
2. **Validator específico** — `updateAllocationValidator` não tem regras de extensão
3. **Verificação de conflito no update** — o PATCH atual não checa sobreposição
4. **Atualização do `SshSession.expiresAt`** — se a sessão SSH estiver ativa, precisa refletir o novo fim

---

## O que NÃO precisa mudar

- **Agente Python**: o heartbeat lê `endTime` direto do banco via `currentAllocation` — após a extensão o agente receberá o novo horário na próxima chamada (≤5s).
- **Lógica de cgroup**: o cgroup libera recursos quando `endTime` passa — como agora `endTime` é mais tarde, o desbloqueio ocorre no momento certo sem alteração.
- `machineCache`: invalidado quando `loggedUser` ou `status` mudam — a extensão não muda nenhum dos dois, o cache expira naturalmente em 5 min, o que é aceitável.
- `shouldBlock` no heartbeat: compara `now < endTime` — com o novo endTime no banco, automaticamente correto.

---

## Modificações necessárias

### 1. Validator — `apps/api/app/validators/allocation.ts`

Adicionar ao final do arquivo:

```typescript
/**
 * Validator para extensão de alocação em andamento.
 * Só aceita o novo horário de fim — nada mais pode mudar.
 */
export const extendAllocationValidator = vine.compile(
  vine.object({
    newEndTime: vine
      .date({ formats: ['iso8601'] })
      .transform((value) => DateTime.fromJSDate(value)),
  })
)
```

### 2. Controller — `apps/api/app/controllers/allocations_controller.ts`

Adicionar import do novo validator e novo método `extend`:

```typescript
import {
  createAllocationValidator,
  updateAllocationValidator,
  extendAllocationValidator,  // novo
  listAllocationsValidator,
} from '#validators/allocation'
```

Novo método a adicionar na classe `AllocationsController`:

```typescript
/**
 * Estende o horário de fim de uma alocação em andamento.
 *
 * Regras:
 * - Somente o dono pode estender sua própria alocação (admin pode estender qualquer uma)
 * - A alocação deve estar ativa no momento (status 'approved', já começou, ainda não terminou)
 * - O novo fim deve ser após o fim atual (não é redução, é extensão)
 * - Extensão máxima: 24h além do fim atual
 * - Não pode conflitar com a próxima alocação aprovada/pendente da mesma máquina
 *   (respeitando o gap mínimo de 5 minutos)
 *
 * POST /api/v1/allocations/:id/extend
 */
async extend({ auth, params, request, response }: HttpContext) {
  const user = auth.user!
  const allocation = await Allocation.findOrFail(params.id)

  // Verificar propriedade
  if (user.role !== 'admin' && allocation.userId !== user.id) {
    return response.forbidden({
      code: 'NOT_OWNER',
      message: 'Você só pode estender suas próprias alocações.',
    })
  }

  // Verificar se a alocação está ativa agora
  const now = DateTime.now().toMillis()
  const startMs = allocation.startTime.toMillis()
  const currentEndMs = allocation.endTime.toMillis()

  if (allocation.status !== 'approved' || now < startMs || now >= currentEndMs) {
    return response.badRequest({
      code: 'ALLOCATION_NOT_ACTIVE',
      message: 'Só é possível estender alocações em andamento.',
    })
  }

  const { newEndTime } = await request.validateUsing(extendAllocationValidator)
  const newEndMs = newEndTime.toMillis()

  // Novo fim deve ser após o fim atual
  if (newEndMs <= currentEndMs) {
    return response.badRequest({
      code: 'INVALID_EXTENSION',
      message: 'O novo horário de fim deve ser após o horário atual de término.',
    })
  }

  // Limite máximo de extensão: 24 horas além do fim atual
  const MAX_EXTENSION_MS = 24 * 60 * 60 * 1000
  if (newEndMs - currentEndMs > MAX_EXTENSION_MS) {
    return response.badRequest({
      code: 'EXTENSION_TOO_LONG',
      message: 'A extensão não pode ultrapassar 24 horas além do fim atual.',
    })
  }

  // Verificar conflito com alocações subsequentes na mesma máquina
  const GAP_MS = 5 * 60 * 1000
  const nextAllocation = await Allocation.query()
    .where('machineId', allocation.machineId)
    .whereIn('status', ['approved', 'pending'])
    .where('id', '!=', allocation.id)
    .where('startTime', '>', allocation.endTime.toSQL()!) // só posteriores
    .orderBy('startTime', 'asc')
    .first()

  if (nextAllocation) {
    const nextStartMs = nextAllocation.startTime.toMillis()
    if (newEndMs + GAP_MS > nextStartMs) {
      return response.conflict({
        code: 'EXTENSION_CONFLICT',
        message: 'A extensão conflita com uma alocação posterior nesta máquina.',
        nextAllocationStart: nextAllocation.startTime.toISO(),
        maxExtensionTime: DateTime.fromMillis(nextStartMs - GAP_MS).toISO(),
      })
    }
  }

  // Aplicar extensão
  allocation.endTime = newEndTime
  await allocation.save()

  // Atualizar SshSession ativa se existir (expiresAt deve seguir o novo endTime)
  const activeSshSession = await SshSession.query()
    .where('allocationId', allocation.id)
    .where('status', 'active')
    .first()

  if (activeSshSession) {
    activeSshSession.expiresAt = newEndTime
    await activeSshSession.save()
  }

  await allocation.load('machine')
  await allocation.load('user')

  return response.ok({
    ...allocation.serialize(),
    extended: true,
    previousEndTime: DateTime.fromMillis(currentEndMs).toISO(),
  })
}
```

### 3. Rotas — `apps/api/start/routes.ts`

Adicionar a nova rota dentro do grupo de alocações autenticadas (junto das rotas gerais de alocações):

```typescript
// Dentro do grupo .prefix('allocations').where('id', router.matchers.number())
router
  .post('/:id/extend', [AllocationsController, 'extend'])
  .as('allocations.extend')
```

O grupo atual ficará:

```typescript
router
  .group(() => {
    router.post('/', [AllocationsController, 'store']).as('allocations.store')
    router.get('/', [AllocationsController, 'index']).as('allocations.index')
    router.patch('/:id', [AllocationsController, 'update']).as('allocations.update')
    router.delete('/:id', [AllocationsController, 'softDelete']).as('allocations.softDelete')
    router.get('/:id/summary', [AllocationsController, 'getSessionSummary']).as('allocations.summary.show')
    router.post('/:id/extend', [AllocationsController, 'extend']).as('allocations.extend')     // NOVO
    router.post('/:id/ssh-access', [AllocationsController, 'requestSshAccess']).as('allocations.sshAccess')
  })
  .prefix('allocations')
  .where('id', router.matchers.number())
```

---

## Respostas da API

### Sucesso — HTTP 200

```json
{
  "id": 42,
  "startTime": "2026-05-06T10:00:00.000Z",
  "endTime": "2026-05-06T18:00:00.000Z",
  "status": "approved",
  "extended": true,
  "previousEndTime": "2026-05-06T14:00:00.000Z",
  "...outros campos da alocação"
}
```

### Erros possíveis

| HTTP | `code` | Situação |
|---|---|---|
| 400 | `ALLOCATION_NOT_ACTIVE` | Alocação não está em andamento |
| 400 | `INVALID_EXTENSION` | `newEndTime` ≤ `endTime` atual |
| 400 | `EXTENSION_TOO_LONG` | Extensão > 24h |
| 403 | `NOT_OWNER` | Usuário não é o dono |
| 404 | — | Alocação não existe |
| 409 | `EXTENSION_CONFLICT` | Conflito com próxima alocação (inclui `maxExtensionTime`) |

O erro 409 inclui `maxExtensionTime` para que o frontend pré-preencha o seletor com o máximo permitido.

---

## Frontend

### Onde exibir o botão

Em `MachineDetailView.vue` (visão do usuário), dentro da seção de alocação ativa.

Condição para exibir:
```typescript
const canExtend = computed(() =>
  currentAllocation.value !== null &&
  currentAllocation.value.status === 'approved' &&
  new Date(currentAllocation.value.startTime) <= new Date() &&
  new Date(currentAllocation.value.endTime) > new Date()
)
```

### Comportamento do modal

1. Abre com um `datetime-local` pré-preenchido com `endTime` atual + 1 hora (sugestão inicial)
2. Não permite selecionar data anterior ao `endTime` atual (atributo `min` no input)
3. Ao confirmar, chama `POST /api/v1/allocations/:id/extend` com `{ newEndTime: ISO }`
4. Em caso de erro 409, exibe a `maxExtensionTime` retornada e preenche automaticamente o campo com esse valor
5. Em caso de sucesso, atualiza o estado local da alocação sem reload de página

### Serviço (apps/web/src/services/)

```typescript
// Em allocations.ts ou arquivo novo extend-allocation.ts
export async function extendAllocation(
  allocationId: number,
  newEndTime: string  // ISO 8601
): Promise<Allocation> {
  const { data } = await api.post(`/allocations/${allocationId}/extend`, { newEndTime })
  return data
}
```

---

## Ordem de implementação

1. `extendAllocationValidator` em `validators/allocation.ts`
2. Método `extend()` em `allocations_controller.ts`
3. Rota `POST /allocations/:id/extend` em `routes.ts`
4. Testes funcionais (ver seção abaixo)
5. Serviço frontend + modal

## Testes a adicionar (`tests/functional/allocations.spec.ts`)

| Caso | Resultado esperado |
|---|---|
| Usuário estende sua alocação ativa por 2h | 200, `endTime` atualizado, `extended: true` |
| Usuário estende além do limite de 24h | 400 `EXTENSION_TOO_LONG` |
| `newEndTime` antes do `endTime` atual | 400 `INVALID_EXTENSION` |
| Alocação ainda não começou | 400 `ALLOCATION_NOT_ACTIVE` |
| Alocação já terminou | 400 `ALLOCATION_NOT_ACTIVE` |
| Extensão conflita com próxima alocação | 409 com `maxExtensionTime` |
| Extensão sem conflito — `maxExtensionTime` é respeitado | 200 |
| Usuário tenta estender alocação de outro | 403 `NOT_OWNER` |
| Admin estende alocação de qualquer usuário | 200 |
| Com sessão SSH ativa: `SshSession.expiresAt` atualizado | Verificar no banco |
