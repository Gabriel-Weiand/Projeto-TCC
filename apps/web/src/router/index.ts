import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/login",
      name: "login",
      component: () => import("@/views/LoginView.vue"),
      meta: { guest: true },
    },
    {
      path: "/",
      component: () => import("@/layouts/AppLayout.vue"),
      meta: { requiresAuth: true },
      children: [
        {
          path: "",
          name: "home",
          component: () => import("@/views/HomeView.vue"),
        },
        {
          path: "my-allocations",
          name: "my-allocations",
          component: () => import("@/views/MyAllocationsView.vue"),
        },
        {
          path: "machines",
          name: "machines",
          component: () => import("@/views/MachinesView.vue"),
        },
        {
          path: "machines/:id",
          name: "machine-detail",
          component: () => import("@/views/MachineDetailView.vue"),
          props: true,
        },
        {
          path: "profile",
          name: "profile",
          component: () => import("@/views/ProfileView.vue"),
        },

        // Admin routes
        {
          path: "admin",
          name: "admin-dashboard",
          component: () => import("@/views/admin/AdminDashboardView.vue"),
          meta: { admin: true },
        },
        {
          path: "admin/users",
          name: "admin-users",
          component: () => import("@/views/admin/AdminUsersView.vue"),
          meta: { admin: true },
        },
        {
          path: "admin/machines",
          name: "admin-machines",
          component: () => import("@/views/admin/AdminMachinesView.vue"),
          meta: { admin: true },
        },
        {
          path: "admin/machines/:id",
          redirect: (to) => ({
            name: "machine-detail",
            params: { id: to.params.id },
            query: { from: "admin" },
          }),
        },
        {
          path: "admin/machines/:id/edit",
          name: "admin-machine-edit",
          component: () => import("@/views/admin/AdminMachineEditView.vue"),
          meta: { admin: true },
          props: true,
        },
        {
          path: "admin/allocations",
          name: "admin-allocations",
          component: () => import("@/views/admin/AdminAllocationsView.vue"),
          meta: { admin: true },
        },
        {
          path: "admin/maintenance",
          name: "admin-maintenance",
          component: () => import("@/views/admin/AdminMaintenanceView.vue"),
          meta: { admin: true },
        },
        {
          path: "admin/lab-telemetry",
          redirect: { name: "admin-maintenance", query: { tab: "telemetria" } },
        },
      ],
    },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  auth.loadFromStorage();

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: "login" };
  }

  if (to.meta.guest && auth.isAuthenticated) {
    return { name: "home" };
  }

  if (to.meta.admin && !auth.isAdmin) {
    return { name: "home" };
  }
});

export default router;
