import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    // Enterprise local proxy configuration
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        secure: false,
      },
      '/ws-tasksphere': {
        target: 'ws://localhost:8080',
        ws: true,
        changeOrigin: true,
      }
    }
  }
});
