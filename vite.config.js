import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ command }) => {
  // 判断是开发环境还是生产构建环境
  const isProduction = command === 'build';

  return {
    // 智能切换路径：本地开发用 '/'，打包上线用 '/Oil-injected-Compressor-Calculator-pro/'
    base: isProduction ? '/Oil-injected-Compressor-Calculator-pro/' : '/',

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
        workbox: {
          // 允许缓存大文件 (CoolProp.wasm ~7MB)
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024
        }
      })
    ],
    server: {
      open: true,
      host: true
    }
  };
});