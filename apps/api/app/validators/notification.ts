import vine from '@vinejs/vine'

export const createNotificationValidator = vine.compile(
  vine.object({
    userId: vine.number().positive(),
    title: vine.string().trim().minLength(3).maxLength(120),
    message: vine.string().trim().minLength(5).maxLength(2000),
  })
)

export const markNotificationReadValidator = vine.compile(
  vine.object({
    isRead: vine.boolean(),
  })
)
