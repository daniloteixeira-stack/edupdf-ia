// Detecta se o app roda empacotado no Windows (Tauri) ou no navegador.
export const IS_DESKTOP =
  import.meta.env.VITE_PLATFORM === "desktop" ||
  (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window);

export const PLATFORM: "desktop" | "web" = IS_DESKTOP ? "desktop" : "web";

export const DESKTOP_DOWNLOAD_URL = import.meta.env.VITE_DESKTOP_DOWNLOAD_URL || "";
