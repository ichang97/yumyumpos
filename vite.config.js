import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

const isLocalMode = process.env.YUMYUM_LOCAL === '1';
const apiPort = process.env.API_PORT || '8787';

export default defineConfig(async () => {
  const plugins = [vue(), tailwindcss()];
  if (!isLocalMode) {
    const { cloudflare } = await import('@cloudflare/vite-plugin');
    plugins.push(cloudflare());
  }

  return {
    plugins,
    build: isLocalMode
      ? {
          outDir: 'dist/client',
          emptyOutDir: true,
        }
      : undefined,
    server: isLocalMode
      ? {
          host: true,
          port: 5173,
          proxy: {
            '/api': {
              target: `http://127.0.0.1:${apiPort}`,
              changeOrigin: false,
            },
          },
        }
      : {
          host: true,
          port: 5173,
        },
  };
});
