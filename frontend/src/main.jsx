import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "./styles/theme.css";
import "./styles/layout.css";
import "./styles/panels.css";
import "./styles/charts.css";
import "./styles/extras.css";
import "./styles/ml.css";
import "./styles/overview.css";
import "./styles/explainer.css";
import "./styles/events.css";
import "./styles/ledger.css";
import "./styles/lapse.css";
import "./styles/shell.css";
import "./styles/motion.css";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { applyTheme, savedTheme } from "./lib/theme.js";

applyTheme(savedTheme()); // before the first paint, so the page never flashes the wrong colours

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
