// =====================================================================
// mode6_two_stage_double.js: 模式六 (双机双级压缩) - v1.0
// 职责: 两台压缩机串联实现两级压缩，低压级和高压级独立计算，
//      支持中间冷却/补气和不同的压缩机参数。
// =====================================================================

import { createKpiCard, createDetailRow, createSectionHeader, createErrorCard, createStateTable } from './components.js';
import { drawPHDiagram, drawTSDiagram, getChartInstance } from './charts.js';
import { HistoryDB, SessionState } from './storage.js';
import { openMobileSheet } from './ui.js';
import { updateFluidInfo } from './coolprop_loader.js';
import { calculateEmpiricalEfficiencies } from './efficiency_models.js';
import { 
    getFilteredBrands,
    getFilteredSeriesByBrand,
    getModelsBySeries, 
    getDisplacementByModel,
    getModelDetail 
} from './compressor_models.js';

let CP_INSTANCE = null;
let lastCalculationData = null;

// UI 引用
let calcButtonM6, calcFormM6, printButtonM6;
let resultsDesktopM6, resultsMobileM6, summaryMobileM6;

// 低压级输入元素
let fluidSelect, fluidInfoDiv, tempEvapInput, superheatInput, subcoolInput;
let flowLpInput;
let etaVLpInput, etaSLpInput, autoEffLpCheckbox;
let compressorBrandLp, compressorSeriesLp, compressorModelLp, modelDisplacementInfoLp, modelDisplacementValueLp;
let tempDischargeActualLpInput;

// 高压级输入元素
let tempCondInput;
let flowHpInput;
let etaVHpInput, etaSHpInput, autoEffHpCheckbox;
let compressorBrandHp, compressorSeriesHp, compressorModelHp, modelDisplacementInfoHp, modelDisplacementValueHp;
let tempDischargeActualHpInput;

// 中间压力设置
let interPressMode, interSatTempInput;

// ECO 设置 - 中间冷却器
let ecoCheckbox, ecoType, ecoSuperheatInput, ecoSuperheatInputSubcooler, ecoDtInput;
// ECO 设置 - 低压级
let ecoCheckboxLp, ecoTypeLp, ecoSuperheatInputLp, ecoDtInputLp;
// ECO 设置 - 高压级
let ecoCheckboxHp, ecoTypeHp, ecoSuperheatInputHp, ecoDtInputHp;

const BTN_TEXT_CALCULATE = 'Calculate Two-Stage Double';
const BTN_TEXT_RECALCULATE = 'Recalculate (Input Changed)';

// ---------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------

function setButtonStale6() {
    if (calcButtonM6 && calcButtonM6.innerText !== BTN_TEXT_RECALCULATE) {
        calcButtonM6.innerText = BTN_TEXT_RECALCULATE;
        calcButtonM6.classList.add('opacity-90', 'ring-2', 'ring-yellow-400', 'ring-offset-2');
        if (printButtonM6) {
            printButtonM6.disabled = true;
            printButtonM6.classList.add('opacity-50', 'cursor-not-allowed');
        }
    }
}

function setButtonFresh6() {
    if (calcButtonM6) {
        calcButtonM6.innerText = BTN_TEXT_CALCULATE;
        calcButtonM6.classList.remove('opacity-90', 'ring-2', 'ring-yellow-400', 'ring-offset-2');
    }
}

function renderToAllViews(htmlContent) {
    if (resultsDesktopM6) resultsDesktopM6.innerHTML = htmlContent;
    if (resultsMobileM6) resultsMobileM6.innerHTML = htmlContent;
}

function updateMobileSummary(kpi1Label, kpi1Value, kpi2Label, kpi2Value) {
    if (!summaryMobileM6) return;
    summaryMobileM6.innerHTML = `
        <div>
            <p class="text-[10px] text-gray-500 uppercase tracking-wider font-bold">${kpi1Label}</p>
            <p class="text-xl font-bold text-gray-900">${kpi1Value}</p>
        </div>
        <div class="text-right">
            <p class="text-[10px] text-gray-500 uppercase tracking-wider font-bold">${kpi2Label}</p>
            <p class="text-xl font-bold text-blue-600">${kpi2Value}</p>
        </div>
    `;
}

// ---------------------------------------------------------------------
// Saturation Lines Calculation
// ---------------------------------------------------------------------

/**
 * 生成压缩过程的中间点（用于 T-S 图，显示熵增加趋势）
 * @param {string} fluid - 工质名称
 * @param {number} h_start - 起始焓值 (J/kg)
 * @param {number} P_start - 起始压力 (Pa)
 * @param {number} h_end - 结束焓值 (J/kg)
 * @param {number} P_end - 结束压力 (Pa)
 * @param {number} numPoints - 中间点数量
 * @returns {Array} T-S 图数据点数组 [[s, T], ...]
 */
function generateCompressionPathTS(fluid, h_start, P_start, h_end, P_end, numPoints = 10) {
    if (!CP_INSTANCE) return [];
    
    const points = [];
    
    for (let i = 0; i <= numPoints; i++) {
        const ratio = i / numPoints;
        
        // 压力插值（对数空间，更符合实际压缩过程）
        const logP_start = Math.log10(P_start);
        const logP_end = Math.log10(P_end);
        const logP = logP_start + (logP_end - logP_start) * ratio;
        const P = Math.pow(10, logP);
        
        // 焓值插值（线性插值，因为实际压缩功与焓值增加成正比）
        const h = h_start + (h_end - h_start) * ratio;
        
        try {
            // 从焓值和压力计算温度和熵值
            const T_K = CP_INSTANCE.PropsSI('T', 'H', h, 'P', P, fluid);
            const s = CP_INSTANCE.PropsSI('S', 'H', h, 'P', P, fluid);
            points.push([s / 1000, T_K - 273.15]); // [s (kJ/kg·K), T (°C)]
        } catch (e) {
            continue;
        }
    }
    
    return points;
}

/**
 * 生成节流过程的中间点（等焓过程，用于 T-S 图）
 * @param {string} fluid - 工质名称
 * @param {number} h - 焓值 (J/kg) - 节流过程等焓
 * @param {number} P_start - 起始压力 (Pa)
 * @param {number} P_end - 结束压力 (Pa)
 * @param {number} numPoints - 中间点数量
 * @returns {Array} T-S 图数据点数组 [[s, T], ...]
 */
function generateThrottlingPathTS(fluid, h, P_start, P_end, numPoints = 10) {
    if (!CP_INSTANCE) return [];
    
    const points = [];
    
    for (let i = 0; i <= numPoints; i++) {
        const ratio = i / numPoints;
        // 线性插值压力（等焓过程）
        const P = P_start + (P_end - P_start) * ratio;
        
        try {
            const T_K = CP_INSTANCE.PropsSI('T', 'H', h, 'P', P, fluid);
            const s = CP_INSTANCE.PropsSI('S', 'H', h, 'P', P, fluid);
            points.push([s / 1000, T_K - 273.15]); // [s (kJ/kg·K), T (°C)]
        } catch (e) {
            continue;
        }
    }
    
    return points;
}

/**
 * 生成等压过程的中间点（用于 T-S 图）
 * @param {string} fluid - 工质名称
 * @param {number} P - 压力 (Pa) - 等压过程
 * @param {number} h_start - 起始焓值 (J/kg)
 * @param {number} h_end - 结束焓值 (J/kg)
 * @param {number} numPoints - 中间点数量
 * @returns {Array} T-S 图数据点数组 [[s, T], ...]
 */
function generateIsobaricPathTS(fluid, P, h_start, h_end, numPoints = 10) {
    if (!CP_INSTANCE) return [];
    
    const points = [];
    
    for (let i = 0; i <= numPoints; i++) {
        const ratio = i / numPoints;
        // 线性插值焓值（等压过程）
        const h = h_start + (h_end - h_start) * ratio;
        
        try {
            const T_K = CP_INSTANCE.PropsSI('T', 'H', h, 'P', P, fluid);
            const s = CP_INSTANCE.PropsSI('S', 'H', h, 'P', P, fluid);
            points.push([s / 1000, T_K - 273.15]); // [s (kJ/kg·K), T (°C)]
        } catch (e) {
            continue;
        }
    }
    
    return points;
}

/**
 * 生成饱和线数据点（用于 P-h 图和 T-S 图）
 * @param {string} fluid - 工质名称
 * @param {number} Pe_Pa - 蒸发压力 (Pa)
 * @param {number} Pc_Pa - 冷凝压力 (Pa)
 * @param {number} numPoints - 数据点数量
 * @returns {Object} 包含饱和液体线和饱和气体线的数据
 */
function generateSaturationLines(fluid, Pe_Pa, Pc_Pa, numPoints = 100) {
    if (!CP_INSTANCE) return { liquid: [], vapor: [] };
    
    const liquidPoints = [];
    const vaporPoints = [];
    
    // 计算压力范围（从蒸发压力到冷凝压力）
    const P_min = Math.min(Pe_Pa, Pc_Pa) * 0.8;
    const P_max = Math.max(Pe_Pa, Pc_Pa) * 1.2;
    
    // 对数分布压力点（因为压力通常是对数分布的）
    for (let i = 0; i <= numPoints; i++) {
        const logP_min = Math.log10(P_min);
        const logP_max = Math.log10(P_max);
        const logP = logP_min + (logP_max - logP_min) * (i / numPoints);
        const P_Pa = Math.pow(10, logP);
        
        try {
            // 饱和液体线 (Q=0)
            const T_sat_K = CP_INSTANCE.PropsSI('T', 'P', P_Pa, 'Q', 0, fluid);
            const h_liq = CP_INSTANCE.PropsSI('H', 'P', P_Pa, 'Q', 0, fluid);
            const s_liq = CP_INSTANCE.PropsSI('S', 'P', P_Pa, 'Q', 0, fluid);
            
            // 饱和气体线 (Q=1)
            const h_vap = CP_INSTANCE.PropsSI('H', 'P', P_Pa, 'Q', 1, fluid);
            const s_vap = CP_INSTANCE.PropsSI('S', 'P', P_Pa, 'Q', 1, fluid);
            
            // P-h 图数据点
            liquidPoints.push([h_liq / 1000, P_Pa / 1e5]); // [h (kJ/kg), P (bar)]
            vaporPoints.push([h_vap / 1000, P_Pa / 1e5]);
            
        } catch (e) {
            // 如果某个压力点计算失败，跳过
            continue;
        }
    }
    
    return {
        liquidPH: liquidPoints,
        vaporPH: vaporPoints
    };
}

/**
 * 生成 T-S 图的饱和线数据点
 * @param {string} fluid - 工质名称
 * @param {number} Te_C - 蒸发温度 (°C)
 * @param {number} Tc_C - 冷凝温度 (°C)
 * @param {number} numPoints - 数据点数量
 * @returns {Object} 包含饱和液体线和饱和气体线的 T-S 数据
 */
function generateSaturationLinesTS(fluid, Te_C, Tc_C, numPoints = 100) {
    if (!CP_INSTANCE) return { liquid: [], vapor: [] };
    
    const liquidPoints = [];
    const vaporPoints = [];
    
    // 计算温度范围
    const T_min = Math.min(Te_C, Tc_C) - 20;
    const T_max = Math.max(Te_C, Tc_C) + 20;
    
    for (let i = 0; i <= numPoints; i++) {
        const T_C = T_min + (T_max - T_min) * (i / numPoints);
        const T_K = T_C + 273.15;
        
        try {
            // 饱和压力
            const P_sat_Pa = CP_INSTANCE.PropsSI('P', 'T', T_K, 'Q', 0.5, fluid);
            
            // 饱和液体线 (Q=0)
            const s_liq = CP_INSTANCE.PropsSI('S', 'T', T_K, 'Q', 0, fluid);
            
            // 饱和气体线 (Q=1)
            const s_vap = CP_INSTANCE.PropsSI('S', 'T', T_K, 'Q', 1, fluid);
            
            // T-S 图数据点
            liquidPoints.push([s_liq / 1000, T_C]); // [s (kJ/kg·K), T (°C)]
            vaporPoints.push([s_vap / 1000, T_C]);
            
        } catch (e) {
            continue;
        }
    }
    
    return {
        liquid: liquidPoints,
        vapor: vaporPoints
    };
}

// ---------------------------------------------------------------------
// Optimal Intermediate Pressure Calculation (Flow Method)
// ---------------------------------------------------------------------

/**
 * 基于高低压级理论排量计算最优中间压力（流量法）
 * 使用流量平衡方法：通过迭代寻优找到中间压力，使得高压级吸气量与（低压排气+中间冷却器补气）质量流量平衡
 * @param {Object} params - 计算参数
 * @param {string} params.fluid - 工质名称
 * @param {number} params.Te_C - 蒸发温度 (°C)
 * @param {number} params.Tc_C - 冷凝温度 (°C)
 * @param {number} params.superheat_K - 过热度 (K)
 * @param {number} params.flow_lp_m3h - 低压级理论排量 (m³/h)
 * @param {number} params.flow_hp_m3h - 高压级理论排量 (m³/h)
 * @param {number} params.eta_v_lp - 低压级容积效率
 * @param {number} params.eta_v_hp - 高压级容积效率
 * @param {number} params.eta_s_lp - 低压级等熵效率
 * @param {number} params.subcooling_K - 过冷度 (K)，用于中间冷却器ECO计算
 * @param {boolean} params.isEcoInterEnabled - 中间冷却器ECO是否启用
 * @param {string} params.ecoInterType - 中间冷却器ECO类型 ('flash_tank' | 'subcooler')
 * @param {number} params.ecoInterSuperheat_K - 中间冷却器ECO过热度 (K)
 * @param {number} params.ecoInterDt_K - 中间冷却器ECO过冷度/接近度 (K)
 * @returns {number|null} 最优中间压力 (Pa)，如果无法计算则返回 null
 */
function calculateOptimalIntermediatePressureM6({
    fluid,
    Te_C,
    Tc_C,
    superheat_K,
    flow_lp_m3h,
    flow_hp_m3h,
    eta_v_lp,
    eta_v_hp,
    eta_s_lp,
    subcooling_K = 5.0,
    isEcoInterEnabled = false,
    ecoInterType = 'flash_tank',
    ecoInterSuperheat_K = 5.0,
    ecoInterDt_K = 5.0
}) {
    if (!CP_INSTANCE) return null;
    
    try {
        const T_evap_K = Te_C + 273.15;
        const T_cond_K = Tc_C + 273.15;
        const Pe_Pa = CP_INSTANCE.PropsSI('P', 'T', T_evap_K, 'Q', 1, fluid);
        const Pc_Pa = CP_INSTANCE.PropsSI('P', 'T', T_cond_K, 'Q', 1, fluid);
        
        // 获取高压级理论排量
        let V_th_HP = null;
        if (flow_hp_m3h !== null && flow_hp_m3h > 0) {
            V_th_HP = flow_hp_m3h; // 高压级理论排量 (m³/h)
        } else {
            // 无法获取高压级排量，返回 null（将使用几何平均法）
            return null;
        }
        
        // =========================================================
        // 第一阶段：初始化与已知点计算
        // =========================================================
        
        // 状态点 1 (低压吸气)
        const T1_K = T_evap_K + superheat_K;
        const h1 = CP_INSTANCE.PropsSI('H', 'T', T1_K, 'P', Pe_Pa, fluid);
        const s1 = CP_INSTANCE.PropsSI('S', 'T', T1_K, 'P', Pe_Pa, fluid);
        const rho1 = CP_INSTANCE.PropsSI('D', 'T', T1_K, 'P', Pe_Pa, fluid);
        
        // 低压级质量流量
        const V_th_LP = flow_lp_m3h; // 低压级理论排量 (m³/h)
        const m_dot_lp = (V_th_LP * eta_v_lp * rho1) / 3600.0; // kg/s
        
        // 状态点 3 (冷凝器出口/过冷前)
        const T3_K = T_cond_K - subcooling_K;
        const h3 = CP_INSTANCE.PropsSI('H', 'T', T3_K, 'P', Pc_Pa, fluid);
        
        // =========================================================
        // 第二阶段：中间压力 P_mid 的迭代搜索
        // =========================================================
        
        // 初始值：几何平均法
        let P_intermediate_Pa = Math.sqrt(Pe_Pa * Pc_Pa);
        const P_min = Pe_Pa * 1.01; // 最小中间压力（略大于蒸发压力）
        const P_max = Pc_Pa * 0.99; // 最大中间压力（略小于冷凝压力）
        
        const maxIter = 100;
        const tolerance = 0.01; // 1% 容差
        
        let last_P = P_intermediate_Pa; // 用于检测振荡
        
        for (let iter = 0; iter < maxIter; iter++) {
            // 计算中间压力下的饱和温度
            const T_intermediate_sat_K = CP_INSTANCE.PropsSI('T', 'P', P_intermediate_Pa, 'Q', 0, fluid);
            
            // =========================================================
            // 1. 低压级出口 (点 2)
            // =========================================================
            // 等熵计算
            const h2s = CP_INSTANCE.PropsSI('H', 'P', P_intermediate_Pa, 'S', s1, fluid);
            // 实际焓（考虑等熵效率）
            const h2 = h1 + (h2s - h1) / eta_s_lp;
            
            // =========================================================
            // 2. 中间冷却器ECO计算（如果启用）
            // =========================================================
            let m_dot_inj_inter = 0;
            let h_6_inter = 0;
            
            if (isEcoInterEnabled) {
                if (ecoInterType === 'flash_tank') {
                    // 闪蒸罐模式：补气是饱和蒸汽（Q=1），不应有过热度
                    const h_eco_liq = CP_INSTANCE.PropsSI('H', 'T', T_intermediate_sat_K, 'Q', 0, fluid);
                    const h_eco_vap = CP_INSTANCE.PropsSI('H', 'T', T_intermediate_sat_K, 'Q', 1, fluid);
                    const h_7_inter = h3; // 从点3等焓节流到中间压力
                    
                    // 计算闪蒸干度
                    const x_flash = (h_7_inter - h_eco_liq) / (h_eco_vap - h_eco_liq);
                    if (x_flash > 0 && x_flash < 1) {
                        m_dot_inj_inter = m_dot_lp * (x_flash / (1 - x_flash));
                    }
                    
                    // 闪蒸罐模式下补气是饱和蒸汽，不使用过热度输入
                    h_6_inter = h_eco_vap;
                } else {
                    // 过冷器模式
                    const h_7_inter = h3; // 从点3等焓节流到中间压力
                    
                    // 主路出口 (点 5)：从 h3 冷却至 T_mid_sat + DT_approach（在冷凝压力下）
                    const T_5_K = T_intermediate_sat_K + ecoInterDt_K; // DT_approach 是过冷器接近度
                    const h_5 = CP_INSTANCE.PropsSI('H', 'T', T_5_K, 'P', Pc_Pa, fluid);
                    
                    // 补气路出口 (点 6)：在过冷器中吸热变为过热蒸汽（过热度为 DT_sh_mid，在中间压力下）
                    const T_inj_K = T_intermediate_sat_K + ecoInterSuperheat_K;
                    h_6_inter = CP_INSTANCE.PropsSI('H', 'T', T_inj_K, 'P', P_intermediate_Pa, fluid);
                    
                    // 能量平衡求补气量 m_dot_inj
                    // 主路放热 = 补气路吸热
                    // m_dot_lp * (h3 - h5) = m_dot_inj * (h6 - h7)
                    const h_diff_main = h3 - h_5;
                    const h_diff_inj = h_6_inter - h_7_inter;
                    
                    if (h_diff_main > 0 && h_diff_inj > 0) {
                        m_dot_inj_inter = (m_dot_lp * h_diff_main) / h_diff_inj;
                    }
                }
            }
            
            // 总质量流量（低压排气 + 中间冷却器补气）
            const m_dot_total = m_dot_lp + m_dot_inj_inter;
            
            // 边界情况检查：确保总质量流量有效
            if (m_dot_total <= 0 || !isFinite(m_dot_total)) {
                console.warn("Invalid m_dot_total in intermediate pressure calculation. Using geometric mean.");
                return Math.sqrt(Pe_Pa * Pc_Pa);
            }
            
            // =========================================================
            // 3. 高压级吸气 (点 3) - 混合后
            // =========================================================
            // 混合焓：低压排气与中间冷却器补气混合
            let h_mix;
            if (isEcoInterEnabled && m_dot_inj_inter > 0) {
                h_mix = (m_dot_lp * h2 + m_dot_inj_inter * h_6_inter) / m_dot_total;
            } else {
                h_mix = h2; // 无补气时，混合点等于低压排气
            }
            
            // 计算点 3 的比容和温度
            let T3_K, rho3;
            try {
                T3_K = CP_INSTANCE.PropsSI('T', 'H', h_mix, 'P', P_intermediate_Pa, fluid);
                rho3 = CP_INSTANCE.PropsSI('D', 'H', h_mix, 'P', P_intermediate_Pa, fluid);
            } catch (e) {
                console.warn("Error calculating T3 or rho3 in intermediate pressure calculation. Using geometric mean.");
                return Math.sqrt(Pe_Pa * Pc_Pa);
            }
            
            // 边界情况检查：确保密度有效
            if (rho3 <= 0 || !isFinite(rho3)) {
                console.warn("Invalid rho3 in intermediate pressure calculation. Using geometric mean.");
                return Math.sqrt(Pe_Pa * Pc_Pa);
            }
            
            // =========================================================
            // 4. 高压级需要的排量
            // =========================================================
            // 高压级质量流量 = 总质量流量
            // m_dot_total = (V_th_HP * eta_v_hp * rho3) / 3600.0
            // 因此：V_th_HP_required = (m_dot_total * 3600.0) / (eta_v_hp * rho3)
            const V_th_HP_required = (m_dot_total * 3600.0) / (eta_v_hp * rho3);
            
            // =========================================================
            // 5. 收敛判别
            // =========================================================
            // 比较 V_th_HP_required 与输入的 V_th_HP
            const flow_error = (V_th_HP_required - V_th_HP) / V_th_HP;
            
            if (Math.abs(flow_error) < tolerance) {
                // 收敛：高压级需要的排量与给定排量匹配
                break;
            }
            
            // 调整中间压力
            // 如果 V_th_HP_required > V_th_HP，说明高压级排量不足，需要提高中间压力（增加密度rho3）
            // 如果 V_th_HP_required < V_th_HP，说明高压级排量过大，需要降低中间压力（减少密度rho3）
            
            // 使用更稳定的调整策略
            let adjustment_factor;
            const abs_error = Math.abs(flow_error);
            
            if (abs_error > 0.1) {
                // 误差较大时，使用较大的调整步长（但限制最大变化）
                const sign = flow_error > 0 ? 1 : -1;
                adjustment_factor = 1.0 + sign * Math.min(abs_error * 0.2, 0.3); // 最大30%变化
            } else if (abs_error > 0.05) {
                // 中等误差
                const sign = flow_error > 0 ? 1 : -1;
                adjustment_factor = 1.0 + sign * abs_error * 0.15;
            } else {
                // 误差较小时，使用较小的调整步长
                const sign = flow_error > 0 ? 1 : -1;
                adjustment_factor = 1.0 + sign * abs_error * 0.1;
            }
            
            let P_new = P_intermediate_Pa * adjustment_factor;
            
            // 限制在合理范围内
            P_new = Math.max(P_min, Math.min(P_max, P_new));
            
            // 检查是否收敛（压力变化很小）
            const pressure_change = Math.abs(P_new - P_intermediate_Pa) / P_intermediate_Pa;
            if (pressure_change < 1e-6) {
                break;
            }
            
            // 防止振荡：如果压力变化方向与上次相反，减小步长
            if (iter > 0) {
                const last_change = P_intermediate_Pa - last_P;
                const current_change = P_new - P_intermediate_Pa;
                if (last_change * current_change < 0 && Math.abs(last_change) > 1e3) {
                    // 方向相反且变化较大，减小步长
                    P_new = P_intermediate_Pa + (P_new - P_intermediate_Pa) * 0.5;
                    P_new = Math.max(P_min, Math.min(P_max, P_new));
                }
            }
            
            last_P = P_intermediate_Pa;
            P_intermediate_Pa = P_new;
        }
        
        // 验证结果：只检查是否在基本范围内
        if (P_intermediate_Pa <= Pe_Pa || P_intermediate_Pa >= Pc_Pa) {
            // 结果不合理，返回几何平均法结果
            const P_intermediate_bar = P_intermediate_Pa / 1e5;
            const Pe_bar = Pe_Pa / 1e5;
            const Pc_bar = Pc_Pa / 1e5;
            console.warn(`Intermediate pressure out of range: ${P_intermediate_bar.toFixed(2)} bar (Pe=${Pe_bar.toFixed(2)}, Pc=${Pc_bar.toFixed(2)}). Using geometric mean.`);
            return Math.sqrt(Pe_Pa * Pc_Pa);
        }
        
        return P_intermediate_Pa;
        
    } catch (error) {
        console.warn("Calculate Optimal Intermediate Pressure M6 Error:", error.message);
        return null; // 出错时返回 null，将使用几何平均法
    }
}

