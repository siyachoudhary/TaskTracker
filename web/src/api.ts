// web/src/api.ts
import axios from "axios";

/**
 * Base URL resolution:
 * - Prefer Vite env (web/.env*).
 * - Fallback: localhost:4000 for dev.
 * - (Optional) production guess: swap app->api subdomain.
 */
const fromEnv = import.meta.env.VITE_API_BASE as string | undefined;

const fallbackDev =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:4000"
    : undefined;

const prodGuess = (() => {
  const host = window.location.host; // e.g. app.example.com
  if (host.startsWith("app.")) return `${window.location.protocol}//api.${host.slice(4)}`;
  return undefined;
})();

const baseURL = fromEnv || fallbackDev || prodGuess || window.location.origin;

export const api = axios.create({
  baseURL,
  withCredentials: true, // send/receive cookies
  headers: { "Content-Type": "application/json" },
});

// Optional: tiny logger to help spot wrong base URLs
api.interceptors.request.use((cfg) => {
  // console.debug("[api]", cfg.method?.toUpperCase(), (cfg.baseURL || "") + (cfg.url || ""));
  return cfg;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // If you want, handle 401s here (e.g., redirect to /)
    return Promise.reject(err);
  }
);