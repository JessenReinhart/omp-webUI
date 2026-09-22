import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { BootSequence } from "./BootSequence";
import { ThemeProvider } from "./themeContext";
import "./styles.css";
import "./awwwards.css";
import "./plugin-registrations";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <BootSequence />
      <App />
    </ThemeProvider>
  </StrictMode>,
);