// ---------------------------------------------------------------------
// Core Calculation Logic - Two-Stage Double Compressor
// ---------------------------------------------------------------------

// 低压级计算
function computeLowPressureStage({
    fluid,
    Te_C,
    P_intermediate_Pa,
    superheat_K,
    flow_m3h,
    eta_v,
    eta_s,
    T_2a_est_C = null,
    isEcoEnabled = false,
    ecoType = null,
    ecoSuperheat_K = 5,
    ecoDt_K = 5,
    h3 = null, // 冷凝器出口焓值，用于ECO计算
    Tc_C = null // 冷凝温度，用于计算经济器压力
}) {
    const T_evap_K = Te_C + 273.15;
    const Pe_Pa = CP_INSTANCE.PropsSI('P', 'T', T_evap_K, 'Q', 1, fluid);
    // 计算冷凝压力（用于经济器压力计算）
    let Pc_Pa = null;
    if (Tc_C !== null) {
        const T_cond_K = Tc_C + 273.15;
        Pc_Pa = CP_INSTANCE.PropsSI('P', 'T', T_cond_K, 'Q', 1, fluid);
    }

    // 点 1：蒸发器出口
    const T1_K = T_evap_K + superheat_K;
    const h1 = CP_INSTANCE.PropsSI('H', 'T', T1_K, 'P', Pe_Pa, fluid);
    const s1 = CP_INSTANCE.PropsSI('S', 'T', T1_K, 'P', Pe_Pa, fluid);
    const rho1 = CP_INSTANCE.PropsSI('D', 'T', T1_K, 'P', Pe_Pa, fluid);

    // 质量流量
    const V_th_m3_s = flow_m3h / 3600.0;
    let m_dot_suc = V_th_m3_s * eta_v * rho1;
    let m_dot_total = m_dot_suc;
    let m_dot_inj = 0;
    let h_5_lp = null, h_6_lp = null, h_7_lp = null;

    // ECO计算（低压级）- 从冷凝器出口（h3）等焓节流到经济器压力
    // 参考mode4的逻辑：使用几何平均法计算经济器压力，与单级模块完全一致
    if (isEcoEnabled && h3 !== null && Pc_Pa !== null) {
        // 使用几何平均法计算经济器压力（与单级模块一致）
        const P_eco_Pa = Math.sqrt(Pe_Pa * Pc_Pa);
        
        // 验证经济器压力合理性
        if (P_eco_Pa <= Pe_Pa || P_eco_Pa >= Pc_Pa) {
            throw new Error(`无效的经济器压力：P_eco (${(P_eco_Pa/1e5).toFixed(2)} bar) 必须在 P_evap 和 P_cond 之间`);
        }
        
        // 计算经济器压力下的饱和状态
        const T_eco_sat_K = CP_INSTANCE.PropsSI('T', 'P', P_eco_Pa, 'Q', 0, fluid);
        const h_eco_liq = CP_INSTANCE.PropsSI('H', 'T', T_eco_sat_K, 'Q', 0, fluid);
        const h_eco_vap = CP_INSTANCE.PropsSI('H', 'T', T_eco_sat_K, 'Q', 1, fluid);
        
        // 点7：从冷凝器出口（h3）等焓节流到经济器压力
        h_7_lp = h3; // 等焓节流：h7 = h3
        
        if (ecoType === 'flash_tank') {
            // 闪蒸罐模式：从h3等焓节流到经济器压力，在经济器压力下闪蒸
            h_5_lp = h_eco_liq; // 经济器压力下的饱和液体
            h_6_lp = h_eco_vap; // 经济器压力下的饱和蒸汽（用于补气）
            
            // 计算闪蒸干度
            const x_flash = (h_7_lp - h_5_lp) / (h_6_lp - h_5_lp);
            if (x_flash < 0 || x_flash > 1) {
                throw new Error(`闪蒸干度异常：x_flash = ${x_flash.toFixed(3)}，应在0-1之间`);
            }
            if (x_flash > 0 && x_flash < 1) {
                m_dot_inj = m_dot_suc * (x_flash / (1 - x_flash));
                m_dot_total = m_dot_suc + m_dot_inj;
            }
        } else if (ecoType === 'subcooler') {
            // 过冷器模式：主路在Pc_Pa下冷却，补气路在P_eco_Pa下加热
            // 点6：补气过热蒸汽（在P_eco_Pa下）
            const T_inj_K = T_eco_sat_K + ecoSuperheat_K;
            h_6_lp = CP_INSTANCE.PropsSI('H', 'T', T_inj_K, 'P', P_eco_Pa, fluid);
            
            // 点5：过冷器出口液体（在Pc_Pa高压下）
            // 从点3经过过冷器冷却，获得过冷度
            // ecoDt_K是相对于经济器压力饱和温度的过冷度
            const T_5_K = T_eco_sat_K + ecoDt_K;
            h_5_lp = CP_INSTANCE.PropsSI('H', 'T', T_5_K, 'P', Pc_Pa, fluid);
            
            // 能量平衡：主路放热 = 补气路吸热
            // 主路：从h3（冷凝器出口，在Pc_Pa下）到h5（过冷器出口，在Pc_Pa下）
            // 补气路：从h7（节流后，在P_eco_Pa下）到h6（过热蒸汽，在P_eco_Pa下）
            const h_diff_main = h3 - h_5_lp;
            const h_diff_inj = h_6_lp - h_7_lp;
            
            if (h_diff_main <= 0 || h_diff_inj <= 0) {
                throw new Error(`过冷器能量平衡异常：主路放热=${h_diff_main.toFixed(1)} J/kg，支路吸热=${h_diff_inj.toFixed(1)} J/kg`);
            }
            m_dot_inj = (m_dot_suc * h_diff_main) / h_diff_inj;
            m_dot_total = m_dot_suc + m_dot_inj;
        }
    }

    // 压缩功计算（与单级模块一致的两级压缩逻辑）
    let W_shaft = 0;
    let h_mid_1s = 0, h_mid_actual = 0, h_mix_lp = 0, h_2s_stage2 = 0;
    
    if (!isEcoEnabled || m_dot_inj === 0) {
        // 无经济器或经济器无补气：单级压缩到中间压力
        h_mid_1s = CP_INSTANCE.PropsSI('H', 'P', P_intermediate_Pa, 'S', s1, fluid);
        const W_s1_ideal = m_dot_suc * (h_mid_1s - h1);
        W_shaft = W_s1_ideal / eta_s;
        h_mix_lp = h_mid_1s;
    } else {
        // 有经济器补气：两级压缩（先到经济器压力，再补气混合，最后到中间压力）
        // 需要先计算经济器压力
        const P_eco_Pa = Math.sqrt(Pe_Pa * Pc_Pa);
        
        // 第一阶段压缩：从蒸发压力压缩到经济器压力
        h_mid_1s = CP_INSTANCE.PropsSI('H', 'P', P_eco_Pa, 'S', s1, fluid);
        const W_s1_ideal = m_dot_suc * (h_mid_1s - h1);
        
        // 计算实际第一级压缩后的焓值（考虑等熵效率）
        h_mid_actual = h1 + (h_mid_1s - h1) / eta_s;
        const W_s1 = W_s1_ideal / eta_s;
        
        // 补气混合过程（在经济器压力下）
        // 混合焓值计算（质量加权平均）
        h_mix_lp = (m_dot_suc * h_mid_actual + m_dot_inj * h_6_lp) / m_dot_total;
        
        // 计算混合后的熵值（用于第二阶段等熵压缩）
        const s_mix = CP_INSTANCE.PropsSI('S', 'H', h_mix_lp, 'P', P_eco_Pa, fluid);
        
        // 第二阶段压缩：从混合点压缩到中间压力
        h_2s_stage2 = CP_INSTANCE.PropsSI('H', 'P', P_intermediate_Pa, 'S', s_mix, fluid);
        const W_s2_ideal = m_dot_total * (h_2s_stage2 - h_mix_lp);
        const W_s2 = W_s2_ideal / eta_s;
        
        // 总压缩功
        W_shaft = W_s1 + W_s2;
        
        // 更新h_mix_lp为第二阶段压缩后的状态（用于后续计算）
        // 实际压缩后的焓值
        const h_mix_actual = h_mix_lp + (h_2s_stage2 - h_mix_lp) / eta_s;
        h_mix_lp = h_mix_actual;
    }

    // 排气温度计算
    // 排气状态：压缩后的状态（在中间压力下），考虑实际压缩效率
    // 如果有经济器，h_mix_lp已经是第二阶段压缩后的实际焓值
    // 如果没有经济器，h_mix_lp是第一级压缩后的等熵焓值，需要转换为实际焓值
    let h_2a_calculated;
    if (!isEcoEnabled || m_dot_inj === 0) {
        // 无经济器：从等熵焓值转换为实际焓值
        const h_2s = h_mix_lp; // h_mix_lp就是等熵压缩到中间压力的焓值
        h_2a_calculated = h1 + (h_2s - h1) / eta_s;
    } else {
        // 有经济器：h_mix_lp已经是第二阶段压缩后的实际焓值
        h_2a_calculated = h_mix_lp;
    }
    const T_2a_calculated_K = CP_INSTANCE.PropsSI('T', 'P', P_intermediate_Pa, 'H', h_2a_calculated, fluid);
    const T_2a_calculated_C = T_2a_calculated_K - 273.15;
    
    // 低压级排气温度：如果输入了设计值，需要判断计算值与设计值的关系
    let h_2a = 0;
    let T_2a_C = 0;
    if (T_2a_est_C !== null && !isNaN(T_2a_est_C)) {
        // 用户输入了设计排温
        // 如果计算值小于设计值，使用计算值（实际排温更低，不需要油冷）
        // 如果计算值大于等于设计值，使用设计值（需要油冷来达到设计值）
        if (T_2a_calculated_C < T_2a_est_C) {
            // 计算值小于设计值，使用计算值
            h_2a = h_2a_calculated;
            T_2a_C = T_2a_calculated_C;
        } else {
            // 计算值大于等于设计值，使用设计值
            const T_2a_est_K = T_2a_est_C + 273.15;
            h_2a = CP_INSTANCE.PropsSI('H', 'T', T_2a_est_K, 'P', P_intermediate_Pa, fluid);
            T_2a_C = T_2a_est_C;
        }
    } else {
        // 未输入设计排温，使用实际计算值
        h_2a = h_2a_calculated;
        T_2a_C = T_2a_calculated_C;
    }

    // 油冷负荷计算（基于实际排气状态）
    // 如果用户输入了设计排温，使用设计值计算油冷负荷；否则使用计算值
    const h_system_in_lp = m_dot_suc * h1 + (isEcoEnabled && m_dot_inj > 0 ? m_dot_inj * h_6_lp : 0);
    // 使用实际的排气焓值（可能是设计值或计算值）来计算油冷负荷
    const energy_out_gas = m_dot_total * h_2a;
    // 能量平衡：W_shaft + h_system_in_lp = energy_out_gas + Q_oil_lp_W
    // 所以：Q_oil_lp_W = W_shaft + h_system_in_lp - energy_out_gas
    let Q_oil_lp_W = W_shaft + h_system_in_lp - energy_out_gas;
    if (Q_oil_lp_W < 0) Q_oil_lp_W = 0;

    return {
        Pe_Pa,
        m_dot: m_dot_total,
        m_dot_suc,
        m_dot_inj,
        h1,
        h_mid: h_mid_1s, // 第一级等熵压缩状态（有经济器时到经济器压力，无经济器时到中间压力）
        h_mix: h_mix_lp, // 最终排气状态（在中间压力下）
        h_2s_stage2: h_2s_stage2, // 等熵压缩终点（有经济器时为第二阶段，无经济器时为单级）
        h2a: h_2a,
        h5: h_5_lp,
        h6: h_6_lp,
        h7: h_7_lp,
        T1_K,
        T2a_C: T_2a_C,
        W_shaft_W: W_shaft,
        Q_oil_W: Q_oil_lp_W
    };
}

// 高压级计算

