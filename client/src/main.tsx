import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { AppProviders } from "@/providers/AppProviders";
import { GlobalErrorBanner } from "@/components/business/GlobalErrorBanner";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders>
      <GlobalErrorBanner />
      <App />
    </AppProviders>
  </StrictMode>,
);
