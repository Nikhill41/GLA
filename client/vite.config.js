import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';import tailwind from '@tailwindcss/vite';
export default defineConfig({plugins:[react(),tailwind()],server:{proxy:{'/api':'http://localhost:4000','/socket.io':{target:'http://localhost:4000',ws:true}}}});