// 高压级计算
function computeHighPressureStage({
    fluid,
    P_intermediate_Pa,
    Pe_Pa, // 蒸发压力，用于节流计算
    Tc_C,
    superheat_K,
    subcooling_K,
    flow_m3h,
    eta_v,
    eta_s,
    m_dot_lp, // 来自低压级的流量（包含中间冷却器ECO补气）
    h_mix, // 混合后的焓值（高压级压缩起点，包含中间冷却器ECO补气，但不包含高压级ECO补气）
    // 高压级ECO参数
    isEcoEnabled = false,
    ecoType = 'flash_tank', // 'flash_tank' | 'subcooler'
    ecoSuperheat_K = 5,
    ecoDt_K = 5.0,
    T_2a_est_C = null
}) {
    const T_cond_K = Tc_C + 273.15;
    const Pc_Pa = CP_INSTANCE.PropsSI('P', 'T', T_cond_K, 'Q', 1, fluid);

    // 点 1：高压级入口（中间压力下的状态）
    // 应该使用低压级混合后的状态（h_mix），而不是重新计算
    // 从h_mix计算对应的温度和熵
    let h1, T1_K, s1, rho1;
    if (h_mix !== null && h_mix !== undefined) {
        // 使用传入的混合焓值
        h1 = h_mix;
        T1_K = CP_INSTANCE.PropsSI('T', 'H', h1, 'P', P_intermediate_Pa, fluid);
        s1 = CP_INSTANCE.PropsSI('S', 'H', h1, 'P', P_intermediate_Pa, fluid);
        rho1 = CP_INSTANCE.PropsSI('D', 'H', h1, 'P', P_intermediate_Pa, fluid);
    } else {
        // 如果没有传入h_mix，使用默认计算（向后兼容）
        const T_intermediate_sat_K = CP_INSTANCE.PropsSI('T', 'P', P_intermediate_Pa, 'Q', 0, fluid);
        T1_K = T_intermediate_sat_K + superheat_K;
        h1 = CP_INSTANCE.PropsSI('H', 'T', T1_K, 'P', P_intermediate_Pa, fluid);
        s1 = CP_INSTANCE.PropsSI('S', 'T', T1_K, 'P', P_intermediate_Pa, fluid);
        rho1 = CP_INSTANCE.PropsSI('D', 'T', T1_K, 'P', P_intermediate_Pa, fluid);
    }

    // 点 3：冷凝器出口（含过冷）
    const T3_K = T_cond_K - subcooling_K;
    const h3 = CP_INSTANCE.PropsSI('H', 'T', T3_K, 'P', Pc_Pa, fluid);

    // =========================================================
    // 高压级ECO计算（参考computeSingleStageCycle的实现）
    // =========================================================
    let m_dot_inj_hp = 0, m_dot_total_hp = m_dot_lp;
    let h_5_hp = h3, h_6_hp = 0, h_7_hp = h3;
    let P_eco_Pa = 0, T_eco_sat_K = 0;
    let h_mid_1s = 0, h_mid_actual = 0, h_2s_stage2 = 0;
    let h_mix_after_eco = h_mix; // 高压级ECO补气混合后的状态
    
    // 确定压缩起点：必须使用h_mix（混合点），这是高压级压缩的起点
    const h_compression_start = (h_mix !== null && h_mix !== undefined) ? h_mix : h1;
    
    if (isEcoEnabled) {
        // 确定经济器压力 P_eco_Pa（使用几何平均法）
        P_eco_Pa = Math.sqrt(Pe_Pa * Pc_Pa);
        T_eco_sat_K = CP_INSTANCE.PropsSI('T', 'P', P_eco_Pa, 'Q', 0, fluid);
        
        // 验证经济器压力合理性
        if (P_eco_Pa <= Pe_Pa || P_eco_Pa >= Pc_Pa) {
            throw new Error(`无效的经济器压力：P_eco (${(P_eco_Pa/1e5).toFixed(2)} bar) 必须在 P_evap 和 P_cond 之间`);
        }
        
        // 计算经济器压力下的饱和状态
        const h_eco_liq = CP_INSTANCE.PropsSI('H', 'T', T_eco_sat_K, 'Q', 0, fluid);
        const h_eco_vap = CP_INSTANCE.PropsSI('H', 'T', T_eco_sat_K, 'Q', 1, fluid);
        
        // 点7：从点3等焓节流到经济器压力
        h_7_hp = h3;
        
        // 验证ecoType的值
        if (ecoType !== 'flash_tank' && ecoType !== 'subcooler') {
            throw new Error(`无效的ecoType值: "${ecoType}"，必须是'flash_tank'或'subcooler'`);
        }
        
        if (ecoType === 'flash_tank') {
            // =========================================================
            // 闪发箱模式（Flash Tank）
            // =========================================================
            // 点5：闪发箱底部饱和液体（在P_eco_Pa下）
            h_5_hp = h_eco_liq;
            
            // 点6：闪发箱顶部饱和蒸汽（在P_eco_Pa下）
            h_6_hp = h_eco_vap;
            
            // 计算闪蒸干度
            const x_flash = (h_7_hp - h_5_hp) / (h_6_hp - h_5_hp);
            
            // 验证干度合理性
            if (x_flash < 0 || x_flash > 1) {
                throw new Error(`闪蒸干度异常：x_flash = ${x_flash.toFixed(3)}，应在0-1之间`);
            }
            
            // 计算补气流量（基于质量守恒和能量守恒）
            // 基准流量：m_dot_lp（包含中间冷却器ECO补气）
            m_dot_inj_hp = m_dot_lp * (x_flash / (1 - x_flash));
            m_dot_total_hp = m_dot_lp + m_dot_inj_hp;
            
        } else if (ecoType === 'subcooler') {
            // =========================================================
            // 板换过冷器模式（Subcooler）
            // =========================================================
            // 点6：补气过热蒸汽（在P_eco_Pa下）
            const T_inj_K = T_eco_sat_K + ecoSuperheat_K;
            h_6_hp = CP_INSTANCE.PropsSI('H', 'T', T_inj_K, 'P', P_eco_Pa, fluid);
            
            // 点5：过冷器出口液体（在Pc_Pa高压下）
            // ecoDt_K是相对于经济器压力饱和温度的过冷度
            const T_5_K = T_eco_sat_K + ecoDt_K;
            h_5_hp = CP_INSTANCE.PropsSI('H', 'T', T_5_K, 'P', Pc_Pa, fluid);
            
            // 能量平衡计算补气流量
            // 主路放热 = 支路吸热
            // m_dot_lp × (h3 - h5) = m_inj × (h6 - h7)
            const h_diff_main = h3 - h_5_hp;  // 主路过冷放热
            const h_diff_inj = h_6_hp - h_7_hp;  // 支路加热吸热
            
            // 验证能量平衡合理性
            if (h_diff_main <= 0 || h_diff_inj <= 0) {
                throw new Error(`过冷器能量平衡异常：主路放热=${h_diff_main.toFixed(1)} J/kg，支路吸热=${h_diff_inj.toFixed(1)} J/kg`);
            }
            
            m_dot_inj_hp = (m_dot_lp * h_diff_main) / h_diff_inj;
            m_dot_total_hp = m_dot_lp + m_dot_inj_hp;
        }
    }
    
    // =========================================================
    // 压缩功计算（与单级模块一致的两级压缩逻辑）
    // =========================================================
    let W_shaft = 0;
    
    if (!isEcoEnabled || m_dot_inj_hp === 0) {
        // 无经济器或经济器无补气：单级压缩到冷凝压力
        const s_start = CP_INSTANCE.PropsSI('S', 'H', h_compression_start, 'P', P_intermediate_Pa, fluid);
        h_2s_stage2 = CP_INSTANCE.PropsSI('H', 'P', Pc_Pa, 'S', s_start, fluid);
        const W_s2_ideal = m_dot_total_hp * (h_2s_stage2 - h_compression_start);
        W_shaft = W_s2_ideal / eta_s;
        h_mix_after_eco = h_compression_start;
    } else {
        // 有经济器补气：两级压缩（先到经济器压力，再补气混合，最后到冷凝压力）
        // 第一阶段压缩：从中间压力压缩到经济器压力
        const s_start = CP_INSTANCE.PropsSI('S', 'H', h_compression_start, 'P', P_intermediate_Pa, fluid);
        h_mid_1s = CP_INSTANCE.PropsSI('H', 'P', P_eco_Pa, 'S', s_start, fluid);
        const W_s1_ideal = m_dot_lp * (h_mid_1s - h_compression_start);
        
        // 计算实际第一级压缩后的焓值（考虑等熵效率）
        h_mid_actual = h_compression_start + (h_mid_1s - h_compression_start) / eta_s;
        const W_s1 = W_s1_ideal / eta_s;
        
        // 补气混合过程（在经济器压力下）
        // 混合焓值计算（质量加权平均）
        h_mix_after_eco = (m_dot_lp * h_mid_actual + m_dot_inj_hp * h_6_hp) / m_dot_total_hp;
        
        // 验证混合逻辑：h_mix应该小于h_mid_actual（因为h_6_hp < h_mid_actual）
        if (h_mix_after_eco >= h_mid_actual) {
            console.warn(`混合逻辑异常：h_mix_after_eco (${h_mix_after_eco.toFixed(1)} J/kg) >= h_mid_actual (${h_mid_actual.toFixed(1)} J/kg)，补气温度可能异常`);
        }
        
        // 计算混合后的熵值（用于第二阶段等熵压缩）
        const s_mix = CP_INSTANCE.PropsSI('S', 'H', h_mix_after_eco, 'P', P_eco_Pa, fluid);
        
        // 第二阶段压缩：从混合点压缩到冷凝压力
        h_2s_stage2 = CP_INSTANCE.PropsSI('H', 'P', Pc_Pa, 'S', s_mix, fluid);
        const W_s2_ideal = m_dot_total_hp * (h_2s_stage2 - h_mix_after_eco);
        const W_s2 = W_s2_ideal / eta_s;
        
        // 总压缩功
        W_shaft = W_s1 + W_s2;
        
        // 更新h_mix_after_eco为第二阶段压缩后的实际状态（用于后续计算）
        const h_mix_actual = h_mix_after_eco + (h_2s_stage2 - h_mix_after_eco) / eta_s;
        h_mix_after_eco = h_mix_actual;
    }
    
    // 更新h1为压缩起点（用于状态点表）
    h1 = h_compression_start;
    T1_K = CP_INSTANCE.PropsSI('T', 'H', h1, 'P', P_intermediate_Pa, fluid);
    s1 = CP_INSTANCE.PropsSI('S', 'H', h1, 'P', P_intermediate_Pa, fluid);
    
    // 验证：压缩过程等熵焓值应该增加
    if (h_2s_stage2 < h_mix_after_eco && (!isEcoEnabled || m_dot_inj_hp === 0)) {
        console.warn(`Warning: Isentropic compression enthalpy decreases (h_2s=${h_2s_stage2}, h_mix_after_eco=${h_mix_after_eco}). Check pressure ratio.`);
    }
    
    // 验证：压缩功应该为正数
    if (W_shaft < 0) {
        console.warn(`Warning: Negative compression work (W_shaft=${W_shaft}). Check pressure ratio and efficiency.`);
    }

    // 排气温度计算（考虑润滑油冷却的影响）
    // 实际排气状态应该是：压缩后的状态减去油冷带走的热量
    let T_2a_C = 0;
    let h_2a = 0;
    
    // 先计算不考虑油冷的排气焓值（压缩后的状态）
    // h_mix_after_eco已经是压缩后的实际焓值（如果有经济器，是第二阶段压缩后的实际焓值）
    const h_2a_no_oil = h_mix_after_eco;
    
    // 先通过迭代计算实际排温（考虑油冷）
    let h_2a_calculated = h_2a_no_oil; // 初始值
    const h_system_in_hp = m_dot_total_hp * h_mix_after_eco;
    
    for (let iter = 0; iter < 10; iter++) {
        const energy_out_gas = m_dot_total_hp * h_2a_calculated;
        let Q_oil_hp_W = W_shaft + h_system_in_hp - energy_out_gas;
        if (Q_oil_hp_W < 0) Q_oil_hp_W = 0;
        const h_2a_new = h_2a_no_oil - (Q_oil_hp_W / m_dot_total_hp);
        if (Math.abs(h_2a_new - h_2a_calculated) < 1e-3) {
            h_2a_calculated = h_2a_new;
            break;
        }
        h_2a_calculated = h_2a_new;
    }
    
    const T_2a_calculated_K = CP_INSTANCE.PropsSI('T', 'P', Pc_Pa, 'H', h_2a_calculated, fluid);
    const T_2a_calculated_C = T_2a_calculated_K - 273.15;
    
    // 高压级排气温度：如果输入了设计值，直接使用设计值（不进行物理合理性检查）
    if (T_2a_est_C !== null && !isNaN(T_2a_est_C)) {
        // 用户输入了设计排温，直接使用设计值
        const T_2a_est_K = T_2a_est_C + 273.15;
        h_2a = CP_INSTANCE.PropsSI('H', 'T', T_2a_est_K, 'P', Pc_Pa, fluid);
        T_2a_C = T_2a_est_C;
    } else {
        // 未输入设计排温，使用实际计算值
        h_2a = h_2a_calculated;
        T_2a_C = T_2a_calculated_C;
    }

    // 节流（根据ECO类型确定节流压力）
    // 注意：双机双级模式中，最终节流到蒸发压力Pe_Pa（不是中间压力）
    let h4, T4_C, h4_pressure;
    if (isEcoEnabled && ecoType === 'flash_tank') {
        // 闪蒸罐模式：液体从闪蒸罐底部节流到蒸发压力
        h4 = h_5_hp; // 使用闪蒸罐底部液体焓值
        h4_pressure = Pe_Pa; // 节流到蒸发压力
        const T4_K = CP_INSTANCE.PropsSI('T', 'P', h4_pressure, 'H', h4, fluid);
        T4_C = T4_K - 273.15;
    } else if (isEcoEnabled && ecoType === 'subcooler') {
        // 过冷器模式：从点5（过冷器出口）等焓节流到蒸发压力
        h4 = h_5_hp; // 使用过冷器出口焓值（等焓节流到蒸发压力）
        h4_pressure = Pe_Pa; // 节流到蒸发压力
        const T4_K = CP_INSTANCE.PropsSI('T', 'P', h4_pressure, 'H', h4, fluid);
        T4_C = T4_K - 273.15;
    } else {
        // 无ECO模式：直接节流到蒸发压力
        h4 = h3;
        h4_pressure = Pe_Pa; // 节流到蒸发压力
        const T4_K = CP_INSTANCE.PropsSI('T', 'P', h4_pressure, 'H', h4, fluid);
        T4_C = T4_K - 273.15;
    }

    // 冷凝放热（使用实际排气焓值，已考虑油冷）
    const Q_cond_W = m_dot_total_hp * (h_2a - h3);

    // 油冷负荷计算（基于实际排气状态）
    const energy_out_gas = m_dot_total_hp * h_2a;
    // 能量平衡：W_shaft + h_system_in_hp = energy_out_gas + Q_oil_hp_W
    // 所以：Q_oil_hp_W = W_shaft + h_system_in_hp - energy_out_gas
    let Q_oil_hp_W = W_shaft + h_system_in_hp - energy_out_gas;
    if (Q_oil_hp_W < 0) Q_oil_hp_W = 0;

    return {
        Pc_Pa,
        Pe_Pa: Pe_Pa || P_intermediate_Pa, // 传递蒸发压力
        m_dot: m_dot_total_hp,
        m_dot_inj: m_dot_inj_hp, // 高压级ECO补气流量
        h1,
        h_mid: h_mid_1s, // 第一级等熵压缩状态（有经济器时到经济器压力，无经济器时为0）
        h_mid_actual: h_mid_actual, // 第一级实际压缩状态（用于T-s图）
        h_mix: h_mix_after_eco, // 最终排气状态（在冷凝压力下，包含高压级ECO补气混合）
        h_2s_stage2: h_2s_stage2, // 等熵压缩终点（有经济器时为第二阶段，无经济器时为单级）
        h2a: h_2a,
        h3: h3,
        h4,
        h4_pressure: h4_pressure || Pe_Pa || P_intermediate_Pa,
        h5: h_5_hp,
        h6: h_6_hp,
        h7: h_7_hp,
        T1_K,
        T2a_C: T_2a_C,
        T3_K,
        T4_C,
        W_shaft_W: W_shaft,
        Q_cond_W,
        Q_oil_W: Q_oil_hp_W,
        isEcoEnabled,
        ecoType,
        P_eco_Pa: isEcoEnabled ? P_eco_Pa : null,
        T_eco_sat_K: isEcoEnabled ? T_eco_sat_K : null
    };
}

