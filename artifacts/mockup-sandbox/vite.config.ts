import { defineConfig, type ConfigEnv, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin";

export default defineConfig(async ({ command }: ConfigEnv): Promise<UserConfig> => {
  const rawPort = process.env.PORT;

  // PORT and BASE_PATH are only required when running the dev server.
  // During `vite build` they are not available and not needed.
  if (command === "serve" && !rawPort) {
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }

  const port = Number(rawPort ?? 3000);

  if (rawPort && (Number.isNaN(port) || port <= 0)) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  const basePath = process.env.BASE_PATH;

  if (command === "serve" && !basePath) {
    throw new Error(
      "BASE_PATH environment variable is required but was not provided.",
    );
  }

  return {
    base: basePath ?? "/",
    plugins: [mockupPreviewPlugin(), react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
      },
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist"),
      emptyOutDir: true,
    },
    server: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
      fs: {
        strict: true,
      },
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});
