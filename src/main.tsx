import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { SessionProvider } from "./lib/session";
import { ToastHost } from "./ui";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SessionProvider>
      <ToastHost>
        <App />
      </ToastHost>
    </SessionProvider>
  </StrictMode>,
);
