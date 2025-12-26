// =====================================================================
// efficiency_models.js: 经验效率模型
// 版本: v2.0 (2024 Modern Screw Compressor)
// 职责: 根据压力比(PR)估算容积效率和等熵/等温效率。
// 基于: 2024年国际先进螺杆压缩机技术发展水平
// =====================================================================

/**
 * 根据压力比计算经验效率值（2024年现代螺杆机水平）
 * @param {number} pressureRatio - 压力比 (Pc / Pe)
 * @returns {object} 包含 { eta_v, eta_s, eta_iso } 的效率对象
 */
export function calculateEmpiricalEfficiencies(pressureRatio) {
    // 确保压力比有效，防止计算错误
    if (isNaN(pressureRatio) || pressureRatio < 1) {
        return { eta_v: 0.92, eta_s: 0.80, eta_iso: 0.75 }; // 返回一组安全的默认值（2024年水平）
    }

    // --- 1. 容积效率 (η_v) 模型: 改进的非线性衰减模型 ---
    // 现代螺杆机（2024）：低压力比时可达0.96-0.98，高压力比时仍能保持0.80-0.90
    const ETA_V_BASE = 0.97;         // 基础容积效率 (PR=1时，2024年水平)
    const PENALTY_V_LOW = 0.008;     // 低压力比区域衰减系数（PR < 3）
    const PENALTY_V_HIGH = 0.012;    // 高压力比区域衰减系数（PR >= 3）
    const ETA_V_MIN = 0.75;          // 最小容积效率（2024年改进）
    
    let eta_v;
    if (pressureRatio < 3.0) {
        // 低压力比区域：线性衰减，衰减较慢
        eta_v = ETA_V_BASE - (pressureRatio - 1) * PENALTY_V_LOW;
    } else {
        // 高压力比区域：分段衰减，衰减加快
        const baseAtPR3 = ETA_V_BASE - (3.0 - 1) * PENALTY_V_LOW;
        eta_v = baseAtPR3 - (pressureRatio - 3.0) * PENALTY_V_HIGH;
    }
    eta_v = Math.max(ETA_V_MIN, eta_v); // 确保不低于下限

    // --- 2. 等熵效率 (η_s) 模型: 改进的抛物线模型 ---
    // 现代螺杆机（2024）：最佳工况（PR=3-5）可达0.85-0.90，极端工况也能保持0.70-0.80
    const ETA_S_PEAK = 0.87;         // 峰值等熵效率（2024年水平提升）
    const PR_SWEET_SPOT = 4.0;       // 最佳效率点对应的压力比
    const PENALTY_S_NEAR = 0.012;    // 接近最佳点区域的衰减系数
    const PENALTY_S_FAR = 0.020;     // 远离最佳点区域的衰减系数
    const ETA_S_MIN = 0.68;          // 最小等熵效率（2024年改进）
    
    const prDiff = Math.abs(pressureRatio - PR_SWEET_SPOT);
    let eta_s;
    if (prDiff <= 2.0) {
        // 接近最佳点区域：衰减较慢
        eta_s = ETA_S_PEAK - prDiff * PENALTY_S_NEAR;
    } else {
        // 远离最佳点区域：衰减加快
        const baseAtPR2 = ETA_S_PEAK - 2.0 * PENALTY_S_NEAR;
        eta_s = baseAtPR2 - (prDiff - 2.0) * PENALTY_S_FAR;
    }
    eta_s = Math.max(ETA_S_MIN, eta_s); // 确保不低于下限

    // 等温效率与等熵效率关联（2024年水平）
    const ISO_FACTOR = 0.94;         // 等温效率因子（2024年略有提升）
    let eta_iso = eta_s * ISO_FACTOR;

    // 返回计算结果，保留3位小数
    return {
        eta_v: parseFloat(eta_v.toFixed(3)),
        eta_s: parseFloat(eta_s.toFixed(3)),
        eta_iso: parseFloat(eta_iso.toFixed(3))
    };
}

