import vine from '@vinejs/vine'

export const markNotificationReadValidator = vine.compile(
  vine.object({
    isRead: vine.boolean(),
  })
)
