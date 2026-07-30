import "@sovereign/ui-kit/styles.css";
import "./shell/shell.css";
import "./login/login.css";
import "./projects/projects.css";
import "./providers/providers.css";
import "./sessions/sessions.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";

const container = document.getElementById("root");
if (!container) {
  throw new Error("root container is missing in index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
