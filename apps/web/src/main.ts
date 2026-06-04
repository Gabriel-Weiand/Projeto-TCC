import { createApp } from "vue";
import { createPinia } from "pinia";
import router from "./router";
import App from "./App.vue";
import "./assets/main.css";
import "./assets/allocation-list.css";
import { startTimeSync } from "./services/timeSync";
import { useLabConfigStore } from "./stores/labConfig";
import { useAuthStore } from "./stores/auth";

const pinia = createPinia();
const app = createApp(App);
app.use(pinia);
app.use(router);

const labConfig = useLabConfigStore(pinia);
const auth = useAuthStore(pinia);

void Promise.all([
  labConfig.fetchConfig().then(() => labConfig.refreshToday()),
  auth.bootstrapSession(),
]).finally(() => {
  app.mount("#app");
  startTimeSync();
});
