import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'sui-sdk', test: /node_modules\/@mysten/ },
            { name: 'wallet-standard', test: /node_modules\/@(?:wallet-standard|solana)/ },
            { name: 'react', test: /node_modules\/(?:react|react-dom)/ },
            { name: 'vendor', test: /node_modules/ },
          ],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
