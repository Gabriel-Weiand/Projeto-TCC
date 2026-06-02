import { createApp } from "vue";
import { createPinia } from "pinia";
import router from "./router";
import App from "./App.vue";
import "./assets/main.css";
import { startTimeSync } from "./services/timeSync";
import { useLabConfigStore } from "./stores/labConfig";

const pinia = createPinia();
const app = createApp(App);
app.use(pinia);
app.use(router);

const labConfig = useLabConfigStore(pinia);
void labConfig.fetchConfig().then(() => labConfig.refreshToday());

app.mount("#app");

startTimeSync();
