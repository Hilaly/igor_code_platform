import "@sovereign/ui-kit/styles.css";
import "./shell/shell.css";
import "./login/login.css";
import "./projects/projects.css";
import "./providers/providers.css";
import "./sessions/sessions.css";
import "./settings/settings.css";

import { trackInputModality } from "@sovereign/ui-kit";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";
import { registerHostModules } from "./plugins/host-modules.ts";

// До рендера, а значит и до любого `import()` бандла плагина: заглушка внутри бандла читает реестр
// в момент загрузки модуля и без него бросает ошибку (docs/ui-extension-model.md).
registerHostModules();

const container = document.getElementById("root");
if (!container) {
  throw new Error("root container is missing in index.html");
}

const stopTrackingInputModality = trackInputModality(document);
if (import.meta.hot) {
  import.meta.hot.dispose(stopTrackingInputModality);
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
