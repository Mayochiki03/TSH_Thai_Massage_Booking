import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// dev: หน้าเว็บที่ :5173 ส่งต่อ API ไป backend 2 พอร์ต
//   /api/public/* → 4000 (ผู้จอง)   /api/* → 4001 (เจ้าหน้าที่/แอดมิน)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // ให้มือถือใน Wi-Fi เดียวกันเปิดได้ (http://<IP เครื่อง>:5173)
    port: 5173,
    allowedHosts: ['.trycloudflare.com'], // เปิดผ่าน Cloudflare Quick Tunnel ตอนทดสอบกับ LINE
    proxy: {
      '/api/public': 'http://127.0.0.1:4000',
      '/api': 'http://127.0.0.1:4001',
    },
  },
});
