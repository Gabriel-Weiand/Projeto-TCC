import User from '#models/user'
import { notifySshKeyRequired } from '#services/notification/notification_service'
import type { Infer } from '@vinejs/vine/types'
import type { registerValidator } from '#validators/auth_user'
import type { updateUserValidator } from '#validators/user'

type RegisterPayload = Infer<typeof registerValidator>
type UpdateUserPayload = Infer<typeof updateUserValidator>

export const UserService = {
  async listUsers() {
    return User.query().orderBy('fullName', 'asc')
  },

  async createUser(payload: RegisterPayload) {
    const user = await User.create(payload)
    await notifySshKeyRequired(user.id)
    return user
  },

  async updateUserByAdmin(userId: number, data: UpdateUserPayload) {
    const targetUser = await User.findOrFail(userId)

    const patch: Pick<UpdateUserPayload, 'password' | 'role'> = {}
    if (data.password) patch.password = data.password
    if (data.role !== undefined) patch.role = data.role

    targetUser.merge(patch)
    await targetUser.save()
    return targetUser
  },

  async updateOwnProfile(user: User, data: UpdateUserPayload) {
    if (data.role && data.role !== user.role) {
      delete data.role
    }

    user.merge(data)
    await user.save()
    return user
  },

  async updateSshKey(user: User, sshPublicKey: string) {
    user.sshPublicKey = sshPublicKey
    await user.save()
    return user
  },

  async deleteUser(userId: number) {
    const user = await User.findOrFail(userId)
    await user.delete()
  },
}
