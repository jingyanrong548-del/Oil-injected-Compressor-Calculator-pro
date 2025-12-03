// =====================================================================
// polynomial_models.js: 多项式拟合数学引擎 (AHRI 540 & VSD Extension)
// 职责: 提供基于系数的纯数学计算，无任何 DOM 依赖
// 版本: v7.0 (VSD Support)
// =====================================================================

/**
 * AHRI 540 标准 10 项系数多项式计算 (基准性能)
 * Formula: X = C0 + C1*S + C2*D + C3*S^2 + C4*S*D + C5*D^2 + C6*S^3 + C7*D*S^2 + C8*S*D^2 + C9*D^3
 * * @param {Array<number>} C - 系数数组 [C0, ..., C9]
 * @param {number} S - 吸气参数 (通常为 T_evap 或 P_suc)
 * @param {number} D - 排气参数 (通常为 T_cond 或 P_dis)
 * @returns {number} 计算结果 (基准流量 X 或 基准功率 P)
 */
export function calculatePoly10(C, S, D) {
    // 鲁棒性检查：如果系数无效，返回 0
    if (!Array.isArray(C) || C.length < 10) {
        console.warn("[Poly] Coefficients array must have at least 10 elements");
        return 0;
    }

    // 预计算幂次，减少 Math.pow 调用开销，提升频繁计算时的性能
    const S2 = S * S;
    const D2 = D * D;
    const S3 = S2 * S;
    const D3 = D2 * D;

    // 严格遵循 AHRI 540 公式顺序
    // C[0]: Constant
    // C[1]: S
    // C[2]: D
    // C[3]: S^2
    // C[4]: S*D
    // C[5]: D^2
    // C[6]: S^3
    // C[7]: D*S^2
    // C[8]: S*D^2
    // C[9]: D^3

    return (
        C[0] +
        C[1] * S +
        C[2] * D +
        C[3] * S2 +
        C[4] * S * D +
        C[5] * D2 +
        C[6] * S3 +
        C[7] * D * S2 +
        C[8] * S * D2 +
        C[9] * D3
    );
}

/**
 * 计算变频修正因子 (Correction Factor)
 * 这是一个通用的多项式曲线，通常用于描述随转速比变化的效率或能力曲线
 * Formula: K = C10 + C11*r + C12*r^2 + C13*r^3 ...
 * * @param {Array<number>} C_corr - 修正系数数组 [C10, ..., C19]
 * @param {number} r - 转速比 (Current RPM / Rated RPM)
 * @returns {number} 修正因子 K (例如 0.95, 1.02 等)
 */
export function calculateCorrectionFactor(C_corr, r) {
    if (!Array.isArray(C_corr) || C_corr.length === 0) return 1.0;

    let k = 0;
    // 简单的幂级数展开: K = Σ (C[i] * r^i)
    // 注意：具体公式取决于厂家定义，此处采用通用的升幂排列
    // C_corr[0] -> Constant (Offset)
    // C_corr[1] -> Linear (r)
    // C_corr[2] -> Quadratic (r^2)
    // ...
    
    // 性能优化：霍纳法则 (Horner's Method) 可能不适用因为系数可能是稀疏的，这里用直接累加
    let r_pow = 1; // r^0
    for (let i = 0; i < C_corr.length; i++) {
        k += C_corr[i] * r_pow;
        r_pow *= r;
    }
    
    return k;
}

/**
 * VSD 综合计算模型 (v7.0 Core)
 * 逻辑: 
 * 1. 计算基准工况下的性能 (Poly10)
 * 2. 如果提供了修正系数，计算修正因子 K 并相乘
 * 3. 如果未提供修正系数(全0)，则采用物理默认值 (线性缩放)
 * * @param {Array<number>} baseC - 基准系数 (10项)
 * @param {Array<number>} corrC - 修正系数 (10项, C10-C19)
 * @param {number} S - 吸气参数
 * @param {number} D - 排气参数
 * @param {number} rpmRatio - 转速比 (Current/Rated)
 * @returns {number} 修正后的最终性能值
 */
export function calculatePolyVSD(baseC, corrC, S, D, rpmRatio = 1.0) {
    // 1. 计算额定转速下的基准值
    const baseValue = calculatePoly10(baseC, S, D);
    
    // 如果基准值计算错误或为0，直接返回
    if (!baseValue || isNaN(baseValue)) return 0;

    // 2. 检查是否存在有效的修正系数
    // 如果 corrC 都是 0，视为用户未输入，启用默认物理逻辑
    const hasCorrectionData = Array.isArray(corrC) && corrC.some(c => Math.abs(c) > 1e-9);

    if (hasCorrectionData) {
        // A. 厂家模型：使用修正系数
        const correctionFactor = calculateCorrectionFactor(corrC, rpmRatio);
        return baseValue * correctionFactor;
    } else {
        // B. 物理默认模型 (Default Physics)
        // 对于容积式压缩机：
        // - 流量与转速成正比 (Flow ~ RPM)
        // - 功率与转速成正比 (Power ~ RPM, 恒扭矩近似)
        // 注意：这忽略了泄漏损失和机械效率随转速的非线性变化，但作为默认值足够好
        return baseValue * rpmRatio;
    }
}