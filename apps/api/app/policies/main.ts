/*
|--------------------------------------------------------------------------
| Bouncer policies
|--------------------------------------------------------------------------
|
| Políticas pré-registradas — referenciáveis por string em controllers e Edge.
|
*/

export const policies = {
  AllocationPolicy: () => import('#policies/allocation_policy'),
  NotificationPolicy: () => import('#policies/notification_policy'),
}
