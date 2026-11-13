import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import path from 'node:path';
export default defineConfig({base:'./', plugins:[react(), tailwind()],build:{rollupOptions:{input:{main:path.resolve('index.html'),legacy:path.resolve('legacy.html')}}}});
