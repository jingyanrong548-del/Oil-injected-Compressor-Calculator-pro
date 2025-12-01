// =====================================================================
// state.js: 全局应用状态管理 (v1.0)
// 职责: 存储计算策略模式及拟合系数，作为 UI 和计算逻辑的桥梁
// =====================================================================

export const AppState = {
    // 计算模式枚举
    MODES: {
        GEOMETRY: 'geometry',   // 传统几何模式 (RPM * Disp * eff)
        POLYNOMIAL: 'polynomial' // AHRI 拟合模式 (C0-C9)
    },

    // 当前激活的模式 (默认为几何模式)
    currentMode: 'geometry',

    // 拟合模型数据仓
    polynomial: {
        // AHRI 540 标准定义的 10 项系数
        // 数组索引 0-9 对应 C0-C9
        massFlowCoeffs: new Array(10).fill(0), 
        powerCoeffs: new Array(10).fill(0),
        
        // 预留：未来可能的 20 项系数扩展
        // extendedCoeffs: new Array(20).fill(0),
        
        // 单位标识 (预留 UI 显示用)
        units: {
            massFlow: 'kg/s',
            power: 'kW'
        }
    },

    /**
     * 切换计算模式
     * @param {string} mode - 'geometry' | 'polynomial'
     */
    setMode(mode) {
        if (Object.values(this.MODES).includes(mode)) {
            this.currentMode = mode;
            console.log(`[State] Mode switched to: ${mode}`);
        } else {
            console.error(`[State] Invalid mode: ${mode}`);
        }
    },

    /**
     * 批量更新系数
     * @param {string} type - 'massFlow' | 'power'
     * @param {Array} values - 系数数组
     */
    updateCoeffs(type, values) {
        if (this.polynomial[type + 'Coeffs']) {
            // 确保只取前10个数据 (针对 AHRI 10项)
            this.polynomial[type + 'Coeffs'] = values.map(v => parseFloat(v) || 0).slice(0, 10);
        }
    }
};