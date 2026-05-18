import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ThemeProvider } from "@/contexts/ThemeContext";

const root = document.getElementById("root");

if (!root) {
  document.body.innerHTML = '<div style="min-height:100vh;background:#050505;color:#fff;display:grid;place-items:center;font-family:Inter,system-ui,sans-serif">Falha ao iniciar o app.</div>';
} else {
  createRoot(root).render(
    <React.StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </React.StrictMode>
  );
}
