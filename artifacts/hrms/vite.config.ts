import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type ConfigEnv } from 'vite';

export default defineConfig(async ({ command }: ConfigEnv) => {
  const rawPort = process.env.PORT;

  // PORT is only required when running the dev server.
  // During `vite build` it is not available and not needed.
  if (command === 'serve' && !rawPort) {
    throw new Error(
      'PORT environment variable is required but was not provided.',
    );
  }

  const port = Number(rawPort ?? 3000);

  if (rawPort && (Number.isNaN(port) || port <= 0)) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  const basePath = process.env.BASE_PATH ?? '/';

  return {
    base: basePath,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
        '@assets': path.resolve(
          import.meta.dirname,
          '..',
          '..',
          'attached_assets',
        ),
      },
      dedupe: ['react', 'react-dom'],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist/public'),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      host: '0.0.0.0',
      allowedHosts: true,
      fs: {
        strict: true,
      },
      // Dev-only: the frontend calls relative `/api/...` paths (see
      // lib/api-client-react/src/custom-fetch.ts — no baseUrl is set for
      // web), so something has to route those to the API server when the
      // two dev servers run on different ports. In production this isn't
      // needed — both are served from the same origin behind a reverse
      // proxy (see artifacts/hrms/README.md's deployment guide).
      proxy: {
        '/api': {
          target: `http://localhost:${process.env.API_PORT ?? 3001}`,
          changeOrigin: true,
        },
      },
    },
    preview: {
      port,
      host: '0.0.0.0',
      allowedHosts: true,
    },
  };
});
