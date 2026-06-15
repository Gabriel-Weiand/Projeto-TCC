import type { HttpContext } from '@adonisjs/core/http'
import Allocation from '#models/allocation'
import Notification from '#models/notification'
import AllocationPolicy from '#policies/allocation_policy'
import {
  createAllocationValidator,
  updateAllocationValidator,
  listAllocationsValidator,
  extendAllocationValidator,
} from '#validators/allocation'
import { AllocationService } from '#services/allocation/allocation_service'

export default class AllocationsController {
  async myAllocations({ auth, request, response }: HttpContext) {
    const filters = await request.validateUsing(listAllocationsValidator)
    const result = await AllocationService.listMyAllocations(auth.user!, filters)
    return response.ok(result)
  }

  async index({ auth, request, response }: HttpContext) {
    const filters = await request.validateUsing(listAllocationsValidator)
    const result = await AllocationService.listAllocations(auth.user!, filters)
    return response.ok(result)
  }

  async store({ auth, request, response }: HttpContext) {
    const data = await request.validateUsing(createAllocationValidator)
    const allocation = await AllocationService.createAllocation(auth.user!, data)
    return response.created(allocation)
  }

  async extend({ auth, bouncer, params, request, response }: HttpContext) {
    const allocation = await Allocation.findOrFail(params.id)
    await bouncer.with(AllocationPolicy).authorize('extend', allocation)

    const payload = await request.validateUsing(extendAllocationValidator)
    const result = await AllocationService.extendAllocation(auth.user!, Number(params.id), payload)
    return response.ok(result)
  }

  async finish({ auth, bouncer, params, response }: HttpContext) {
    const allocation = await Allocation.findOrFail(params.id)
    await bouncer.with(AllocationPolicy).authorize('finish', allocation)

    const result = await AllocationService.finishAllocation(auth.user!, Number(params.id))
    return response.ok(result)
  }

  async update({ auth, bouncer, params, request, response }: HttpContext) {
    const allocation = await Allocation.findOrFail(params.id)
    await bouncer.with(AllocationPolicy).authorize('update', allocation)

    const data = await request.validateUsing(updateAllocationValidator)
    const result = await AllocationService.updateAllocation(auth.user!, Number(params.id), data)
    return response.ok(result)
  }

  async softDelete({ auth, bouncer, params, response }: HttpContext) {
    const allocation = await Allocation.findOrFail(params.id)
    await bouncer.with(AllocationPolicy).authorize('delete', allocation)

    const result = await AllocationService.softDeleteAllocation(auth.user!, Number(params.id))
    return response.ok(result)
  }

  async machineHistory({ auth, params, request, response }: HttpContext) {
    const { page = 1, limit = 20 } = request.qs()
    const result = await AllocationService.machineHistory(
      auth.user!,
      Number(params.id),
      Number(page),
      Number(limit)
    )
    return response.ok(result)
  }

  async summarizeSession({ bouncer, params, response }: HttpContext) {
    await bouncer.authorize('isAdmin')

    const metric = await AllocationService.summarizeSession(Number(params.id))
    return response.created(metric)
  }

  async getSessionSummary({ bouncer, params, response }: HttpContext) {
    const allocation = await Allocation.findOrFail(params.id)
    await bouncer.with(AllocationPolicy).authorize('viewSummary', allocation)

    const metric = await AllocationService.getSessionSummary(Number(params.id))
    return response.ok(metric)
  }
}
