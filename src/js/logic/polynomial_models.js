// =====================================================================
// polynomial_models.js: 多项式拟合数学引擎 (AHRI 540)
// 职责: 提供基于系数的纯数学计算，无任何 DOM 依赖
// =====================================================================

/**
 * AHRI 540 标准 10 项系数多项式计算
 * Formula: X = C0 + C1*S + C2*D + C3*S^2 + C4*S*D + C5*D^2 + C6*S^3 + C7*D*S^2 + C8*S*D^2 + C9*D^3
 * * @param {Array<number>} C - 系数数组 [C0, ..., C9]
 * @param {number} S - 吸气露点温度 (Suction Dew Point)
 * @param {number} D - 排气露点温度 (Discharge Dew Point)
 * @returns {number} 计算结果 (流量 X 或 功率 P)
 */
export function calculatePoly10(C, S, D) {
    if (!Array.isArray(C) || C.length < 10) {
        console.warn("[Poly] Coefficients array must have at least 10 elements");
        return 0;
    }

    // 预计算幂次，减少 Math.pow 调用开销
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
 * (预留) 扩展 20 项系数计算接口
 * 适用于更复杂的变频或变容修正模型
 */
export function calculatePoly20(C, S, D, rpmRatio = 1.0) {
    // 基础 10 项
    let base = calculatePoly10(C, S, D);
    
    // 示例扩展逻辑 (实际公式需根据具体厂家定义)
    // 假设 C10-C19 是关于转速比的修正项...
    return base * rpmRatio; 
}