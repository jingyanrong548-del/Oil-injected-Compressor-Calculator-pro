import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // 1. 基础路径配置 (如果在服务器子目录下部署，需修改此处)
  base: '/Oil-injected-Compressor-Calculator-pro/',

  // 2. 插件配置
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['coolprop.wasm', 'coolprop.js'],
      manifest: {
        name: 'Compressor Efficiency Pro',
        short_name: 'CompEff Pro',
        description: 'Industrial Heat Pump Compressor Calculation Tool',
        theme_color: '#0d9488',
        background_color: '#f9fafb',
        display: 'standalone',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      // ▼▼▼▼▼▼▼▼▼ 新增以下配置 (允许缓存大文件) ▼▼▼▼▼▼▼▼▼
      workbox: {
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024 // 提高限制到 10MB
      }
      // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
    })
  ],

  // 3. 开发服务器配置
  server: {
    open: true, // 启动时自动打开浏览器
    host: true  // 允许局域网访问 (方便手机测试响应式布局)
  }
});