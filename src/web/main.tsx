import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { BootSequence } from "./BootSequence";
import "./styles.css";
import "./revamp.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BootSequence />
    <App />
  </StrictMode>,
);
