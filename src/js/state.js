// =====================================================================
// state.js: 全局应用状态管理 (v7.0 Extended)
// 职责: 存储计算模式、拟合系数、变频状态及湿气参数
// =====================================================================

export const AppState = {
    // 计算模式枚举
    MODES: {
        GEOMETRY: 'geometry',   // 传统几何模式
        POLYNOMIAL: 'polynomial' // AHRI 拟合模式
    },

    // 当前激活的模式 (默认为几何模式)
    currentMode: 'geometry',

    // [New] VSD 变频状态
    vsd: {
        enabled: false,
        ratedRpm: 2900,
        currentRpm: 2900
    },

    // [New] 气体成分状态 (Mode 3)
    // [Update] 气体成分状态 (Mode 3)
    gas: {
        moistureType: 'rh', // 'rh', 'pdp', 'ppmw', 'ppmv'
        moistureValue: 0,   // 数值
        isWet: false        // 计算后标记
    },

    // 拟合模型数据仓 (扩容)
    polynomial: {
        // AHRI 540 标准 10 项 (C0-C9)
        massFlowCoeffs: new Array(10).fill(0),
        powerCoeffs: new Array(10).fill(0),

        // [New] 变频修正系数 (C10-C19)
        // 通常用于：Flow_corr = Flow_base * (C10 + C11*Ratio + ...)
        correctionCoeffs: new Array(10).fill(0),

        // 单位标识
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
     * 更新变频状态
     * @param {boolean} enabled 
     * @param {number} rated 
     * @param {number} current 
     */
    updateVSD(enabled, rated, current) {
        this.vsd.enabled = !!enabled;
        if (rated) this.vsd.ratedRpm = parseFloat(rated);
        if (current) this.vsd.currentRpm = parseFloat(current);
    },

    /**
     * 批量更新系数
     * @param {string} type - 'massFlow' | 'power' | 'correction'
     * @param {Array} values - 系数数组
     */
    updateCoeffs(type, values) {
        // 映射 correction 到 correctionCoeffs
        const key = type === 'correction' ? 'correctionCoeffs' : type + 'Coeffs';

        if (this.polynomial[key]) {
            // 确保只取前10个数据
            this.polynomial[key] = values.map(v => parseFloat(v) || 0).slice(0, 10);
            console.log(`[State] Updated ${key}:`, this.polynomial[key]);
        }
    }
};