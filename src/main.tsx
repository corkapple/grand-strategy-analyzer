import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

if ((import.meta.env.DEV || import.meta.env.MODE === "docs") && new URLSearchParams(location.search).has("shot")) {
  void import("./dev/shots"); // documentation screenshots only; stripped from release builds
} else
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
