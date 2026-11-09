/**
 * Where anonymous results go and where the shared stats come from (a Cloudflare Worker; see
 * worker/). Set at build time with VITE_COMMUNITY_URL. Empty = sharing and stats are off.
 */
export const COMMUNITY_URL: string = ((import.meta.env.VITE_COMMUNITY_URL as string | undefined) ?? "").replace(/\/$/, "");
export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
