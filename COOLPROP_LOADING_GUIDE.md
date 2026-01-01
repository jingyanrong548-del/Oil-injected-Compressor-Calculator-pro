# CoolProp 加载指南

本文档说明如何在此 App 中正确加载 CoolProp WASM 库，以便在另一个 App 中参考使用。

## 📁 文件结构

```
项目根目录/
├── public/
│   └── coolprop.wasm          # CoolProp WASM 二进制文件（必须）
├── src/js/
│   ├── coolprop.js            # CoolProp 模块导出文件（由 Emscripten 生成）
│   └── coolprop_loader.js     # CoolProp 加载器（核心加载逻辑）
└── vite.config.js             # Vite 构建配置
```

## 🔧 核心加载逻辑

### 1. 加载器实现 (`src/js/coolprop_loader.js`)

```javascript
import Module from './coolprop.js';

/**
 * 异步加载 CoolProp WASM 模块
 * @returns {Promise<Object>} CoolProp 实例对象
 */
export async function loadCoolProp() {
    try {
        console.log("[CoolProp] Starting load sequence...");
        
        // 1. 获取当前的基础路径 (从 Vite 环境变量中读取)
        // 兼容处理：确保 base 以 '/' 结尾
        let baseUrl = import.meta.env.BASE_URL;
        if (!baseUrl.endsWith('/')) baseUrl += '/';

        console.log(`[CoolProp] Environment Base URL: ${baseUrl}`);

        // 2. 配置 Module 加载参数
        const moduleArgs = {
            locateFile: (path, scriptDirectory) => {
                if (path.endsWith('.wasm')) {
                    // 强制指定 wasm 文件的完整绝对路径
                    // 注意：coolprop.wasm 必须位于项目的 public/ 根目录下
                    // 构建后它会位于 dist/coolprop.wasm
                    const fullPath = `${baseUrl}coolprop.wasm`;
                    console.log(`[CoolProp] Requesting WASM at: ${fullPath}`);
                    return fullPath;
                }
                return scriptDirectory + path;
            }
        };

        // 3. 初始化模块
        const CP = await Module(moduleArgs);
        console.log("[CoolProp] WASM initialized successfully.");
        return CP;

    } catch (err) {
        console.error("[CoolProp] Critical Loading Error:", err);
        throw new Error(`CoolProp 加载失败。\n请检查:\n1. public 目录下是否有 coolprop.wasm\n2. 网络连接是否正常\n3. 如果问题持续，请清除浏览器缓存后重试\n(${err.message})`);
    }
}
```

### 2. 在主入口中使用 (`src/js/main.js`)

```javascript
import { loadCoolProp, updateFluidInfo } from './coolprop_loader.js';

document.addEventListener('DOMContentLoaded', () => {
    // 1. 首先初始化不依赖 CoolProp 的 UI
    initUI();
    
    // 2. 异步加载 CoolProp
    loadCoolProp()
        .then((CP) => {
            console.log("CoolProp loaded successfully.");
            
            // 3. CoolProp 加载成功后，初始化依赖它的计算模块
            initMode2(CP);
            initMode3(CP);
            // ... 其他模块初始化
            
            // 4. 更新 UI 状态
            buttons.forEach(btn => {
                if (btn) {
                    btn.disabled = false;
                }
            });
            
            // 5. 更新流体信息显示
            fluidInfos.forEach(fi => {
                if (fi.select && fi.info) {
                    updateFluidInfo(fi.select, fi.info, CP);
                }
            });
        })
        .catch((err) => {
            console.error("Failed to load CoolProp:", err);
            // 处理加载失败的情况
            buttons.forEach(btn => {
                if (btn) {
                    btn.disabled = true;
                    btn.textContent = "加载失败";
                }
            });
        });
});
```

## 📋 关键配置要点

### 1. WASM 文件位置
- **开发环境**: `public/coolprop.wasm`
- **构建后**: `dist/coolprop.wasm` (位于项目根目录)
- **访问路径**: `${baseUrl}coolprop.wasm` (例如: `/coolprop.wasm`)

### 2. Vite 配置 (`vite.config.js`)

