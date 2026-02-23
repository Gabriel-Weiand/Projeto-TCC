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
          path: "machines",
          name: "machines",
          component: () => import("@/views/MachinesView.vue"),
        },
        {
          path: "profile",
          name: "profile",
          component: () => import("@/views/ProfileView.vue"),
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
});

export default router;