/**
 * 计算氨喷油螺杆压缩机效率
 * 基于 Mycom/Mayekawa 等工业氨机的一般特性曲线拟合
 * @param {number} Pd_abs - 排气绝对压力 (bar)
 * @param {number} Ps_abs - 吸气绝对压力 (bar)
 * @param {number} Vi - 内容积比 (通常为 2.6, 3.6, 5.8 等，或无级调节)
 * @param {boolean} hasEconomizer - 是否带经济器 (影响容积效率修正)
 * @returns {Object} { eta_v (容积效率), eta_is (绝热效率/等熵效率) }
 */
export function calculateScrewEfficiency(Pd_abs, Ps_abs, Vi, hasEconomizer = false) {
    // 1. 计算系统运行压比
    const pi_system = Pd_abs / Ps_abs;
    
    // 2. 氨绝热指数 (k) - 平均值，虽随温度变化，但用于效率估算 1.3 足够精确
    const k = 1.31; 
    
    // 3. 计算内建压比 (Built-in Pressure Ratio)
    // pi_i = Vi ^ k
    const pi_internal = Math.pow(Vi, k);

    // ==========================================
    // A. 容积效率 (Volumetric Efficiency) 计算
    // ==========================================
    // 氨机通常容积效率较高，主要受压比影响
    // 经验公式: eta_v = 0.96 - 0.015 * (Pd/Ps) (简化版)
    // 进阶版 (考虑 Vi 对泄漏路径的影响):
    let eta_v = 0.95 - 0.012 * pi_system;
    
    // 修正: 极高压比下衰减加速
    if (pi_system > 8) {
        eta_v -= 0.005 * (pi_system - 8);
    }
    
    // 经济器补气会稍微降低吸气侧的容积效率（因为占据了齿槽容积）
    if (hasEconomizer) {
        eta_v *= 0.98; 
    }

    // 边界保护
    eta_v = Math.max(0.6, Math.min(0.99, eta_v));


    // ==========================================
    // B. 等熵效率 (Isentropic Efficiency) 计算
    // ==========================================
    // 核心算法：基于"欠压缩"或"过压缩"损失模型
    
    // 峰值效率 (取决于机器制造精度，Mycom/Howden 大机组通常在 0.80-0.85)
    const peak_efficiency = 0.82; 

    // 计算不匹配系数 (Mismatch factor)
    // 当运行压比 = 内建压比时，效率最高
    // 公式参考自 Stosic 螺杆压缩机通用模型
    
    let mismatch_loss = 0;
    
    if (pi_system !== pi_internal) {
        // 相对偏差
        const deviation = Math.abs(pi_system - pi_internal) / pi_internal;
        
        // 过压缩 (System < Internal) 损失通常比 欠压缩 (System > Internal) 小
        // 因为过压缩只是多做了功，而欠压缩会导致气体回流冲击
        const penalty_factor = pi_system > pi_internal ? 0.08 : 0.06;
        
        mismatch_loss = penalty_factor * Math.pow(deviation, 2) + 0.02 * deviation;
    }

    let eta_is = peak_efficiency - mismatch_loss;
    
    // 机械效率修正 (摩擦损失)
    const eta_mech = 0.94; // 喷油螺杆机械效率通常很高
    
    // 最终等熵效率 (考虑机械损失)
    // 注意：有些厂家定义的等熵效率已经包含机械效率，此处需根据 Mycom 定义调整
    eta_is = eta_is * eta_mech;

    // 边界保护
    eta_is = Math.max(0.4, Math.min(0.88, eta_is));

    return {
        eta_v: parseFloat(eta_v.toFixed(4)),
        eta_is: parseFloat(eta_is.toFixed(4)),
        pi_system: parseFloat(pi_system.toFixed(2)),
        pi_internal: parseFloat(pi_internal.toFixed(2))
    };
}