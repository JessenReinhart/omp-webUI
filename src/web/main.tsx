import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { BootSequence } from "./BootSequence";
import "./styles.css";
import "./revamp.css";
import "./workspace-v2.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BootSequence />
    <App />
  </StrictMode>,
);
