/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // 1. 字体系统：优先使用 Apple 系统字体栈
      fontFamily: {
        sans: [
          'Inter', 
          '-apple-system', 
          'BlinkMacSystemFont', 
          '"SF Pro Text"', 
          '"Helvetica Neue"', 
          'sans-serif'
        ],
        mono: ['"SF Mono"', 'Menlo', 'Monaco', 'Courier New', 'monospace'],
      },
      
      // 2. 色彩系统：iOS 风格语义化颜色
      colors: {
        ios: {
          bg: '#F5F5F7',         // 系统背景灰
          surface: '#FFFFFF',    // 卡片表面白
          'text-primary': '#1D1D1F',   // 主要文字 (接近纯黑)
          'text-secondary': '#86868B', // 次要文字 (金属灰)
          border: 'rgba(0, 0, 0, 0.04)', // 极淡的边框
        },
        primary: {
          50: '#F0FDFA',
          100: '#CCFBF1',
          400: '#2DD4BF',
          500: '#14B8A6', // Teal 主色
          600: '#0D9488', // 激活态
          700: '#0F766E',
        }
      },

      // 3. 阴影系统：弥散阴影 (Diffuse Shadows)
      boxShadow: {
        'glass': '0 8px 30px rgba(0, 0, 0, 0.04)',
        'glass-hover': '0 20px 40px rgba(0, 0, 0, 0.08)',
        'inner-ios': 'inset 0 1px 2px rgba(0, 0, 0, 0.06)',
        // 专门用于底部抽屉的向上投影
        'sheet-up': '0 -8px 30px rgba(0, 0, 0, 0.12)', 
      },

      // 4. 动画曲线 (关键：让网页像 App 一样顺滑)
      transitionTimingFunction: {
        // iOS 经典的“减速-弹簧”曲线，用于 Bottom Sheet 拖拽
        'ios': 'cubic-bezier(0.25, 1, 0.5, 1)', 
        // 更有弹性的曲线，用于开关 Toggle
        'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },

      // 5. 自定义动画关键帧
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up-enter': {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'pulse-slow': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.8' },
        }
      },
      
      animation: {
        'fade-in': 'fade-in 0.3s ease-out forwards',
        'slide-up': 'slide-up-enter 0.5s cubic-bezier(0.25, 1, 0.5, 1) forwards',
      },

      // 6. 安全区域扩展 (适配 iPhone X+ 底部横条)
      spacing: {
        'safe-bottom': 'env(safe-area-inset-bottom)',
      }
    },
  },
  plugins: [],
}