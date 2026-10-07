import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// dev: หน้าเว็บที่ :5173 ส่งต่อ API ไป backend 2 พอร์ต
//   /api/public/* → 4000 (ผู้จอง)   /api/* → 4001 (เจ้าหน้าที่/แอดมิน)
// build: ได้โฟลเดอร์ dist/ ที่ backend ส่งให้ browser เอง (ดู backend/src/web.js)
//   manifest: true → สร้าง dist/.vite/manifest.json ให้ backend รู้ว่าไฟล์ไหนเป็นของหน้าผู้จอง
//   (พอร์ต public ส่งเฉพาะไฟล์ของหน้าผู้จอง ไม่ส่งโค้ดหน้าแอดมิน/kiosk)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { manifest: true },
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
