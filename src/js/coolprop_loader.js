// =====================================================================
// coolprop_loader.js: CoolProp 物性库加载器 (v4.8 Stable)
// 职责: 1. 强健的 WASM 路径解析 2. 流体基本信息查询与 UI 更新
// =====================================================================

import Module from './coolprop.js';

/**
 * 异步加载 CoolProp WASM 模块
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


// ---------------------------------------------------------------------
// 流体基础数据 (GWP, ODP, 安全等级)
// ---------------------------------------------------------------------
const fluidInfoData = {
    'R134a': { gwp: 1430, odp: 0, safety: 'A1' },
    'R245fa': { gwp: 1030, odp: 0, safety: 'B1' },
    'R1233zd(E)': { gwp: 1, odp: 0, safety: 'A1' },
    'R1234ze(E)': { gwp: '<1', odp: 0, safety: 'A2L' },
    'R123': { gwp: 77, odp: 0.012, safety: 'B1' },
    'R22': { gwp: 1810, odp: 0.034, safety: 'A1' },
    'R410A': { gwp: 2088, odp: 0, safety: 'A1' },
    'R32': { gwp: 675, odp: 0, safety: 'A2L' },
    'R290': { gwp: 3, odp: 0, safety: 'A3' },
    'R717': { gwp: 0, odp: 0, safety: 'B2L' },
    'R515B': { gwp: 293, odp: 0, safety: 'A1' },
    'R142b': { gwp: 2310, odp: 0.043, safety: 'A2' },
    'R1336mzz(Z)': { gwp: 2, odp: 0, safety: 'A1' },
    'R744': { gwp: 1, odp: 0, safety: 'A1' },
    'R600a': { gwp: 3, odp: 0, safety: 'A3' },
    'R152a': { gwp: 124, odp: 0, safety: 'A2' },
    'R454B': { gwp: 466, odp: 0, safety: 'A2L' },
    'R513A': { gwp: 631, odp: 0, safety: 'A1' },
    'R236fa': { gwp: 9810, odp: 0, safety: 'A1' },
    'R23': { gwp: 14800, odp: 0, safety: 'A1' },
    'R1234yf': { gwp: '<1', odp: 0, safety: 'A2L' },
    'R1270': { gwp: 2, odp: 0, safety: 'A3' },
    'R1150': { gwp: 2, odp: 0, safety: 'A3' },
    'R507A': { gwp: 3985, odp: 0, safety: 'A1' },
    'Air': { gwp: 0, odp: 0, safety: 'A1' },
    'Nitrogen': { gwp: 0, odp: 0, safety: 'A1' },
    'Helium': { gwp: 0, odp: 0, safety: 'A1' },
    'Neon': { gwp: 0, odp: 0, safety: 'A1' },
    'Argon': { gwp: 0, odp: 0, safety: 'A1' },
    'Water': { gwp: 0, odp: 0, safety: 'A1' },
    'Hydrogen': { gwp: 0, odp: 0, safety: 'A3' },
    'Oxygen': { gwp: 0, odp: 0, safety: 'A1 (Oxidizer)' },
    'Methane': { gwp: 25, odp: 0, safety: 'A3' },
    'default': { gwp: 'N/A', odp: 'N/A', safety: 'N/A' }
};

/**
 * 更新 UI 中的流体信息显示
 * @param {HTMLSelectElement} selectElement - 下拉菜单 DOM
 * @param {HTMLElement} infoElement - 显示信息的 DOM
 * @param {object} CP - CoolProp 实例
 */
import i18next from './i18n.js';

export function updateFluidInfo(selectElement, infoElement, CP) {
    if (!CP) {
        infoElement.innerHTML = `<span class="text-red-400">${i18next.t('common.loading')}</span>`;
        return;
    }

    const fluid = selectElement.value;
    const info = fluidInfoData[fluid] || fluidInfoData['default'];

    try {
        // 特殊处理水 (IF97)
        if (fluid === 'Water') {
            infoElement.innerHTML = `
                <div class="flex justify-between items-center text-[10px] md:text-xs text-gray-500 font-mono">
                    <span class="font-bold text-gray-700">Water (IF97)</span>
                    <span>Safe: A1</span>
                    <span>Tc: 647.1K / Pc: 220.6bar</span>
                </div>`;
            return;
        }

        // 调用 CoolProp 获取临界参数
        // 注意：部分流体可能没有定义的临界参数，需 try-catch
        const Tcrit_K = CP.PropsSI('Tcrit', '', 0, '', 0, fluid);
        const Pcrit_Pa = CP.PropsSI('Pcrit', '', 0, '', 0, fluid);

        // 生成紧凑的 HTML (适配 UI 3.0 Card Header)
        infoElement.innerHTML = `
            <div class="flex justify-between items-center text-[10px] md:text-xs text-gray-500 font-mono">
                <span><b class="text-gray-700">${fluid}</b> (${info.safety})</span>
                <span class="hidden sm:inline">GWP: ${info.gwp}</span>
                <span>Tc: ${(Tcrit_K - 273.15).toFixed(1)}°C / Pc: ${(Pcrit_Pa / 1e5).toFixed(1)} bar</span>
            </div>
        `;

    } catch (err) {
        console.warn(`[CoolProp] Info update warning for ${fluid}:`, err);
        infoElement.innerHTML = `
            <div class="flex justify-between items-center text-[10px] md:text-xs text-gray-500 font-mono">
                <span><b>${fluid}</b> (${info.safety})</span>
                <span>GWP: ${info.gwp}</span>
                <span class="text-orange-400">Props unavailable</span>
            </div>
        `;
    }
}