function calculateMode6() {
    renderToAllViews('<div class="flex justify-center p-10"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>');
    ['chart-desktop-m6', 'chart-mobile-m6'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    setTimeout(() => {
        try {
            // 读取输入
            const fluid = fluidSelect.value;
            const Te_C = parseFloat(tempEvapInput.value);
            const Tc_C = parseFloat(tempCondInput.value);
            let shLp_K = parseFloat(superheatInput.value);
            // 过热度为0时会导致计算错误，使用0.001代替
            if (shLp_K === 0 || Math.abs(shLp_K) < 0.0001) {
                shLp_K = 0.001;
            }
            const scHp_K = parseFloat(subcoolInput.value);

            // 低压级流量
            let flowLp = parseFloat(flowLpInput.value);
            if (compressorModelLp && compressorModelLp.value) {
                const brand = compressorBrandLp.value;
                const series = compressorSeriesLp.value;
                const model = compressorModelLp.value;
                const displacement = getDisplacementByModel(brand, series, model);
                if (displacement !== null && (isNaN(flowLp) || flowLp <= 0)) {
                    flowLp = displacement;
                }
            }

            const eta_v_lp = parseFloat(etaVLpInput.value);
            const eta_s_lp = parseFloat(etaSLpInput.value);

            // 高压级流量
            let flowHp = parseFloat(flowHpInput.value);
            if (compressorModelHp && compressorModelHp.value) {
                const brand = compressorBrandHp.value;
                const series = compressorSeriesHp.value;
                const model = compressorModelHp.value;
                const displacement = getDisplacementByModel(brand, series, model);
                if (displacement !== null && (isNaN(flowHp) || flowHp <= 0)) {
                    flowHp = displacement;
                }
            }

            const eta_v_hp = parseFloat(etaVHpInput.value);
            const eta_s_hp = parseFloat(etaSHpInput.value);

            // 中间压力设置
            const interPressModeValue = document.querySelector('input[name="inter_press_mode_m6"]:checked')?.value || 'auto';
            const interSatTempValue = interSatTempInput ? parseFloat(interSatTempInput.value) : null;

            // ECO参数 - 中间冷却器（始终启用）
            const isEcoEnabled = true; // 中间冷却器是必选项
            const ecoTypeValue = document.querySelector('input[name="eco_type_m6"]:checked')?.value || 'flash_tank';
            // 根据ECO类型选择过热度输入框
            // 闪蒸罐模式：使用补气过热度输入（但补气是饱和蒸汽，过热度为0）
            // 过冷器模式：使用补气过热度输入（补气需要过热）
            const ecoSuperheatValue = ecoTypeValue === 'flash_tank' 
                ? 0  // 闪蒸罐模式下过热度固定为0
                : (ecoSuperheatInputSubcooler ? parseFloat(ecoSuperheatInputSubcooler.value) : 5);
            const ecoDtValue = ecoDtInput ? parseFloat(ecoDtInput.value) : 5.0;
            
            // ECO参数 - 低压级
            const isEcoEnabledLp = ecoCheckboxLp && ecoCheckboxLp.checked;
            const ecoTypeLpValue = isEcoEnabledLp ? (document.querySelector('input[name="eco_type_m6_lp"]:checked')?.value || 'flash_tank') : null;
            // 闪蒸罐模式：过热度固定为0；过冷器模式：读取输入框值
            const ecoSuperheatLpValue = (ecoTypeLpValue === 'flash_tank') 
                ? 0  // 闪蒸罐模式下过热度固定为0
                : (ecoSuperheatInputLp ? parseFloat(ecoSuperheatInputLp.value) : 5);
            const ecoDtLpValue = ecoDtInputLp ? parseFloat(ecoDtInputLp.value) : 5.0;
            
            // ECO参数 - 高压级
            const isEcoEnabledHp = ecoCheckboxHp && ecoCheckboxHp.checked;
            const ecoTypeHpValue = isEcoEnabledHp ? (document.querySelector('input[name="eco_type_m6_hp"]:checked')?.value || 'flash_tank') : null;
            // 闪蒸罐模式：过热度固定为0；过冷器模式：读取输入框值
            const ecoSuperheatHpValue = (ecoTypeHpValue === 'flash_tank')
                ? 0  // 闪蒸罐模式下过热度固定为0
                : (ecoSuperheatInputHp ? parseFloat(ecoSuperheatInputHp.value) : 5);
            const ecoDtHpValue = ecoDtInputHp ? parseFloat(ecoDtInputHp.value) : 5.0;

            // 排气温度
            const T_2a_est_Lp_C = tempDischargeActualLpInput ? parseFloat(tempDischargeActualLpInput.value) : null;
            const T_2a_est_Hp_C = tempDischargeActualHpInput ? parseFloat(tempDischargeActualHpInput.value) : null;

            // 验证输入
            if (isNaN(Te_C) || isNaN(Tc_C) || isNaN(shLp_K) || isNaN(scHp_K) || 
                isNaN(flowLp) || isNaN(flowHp) || isNaN(eta_v_lp) || isNaN(eta_s_lp) || 
                isNaN(eta_v_hp) || isNaN(eta_s_hp)) {
                throw new Error('请输入完整且有效的数值参数。');
            }

            if (flowLp <= 0 || flowHp <= 0 || eta_v_lp <= 0 || eta_s_lp <= 0 || 
                eta_v_hp <= 0 || eta_s_hp <= 0 || shLp_K < 0 || scHp_K < 0) {
                throw new Error('流量和效率必须大于0，过热度/过冷度不能为负。');
            }

            if (Tc_C <= Te_C) {
                throw new Error('冷凝温度必须高于蒸发温度。');
            }

            if (interPressModeValue === 'manual' && (isNaN(interSatTempValue) || interSatTempValue === null)) {
                throw new Error('手动模式下必须指定中间饱和温度。');
            }

            // 确定中间压力
            const T_evap_K = Te_C + 273.15;
            const T_cond_K = Tc_C + 273.15;
            const Pe_Pa = CP_INSTANCE.PropsSI('P', 'T', T_evap_K, 'Q', 1, fluid);
            const Pc_Pa = CP_INSTANCE.PropsSI('P', 'T', T_cond_K, 'Q', 1, fluid);

            let P_intermediate_Pa, T_intermediate_sat_K;
            if (interPressModeValue === 'auto') {
                // 自动模式：优先使用基于流量法的优化算法
                // 获取压缩机参数（用于优化中间压力计算）
                let disp_lp = null, disp_hp = null;
                if (compressorBrandLp && compressorSeriesLp && compressorModelLp &&
                    compressorBrandHp && compressorSeriesHp && compressorModelHp) {
                    const brandLp = compressorBrandLp.value;
                    const seriesLp = compressorSeriesLp.value;
                    const modelLp = compressorModelLp.value;
                    const brandHp = compressorBrandHp.value;
                    const seriesHp = compressorSeriesHp.value;
                    const modelHp = compressorModelHp.value;
                    
                    if (brandLp && seriesLp && modelLp) {
                        const detailLp = getModelDetail(brandLp, seriesLp, modelLp);
                        if (detailLp) {
                            if (typeof detailLp.disp_lp === 'number') {
                                disp_lp = detailLp.disp_lp;
                            } else if (typeof detailLp.displacement === 'number') {
                                disp_lp = detailLp.displacement;
                            }
                        }
                    }
                    
                    if (brandHp && seriesHp && modelHp) {
                        const detailHp = getModelDetail(brandHp, seriesHp, modelHp);
                        if (detailHp) {
                            if (typeof detailHp.disp_hp === 'number') {
                                disp_hp = detailHp.disp_hp;
                            } else if (typeof detailHp.displacement === 'number') {
                                disp_hp = detailHp.displacement;
                            }
                        }
                    }
                }
                
                // 如果无法从型号获取，尝试使用输入的流量值
                if (disp_lp === null || disp_lp <= 0) {
                    disp_lp = flowLp;
                }
                if (disp_hp === null || disp_hp <= 0) {
                    disp_hp = flowHp;
                }
                
                // 优先使用流量法计算
                if (disp_lp > 0 && disp_hp > 0) {
                    const optimalPressure = calculateOptimalIntermediatePressureM6({
                        fluid,
                        Te_C,
                        Tc_C,
                        superheat_K: shLp_K,
                        flow_lp_m3h: disp_lp,
                        flow_hp_m3h: disp_hp,
                        eta_v_lp,
                        eta_v_hp,
                        eta_s_lp,
                        subcooling_K: scHp_K,
                        isEcoInterEnabled: isEcoEnabled,
                        ecoInterType: ecoTypeValue,
                        ecoInterSuperheat_K: ecoSuperheatValue,
                        ecoInterDt_K: ecoDtValue
                    });
                    
                    if (optimalPressure !== null && optimalPressure > Pe_Pa && optimalPressure < Pc_Pa) {
                        // 使用优化算法结果
                        P_intermediate_Pa = optimalPressure;
                        T_intermediate_sat_K = CP_INSTANCE.PropsSI('T', 'P', P_intermediate_Pa, 'Q', 0, fluid);
                    } else {
                        // 回退到几何平均法
                        P_intermediate_Pa = Math.sqrt(Pe_Pa * Pc_Pa);
                        T_intermediate_sat_K = CP_INSTANCE.PropsSI('T', 'P', P_intermediate_Pa, 'Q', 0, fluid);
                    }
                } else {
                    // 无法获取排量参数，使用几何平均法
                    P_intermediate_Pa = Math.sqrt(Pe_Pa * Pc_Pa);
                    T_intermediate_sat_K = CP_INSTANCE.PropsSI('T', 'P', P_intermediate_Pa, 'Q', 0, fluid);
                }
            } else {
                // 手动模式：用户指定中间饱和温度
                T_intermediate_sat_K = interSatTempValue + 273.15;
                P_intermediate_Pa = CP_INSTANCE.PropsSI('P', 'T', T_intermediate_sat_K, 'Q', 0.5, fluid);
            }

            if (P_intermediate_Pa <= Pe_Pa || P_intermediate_Pa >= Pc_Pa) {
                throw new Error(`无效的中间压力：P_intermediate (${(P_intermediate_Pa/1e5).toFixed(2)} bar) 必须在 P_s 和 P_d 之间`);
            }

            // 先计算冷凝器出口状态（用于高压级ECO计算）
            const T3_K = T_cond_K - scHp_K;
            const h3 = CP_INSTANCE.PropsSI('H', 'T', T3_K, 'P', Pc_Pa, fluid);

            // 计算低压级（带ECO支持）
            const lpStage = computeLowPressureStage({
                fluid,
                Te_C,
                P_intermediate_Pa,
                superheat_K: shLp_K,
                flow_m3h: flowLp,
                eta_v: eta_v_lp,
                eta_s: eta_s_lp,
                T_2a_est_C: T_2a_est_Lp_C,
                isEcoEnabled: isEcoEnabledLp,
                ecoType: ecoTypeLpValue,
                ecoSuperheat_K: ecoSuperheatLpValue,
                ecoDt_K: ecoDtLpValue,
                h3: h3, // 传入冷凝器出口焓值，用于ECO计算
                Tc_C: Tc_C // 传入冷凝温度，用于计算经济器压力
            });

            // 计算混合状态（用于高压级）
            // 这是高压级压缩的起点（混合点），不包含高压级ECO补气
            let h_mix, h_mid_1s;
            if (isEcoEnabledLp && lpStage.m_dot_inj > 0) {
                // 低压级有ECO补气
                h_mid_1s = lpStage.h_mid;
                h_mix = lpStage.h_mix; // 低压级混合后的状态
            } else {
                // 无ECO，直接使用低压级排气状态
                h_mid_1s = lpStage.h_mid;
                h_mix = lpStage.h2a; // 低压级排气状态
            }
            
            // 保存初始混合点（不包含高压级ECO补气），用于高压级压缩起点
            const h_mix_initial = h_mix;

            // 中间冷却器ECO计算（始终启用，与mode5逻辑一致）
            let h_5_inter = h3, h_6_inter = 0, h_7_inter = h3;
            let m_dot_inj_inter = 0, m_dot_total_inter = lpStage.m_dot;
            
            if (ecoTypeValue === 'flash_tank') {
                // 闪蒸罐模式：补气是饱和蒸汽（Q=1），不应有过热度
                // 闪蒸罐的工作原理：从冷凝器出口的液体（h3）等焓节流到中间压力，
                // 在中间压力下发生闪蒸，产生饱和液体和饱和蒸汽
                const h_eco_liq = CP_INSTANCE.PropsSI('H', 'T', T_intermediate_sat_K, 'Q', 0, fluid);
                const h_eco_vap = CP_INSTANCE.PropsSI('H', 'T', T_intermediate_sat_K, 'Q', 1, fluid);
                h_7_inter = h3; // 从点3等焓节流到中间压力
                h_6_inter = h_eco_vap; // 闪蒸罐顶部饱和蒸汽（Q=1），无过热度
                h_5_inter = h_eco_liq; // 闪蒸罐底部饱和液体（Q=0）
                const x_flash = (h_7_inter - h_5_inter) / (h_6_inter - h_5_inter);
                if (x_flash > 0 && x_flash < 1) {
                    m_dot_inj_inter = lpStage.m_dot * (x_flash / (1 - x_flash));
                    m_dot_total_inter = lpStage.m_dot + m_dot_inj_inter;
                }
                // 注意：闪蒸罐模式下不使用过热度输入，补气始终是饱和蒸汽
            } else {
                // 过冷器模式（与mode5逻辑完全一致）
                // 主路：从h3（冷凝器出口，T_cond - DT_sc）冷却至T_mid_sat + DT_approach（在冷凝压力下）
                const T_5_K = T_intermediate_sat_K + ecoDtValue; // 主路出口温度（在冷凝压力下）
                h_5_inter = CP_INSTANCE.PropsSI('H', 'T', T_5_K, 'P', Pc_Pa, fluid);
                
                // 补气路：从h3等焓节流到中间压力，然后在过冷器中吸热变为过热蒸汽
                h_7_inter = h3; // 等焓节流到中间压力
                const T_inj_K = T_intermediate_sat_K + ecoSuperheatValue; // 补气过热温度
                h_6_inter = CP_INSTANCE.PropsSI('H', 'T', T_inj_K, 'P', P_intermediate_Pa, fluid);
                
                // 能量平衡求补气量 m_dot_inj
                // 主路放热 = 补气路吸热
                // m_dot_lp * (h3 - h5) = m_dot_inj * (h6 - h7)
                const h_diff_main = h3 - h_5_inter;
                const h_diff_inj = h_6_inter - h_7_inter;
                if (h_diff_main <= 0 || h_diff_inj <= 0) {
                    throw new Error(`过冷器能量平衡异常：主路放热=${h_diff_main.toFixed(1)} J/kg，支路吸热=${h_diff_inj.toFixed(1)} J/kg`);
                }
                m_dot_inj_inter = (lpStage.m_dot * h_diff_main) / h_diff_inj;
                m_dot_total_inter = lpStage.m_dot + m_dot_inj_inter;
            }
            
            // 更新混合状态（中间冷却器补气）
            if (m_dot_inj_inter > 0) {
                h_mix = (lpStage.m_dot * h_mix + m_dot_inj_inter * h_6_inter) / m_dot_total_inter;
            }

            // 计算高压级
            // 高压级压缩应该从混合点（h_mix）开始
            // h_mix已经包含中间冷却器ECO补气（如果有）
            // 如果有高压级ECO补气，补气将在computeHighPressureStage内部处理
            const hpStage = computeHighPressureStage({
                fluid,
                P_intermediate_Pa,
                Pe_Pa: Pe_Pa, // 传递蒸发压力
                Tc_C,
                superheat_K: shLp_K, // 使用相同的过热度
                subcooling_K: scHp_K,
                flow_m3h: flowHp,
                eta_v: eta_v_hp,
                eta_s: eta_s_hp,
                m_dot_lp: m_dot_total_inter, // 使用中间冷却器的总流量（包含中间冷却器ECO补气）
                h_mix: h_mix, // 使用更新后的混合点（包含中间冷却器ECO补气，但不包含高压级ECO补气）
                // 高压级ECO参数
                isEcoEnabled: isEcoEnabledHp,
                ecoType: ecoTypeHpValue,
                ecoSuperheat_K: ecoSuperheatHpValue,
                ecoDt_K: ecoDtHpValue,
                T_2a_est_C: T_2a_est_Hp_C
            });

            // 计算蒸发制冷量（从低压级入口到高压级节流后）
            // 节流后的点4在蒸发压力下
            // 注意：应该使用主路流量（m_dot_suc），因为补气不经过蒸发器
            const h_evap_out = lpStage.h1;
            const h_evap_in = hpStage.h4; // 点4在蒸发压力下
            const Q_evap_W = lpStage.m_dot_suc * (h_evap_out - h_evap_in);

            // 总功率
            const W_shaft_total_W = lpStage.W_shaft_W + hpStage.W_shaft_W;
            const W_input_total_W = W_shaft_total_W;

            // COP
            const COP_c = Q_evap_W / W_input_total_W;
            const COP_h = hpStage.Q_cond_W / W_input_total_W;

            // 判断是否有ECO（中间冷却器、低压级或高压级）- 需要在状态点表生成之前定义
            const hasEcoInter = true; // 中间冷却器ECO始终启用
            const hasEcoLp = isEcoEnabledLp && lpStage.m_dot_inj > 0;
            const hasEcoHp = isEcoEnabledHp && hpStage.m_dot_inj > 0; // 使用hpStage返回的补气流量

            // 构造状态点表
            const statePoints = [];
            statePoints.push({
                name: 'LP-1',
                desc: 'Low Press Evap Out',
                temp: (lpStage.T1_K - 273.15).toFixed(1),
                press: (lpStage.Pe_Pa / 1e5).toFixed(2),
                enth: (lpStage.h1 / 1000).toFixed(1),
                flow: lpStage.m_dot.toFixed(4)
            });

            statePoints.push({
                name: 'LP-2',
                desc: 'Low Press Discharge',
                temp: lpStage.T2a_C.toFixed(1),
                press: (P_intermediate_Pa / 1e5).toFixed(2),
                enth: (lpStage.h2a / 1000).toFixed(1),
                flow: lpStage.m_dot.toFixed(4)
            });

            // mix点的温度应该从h_mix和中间压力计算，而不是使用饱和温度
            const T_mix_K = CP_INSTANCE.PropsSI('T', 'H', h_mix, 'P', P_intermediate_Pa, fluid);
            statePoints.push({
                name: 'mix',
                desc: 'After Mixing',
                temp: (T_mix_K - 273.15).toFixed(1),
                press: (P_intermediate_Pa / 1e5).toFixed(2),
                enth: (h_mix / 1000).toFixed(1),
                flow: hpStage.m_dot.toFixed(4)
            });

            statePoints.push({
                name: 'HP-1',
                desc: 'High Press Comp In',
                temp: (hpStage.T1_K - 273.15).toFixed(1),
                press: (P_intermediate_Pa / 1e5).toFixed(2),
                enth: (hpStage.h1 / 1000).toFixed(1),
                flow: hpStage.m_dot.toFixed(4)
            });

            statePoints.push({
                name: 'HP-2',
                desc: 'High Press Discharge',
                temp: hpStage.T2a_C.toFixed(1),
                press: (hpStage.Pc_Pa / 1e5).toFixed(2),
                enth: (hpStage.h2a / 1000).toFixed(1),
                flow: hpStage.m_dot.toFixed(4)
            });

            statePoints.push({
                name: '3',
                desc: 'Cond Out',
                temp: (hpStage.T3_K - 273.15).toFixed(1),
                press: (hpStage.Pc_Pa / 1e5).toFixed(2),
                enth: (hpStage.h3 / 1000).toFixed(1),
                flow: hpStage.m_dot.toFixed(4)
            });

            statePoints.push({
                name: '4',
                desc: 'Exp Valve Out (Evap)',
                temp: hpStage.T4_C.toFixed(1),
                press: ((hpStage.h4_pressure || Pe_Pa) / 1e5).toFixed(2),
                enth: (hpStage.h4 / 1000).toFixed(1),
                flow: lpStage.m_dot.toFixed(4)
            });

            // ECO相关状态点 - 中间冷却器ECO
            if (hasEcoInter) {
                const m_p5_inter = lpStage.m_dot; // 主路流量
                const m_p6_inter = m_dot_inj_inter; // 补气流量
                const m_p7_inter = m_dot_inj_inter; // 补气流量
                
                if (ecoTypeValue === 'flash_tank') {
                    const T_7_inter_K = CP_INSTANCE.PropsSI('T', 'P', P_intermediate_Pa, 'Q', 0, fluid);
                    const T_6_inter_K = CP_INSTANCE.PropsSI('T', 'P', P_intermediate_Pa, 'Q', 1, fluid);
                    const T_5_inter_K = CP_INSTANCE.PropsSI('T', 'P', P_intermediate_Pa, 'Q', 0, fluid);
                    statePoints.push({
                        name: '7-Inter',
                        desc: 'Flash In (Inter)',
                        temp: (T_7_inter_K - 273.15).toFixed(1),
                        press: (P_intermediate_Pa / 1e5).toFixed(2),
                        enth: (h_7_inter / 1000).toFixed(1),
                        flow: m_p7_inter.toFixed(4)
                    });
                    statePoints.push({
                        name: '6-Inter',
                        desc: 'Injection Gas (Inter)',
                        temp: (T_6_inter_K - 273.15).toFixed(1),
                        press: (P_intermediate_Pa / 1e5).toFixed(2),
                        enth: (h_6_inter / 1000).toFixed(1),
                        flow: m_p6_inter.toFixed(4)
                    });
                    statePoints.push({
                        name: '5-Inter',
                        desc: 'ECO Liq Out (Inter)',
                        temp: (T_5_inter_K - 273.15).toFixed(1),
                        press: (P_intermediate_Pa / 1e5).toFixed(2),
                        enth: (h_5_inter / 1000).toFixed(1),
                        flow: m_p5_inter.toFixed(4)
                    });
                } else {
                    // Subcooler模式
                    const T_5_inter_K = CP_INSTANCE.PropsSI('T', 'P', Pc_Pa, 'H', h_5_inter, fluid);
                    const T_7_inter_K = CP_INSTANCE.PropsSI('T', 'P', P_intermediate_Pa, 'H', h_7_inter, fluid);
                    const T_6_inter_K = CP_INSTANCE.PropsSI('T', 'P', P_intermediate_Pa, 'H', h_6_inter, fluid);
                    statePoints.push({
                        name: '5-Inter',
                        desc: 'Subcooler Out (Inter)',
                        temp: (T_5_inter_K - 273.15).toFixed(1),
                        press: (Pc_Pa / 1e5).toFixed(2),
                        enth: (h_5_inter / 1000).toFixed(1),
                        flow: m_p5_inter.toFixed(4)
                    });
                    statePoints.push({
                        name: '7-Inter',
                        desc: 'Inj Valve Out (Inter)',
                        temp: (T_7_inter_K - 273.15).toFixed(1),
                        press: (P_intermediate_Pa / 1e5).toFixed(2),
                        enth: (h_7_inter / 1000).toFixed(1),
                        flow: m_p7_inter.toFixed(4)
                    });
                    statePoints.push({
                        name: '6-Inter',
                        desc: 'Injection Gas (Inter)',
                        temp: (T_6_inter_K - 273.15).toFixed(1),
                        press: (P_intermediate_Pa / 1e5).toFixed(2),
                        enth: (h_6_inter / 1000).toFixed(1),
                        flow: m_p6_inter.toFixed(4)
                    });
                }
            }

            // ECO相关状态点 - 高压级ECO
            if (hasEcoHp) {
                // 使用hpStage返回的经济器压力
                const P_eco_hp_Pa = hpStage.P_eco_Pa || Math.sqrt(Pe_Pa * hpStage.Pc_Pa);
                
                // 定义流量变量
                const m_p5_hp = hpStage.m_dot - hpStage.m_dot_inj; // 主路流量（总流量减去补气流量）
                const m_p6_hp = hpStage.m_dot_inj; // 补气流量
                const m_p7_hp = hpStage.m_dot_inj; // 补气流量
                
                if (ecoTypeHpValue === 'flash_tank') {
                    // 闪蒸罐模式：点7、点6、点5都在经济器压力下
                    const T_7_K = CP_INSTANCE.PropsSI('T', 'P', P_eco_hp_Pa, 'H', hpStage.h7, fluid);
                    const T_6_K = CP_INSTANCE.PropsSI('T', 'P', P_eco_hp_Pa, 'H', hpStage.h6, fluid);
                    const T_5_K = CP_INSTANCE.PropsSI('T', 'P', P_eco_hp_Pa, 'H', hpStage.h5, fluid);
                    statePoints.push({
                        name: '7-HP',
                        desc: 'Flash In (HP)',
                        temp: (T_7_K - 273.15).toFixed(1),
                        press: (P_eco_hp_Pa / 1e5).toFixed(2),
                        enth: (hpStage.h7 / 1000).toFixed(1),
                        flow: m_p7_hp.toFixed(4)
                    });
                    statePoints.push({
                        name: '6-HP',
                        desc: 'Injection Gas (HP)',
                        temp: (T_6_K - 273.15).toFixed(1),
                        press: (P_eco_hp_Pa / 1e5).toFixed(2),
                        enth: (hpStage.h6 / 1000).toFixed(1),
                        flow: m_p6_hp.toFixed(4)
                    });
                    statePoints.push({
                        name: '5-HP',
                        desc: 'ECO Liq Out (HP)',
                        temp: (T_5_K - 273.15).toFixed(1),
                        press: (P_eco_hp_Pa / 1e5).toFixed(2),
                        enth: (hpStage.h5 / 1000).toFixed(1),
                        flow: m_p5_hp.toFixed(4)
                    });
                } else {
                    // Subcooler模式：点7和点6在经济器压力下，点5在冷凝压力下
                    const T_5_K = CP_INSTANCE.PropsSI('T', 'P', hpStage.Pc_Pa, 'H', hpStage.h5, fluid);
                    // 点7：从点3等焓节流到经济器压力（h7 = h3）
                    const T_7_K = CP_INSTANCE.PropsSI('T', 'P', P_eco_hp_Pa, 'H', hpStage.h7, fluid);
                    const T_6_K = CP_INSTANCE.PropsSI('T', 'P', P_eco_hp_Pa, 'H', hpStage.h6, fluid);
                    statePoints.push({
                        name: '5-HP',
                        desc: 'Subcooler Out (HP)',
                        temp: (T_5_K - 273.15).toFixed(1),
                        press: (hpStage.Pc_Pa / 1e5).toFixed(2),
                        enth: (hpStage.h5 / 1000).toFixed(1),
                        flow: m_p5_hp.toFixed(4)
                    });
                    statePoints.push({
                        name: '7-HP',
                        desc: 'Inj Valve Out (HP)',
                        temp: (T_7_K - 273.15).toFixed(1),
                        press: (P_eco_hp_Pa / 1e5).toFixed(2),
                        enth: (hpStage.h7 / 1000).toFixed(1),
                        flow: m_p7_hp.toFixed(4)
                    });
                    statePoints.push({
                        name: '6-HP',
                        desc: 'Injection Gas (HP)',
                        temp: (T_6_K - 273.15).toFixed(1),
                        press: (P_eco_hp_Pa / 1e5).toFixed(2),
                        enth: (hpStage.h6 / 1000).toFixed(1),
                        flow: m_p6_hp.toFixed(4)
                    });
                }
            }
            
            // ECO相关状态点 - 低压级ECO
            if (hasEcoLp) {
                const m_p5_lp = lpStage.m_dot_suc; // 主路流量
                const m_p6_lp = lpStage.m_dot_inj; // 补气流量
                const m_p7_lp = lpStage.m_dot_inj; // 补气流量
                
                if (ecoTypeLpValue === 'flash_tank') {
                    const T_7_lp_K = CP_INSTANCE.PropsSI('T', 'P', P_intermediate_Pa, 'Q', 0, fluid);
                    const T_6_lp_K = CP_INSTANCE.PropsSI('T', 'P', P_intermediate_Pa, 'Q', 1, fluid);
                    const T_5_lp_K = CP_INSTANCE.PropsSI('T', 'P', P_intermediate_Pa, 'Q', 0, fluid);
                    statePoints.push({
                        name: '7-LP',
                        desc: 'Flash In (LP)',
                        temp: (T_7_lp_K - 273.15).toFixed(1),
                        press: (P_intermediate_Pa / 1e5).toFixed(2),
                        enth: (lpStage.h7 / 1000).toFixed(1),
                        flow: m_p7_lp.toFixed(4)
                    });
                    statePoints.push({
                        name: '6-LP',
                        desc: 'Injection Gas (LP)',
                        temp: (T_6_lp_K - 273.15).toFixed(1),
                        press: (P_intermediate_Pa / 1e5).toFixed(2),
                        enth: (lpStage.h6 / 1000).toFixed(1),
                        flow: m_p6_lp.toFixed(4)
                    });
                    statePoints.push({
                        name: '5-LP',
                        desc: 'ECO Liq Out (LP)',
                        temp: (T_5_lp_K - 273.15).toFixed(1),
                        press: (P_intermediate_Pa / 1e5).toFixed(2),
                        enth: (lpStage.h5 / 1000).toFixed(1),
                        flow: m_p5_lp.toFixed(4)
                    });
                } else {
                    // Subcooler模式
                    const T_5_lp_K = CP_INSTANCE.PropsSI('T', 'P', P_intermediate_Pa, 'H', lpStage.h5, fluid);
                    const T_7_lp_K = CP_INSTANCE.PropsSI('T', 'P', P_intermediate_Pa, 'H', lpStage.h7, fluid);
                    const T_6_lp_K = CP_INSTANCE.PropsSI('T', 'P', P_intermediate_Pa, 'H', lpStage.h6, fluid);
                    statePoints.push({
                        name: '5-LP',
                        desc: 'Subcooler Out (LP)',
                        temp: (T_5_lp_K - 273.15).toFixed(1),
                        press: (P_intermediate_Pa / 1e5).toFixed(2),
                        enth: (lpStage.h5 / 1000).toFixed(1),
                        flow: m_p5_lp.toFixed(4)
                    });
                    statePoints.push({
                        name: '7-LP',
                        desc: 'Inj Valve Out (LP)',
                        temp: (T_7_lp_K - 273.15).toFixed(1),
                        press: (P_intermediate_Pa / 1e5).toFixed(2),
                        enth: (lpStage.h7 / 1000).toFixed(1),
                        flow: m_p7_lp.toFixed(4)
                    });
                    statePoints.push({
                        name: '6-LP',
                        desc: 'Injection Gas (LP)',
                        temp: (T_6_lp_K - 273.15).toFixed(1),
                        press: (P_intermediate_Pa / 1e5).toFixed(2),
                        enth: (lpStage.h6 / 1000).toFixed(1),
                        flow: m_p6_lp.toFixed(4)
                    });
                }
            }

            // 绘制 P-h 图（合并显示）
            const point = (name, h_j, p_pa, pos = 'top') => ({ 
                name, 
                value: [h_j / 1000, p_pa / 1e5], 
                label: { position: pos, show: true } 
            });

            const pt_lp1 = point('LP-1', lpStage.h1, lpStage.Pe_Pa, 'bottom');
            let pt_lp2, pt_mid, pt_mix, pt_hp1, pt_hp2, pt3, pt4, pt5, pt6, pt7;
            let pt5_lp, pt6_lp, pt7_lp; // 低压级ECO点
            let pt5_inter, pt6_inter, pt7_inter; // 中间冷却器ECO点
            
            // hasEcoInter始终为true（中间冷却器ECO始终启用），hasEcoLp 和 hasEcoHp 已在上面定义
            
            // 中间冷却器ECO始终启用，所以总是显示ECO路径
            if (hasEcoInter || hasEcoLp || hasEcoHp) {
                // ECO模式：需要显示补气和混合过程
                pt_lp2 = point('LP-2', lpStage.h2a, P_intermediate_Pa, 'right');
                // mid点：补气混合后的实际状态（如果有ECO补气），否则等于等熵压缩状态
                // 使用h_mix（补气混合后的状态）而不是h_mid（等熵状态），确保显示实际状态点
                pt_mid = point('mid', lpStage.h_mix, P_intermediate_Pa, 'right');
                
                // 中间冷却器ECO点（始终显示）
                pt6_inter = point('6-Inter', h_6_inter, P_intermediate_Pa, 'left');
                if (ecoTypeValue === 'flash_tank') {
                    pt7_inter = point('7-Inter', h_7_inter, P_intermediate_Pa, 'right');
                    pt5_inter = point('5-Inter', h_5_inter, P_intermediate_Pa, 'top');
                } else {
                    // 过冷器模式：与mode5一致
                    pt7_inter = point('7-Inter', h_7_inter, P_intermediate_Pa, 'bottom');
                    pt5_inter = point('5-Inter', h_5_inter, hpStage.Pc_Pa, 'top');
                }
                
                // 低压级ECO点
                if (hasEcoLp) {
                    // 点6：中间压力下的过热蒸汽（补气）
                    pt6_lp = point('6-LP', lpStage.h6, P_intermediate_Pa, 'left');
                    
                    if (ecoTypeLpValue === 'flash_tank') {
                        // 闪蒸罐模式：点7从冷凝器出口等焓节流到中间压力，在中间压力下闪蒸
                        pt7_lp = point('7-LP', lpStage.h7, P_intermediate_Pa, 'right');
                        // 点5：中间压力下的饱和液体
                        pt5_lp = point('5-LP', lpStage.h5, P_intermediate_Pa, 'top');
                    } else {
                        // 过冷器模式：点7从冷凝器出口等焓节流到中间压力
                        pt7_lp = point('7-LP', lpStage.h7, P_intermediate_Pa, 'bottom');
                        // 点5：中间压力下的过冷液体（参考计算逻辑，点5在中间压力下）
                        pt5_lp = point('5-LP', lpStage.h5, P_intermediate_Pa, 'top');
                    }
                }
                
                // mix点：中间冷却器混合后的状态（包含中间冷却器ECO补气，但不包含高压级ECO补气）
                pt_mix = point('mix', h_mix, P_intermediate_Pa, 'left');
                
                // HP-1点：高压级压缩起点（等于mix点，因为高压级ECO补气在压缩过程中处理）
                pt_hp1 = point('HP-1', hpStage.h1, P_intermediate_Pa, 'left');
                
                // 高压级ECO点（如果启用）
                let pt_mid_hp, pt_mix_hp; // 高压级ECO压缩过程中的中间点和混合点
                if (hasEcoHp) {
                    // 计算高压级经济器压力
                    const P_eco_hp_Pa = hpStage.P_eco_Pa || Math.sqrt(Pe_Pa * hpStage.Pc_Pa);
                    
                    // 点6和点7在经济器压力下，点5根据模式决定
                    pt6 = point('6-HP', hpStage.h6, P_eco_hp_Pa, 'left');
                    if (ecoTypeHpValue === 'flash_tank') {
                        // 闪蒸罐模式：点7和点5都在经济器压力下
                        pt7 = point('7-HP', hpStage.h7, P_eco_hp_Pa, 'right');
                        pt5 = point('5-HP', hpStage.h5, P_eco_hp_Pa, 'top');
                    } else {
                        // 过冷器模式：点7在经济器压力下，点5在冷凝压力下
                        pt7 = point('7-HP', hpStage.h7, P_eco_hp_Pa, 'bottom');
                        pt5 = point('5-HP', hpStage.h5, hpStage.Pc_Pa, 'top');
                    }
                    
                    // 高压级ECO压缩过程中的中间点（第一级压缩到经济器压力）
                    pt_mid_hp = point('mid-HP', hpStage.h_mid, P_eco_hp_Pa, 'right');
                    // 高压级ECO补气混合后的状态（在经济器压力下）
                    // 注意：hpStage.h_mix是最终排气状态，我们需要计算混合点
                    // 实际上，混合点应该在经济器压力下，但hpStage.h_mix在冷凝压力下
                    // 我们需要从hpStage.h_mid_actual和hpStage.h6计算混合点
                    if (hpStage.h_mid_actual && hpStage.h6) {
                        // 计算混合点（在经济器压力下）
                        const m_dot_base_hp = hpStage.m_dot - hpStage.m_dot_inj;
                        const h_mix_hp = (m_dot_base_hp * hpStage.h_mid_actual + hpStage.m_dot_inj * hpStage.h6) / hpStage.m_dot;
                        pt_mix_hp = point('mix-HP', h_mix_hp, P_eco_hp_Pa, 'left');
                    }
                }
                
                // HP-2点：高压级实际排气点（考虑了压缩效率的实际排气状态）
                pt_hp2 = point('HP-2', hpStage.h2a, hpStage.Pc_Pa, 'top');
                pt3 = point('3', hpStage.h3, hpStage.Pc_Pa, 'top');
                
                // 确定点4（根据启用的ECO类型）
                // 重要：点4的焓值必须等于点5的焓值（等焓节流过程），确保P-h图中显示为垂直向下的等焓线
                let h4_for_plot; // 用于绘图的点4焓值
                if (hasEcoHp) {
                    // 高压级ECO：点4从点5-HP等焓节流到蒸发压力
                    h4_for_plot = hpStage.h5; // 使用点5-HP的焓值，确保等焓
                    pt4 = point('4', h4_for_plot, Pe_Pa, 'bottom');
                } else if (hasEcoInter) {
                    // 中间冷却器ECO：点4从点5-Inter等焓节流到蒸发压力
                    h4_for_plot = h_5_inter; // 使用点5-Inter的焓值，确保等焓
                    pt4 = point('4', h4_for_plot, Pe_Pa, 'bottom');
                } else if (hasEcoLp) {
                    // 低压级ECO：点4从点5-LP等焓节流到蒸发压力
                    h4_for_plot = lpStage.h5; // 使用点5-LP的焓值，确保等焓
                    pt4 = point('4', h4_for_plot, Pe_Pa, 'bottom');
                } else {
                    // 无ECO：点4从点3等焓节流到蒸发压力
                    h4_for_plot = hpStage.h3; // 使用点3的焓值，确保等焓
                    pt4 = point('4', h4_for_plot, Pe_Pa, 'bottom');
                }
                
                // 验证等焓过程（用于调试，允许10 J/kg的数值误差）
                // 注意：验证时使用实际用于绘图的焓值，而不是hpStage.h4（因为hpStage.h4可能不反映正确的节流起点）
                if (hasEcoHp && Math.abs(h4_for_plot - hpStage.h5) > 10) {
                    console.warn(`警告：点4和点5-HP的焓值差异较大，h4_for_plot=${h4_for_plot}, h5=${hpStage.h5}`);
                }
                if (hasEcoInter && !hasEcoHp && Math.abs(h4_for_plot - h_5_inter) > 10) {
                    console.warn(`警告：点4和点5-Inter的焓值差异较大，h4_for_plot=${h4_for_plot}, h5_inter=${h_5_inter}`);
                }
                if (hasEcoLp && !hasEcoHp && !hasEcoInter && Math.abs(h4_for_plot - lpStage.h5) > 10) {
                    console.warn(`警告：点4和点5-LP的焓值差异较大，h4_for_plot=${h4_for_plot}, h5_lp=${lpStage.h5}`);
                }
                
                // 构建主循环点
                const pt1_start = pt_lp1;
                const mainPoints = [pt4, pt1_start, pt_lp2];
                if (hasEcoLp) {
                    mainPoints.push(pt_mid);
                }
                
                // mix和HP-1的关系：
                // - 如果没有高压级ECO补气：mix和HP-1是同一个点（都等于h_mix），会重叠显示
                // - 如果有高压级ECO补气：mix是补气前的状态（h_mix），HP-1是补气后的状态（hpStage.h1 = h_mix_final）
                // 总是显示mix和HP-1，让图表清晰显示压缩起点
                mainPoints.push(pt_mix, pt_hp1);
                
                // 如果有高压级ECO补气，添加压缩过程中的中间点和混合点
                if (hasEcoHp && pt_mid_hp && pt_mix_hp) {
                    mainPoints.push(pt_mid_hp, pt_mix_hp);
                }
                
                mainPoints.push(pt_hp2, pt3);
                
                // 从点3到点4的路径（根据启用的经济器类型，优先级：高压级 > 中间冷却器 > 低压级 > 无）
                // 确保主循环正确闭合
                // 注意：点3已经在上面添加，这里只添加从点3到点4的路径（不包括点3）
                if (hasEcoHp) {
                    // 高压级经济器：3 → 7-HP → 5-HP → 4（闪蒸罐）或 3 → 5-HP → 4（过冷器）
                    if (ecoTypeHpValue === 'flash_tank') {
                        mainPoints.push(pt7, pt5, pt4);
                    } else {
                        // 过冷器模式：3 → 5-HP → 4
                        mainPoints.push(pt5, pt4);
                    }
                } else if (hasEcoInter) {
                    // 中间冷却器经济器：3 → 7-Inter → 5-Inter → 4（闪蒸罐）或 3 → 5-Inter → 4（过冷器）
                    if (ecoTypeValue === 'flash_tank') {
                        mainPoints.push(pt7_inter, pt5_inter, pt4);
                    } else {
                        // 过冷器模式：3 → 5-Inter → 4
                        mainPoints.push(pt5_inter, pt4);
                    }
                } else if (hasEcoLp) {
                    // 只有低压级经济器：3 → 7-LP → 5-LP → 4（闪蒸罐）或 3 → 5-LP → 4（过冷器）
                    if (ecoTypeLpValue === 'flash_tank') {
                        mainPoints.push(pt7_lp, pt5_lp, pt4);
                    } else {
                        mainPoints.push(pt5_lp, pt4);
                    }
                } else {
                    // 无经济器：3 → 4（直接节流）
                    // 注意：点4已经在mainPoints开头，但为了循环闭合，这里不需要重复添加
                    // 点3已经在上面添加，点4在开头，循环已经闭合
                }
                
                // 构建ECO液路和补气路
                const ecoLiquidPoints = [];
                const ecoVaporPoints = [];
                
                // 中间冷却器ECO路径（始终显示）
                // 注意：中间冷却器ECO和高压级ECO是并行工作的，都从点3开始
                // 但最终流向蒸发器的液体来自高压级ECO（点5-HP），因为它的优先级更高
                if (ecoTypeValue === 'flash_tank') {
                    // 闪蒸罐模式
                    // 中间冷却器ECO液路：3 -> 7-Inter -> 5-Inter（独立显示，不直接到点4）
                    ecoLiquidPoints.push(pt3, pt7_inter, pt5_inter);
                    // 补气路：7-Inter -> 6-Inter -> mix（连接到混合点）
                    ecoVaporPoints.push(pt7_inter, pt6_inter);
                    if (pt_mix) {
                        ecoVaporPoints.push(pt_mix);
                    }
                } else {
                    // 过冷器模式
                    // 中间冷却器ECO液路：3 -> 5-Inter（独立显示，不直接到点4）
                    ecoLiquidPoints.push(pt3, pt5_inter);
                    // 补气路：3 -> 7-Inter -> 6-Inter -> mix（连接到混合点）
                    const pt3_clone_inter = point('', hpStage.h3, hpStage.Pc_Pa);
                    ecoVaporPoints.push(pt3_clone_inter, pt7_inter, pt6_inter);
                    if (pt_mix) {
                        ecoVaporPoints.push(pt_mix);
                    }
                }
                
                // 高压级ECO路径（独立显示，从点3开始）
                if (hasEcoHp) {
                    const P_eco_hp_Pa = hpStage.P_eco_Pa || Math.sqrt(Pe_Pa * hpStage.Pc_Pa);
                    
                    // 重要：在两个独立路径之间插入null，断开连接，避免形成三角形
                    // 当同时有中间冷却器ECO和高压级ECO时，它们应该独立显示，不应该连接
                    if (hasEcoInter) {
                        ecoLiquidPoints.push(null); // 断开中间冷却器ECO和高压级ECO的连接
                    }
                    
                    if (ecoTypeHpValue === 'flash_tank') {
                        // 闪蒸罐模式：
                        // 液路：3 -> 7-HP（等焓节流从Pc_Pa到P_eco_Pa）-> 5-HP（闪蒸罐底部）-> 4
                        // 注意：即使有中间冷却器ECO，高压级ECO也是从点3独立开始的
                        ecoLiquidPoints.push(pt3, pt7, pt5, pt4);
                        // 补气路：7-HP -> 6-HP -> mix-HP（补气混合点）
                        ecoVaporPoints.push(pt7, pt6);
                        if (pt_mix_hp) {
                            ecoVaporPoints.push(pt_mix_hp);
                        }
                    } else {
                        // 过冷器模式：
                        // 液路：3 -> 5-HP（过冷器出口，在Pc_Pa下）-> 4
                        ecoLiquidPoints.push(pt3, pt5, pt4);
                        // 补气路：3 -> 7-HP（等焓节流从Pc_Pa到P_eco_Pa）-> 6-HP（在过冷器中加热）-> mix-HP（补气混合点）
                        const pt3_clone = point('', hpStage.h3, hpStage.Pc_Pa);
                        ecoVaporPoints.push(pt3_clone, pt7, pt6);
                        if (pt_mix_hp) {
                            ecoVaporPoints.push(pt_mix_hp);
                        }
                    }
                }
                
                // 低压级ECO路径（如果有）
                if (hasEcoLp) {
                    if (ecoTypeLpValue === 'flash_tank') {
                        // 闪蒸罐模式：从冷凝器出口（点3）等焓节流到中间压力（点7），在中间压力下闪蒸
                        // 液路：3 -> 7（等焓节流到中间压力）-> 5（闪蒸罐底部，中间压力）-> 4（节流到蒸发压力）
                        ecoLiquidPoints.push(pt3, pt7_lp, pt5_lp, pt4);
                        // 补气路：7 -> 6（在中间压力下，从节流后的两相状态到饱和蒸汽）
                        ecoVaporPoints.push(pt7_lp, pt6_lp);
                    } else {
                        // 过冷器模式：从冷凝器出口（点3）等焓节流到中间压力（点7），在过冷器中换热
                        // 液路：3 -> 5（过冷器出口，在中间压力下）-> 4（节流到蒸发压力）
                        ecoLiquidPoints.push(pt3, pt5_lp, pt4);
                        // 补气路：3 -> 7（等焓节流到中间压力）-> 6（在过冷器中加热到中间压力下的过热蒸汽）
                        const pt3_clone_lp = point('', hpStage.h3, hpStage.Pc_Pa);
                        ecoVaporPoints.push(pt3_clone_lp, pt7_lp, pt6_lp);
                    }
                }
                
                // 生成饱和线数据
                const satLinesPH = generateSaturationLines(fluid, Pe_Pa, Pc_Pa, 100);
                const satLinesTS = generateSaturationLinesTS(fluid, Te_C, Tc_C, 100);
                
                // 构建 T-S 图主循环点（带过程中间点）
                const mainPointsTS = [];
                
                // 点 4：节流后（蒸发压力）
                const pt4_TS = {
                    name: '4',
                    value: [
                        CP_INSTANCE.PropsSI('S', 'H', hpStage.h4, 'P', Pe_Pa, fluid) / 1000,
                        CP_INSTANCE.PropsSI('T', 'H', hpStage.h4, 'P', Pe_Pa, fluid) - 273.15
                    ],
                    label: { show: true }
                };
                mainPointsTS.push(pt4_TS);
                
                // 点 LP-1：蒸发器出口（等压过程 4->LP-1，添加中间点）
                const pt_lp1_TS = {
                    name: 'LP-1',
                    value: [
                        CP_INSTANCE.PropsSI('S', 'H', lpStage.h1, 'P', Pe_Pa, fluid) / 1000,
                        CP_INSTANCE.PropsSI('T', 'H', lpStage.h1, 'P', Pe_Pa, fluid) - 273.15
                    ],
                    label: { show: true }
                };
                // 添加等压过程中间点（4->LP-1 蒸发过程）
                const evapPath = generateIsobaricPathTS(fluid, Pe_Pa, hpStage.h4, lpStage.h1, 8);
                evapPath.forEach((pt, idx) => {
                    if (idx > 0 && idx < evapPath.length - 1) {
                        mainPointsTS.push({ name: '', value: pt, label: { show: false } });
                    }
                });
                mainPointsTS.push(pt_lp1_TS);
                
                // LP-2 点：低压级排气（压缩过程 LP-1->LP-2，添加中间点显示熵增加）
                const pt_lp2_TS = {
                    name: 'LP-2',
                    value: [
                        CP_INSTANCE.PropsSI('S', 'H', lpStage.h2a, 'P', P_intermediate_Pa, fluid) / 1000,
                        CP_INSTANCE.PropsSI('T', 'H', lpStage.h2a, 'P', P_intermediate_Pa, fluid) - 273.15
                    ],
                    label: { show: true }
                };
                // 添加压缩过程中间点（显示熵增加趋势）
                const compLpPath = generateCompressionPathTS(fluid, lpStage.h1, Pe_Pa, lpStage.h2a, P_intermediate_Pa, 10);
                compLpPath.forEach((pt, idx) => {
                    if (idx > 0 && idx < compLpPath.length - 1) {
                        mainPointsTS.push({ name: '', value: pt, label: { show: false } });
                    }
                });
                mainPointsTS.push(pt_lp2_TS);
                
                // mix 点：补气混合后（混合过程 LP-2->mix，熵增加）
                const pt_mix_TS = {
                    name: 'mix',
                    value: [
                        CP_INSTANCE.PropsSI('S', 'H', h_mix, 'P', P_intermediate_Pa, fluid) / 1000,
                        CP_INSTANCE.PropsSI('T', 'H', h_mix, 'P', P_intermediate_Pa, fluid) - 273.15
                    ],
                    label: { show: true }
                };
                // 混合过程是瞬间的，但可以添加一个中间点显示趋势
                const mixPath = generateIsobaricPathTS(fluid, P_intermediate_Pa, lpStage.h2a, h_mix, 3);
                mixPath.forEach((pt, idx) => {
                    if (idx > 0 && idx < mixPath.length - 1) {
                        mainPointsTS.push({ name: '', value: pt, label: { show: false } });
                    }
                });
                mainPointsTS.push(pt_mix_TS);
                
                // HP-1 点：高压级压缩起点
                const pt_hp1_TS = {
                    name: 'HP-1',
                    value: [
                        CP_INSTANCE.PropsSI('S', 'H', hpStage.h1, 'P', P_intermediate_Pa, fluid) / 1000,
                        CP_INSTANCE.PropsSI('T', 'H', hpStage.h1, 'P', P_intermediate_Pa, fluid) - 273.15
                    ],
                    label: { show: true }
                };
                mainPointsTS.push(pt_hp1_TS);
                
                // HP-2 点：高压级排气（压缩过程 HP-1->HP-2，添加中间点显示熵增加）
                const pt_hp2_TS = {
                    name: 'HP-2',
                    value: [
                        CP_INSTANCE.PropsSI('S', 'H', hpStage.h2a, 'P', hpStage.Pc_Pa, fluid) / 1000,
                        CP_INSTANCE.PropsSI('T', 'H', hpStage.h2a, 'P', hpStage.Pc_Pa, fluid) - 273.15
                    ],
                    label: { show: true }
                };
                // 添加压缩过程中间点（显示熵增加趋势）
                const compHpPath = generateCompressionPathTS(fluid, hpStage.h1, P_intermediate_Pa, hpStage.h2a, hpStage.Pc_Pa, 10);
                compHpPath.forEach((pt, idx) => {
                    if (idx > 0 && idx < compHpPath.length - 1) {
                        mainPointsTS.push({ name: '', value: pt, label: { show: false } });
                    }
                });
                mainPointsTS.push(pt_hp2_TS);
                
                // 点 3：冷凝器出口（等压过程 HP-2->3 冷凝，添加中间点）
                const pt3_TS = {
                    name: '3',
                    value: [
                        CP_INSTANCE.PropsSI('S', 'H', hpStage.h3, 'P', hpStage.Pc_Pa, fluid) / 1000,
                        CP_INSTANCE.PropsSI('T', 'H', hpStage.h3, 'P', hpStage.Pc_Pa, fluid) - 273.15
                    ],
                    label: { show: true }
                };
                // 添加等压过程中间点（HP-2->3 冷凝过程）
                const condPath = generateIsobaricPathTS(fluid, hpStage.Pc_Pa, hpStage.h2a, hpStage.h3, 8);
                condPath.forEach((pt, idx) => {
                    if (idx > 0 && idx < condPath.length - 1) {
                        mainPointsTS.push({ name: '', value: pt, label: { show: false } });
                    }
                });
                mainPointsTS.push(pt3_TS);
                
                // 构建 T-S 图 ECO 液路和补气路点（简化处理，主要显示关键路径）
                const ecoLiquidPointsTS = [];
                const ecoVaporPointsTS = [];
                
                // 中间冷却器ECO路径（始终显示，与mode5逻辑一致）
                // 液路：3 -> 5-Inter -> 4（节流过程）
                const pt3_eco_TS = [
                    CP_INSTANCE.PropsSI('S', 'H', hpStage.h3, 'P', hpStage.Pc_Pa, fluid) / 1000,
                    CP_INSTANCE.PropsSI('T', 'H', hpStage.h3, 'P', hpStage.Pc_Pa, fluid) - 273.15
                ];
                ecoLiquidPointsTS.push(pt3_eco_TS);
                
                if (ecoTypeValue === 'subcooler') {
                    const pt5_inter_TS = [
                        CP_INSTANCE.PropsSI('S', 'H', h_5_inter, 'P', hpStage.Pc_Pa, fluid) / 1000,
                        CP_INSTANCE.PropsSI('T', 'H', h_5_inter, 'P', hpStage.Pc_Pa, fluid) - 273.15
                    ];
                    ecoLiquidPointsTS.push(pt5_inter_TS);
                }
                
                // 节流过程 5/3 -> 4
                const h_throttle_start = ecoTypeValue === 'subcooler' ? h_5_inter : hpStage.h3;
                const throttlePath = generateThrottlingPathTS(fluid, h_throttle_start, hpStage.Pc_Pa, Pe_Pa, 8);
                throttlePath.forEach((pt, idx) => {
                    if (idx > 0 && idx < throttlePath.length - 1) {
                        ecoLiquidPointsTS.push(pt);
                    }
                });
                ecoLiquidPointsTS.push(pt4_TS.value);
                
                // 补气路：3 -> 7-Inter -> 6-Inter -> mix（与mode5一致）
                const pt7_inter_TS = [
                    CP_INSTANCE.PropsSI('S', 'H', h_7_inter, 'P', P_intermediate_Pa, fluid) / 1000,
                    CP_INSTANCE.PropsSI('T', 'H', h_7_inter, 'P', P_intermediate_Pa, fluid) - 273.15
                ];
                const pt6_inter_TS = [
                    CP_INSTANCE.PropsSI('S', 'H', h_6_inter, 'P', P_intermediate_Pa, fluid) / 1000,
                    CP_INSTANCE.PropsSI('T', 'H', h_6_inter, 'P', P_intermediate_Pa, fluid) - 273.15
                ];
                ecoVaporPointsTS.push(pt3_eco_TS);
                const throttlePath37 = generateThrottlingPathTS(fluid, hpStage.h3, hpStage.Pc_Pa, P_intermediate_Pa, 5);
                throttlePath37.forEach((pt, idx) => {
                    if (idx > 0 && idx < throttlePath37.length - 1) {
                        ecoVaporPointsTS.push(pt);
                    }
                });
                ecoVaporPointsTS.push(pt7_inter_TS);
                const subcoolerPath = generateIsobaricPathTS(fluid, P_intermediate_Pa, h_7_inter, h_6_inter, 5);
                subcoolerPath.forEach((pt, idx) => {
                    if (idx > 0 && idx < subcoolerPath.length - 1) {
                        ecoVaporPointsTS.push(pt);
                    }
                });
                ecoVaporPointsTS.push(pt6_inter_TS);
                ecoVaporPointsTS.push(pt_mix_TS.value);
                
                // 高压级ECO路径（T-S图）
                if (hasEcoHp) {
                    // 计算高压级经济器压力
                    const P_eco_hp_Pa = hpStage.P_eco_Pa || Math.sqrt(Pe_Pa * hpStage.Pc_Pa);
                    
                    // 点7-HP：从点3等焓节流到经济器压力
                    const pt7_hp_TS = [
                        CP_INSTANCE.PropsSI('S', 'H', hpStage.h7, 'P', P_eco_hp_Pa, fluid) / 1000,
                        CP_INSTANCE.PropsSI('T', 'H', hpStage.h7, 'P', P_eco_hp_Pa, fluid) - 273.15
                    ];
                    
                    // 点6-HP：补气过热蒸汽（在经济器压力下）
                    const pt6_hp_TS = [
                        CP_INSTANCE.PropsSI('S', 'H', hpStage.h6, 'P', P_eco_hp_Pa, fluid) / 1000,
                        CP_INSTANCE.PropsSI('T', 'H', hpStage.h6, 'P', P_eco_hp_Pa, fluid) - 273.15
                    ];
                    
                    // 添加从点3到点7-HP的节流路径（从Pc_Pa到P_eco_Pa）
                    ecoVaporPointsTS.push(pt3_eco_TS);
                    const throttlePath3to7_hp = generateThrottlingPathTS(fluid, hpStage.h3, hpStage.Pc_Pa, P_eco_hp_Pa, 5);
                    throttlePath3to7_hp.forEach((pt, idx) => {
                        if (idx > 0 && idx < throttlePath3to7_hp.length - 1) {
                            ecoVaporPointsTS.push(pt);
                        }
                    });
                    ecoVaporPointsTS.push(pt7_hp_TS);
                    
                    if (ecoTypeHpValue === 'subcooler') {
                        // 过冷器模式：添加从点7-HP到点6-HP的等压加热过程
                        const subcoolerPath_hp = generateIsobaricPathTS(fluid, P_eco_hp_Pa, hpStage.h7, hpStage.h6, 5);
                        subcoolerPath_hp.forEach((pt, idx) => {
                            if (idx > 0 && idx < subcoolerPath_hp.length - 1) {
                                ecoVaporPointsTS.push(pt);
                            }
                        });
                    }
                    ecoVaporPointsTS.push(pt6_hp_TS);
                    
                    // 添加补气混合点（mix-HP）到补气路
                    if (hpStage.h_mid_actual && hpStage.h6) {
                        const m_dot_base_hp = hpStage.m_dot - hpStage.m_dot_inj;
                        const h_mix_hp = (m_dot_base_hp * hpStage.h_mid_actual + hpStage.m_dot_inj * hpStage.h6) / hpStage.m_dot;
                        const pt_mix_hp_TS = [
                            CP_INSTANCE.PropsSI('S', 'H', h_mix_hp, 'P', P_eco_hp_Pa, fluid) / 1000,
                            CP_INSTANCE.PropsSI('T', 'H', h_mix_hp, 'P', P_eco_hp_Pa, fluid) - 273.15
                        ];
                        ecoVaporPointsTS.push(pt_mix_hp_TS);
                    }
                }
                
                // 保存图表数据供切换使用
                if (!lastCalculationData) {
                    lastCalculationData = {};
                }
                lastCalculationData.chartData = {
                    fluid,
                    mainPoints,
                    ecoLiquidPoints,
                    ecoVaporPoints,
                    mainPointsTS,
                    ecoLiquidPointsTS,
                    ecoVaporPointsTS,
                    satLinesPH,
                    satLinesTS,
                    hasEcoInter,
                    hasEcoLp,
                    hasEcoHp,
                    chartType: 'ph' // 默认显示 P-h 图
                };
                
                // 绘制P-h图
                const ecoTitle = [];
                if (hasEcoInter) ecoTitle.push('中间冷却器');
                if (hasEcoLp) ecoTitle.push('低压级ECO');
                if (hasEcoHp) ecoTitle.push('高压级ECO');
                
                ['chart-desktop-m6', 'chart-mobile-m6'].forEach(id => {
                    drawPHDiagram(id, {
                        title: `Two-Stage Double Compressor (${fluid})${ecoTitle.length > 0 ? ' [' + ecoTitle.join('+') + ']' : ''}`,
                        mainPoints: mainPoints,
                        ecoLiquidPoints: ecoLiquidPoints,
                        ecoVaporPoints: ecoVaporPoints,
                        saturationLiquidPoints: satLinesPH.liquidPH,
                        saturationVaporPoints: satLinesPH.vaporPH,
                        xLabel: 'h (kJ/kg)',
                        yLabel: 'P (bar)'
                    });
                });
            } else {
                // 只有中间冷却器ECO（无其他ECO）
                pt_lp2 = point('LP-2', lpStage.h2a, P_intermediate_Pa, 'right');
                pt_mix = point('mix', h_mix, P_intermediate_Pa, 'left');
                pt_hp1 = point('HP-1', hpStage.h1, P_intermediate_Pa, 'left');
                // HP-2点：高压级实际排气点（考虑了压缩效率的实际排气状态）
                pt_hp2 = point('HP-2', hpStage.h2a, hpStage.Pc_Pa, 'top');
                pt3 = point('3', hpStage.h3, hpStage.Pc_Pa, 'top');
                
                // 中间冷却器ECO点（始终显示）
                pt6_inter = point('6-Inter', h_6_inter, P_intermediate_Pa, 'left');
                if (ecoTypeValue === 'flash_tank') {
                    pt7_inter = point('7-Inter', h_7_inter, P_intermediate_Pa, 'right');
                    pt5_inter = point('5-Inter', h_5_inter, P_intermediate_Pa, 'top');
                } else {
                    // 过冷器模式：与mode5一致
                    pt7_inter = point('7-Inter', h_7_inter, P_intermediate_Pa, 'bottom');
                    pt5_inter = point('5-Inter', h_5_inter, hpStage.Pc_Pa, 'top');
                }
                
                // 点4：从点5-Inter等焓节流到蒸发压力（确保等焓过程）
                // 重要：点4的焓值必须等于点5-Inter的焓值，确保P-h图中显示为垂直向下的等焓线
                const h4_for_plot_inter = h_5_inter; // 使用点5-Inter的焓值，确保等焓
                pt4 = point('4', h4_for_plot_inter, Pe_Pa, 'bottom'); // 点4在蒸发压力下
                
                // 验证等焓过程（用于调试，允许10 J/kg的数值误差）
                // 注意：这里验证的是实际用于绘图的焓值
                if (Math.abs(h4_for_plot_inter - h_5_inter) > 10) {
                    console.warn(`警告：点4和点5-Inter的焓值差异较大，h4_for_plot=${h4_for_plot_inter}, h5_inter=${h_5_inter}`);
                }

                // 主循环：4 -> LP-1 -> LP-2 -> mix -> HP-1 -> HP-2 -> 3 -> [经济器路径] -> 4
                const mainPoints = [pt4, pt_lp1, pt_lp2, pt_mix, pt_hp1, pt_hp2, pt3];
                
                // 从点3到点4的路径（根据中间冷却器ECO类型）
                if (ecoTypeValue === 'flash_tank') {
                    // 闪蒸罐模式：3 → 7-Inter → 5-Inter → 4
                    mainPoints.push(pt7_inter, pt5_inter, pt4);
                } else {
                    // 过冷器模式：3 → 5-Inter → 4
                    mainPoints.push(pt5_inter, pt4);
                }
                
                // 构建ECO液路和补气路（中间冷却器ECO始终显示）
                const ecoLiquidPoints = [];
                const ecoVaporPoints = [];
                
                if (ecoTypeValue === 'flash_tank') {
                    // 闪蒸罐模式
                    ecoLiquidPoints.push(pt3, pt7_inter, pt5_inter, pt4);
                    ecoVaporPoints.push(pt7_inter, pt6_inter);
                } else {
                    // 过冷器模式：与mode5完全一致
                    // 液路：3 -> 5 -> 4
                    ecoLiquidPoints.push(pt3, pt5_inter, pt4);
                    // 补气路：3 -> 7 -> 6 -> mix（连接到混合点）
                    const pt3_clone_inter = point('', hpStage.h3, hpStage.Pc_Pa);
                    ecoVaporPoints.push(pt3_clone_inter, pt7_inter, pt6_inter, pt_mix);
                }
                
                // 生成饱和线数据
                const satLinesPH = generateSaturationLines(fluid, Pe_Pa, Pc_Pa, 100);
                const satLinesTS = generateSaturationLinesTS(fluid, Te_C, Tc_C, 100);
                
                // 构建 T-S 图主循环点（带过程中间点）
                const mainPointsTS = [];
                
                // 点 4：节流后（蒸发压力）
                const pt4_TS = {
                    name: '4',
                    value: [
                        CP_INSTANCE.PropsSI('S', 'H', hpStage.h4, 'P', Pe_Pa, fluid) / 1000,
                        CP_INSTANCE.PropsSI('T', 'H', hpStage.h4, 'P', Pe_Pa, fluid) - 273.15
                    ],
                    label: { show: true }
                };
                mainPointsTS.push(pt4_TS);
                
                // 点 LP-1：蒸发器出口（等压过程 4->LP-1，添加中间点）
                const pt_lp1_TS = {
                    name: 'LP-1',
                    value: [
                        CP_INSTANCE.PropsSI('S', 'H', lpStage.h1, 'P', Pe_Pa, fluid) / 1000,
                        CP_INSTANCE.PropsSI('T', 'H', lpStage.h1, 'P', Pe_Pa, fluid) - 273.15
                    ],
                    label: { show: true }
                };
                // 添加等压过程中间点（4->LP-1 蒸发过程）
                const evapPath = generateIsobaricPathTS(fluid, Pe_Pa, hpStage.h4, lpStage.h1, 8);
                evapPath.forEach((pt, idx) => {
                    if (idx > 0 && idx < evapPath.length - 1) {
                        mainPointsTS.push({ name: '', value: pt, label: { show: false } });
                    }
                });
                mainPointsTS.push(pt_lp1_TS);
                
                // LP-2 点：低压级排气（压缩过程 LP-1->LP-2，添加中间点显示熵增加）
                const pt_lp2_TS = {
                    name: 'LP-2',
                    value: [
                        CP_INSTANCE.PropsSI('S', 'H', lpStage.h2a, 'P', P_intermediate_Pa, fluid) / 1000,
                        CP_INSTANCE.PropsSI('T', 'H', lpStage.h2a, 'P', P_intermediate_Pa, fluid) - 273.15
                    ],
                    label: { show: true }
                };
                // 添加压缩过程中间点（显示熵增加趋势）
                const compLpPath = generateCompressionPathTS(fluid, lpStage.h1, Pe_Pa, lpStage.h2a, P_intermediate_Pa, 10);
                compLpPath.forEach((pt, idx) => {
                    if (idx > 0 && idx < compLpPath.length - 1) {
                        mainPointsTS.push({ name: '', value: pt, label: { show: false } });
                    }
                });
                mainPointsTS.push(pt_lp2_TS);
                
                // mix 点：补气混合后（混合过程 LP-2->mix，熵增加）
                const pt_mix_TS = {
                    name: 'mix',
                    value: [
                        CP_INSTANCE.PropsSI('S', 'H', h_mix, 'P', P_intermediate_Pa, fluid) / 1000,
                        CP_INSTANCE.PropsSI('T', 'H', h_mix, 'P', P_intermediate_Pa, fluid) - 273.15
                    ],
                    label: { show: true }
                };
                // 混合过程是瞬间的，但可以添加一个中间点显示趋势
                const mixPath = generateIsobaricPathTS(fluid, P_intermediate_Pa, lpStage.h2a, h_mix, 3);
                mixPath.forEach((pt, idx) => {
                    if (idx > 0 && idx < mixPath.length - 1) {
                        mainPointsTS.push({ name: '', value: pt, label: { show: false } });
                    }
                });
                mainPointsTS.push(pt_mix_TS);
                
                // HP-1 点：高压级压缩起点
                const pt_hp1_TS = {
                    name: 'HP-1',
                    value: [
                        CP_INSTANCE.PropsSI('S', 'H', hpStage.h1, 'P', P_intermediate_Pa, fluid) / 1000,
                        CP_INSTANCE.PropsSI('T', 'H', hpStage.h1, 'P', P_intermediate_Pa, fluid) - 273.15
                    ],
                    label: { show: true }
                };
                mainPointsTS.push(pt_hp1_TS);
                
                // HP-2 点：高压级排气（压缩过程 HP-1->HP-2，添加中间点显示熵增加）
                const pt_hp2_TS = {
                    name: 'HP-2',
                    value: [
                        CP_INSTANCE.PropsSI('S', 'H', hpStage.h2a, 'P', hpStage.Pc_Pa, fluid) / 1000,
                        CP_INSTANCE.PropsSI('T', 'H', hpStage.h2a, 'P', hpStage.Pc_Pa, fluid) - 273.15
                    ],
                    label: { show: true }
                };
                // 添加压缩过程中间点（显示熵增加趋势）
                const compHpPath = generateCompressionPathTS(fluid, hpStage.h1, P_intermediate_Pa, hpStage.h2a, hpStage.Pc_Pa, 10);
                compHpPath.forEach((pt, idx) => {
                    if (idx > 0 && idx < compHpPath.length - 1) {
                        mainPointsTS.push({ name: '', value: pt, label: { show: false } });
                    }
                });
                mainPointsTS.push(pt_hp2_TS);
                
                // 点 3：冷凝器出口（等压过程 HP-2->3 冷凝，添加中间点）
                const pt3_TS = {
                    name: '3',
                    value: [
                        CP_INSTANCE.PropsSI('S', 'H', hpStage.h3, 'P', hpStage.Pc_Pa, fluid) / 1000,
                        CP_INSTANCE.PropsSI('T', 'H', hpStage.h3, 'P', hpStage.Pc_Pa, fluid) - 273.15
                    ],
                    label: { show: true }
                };
                // 添加等压过程中间点（HP-2->3 冷凝过程）
                const condPath = generateIsobaricPathTS(fluid, hpStage.Pc_Pa, hpStage.h2a, hpStage.h3, 8);
                condPath.forEach((pt, idx) => {
                    if (idx > 0 && idx < condPath.length - 1) {
                        mainPointsTS.push({ name: '', value: pt, label: { show: false } });
                    }
                });
                mainPointsTS.push(pt3_TS);
                
                // 节流过程 3 -> 4（如果中间冷却器ECO是过冷器模式，则从5_inter节流；否则从3节流）
                const h_throttle_start = ecoTypeValue === 'subcooler' ? h_5_inter : hpStage.h3;
                const throttlePath = generateThrottlingPathTS(fluid, h_throttle_start, hpStage.Pc_Pa, Pe_Pa, 8);
                throttlePath.forEach((pt, idx) => {
                    if (idx > 0 && idx < throttlePath.length - 1) {
                        mainPointsTS.push({ name: '', value: pt, label: { show: false } });
                    }
                });
                
                // 构建 T-S 图 ECO 液路和补气路点（中间冷却器ECO始终显示）
                const ecoLiquidPointsTS = [];
                const ecoVaporPointsTS = [];
                
                // 中间冷却器ECO路径（与mode5逻辑一致）
                // 液路：3 -> 5-Inter -> 4（节流过程）
                const pt3_eco_TS = [
                    CP_INSTANCE.PropsSI('S', 'H', hpStage.h3, 'P', hpStage.Pc_Pa, fluid) / 1000,
                    CP_INSTANCE.PropsSI('T', 'H', hpStage.h3, 'P', hpStage.Pc_Pa, fluid) - 273.15
                ];
                ecoLiquidPointsTS.push(pt3_eco_TS);
                
                if (ecoTypeValue === 'subcooler') {
                    const pt5_inter_TS = [
                        CP_INSTANCE.PropsSI('S', 'H', h_5_inter, 'P', hpStage.Pc_Pa, fluid) / 1000,
                        CP_INSTANCE.PropsSI('T', 'H', h_5_inter, 'P', hpStage.Pc_Pa, fluid) - 273.15
                    ];
                    ecoLiquidPointsTS.push(pt5_inter_TS);
                }
                
                // 节流过程 5/3 -> 4
                const throttlePath_eco = generateThrottlingPathTS(fluid, h_throttle_start, hpStage.Pc_Pa, Pe_Pa, 8);
                throttlePath_eco.forEach((pt, idx) => {
                    if (idx > 0 && idx < throttlePath_eco.length - 1) {
                        ecoLiquidPointsTS.push(pt);
                    }
                });
                ecoLiquidPointsTS.push(pt4_TS.value);
                
                // 补气路：3 -> 7-Inter -> 6-Inter -> mix（与mode5一致）
                const pt7_inter_TS = [
                    CP_INSTANCE.PropsSI('S', 'H', h_7_inter, 'P', P_intermediate_Pa, fluid) / 1000,
                    CP_INSTANCE.PropsSI('T', 'H', h_7_inter, 'P', P_intermediate_Pa, fluid) - 273.15
                ];
                const pt6_inter_TS = [
                    CP_INSTANCE.PropsSI('S', 'H', h_6_inter, 'P', P_intermediate_Pa, fluid) / 1000,
                    CP_INSTANCE.PropsSI('T', 'H', h_6_inter, 'P', P_intermediate_Pa, fluid) - 273.15
                ];
                ecoVaporPointsTS.push(pt3_eco_TS);
                const throttlePath37 = generateThrottlingPathTS(fluid, hpStage.h3, hpStage.Pc_Pa, P_intermediate_Pa, 5);
                throttlePath37.forEach((pt, idx) => {
                    if (idx > 0 && idx < throttlePath37.length - 1) {
                        ecoVaporPointsTS.push(pt);
                    }
                });
                ecoVaporPointsTS.push(pt7_inter_TS);
                const subcoolerPath = generateIsobaricPathTS(fluid, P_intermediate_Pa, h_7_inter, h_6_inter, 5);
                subcoolerPath.forEach((pt, idx) => {
                    if (idx > 0 && idx < subcoolerPath.length - 1) {
                        ecoVaporPointsTS.push(pt);
                    }
                });
                ecoVaporPointsTS.push(pt6_inter_TS);
                // 获取mix点的T-S坐标
                const pt_mix_TS_value = [
                    CP_INSTANCE.PropsSI('S', 'H', h_mix, 'P', P_intermediate_Pa, fluid) / 1000,
                    CP_INSTANCE.PropsSI('T', 'H', h_mix, 'P', P_intermediate_Pa, fluid) - 273.15
                ];
                ecoVaporPointsTS.push(pt_mix_TS_value);
                
                // 高压级ECO路径（T-S图）- 如果启用
                if (hasEcoHp) {
                    // 计算高压级经济器压力
                    const P_eco_hp_Pa = Math.sqrt(Pe_Pa * Pc_Pa);
                    
                    // 点7-HP：从点3等焓节流到经济器压力
                    const pt7_hp_TS = [
                        CP_INSTANCE.PropsSI('S', 'H', hpStage.h7, 'P', P_eco_hp_Pa, fluid) / 1000,
                        CP_INSTANCE.PropsSI('T', 'H', hpStage.h7, 'P', P_eco_hp_Pa, fluid) - 273.15
                    ];
                    
                    // 点6-HP：补气过热蒸汽（在经济器压力下）
                    const pt6_hp_TS = [
                        CP_INSTANCE.PropsSI('S', 'H', hpStage.h6, 'P', P_eco_hp_Pa, fluid) / 1000,
                        CP_INSTANCE.PropsSI('T', 'H', hpStage.h6, 'P', P_eco_hp_Pa, fluid) - 273.15
                    ];
                    
                    // 添加从点3到点7-HP的节流路径（从Pc_Pa到P_eco_Pa）
                    ecoVaporPointsTS.push(pt3_eco_TS);
                    const throttlePath3to7_hp = generateThrottlingPathTS(fluid, hpStage.h3, hpStage.Pc_Pa, P_eco_hp_Pa, 5);
                    throttlePath3to7_hp.forEach((pt, idx) => {
                        if (idx > 0 && idx < throttlePath3to7_hp.length - 1) {
                            ecoVaporPointsTS.push(pt);
                        }
                    });
                    ecoVaporPointsTS.push(pt7_hp_TS);
                    
                    if (ecoTypeHpValue === 'subcooler') {
                        // 过冷器模式：添加从点7-HP到点6-HP的等压加热过程
                        const subcoolerPath_hp = generateIsobaricPathTS(fluid, P_eco_hp_Pa, hpStage.h7, hpStage.h6, 5);
                        subcoolerPath_hp.forEach((pt, idx) => {
                            if (idx > 0 && idx < subcoolerPath_hp.length - 1) {
                                ecoVaporPointsTS.push(pt);
                            }
                        });
                    }
                    ecoVaporPointsTS.push(pt6_hp_TS);
                }
                
                // 保存图表数据供切换使用
                if (!lastCalculationData) {
                    lastCalculationData = {};
                }
                lastCalculationData.chartData = {
                    fluid,
                    mainPoints,
                    ecoLiquidPoints: ecoLiquidPoints, // 使用上面定义的ecoLiquidPoints
                    ecoVaporPoints: ecoVaporPoints, // 使用上面定义的ecoVaporPoints
                    mainPointsTS,
                    ecoLiquidPointsTS,
                    ecoVaporPointsTS,
                    satLinesPH,
                    satLinesTS,
                    hasEcoInter: true, // 中间冷却器ECO始终启用
                    hasEcoLp: false,
                    hasEcoHp: false,
                    chartType: 'ph' // 默认显示 P-h 图
                };

                ['chart-desktop-m6', 'chart-mobile-m6'].forEach(id => {
                    drawPHDiagram(id, {
                        title: `Two-Stage Double Compressor (${fluid}) [中间冷却器]`,
                        mainPoints: mainPoints,
                        ecoLiquidPoints: ecoLiquidPoints,
                        ecoVaporPoints: ecoVaporPoints,
                        saturationLiquidPoints: satLinesPH.liquidPH,
                        saturationVaporPoints: satLinesPH.vaporPH,
                        xLabel: 'h (kJ/kg)',
                        yLabel: 'P (bar)'
                    });
                });
            }

            // 渲染结果面板
            const html = `
                <div class="grid grid-cols-2 gap-4 mb-6">
                    ${createKpiCard('制冷量', (Q_evap_W / 1000).toFixed(2), 'kW', 'Cooling Capacity', 'blue')}
                    ${createKpiCard('总轴功率', (W_shaft_total_W / 1000).toFixed(2), 'kW', 'Total Shaft Power', 'orange')}
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div class="bg-white/60 p-4 rounded-2xl border border-white/50">
                        ${createSectionHeader('Low Pressure Stage', '❄️')}
                        ${createDetailRow('轴功 (LP)', `${(lpStage.W_shaft_W / 1000).toFixed(2)} kW`)}
                        ${createDetailRow('Q_evap', `${(Q_evap_W / 1000).toFixed(2)} kW`)}
                        ${createDetailRow('油冷负荷', (lpStage.Q_oil_W / 1000).toFixed(2), 'kW')}
                        ${createDetailRow('m_dot_LP', `${lpStage.m_dot.toFixed(4)} kg/s`)}
                        ${createDetailRow('T_discharge_LP', `${lpStage.T2a_C.toFixed(1)} °C`)}
                    </div>
                    <div class="bg-white/60 p-4 rounded-2xl border border-white/50">
                        ${createSectionHeader('High Pressure Stage', '🔥')}
                        ${createDetailRow('轴功 (HP)', `${(hpStage.W_shaft_W / 1000).toFixed(2)} kW`)}
                        ${createDetailRow('Q_cond', `${(hpStage.Q_cond_W / 1000).toFixed(2)} kW`)}
                        ${createDetailRow('油冷负荷', (hpStage.Q_oil_W / 1000).toFixed(2), 'kW')}
                        ${createDetailRow('m_dot_HP', `${hpStage.m_dot.toFixed(4)} kg/s`)}
                        ${createDetailRow('T_discharge_HP', `${hpStage.T2a_C.toFixed(1)} °C`)}
                    </div>
                </div>

                <div class="space-y-1 bg-white/40 p-4 rounded-2xl border border-white/50 shadow-inner">
                    ${createSectionHeader('System Performance', '📈')}
                    ${createDetailRow('COP_c', COP_c.toFixed(3), true)}
                    ${createDetailRow('COP_h', COP_h.toFixed(3))}
                    ${createDetailRow('P_intermediate', `${(P_intermediate_Pa / 1e5).toFixed(2)} bar`)}
                    ${createDetailRow('T_intermediate', `${(T_intermediate_sat_K - 273.15).toFixed(1)} °C`)}
                    ${createSectionHeader('State Points', '📊')}
                    ${createStateTable(statePoints)}
                </div>
            `;

            renderToAllViews(html);
            
            // 结果渲染后，重新绑定图表切换按钮（因为按钮可能在结果渲染时才创建）
            setTimeout(() => {
                if (window.bindChartToggleButtonsM6) {
                    window.bindChartToggleButtonsM6();
                }
            }, 100);

            updateMobileSummary('Q_evap', `${(Q_evap_W / 1000).toFixed(2)} kW`, 'COP', COP_c.toFixed(2));

            openMobileSheet('m6');

            setButtonFresh6();
            if (printButtonM6) printButtonM6.disabled = false;

            // 保留已有的 chartData（如果存在），避免覆盖图表切换数据
            const existingChartData = lastCalculationData && lastCalculationData.chartData;
            
            lastCalculationData = {
                fluid,
                Te_C,
                Tc_C,
                lpStage,
                hpStage,
                Q_evap_W,
                W_shaft_total_W,
                COP_c
            };
            
            // 恢复 chartData（如果之前存在）
            if (existingChartData) {
                lastCalculationData.chartData = existingChartData;
            }

            const inputState = SessionState.collectInputs('calc-form-mode-6');
            HistoryDB.add(
                'M6',
                `${fluid} • ${(Q_evap_W / 1000).toFixed(2)} kW • COP ${COP_c.toFixed(2)}`,
                inputState,
                { 'Q_evap': `${(Q_evap_W / 1000).toFixed(2)} kW`, COP: COP_c.toFixed(2) }
            );
        } catch (error) {
            console.error(error);
            renderToAllViews(createErrorCard(error.message));
            if (printButtonM6) printButtonM6.disabled = true;
        }
    }, 50);
}

function printReportMode6() {
    if (!lastCalculationData) return;
    const d = lastCalculationData;
    const resultDiv = document.querySelector('.print-results');
    let tableText = '\n\nState Points:\n--------------------\nPoint\tT(C)\tP(bar)\th(kJ)\tm(kg/s)\n';
    tableText += `Q_evap\t${(d.Q_evap_W / 1000).toFixed(3)} kW\n`;
    tableText += `W_input\t${(d.W_shaft_total_W / 1000).toFixed(3)} kW\n`;
    tableText += `COP_c\t${d.COP_c.toFixed(3)}\n`;
    resultDiv.innerText = `Two-Stage Double Compressor Report:\n` + tableText;
    window.print();
}

// 图表切换函数
function toggleChartTypeM6() {
    console.log('toggleChartTypeM6 called', { 
        hasLastCalcData: !!lastCalculationData,
        hasChartData: !!(lastCalculationData && lastCalculationData.chartData)
    }); // 调试信息
    
    if (!lastCalculationData) {
        console.warn('No calculation data available. Please run calculation first.');
        alert('请先运行计算，然后再切换图表类型。');
        return;
    }
    
    if (!lastCalculationData.chartData) {
        console.warn('No chart data available. Please run calculation first.');
        alert('请先运行计算，然后再切换图表类型。');
        return;
    }
    
    console.log('Chart data available, switching...'); // 调试信息
    
    const chartData = lastCalculationData.chartData;
    const currentType = chartData.chartType || 'ph'; // 添加默认值
    const newType = currentType === 'ph' ? 'ts' : 'ph';
    chartData.chartType = newType;
    
    // 验证必需的数据是否存在
    if (newType === 'ts') {
        if (!chartData.mainPointsTS || chartData.mainPointsTS.length === 0) {
            console.error('T-S chart data not available. Missing or empty mainPointsTS.', chartData);
            alert('T-S 图数据不可用。请重新运行计算。');
            return;
        }
        if (!chartData.satLinesTS || !chartData.satLinesTS.liquid || chartData.satLinesTS.liquid.length === 0) {
            console.error('T-S chart data not available. Missing or empty satLinesTS.', chartData);
            alert('T-S 图饱和线数据不可用。请重新运行计算。');
            return;
        }
    } else {
        if (!chartData.mainPoints || chartData.mainPoints.length === 0) {
            console.error('P-h chart data not available. Missing or empty mainPoints.', chartData);
            alert('P-h 图数据不可用。请重新运行计算。');
            return;
        }
        if (!chartData.satLinesPH || !chartData.satLinesPH.liquidPH || chartData.satLinesPH.liquidPH.length === 0) {
            console.error('P-h chart data not available. Missing or empty satLinesPH.', chartData);
            alert('P-h 图饱和线数据不可用。请重新运行计算。');
            return;
        }
    }
    
    // 确保图表容器可见
    ['chart-desktop-m6', 'chart-mobile-m6'].forEach(id => {
        const container = document.getElementById(id);
        if (container) {
            container.classList.remove('hidden');
        }
    });
    
    try {
        if (newType === 'ph') {
            // 切换到 P-h 图
            ['chart-desktop-m6', 'chart-mobile-m6'].forEach(id => {
                // 清除旧图表配置
                const chart = getChartInstance(id);
                if (chart) {
                    chart.clear();
                }
                
                const ecoTitle = [];
                if (chartData.hasEcoInter) ecoTitle.push('中间冷却器');
                if (chartData.hasEcoLp) ecoTitle.push('低压级ECO');
                if (chartData.hasEcoHp) ecoTitle.push('高压级ECO');
                
                drawPHDiagram(id, {
                    title: `Two-Stage Double Compressor (${chartData.fluid})${ecoTitle.length > 0 ? ' [' + ecoTitle.join('+') + ']' : ''}`,
                    mainPoints: chartData.mainPoints || [],
                    ecoLiquidPoints: chartData.ecoLiquidPoints || [],
                    ecoVaporPoints: chartData.ecoVaporPoints || [],
                    saturationLiquidPoints: chartData.satLinesPH?.liquidPH || [],
                    saturationVaporPoints: chartData.satLinesPH?.vaporPH || [],
                    xLabel: 'h (kJ/kg)',
                    yLabel: 'P (bar)'
                });
            });
        } else {
            // 切换到 T-S 图
            console.log('Switching to T-S diagram', {
                mainPointsTS: chartData.mainPointsTS?.length,
                ecoLiquidPointsTS: chartData.ecoLiquidPointsTS?.length,
                ecoVaporPointsTS: chartData.ecoVaporPointsTS?.length,
                satLinesTS: !!chartData.satLinesTS
            }); // 调试信息
            
            ['chart-desktop-m6', 'chart-mobile-m6'].forEach(id => {
                const container = document.getElementById(id);
                if (!container) {
                    console.error(`Chart container ${id} not found`);
                    return;
                }
                
                // 确保容器可见
                container.classList.remove('hidden');
                
                // 清除旧图表配置
                const chart = getChartInstance(id);
                if (chart) {
                    chart.clear();
                } else {
                    console.warn(`Chart instance for ${id} not found, will be created by drawTSDiagram`);
                }
                
                const ecoTitle = [];
                if (chartData.hasEcoInter) ecoTitle.push('中间冷却器');
                if (chartData.hasEcoLp) ecoTitle.push('低压级ECO');
                if (chartData.hasEcoHp) ecoTitle.push('高压级ECO');
                
                // 验证数据
                if (!chartData.mainPointsTS || chartData.mainPointsTS.length === 0) {
                    console.error('mainPointsTS is empty or missing');
                }
                if (!chartData.satLinesTS || !chartData.satLinesTS.liquid || chartData.satLinesTS.liquid.length === 0) {
                    console.error('satLinesTS.liquid is empty or missing');
                }
                
                drawTSDiagram(id, {
                    title: `Two-Stage Double Compressor (${chartData.fluid})${ecoTitle.length > 0 ? ' [' + ecoTitle.join('+') + ']' : ''}`,
                    mainPoints: chartData.mainPointsTS || [],
                    ecoLiquidPoints: chartData.ecoLiquidPointsTS || [],
                    ecoVaporPoints: chartData.ecoVaporPointsTS || [],
                    saturationLiquidPoints: chartData.satLinesTS?.liquid || [],
                    saturationVaporPoints: chartData.satLinesTS?.vapor || [],
                    xLabel: 'Entropy (kJ/kg·K)',
                    yLabel: 'Temperature (°C)'
                });
                
                console.log(`T-S diagram drawn for ${id}`); // 调试信息
            });
        }
        
        // 更新按钮文本
        const toggleBtn = document.getElementById('chart-toggle-m6');
        const toggleBtnMobile = document.getElementById('chart-toggle-m6-mobile');
        if (toggleBtn) {
            toggleBtn.textContent = newType === 'ph' ? '切换到 T-S 图' : '切换到 P-h 图';
        }
        if (toggleBtnMobile) {
            toggleBtnMobile.textContent = newType === 'ph' ? '切换到 T-S 图' : '切换到 P-h 图';
        }
    } catch (error) {
        console.error('Error switching chart type:', error);
        alert('切换图表类型时出错，请重新计算。');
    }
}

// ---------------------------------------------------------------------
// Compressor Model Selection Handlers
// ---------------------------------------------------------------------

function initCompressorModelSelectorsM6Lp() {
    // Mode 6 LP (双机双级模式): 前川只保留N系列，其余品牌保留全部
    const brands = getFilteredBrands('m6');
    compressorBrandLp.innerHTML = '<option value="">-- 选择品牌 --</option>';
    brands.forEach(brand => {
        const option = document.createElement('option');
        option.value = brand;
        option.textContent = brand;
        compressorBrandLp.appendChild(option);
    });

    compressorBrandLp.addEventListener('change', () => {
        const brand = compressorBrandLp.value;
        compressorSeriesLp.innerHTML = '<option value="">-- 选择系列 --</option>';
        compressorModelLp.innerHTML = '<option value="">-- 选择型号 --</option>';
        compressorSeriesLp.disabled = !brand;
        compressorModelLp.disabled = true;
        modelDisplacementInfoLp.classList.add('hidden');

        if (brand) {
            const series = getFilteredSeriesByBrand('m6', brand);
            series.forEach(s => {
                const option = document.createElement('option');
                option.value = s;
                option.textContent = s;
                compressorSeriesLp.appendChild(option);
            });
            compressorSeriesLp.disabled = false;
        }
    });

    compressorSeriesLp.addEventListener('change', () => {
        const brand = compressorBrandLp.value;
        const series = compressorSeriesLp.value;
        compressorModelLp.innerHTML = '<option value="">-- 选择型号 --</option>';
        compressorModelLp.disabled = !series;
        modelDisplacementInfoLp.classList.add('hidden');

        if (brand && series) {
            const models = getModelsBySeries(brand, series);
            models.forEach(m => {
                const option = document.createElement('option');
                option.value = m.model;
                option.textContent = m.model;
                compressorModelLp.appendChild(option);
            });
            compressorModelLp.disabled = false;
        }
    });

    compressorModelLp.addEventListener('change', () => {
        const brand = compressorBrandLp.value;
        const series = compressorSeriesLp.value;
        const model = compressorModelLp.value;

        if (brand && series && model) {
            const displacement = getDisplacementByModel(brand, series, model);
            if (displacement !== null) {
                modelDisplacementValueLp.textContent = displacement.toFixed(0);
                modelDisplacementInfoLp.classList.remove('hidden');
                
                if (flowLpInput) {
                    flowLpInput.value = displacement.toFixed(2);
                    setButtonStale6();
                }
            } else {
                modelDisplacementInfoLp.classList.add('hidden');
            }
            
            // 选择压缩机型号后，自动更新中间压力（如果模式为自动）
            updateIntermediatePressureM6();
        } else {
            modelDisplacementInfoLp.classList.add('hidden');
        }
    });
}

function initCompressorModelSelectorsM6Hp() {
    // Mode 6 HP (双机双级模式): 前川只保留N系列，其余品牌保留全部
    const brands = getFilteredBrands('m6');
    compressorBrandHp.innerHTML = '<option value="">-- 选择品牌 --</option>';
    brands.forEach(brand => {
        const option = document.createElement('option');
        option.value = brand;
        option.textContent = brand;
        compressorBrandHp.appendChild(option);
    });

    compressorBrandHp.addEventListener('change', () => {
        const brand = compressorBrandHp.value;
        compressorSeriesHp.innerHTML = '<option value="">-- 选择系列 --</option>';
        compressorModelHp.innerHTML = '<option value="">-- 选择型号 --</option>';
        compressorSeriesHp.disabled = !brand;
        compressorModelHp.disabled = true;
        modelDisplacementInfoHp.classList.add('hidden');

        if (brand) {
            const series = getFilteredSeriesByBrand('m6', brand);
            series.forEach(s => {
                const option = document.createElement('option');
                option.value = s;
                option.textContent = s;
                compressorSeriesHp.appendChild(option);
            });
            compressorSeriesHp.disabled = false;
        }
    });

    compressorSeriesHp.addEventListener('change', () => {
        const brand = compressorBrandHp.value;
        const series = compressorSeriesHp.value;
        compressorModelHp.innerHTML = '<option value="">-- 选择型号 --</option>';
        compressorModelHp.disabled = !series;
        modelDisplacementInfoHp.classList.add('hidden');

        if (brand && series) {
            const models = getModelsBySeries(brand, series);
            models.forEach(m => {
                const option = document.createElement('option');
                option.value = m.model;
                option.textContent = m.model;
                compressorModelHp.appendChild(option);
            });
            compressorModelHp.disabled = false;
        }
    });

    compressorModelHp.addEventListener('change', () => {
        const brand = compressorBrandHp.value;
        const series = compressorSeriesHp.value;
        const model = compressorModelHp.value;

        if (brand && series && model) {
            const displacement = getDisplacementByModel(brand, series, model);
            if (displacement !== null) {
                modelDisplacementValueHp.textContent = displacement.toFixed(0);
                modelDisplacementInfoHp.classList.remove('hidden');
                
                if (flowHpInput) {
                    flowHpInput.value = displacement.toFixed(2);
                    setButtonStale6();
                }
            } else {
                modelDisplacementInfoHp.classList.add('hidden');
            }
            
            // 选择压缩机型号后，自动更新中间压力（如果模式为自动）
            updateIntermediatePressureM6();
        } else {
            modelDisplacementInfoHp.classList.add('hidden');
        }
    });
}

// ---------------------------------------------------------------------
// Intermediate Pressure Update
// ---------------------------------------------------------------------

function updateIntermediatePressureM6() {
    if (!CP_INSTANCE || !interSatTempInput) return;
    
    try {
        // 检查中间压力模式是否为自动
        const interPressModeValue = document.querySelector('input[name="inter_press_mode_m6"]:checked')?.value || 'auto';
        if (interPressModeValue !== 'auto') return; // 手动模式时不更新
        
        const fluid = fluidSelect.value;
        const Te_C = parseFloat(tempEvapInput.value);
        const Tc_C = parseFloat(tempCondInput.value);
        let shLp_K = parseFloat(superheatInput.value);
        // 过热度为0时会导致计算错误，使用0.001代替
        if (shLp_K === 0 || Math.abs(shLp_K) < 0.0001) {
            shLp_K = 0.001;
        }
        const scHp_K = parseFloat(subcoolInput.value);
        const flowLp = parseFloat(flowLpInput.value);
        const flowHp = parseFloat(flowHpInput.value);
        const eta_v_lp = parseFloat(etaVLpInput.value);
        const eta_v_hp = parseFloat(etaVHpInput.value);
        const eta_s_lp = parseFloat(etaSLpInput.value);
        
        // ECO参数（用于估算补气流量）- 中间冷却器ECO始终启用
        const isEcoEnabled = true; // 中间冷却器是必选项
        const ecoTypeValue = document.querySelector('input[name="eco_type_m6"]:checked')?.value || 'flash_tank';
        // 闪蒸罐模式：使用补气过热度输入（但补气是饱和蒸汽，过热度为0）
        // 过冷器模式：使用补气过热度输入（补气需要过热）
        const ecoSuperheatValue = ecoTypeValue === 'flash_tank' 
            ? 0  // 闪蒸罐模式下过热度固定为0
            : (ecoSuperheatInputSubcooler ? parseFloat(ecoSuperheatInputSubcooler.value) : 5);
        const ecoDtValue = ecoDtInput ? parseFloat(ecoDtInput.value) : 5.0;
        
        if (isNaN(Te_C) || isNaN(Tc_C) || Tc_C <= Te_C) return;
        if (isNaN(shLp_K) || isNaN(scHp_K) || isNaN(flowLp) || isNaN(flowHp)) return;
        
        // 效率参数验证：如果为空或无效，使用默认值或返回
        if (isNaN(eta_v_lp) || eta_v_lp <= 0 || eta_v_lp > 1) return;
        if (isNaN(eta_v_hp) || eta_v_hp <= 0 || eta_v_hp > 1) return;
        if (isNaN(eta_s_lp) || eta_s_lp <= 0 || eta_s_lp > 1) return;
        
        const Pe_Pa = CP_INSTANCE.PropsSI('P', 'T', Te_C + 273.15, 'Q', 1, fluid);
        const Pc_Pa = CP_INSTANCE.PropsSI('P', 'T', Tc_C + 273.15, 'Q', 1, fluid);
        
        if (!Pe_Pa || !Pc_Pa || Pe_Pa <= 0 || Pc_Pa <= 0) return;
        
        // 获取压缩机参数（用于优化中间压力计算）
        let disp_lp = null, disp_hp = null;
        if (compressorBrandLp && compressorSeriesLp && compressorModelLp &&
            compressorBrandHp && compressorSeriesHp && compressorModelHp) {
            const brandLp = compressorBrandLp.value;
            const seriesLp = compressorSeriesLp.value;
            const modelLp = compressorModelLp.value;
            const brandHp = compressorBrandHp.value;
            const seriesHp = compressorSeriesHp.value;
            const modelHp = compressorModelHp.value;
            
            if (brandLp && seriesLp && modelLp) {
                const detailLp = getModelDetail(brandLp, seriesLp, modelLp);
                if (detailLp) {
                    if (typeof detailLp.disp_lp === 'number') {
                        disp_lp = detailLp.disp_lp;
                    } else if (typeof detailLp.displacement === 'number') {
                        disp_lp = detailLp.displacement;
                    }
                }
            }
            
            if (brandHp && seriesHp && modelHp) {
                const detailHp = getModelDetail(brandHp, seriesHp, modelHp);
                if (detailHp) {
                    if (typeof detailHp.disp_hp === 'number') {
                        disp_hp = detailHp.disp_hp;
                    } else if (typeof detailHp.displacement === 'number') {
                        disp_hp = detailHp.displacement;
                    }
                }
            }
        }
        
        // 如果无法从型号获取，尝试使用输入的流量值
        if (disp_lp === null || disp_lp <= 0) {
            disp_lp = flowLp;
        }
        if (disp_hp === null || disp_hp <= 0) {
            disp_hp = flowHp;
        }
        
        // 优先使用流量法计算
        let P_intermediate_Pa = null;
        if (disp_lp > 0 && disp_hp > 0) {
            P_intermediate_Pa = calculateOptimalIntermediatePressureM6({
                fluid,
                Te_C,
                Tc_C,
                superheat_K: shLp_K,
                flow_lp_m3h: disp_lp,
                flow_hp_m3h: disp_hp,
                eta_v_lp,
                eta_v_hp,
                eta_s_lp,
                subcooling_K: scHp_K,
                isEcoInterEnabled: isEcoEnabled,
                ecoInterType: ecoTypeValue,
                ecoInterSuperheat_K: ecoSuperheatValue,
                ecoInterDt_K: ecoDtValue
            });
        }
        
        // 如果优化算法失败，回退到几何平均法
        if (P_intermediate_Pa === null || P_intermediate_Pa <= Pe_Pa || P_intermediate_Pa >= Pc_Pa) {
            P_intermediate_Pa = Math.sqrt(Pe_Pa * Pc_Pa);
        }
        
        // 计算中间饱和温度
        const T_intermediate_sat_K = CP_INSTANCE.PropsSI('T', 'P', P_intermediate_Pa, 'Q', 0, fluid);
        const T_intermediate_sat_C = T_intermediate_sat_K - 273.15;
        
        // 更新中间压力输入框的值（即使输入框是禁用的）
        if (interSatTempInput) {
            interSatTempInput.value = T_intermediate_sat_C.toFixed(2);
            // 触发input事件，确保UI更新
            interSatTempInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        
    } catch (error) {
        console.warn("Update Intermediate Pressure M6 Error (Ignored):", error.message);
    }
}

// ---------------------------------------------------------------------
// Auto Efficiency Calculation
// ---------------------------------------------------------------------

function updateAndDisplayEfficienciesM6Lp() {
    if (!CP_INSTANCE || !autoEffLpCheckbox || !autoEffLpCheckbox.checked) return;
    
    try {
        const fluid = fluidSelect.value;
        const Te_C = parseFloat(tempEvapInput.value);
        const Tc_C = parseFloat(tempCondInput.value);
        
        if (isNaN(Te_C) || isNaN(Tc_C) || Tc_C <= Te_C) return;
        
        const Pe_Pa = CP_INSTANCE.PropsSI('P', 'T', Te_C + 273.15, 'Q', 1, fluid);
        const Pc_Pa = CP_INSTANCE.PropsSI('P', 'T', Tc_C + 273.15, 'Q', 1, fluid);
        const P_intermediate_Pa = Math.sqrt(Pe_Pa * Pc_Pa);
        
        const pressureRatio = P_intermediate_Pa / Pe_Pa;
        const efficiencies = calculateEmpiricalEfficiencies(pressureRatio);
        
        if (etaVLpInput) etaVLpInput.value = efficiencies.eta_v;
        if (etaSLpInput) etaSLpInput.value = efficiencies.eta_s;
        
    } catch (error) {
        console.warn("Auto-Eff M6 LP Error (Ignored):", error.message);
    }
}

function updateAndDisplayEfficienciesM6Hp() {
    if (!CP_INSTANCE || !autoEffHpCheckbox || !autoEffHpCheckbox.checked) return;
    
    try {
        const fluid = fluidSelect.value;
        const Te_C = parseFloat(tempEvapInput.value);
        const Tc_C = parseFloat(tempCondInput.value);
        
        if (isNaN(Te_C) || isNaN(Tc_C) || Tc_C <= Te_C) return;
        
        const Pe_Pa = CP_INSTANCE.PropsSI('P', 'T', Te_C + 273.15, 'Q', 1, fluid);
        const Pc_Pa = CP_INSTANCE.PropsSI('P', 'T', Tc_C + 273.15, 'Q', 1, fluid);
        const P_intermediate_Pa = Math.sqrt(Pe_Pa * Pc_Pa);
        
        const pressureRatio = Pc_Pa / P_intermediate_Pa;
        const efficiencies = calculateEmpiricalEfficiencies(pressureRatio);
        
        if (etaVHpInput) etaVHpInput.value = efficiencies.eta_v;
        if (etaSHpInput) etaSHpInput.value = efficiencies.eta_s;
        
    } catch (error) {
        console.warn("Auto-Eff M6 HP Error (Ignored):", error.message);
    }
}

export function triggerMode6EfficiencyUpdate() {
    updateAndDisplayEfficienciesM6Lp();
    updateAndDisplayEfficienciesM6Hp();
}

export function initMode6(CP) {
    CP_INSTANCE = CP;

    calcButtonM6 = document.getElementById('calc-button-mode-6');
    calcFormM6 = document.getElementById('calc-form-mode-6');
    printButtonM6 = document.getElementById('print-button-mode-6');
    resultsDesktopM6 = document.getElementById('results-desktop-m6');
    resultsMobileM6 = document.getElementById('mobile-results-m6');
    summaryMobileM6 = document.getElementById('mobile-summary-m6');

    // 输入元素
    fluidSelect = document.getElementById('fluid_m6');
    fluidInfoDiv = document.getElementById('fluid-info-m6');
    tempEvapInput = document.getElementById('temp_evap_m6');
    tempCondInput = document.getElementById('temp_cond_m6');
    superheatInput = document.getElementById('superheat_m6');
    subcoolInput = document.getElementById('subcooling_m6');
    
    // 低压级
    flowLpInput = document.getElementById('flow_m3h_m6_lp');
    etaVLpInput = document.getElementById('eta_v_m6_lp');
    etaSLpInput = document.getElementById('eta_s_m6_lp');
    autoEffLpCheckbox = document.getElementById('auto-eff-m6-lp');
    compressorBrandLp = document.getElementById('compressor_brand_m6_lp');
    compressorSeriesLp = document.getElementById('compressor_series_m6_lp');
    compressorModelLp = document.getElementById('compressor_model_m6_lp');
    modelDisplacementInfoLp = document.getElementById('model_displacement_info_m6_lp');
    modelDisplacementValueLp = document.getElementById('model_displacement_value_m6_lp');
    tempDischargeActualLpInput = document.getElementById('temp_discharge_actual_m6_lp');
    
    // 高压级
    flowHpInput = document.getElementById('flow_m3h_m6_hp');
    etaVHpInput = document.getElementById('eta_v_m6_hp');
    etaSHpInput = document.getElementById('eta_s_m6_hp');
    autoEffHpCheckbox = document.getElementById('auto-eff-m6-hp');
    compressorBrandHp = document.getElementById('compressor_brand_m6_hp');
    compressorSeriesHp = document.getElementById('compressor_series_m6_hp');
    compressorModelHp = document.getElementById('compressor_model_m6_hp');
    modelDisplacementInfoHp = document.getElementById('model_displacement_info_m6_hp');
    modelDisplacementValueHp = document.getElementById('model_displacement_value_m6_hp');
    tempDischargeActualHpInput = document.getElementById('temp_discharge_actual_m6_hp');
    
    interSatTempInput = document.getElementById('temp_inter_sat_m6');
    
    // ECO设置 - 中间冷却器（始终启用，不需要checkbox）
    // ecoCheckbox = document.getElementById('enable_eco_m6'); // 不再需要
    ecoSuperheatInput = document.getElementById('eco_superheat_m6');
    ecoSuperheatInputSubcooler = document.getElementById('eco_superheat_m6_subcooler');
    ecoDtInput = document.getElementById('eco_dt_m6');
    
    // ECO设置 - 低压级
    ecoCheckboxLp = document.getElementById('enable_eco_m6_lp');
    ecoSuperheatInputLp = document.getElementById('eco_superheat_m6_lp');
    ecoDtInputLp = document.getElementById('eco_dt_m6_lp');
    
    // ECO设置 - 高压级
    ecoCheckboxHp = document.getElementById('enable_eco_m6_hp');
    ecoSuperheatInputHp = document.getElementById('eco_superheat_m6_hp');
    ecoDtInputHp = document.getElementById('eco_dt_m6_hp');

    // Initialize compressor model selectors
    if (compressorBrandLp && compressorSeriesLp && compressorModelLp) {
        initCompressorModelSelectorsM6Lp();
    }
    if (compressorBrandHp && compressorSeriesHp && compressorModelHp) {
        initCompressorModelSelectorsM6Hp();
    }

    if (calcFormM6) {
        calcFormM6.addEventListener('submit', (e) => {
            e.preventDefault();
            calculateMode6();
        });

        const inputs = calcFormM6.querySelectorAll('input, select');
        inputs.forEach((input) => {
            input.addEventListener('input', setButtonStale6);
            input.addEventListener('change', setButtonStale6);
        });

        if (fluidSelect && fluidInfoDiv) {
            fluidSelect.addEventListener('change', () => {
                updateFluidInfo(fluidSelect, fluidInfoDiv, CP_INSTANCE);
                updateAndDisplayEfficienciesM6Lp();
                updateAndDisplayEfficienciesM6Hp();
            });
        }

        // 自动效率更新监听器
        [tempEvapInput, tempCondInput, autoEffLpCheckbox, autoEffHpCheckbox].forEach(input => {
            if (input) {
                input.addEventListener('change', () => {
                    updateAndDisplayEfficienciesM6Lp();
                    updateAndDisplayEfficienciesM6Hp();
                });
                input.addEventListener('input', () => {
                    if (autoEffLpCheckbox && autoEffLpCheckbox.checked) updateAndDisplayEfficienciesM6Lp();
                    if (autoEffHpCheckbox && autoEffHpCheckbox.checked) updateAndDisplayEfficienciesM6Hp();
                });
            }
        });

        if (autoEffLpCheckbox) {
            autoEffLpCheckbox.addEventListener('change', () => {
                if (autoEffLpCheckbox.checked) {
                    updateAndDisplayEfficienciesM6Lp();
                }
            });
        }
        
        if (autoEffHpCheckbox) {
            autoEffHpCheckbox.addEventListener('change', () => {
                if (autoEffHpCheckbox.checked) {
                    updateAndDisplayEfficienciesM6Hp();
                }
            });
        }

        if (printButtonM6) {
            printButtonM6.addEventListener('click', printReportMode6);
        }
        
        // 图表切换按钮 - 直接在按钮上绑定事件监听器
        // 使用函数来绑定，这样可以在结果渲染后重新调用
        function bindChartToggleButtons() {
            const chartToggleBtn = document.getElementById('chart-toggle-m6');
            const chartToggleBtnMobile = document.getElementById('chart-toggle-m6-mobile');
            
            console.log('Binding chart toggle buttons:', { chartToggleBtn, chartToggleBtnMobile }); // 调试信息
            
            if (chartToggleBtn) {
                // 直接添加事件监听器，如果已存在会被覆盖（使用once选项或先移除）
                const handler = (e) => {
                    console.log('Chart toggle button clicked (desktop)'); // 调试信息
                    e.preventDefault();
                    e.stopPropagation();
                    toggleChartTypeM6();
                };
                // 先移除旧的监听器（通过克隆节点）
                const newBtn = chartToggleBtn.cloneNode(true);
                if (chartToggleBtn.parentNode) {
                    chartToggleBtn.parentNode.replaceChild(newBtn, chartToggleBtn);
                    newBtn.addEventListener('click', handler);
                    console.log('Desktop chart toggle button bound'); // 调试信息
                }
            }
            
            if (chartToggleBtnMobile) {
                const handlerMobile = (e) => {
                    console.log('Chart toggle button clicked (mobile)'); // 调试信息
                    e.preventDefault();
                    e.stopPropagation();
                    toggleChartTypeM6();
                };
                const newBtnMobile = chartToggleBtnMobile.cloneNode(true);
                if (chartToggleBtnMobile.parentNode) {
                    chartToggleBtnMobile.parentNode.replaceChild(newBtnMobile, chartToggleBtnMobile);
                    newBtnMobile.addEventListener('click', handlerMobile);
                    console.log('Mobile chart toggle button bound'); // 调试信息
                }
            }
        }
        
        // 初始化时绑定
        bindChartToggleButtons();
        
        // 保存绑定函数，以便在结果渲染后重新绑定
        window.bindChartToggleButtonsM6 = bindChartToggleButtons;
        
        // 中间压力模式切换监听器
        const interPressModeRadios = document.querySelectorAll('input[name="inter_press_mode_m6"]');
        interPressModeRadios.forEach(radio => {
            if (radio) {
                radio.addEventListener('change', () => {
                    updateIntermediatePressureM6(); // 切换模式时更新中间压力
                });
            }
        });
        
        // 温度、效率等输入变化时更新中间压力
        [tempEvapInput, tempCondInput, superheatInput, subcoolInput, 
         flowLpInput, flowHpInput, etaVLpInput, etaVHpInput, etaSLpInput].forEach(input => {
            if (input) {
                // 使用防抖，避免频繁更新
                let updateTimeout = null;
                const scheduleUpdate = () => {
                    if (updateTimeout) clearTimeout(updateTimeout);
                    updateTimeout = setTimeout(() => {
                        updateIntermediatePressureM6();
                    }, 150); // 150ms 防抖
                };
                
                input.addEventListener('input', scheduleUpdate);
                input.addEventListener('change', () => {
                    if (updateTimeout) clearTimeout(updateTimeout);
                    updateIntermediatePressureM6();
                });
            }
        });
        
        // ECO参数变化时也更新中间压力（中间冷却器ECO始终启用）
        [ecoSuperheatInput, ecoSuperheatInputSubcooler, ecoDtInput].forEach(input => {
            if (input) {
                input.addEventListener('change', () => {
                    updateIntermediatePressureM6();
                });
            }
        });

        // ECO toggle 逻辑（已在 ui.js 中处理，这里确保初始化时状态正确）
        // ECO设置已移至ui.js处理，这里不再需要
        
        // 初始化时触发一次效率更新和中间压力更新
        setTimeout(() => {
            if (autoEffLpCheckbox && autoEffLpCheckbox.checked) {
                updateAndDisplayEfficienciesM6Lp();
            }
            if (autoEffHpCheckbox && autoEffHpCheckbox.checked) {
                updateAndDisplayEfficienciesM6Hp();
            }
            updateIntermediatePressureM6(); // 初始化时更新中间压力
        }, 100);
    }

    console.log('Mode 6 (Two-Stage Double Compressor) initialized.');
}