```javascript
export default defineConfig({
    base: '/',  // 部署路径，根据实际情况调整
    
    plugins: [
        VitePWA({
            // 确保 CoolProp 文件被 PWA 缓存
            includeAssets: ['coolprop.wasm', 'coolprop.js'],
            workbox: {
                // 允许缓存大文件 (CoolProp.wasm 约为 6MB+)
                maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
                runtimeCaching: [
                    {
                        urlPattern: /\.wasm$/,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'coolprop-wasm-cache',
                            expiration: {
                                maxEntries: 1,
                                maxAgeSeconds: 60 * 60 * 24 * 365 // 1年
                            }
                        }
                    }
                ]
            }
        })
    ],
    build: {
        target: 'esnext',  // 支持最新的 ES 特性
        outDir: 'dist',
        assetsDir: 'assets'
    }
});
```

### 3. 路径解析逻辑

```javascript
// 关键：使用 locateFile 回调函数指定 WASM 文件路径
const moduleArgs = {
    locateFile: (path, scriptDirectory) => {
        if (path.endsWith('.wasm')) {
            // 使用绝对路径，基于 BASE_URL
            const fullPath = `${baseUrl}coolprop.wasm`;
            return fullPath;
        }
        return scriptDirectory + path;
    }
};
```

## 🚀 在其他 App 中使用

### 步骤 1: 复制必要文件
```
1. 复制 coolprop.wasm 到新项目的 public/ 目录
2. 复制 coolprop.js 到新项目的 src/js/ 目录
3. 复制 coolprop_loader.js 到新项目的 src/js/ 目录
```

### 步骤 2: 安装依赖
```bash
npm install vite  # 如果使用 Vite
# 或使用其他构建工具
```

### 步骤 3: 调整路径配置
根据新项目的部署路径调整 `baseUrl`:
```javascript
// 如果部署在子路径，例如 /my-app/
let baseUrl = '/my-app/';
if (!baseUrl.endsWith('/')) baseUrl += '/';
```

### 步骤 4: 使用 CoolProp API
```javascript
import { loadCoolProp } from './coolprop_loader.js';

// 加载 CoolProp
const CP = await loadCoolProp();

// 使用 CoolProp 计算物性
const T = 300; // 温度 (K)
const P = 101325; // 压力 (Pa)
const fluid = 'R134a';

// 获取焓值
const h = CP.PropsSI('H', 'T', T, 'P', P, fluid);

// 获取密度
const rho = CP.PropsSI('D', 'T', T, 'P', P, fluid);

// 获取熵值
const s = CP.PropsSI('S', 'T', T, 'P', P, fluid);
```

## ⚠️ 常见问题

### 1. WASM 文件加载失败
- **检查**: `public/coolprop.wasm` 文件是否存在
- **检查**: 网络连接是否正常
- **检查**: 浏览器控制台是否有 CORS 错误

### 2. 路径错误
- **问题**: `locateFile` 返回的路径不正确
- **解决**: 确保 `baseUrl` 正确设置，与部署路径匹配

### 3. 模块初始化失败
- **检查**: `coolprop.js` 文件是否正确导入
- **检查**: 浏览器是否支持 WebAssembly
- **检查**: 控制台错误信息

### 4. 构建后路径问题
- **开发环境**: 使用 `import.meta.env.BASE_URL`
- **生产环境**: 确保构建配置中的 `base` 路径正确

## 📝 完整示例

```javascript
// main.js
import { loadCoolProp } from './coolprop_loader.js';

async function initApp() {
    try {
        // 加载 CoolProp
        const CP = await loadCoolProp();
        console.log('CoolProp loaded:', CP);
        
        // 使用 CoolProp
        const T = 273.15 + 25; // 25°C
        const P = 101325; // 1 atm
        const fluid = 'R134a';
        
        const h = CP.PropsSI('H', 'T', T, 'P', P, fluid);
        const rho = CP.PropsSI('D', 'T', T, 'P', P, fluid);
        
        console.log(`Enthalpy: ${h} J/kg`);
        console.log(`Density: ${rho} kg/m³`);
        
    } catch (error) {
        console.error('Failed to initialize CoolProp:', error);
    }
}

initApp();
```

## 🔗 相关文件

- `src/js/coolprop_loader.js` - 加载器实现
- `src/js/main.js` - 主入口使用示例
- `vite.config.js` - 构建配置
- `public/coolprop.wasm` - WASM 二进制文件

## 📌 注意事项

1. **文件大小**: `coolprop.wasm` 文件较大（约 6MB+），需要确保服务器支持大文件传输
2. **缓存策略**: 建议使用缓存策略提高加载速度
3. **错误处理**: 始终使用 try-catch 处理加载错误
4. **异步加载**: CoolProp 加载是异步的，确保在加载完成后再使用
5. **浏览器兼容性**: 需要支持 WebAssembly 的现代浏览器

