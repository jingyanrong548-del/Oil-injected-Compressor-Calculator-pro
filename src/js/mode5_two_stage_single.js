// =====================================================================
// mode5_two_stage_single.js: 模式五 (单机双级压缩) - v1.0
// 职责: 单台压缩机实现两级压缩，通过经济器（ECO）实现补气，
//      支持闪发箱（Flash Tank）和过冷器（Subcooler）两种模式。
// 说明: 复用 Mode 4 中的 ECO 逻辑，但明确指定中间压力/温度。
// =====================================================================

import { createKpiCard, createDetailRow, createSectionHeader, createErrorCard, createStateTable } from './components.js';
import { drawPHDiagram } from './charts.js';
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
let calcButtonM5, calcFormM5, printButtonM5;
let resultsDesktopM5, resultsMobileM5, summaryMobileM5;

// 输入元素
let fluidSelect, fluidInfoDiv, tempEvapInput, tempCondInput, superheatInput, subcoolInput;
let flowInput;
let etaVLpInput, etaSLpInput, autoEffLpCheckbox;
let etaSHpInput, autoEffHpCheckbox;
let compressorBrand, compressorSeries, compressorModel, modelDisplacementInfo, modelDisplacementValue;
let ecoCheckbox, ecoType, ecoPressMode, ecoSatTempInput, ecoSuperheatInput, ecoDtInput;
let slhxCheckbox, slhxEff;
let tempDischargeActualInput;
let tempDischargeMidInput;  // 低压级设定排气温度输入

// 中间压力设置
let interPressMode, interSatTempInput;

const BTN_TEXT_CALCULATE = 'Calculate Two-Stage';
const BTN_TEXT_RECALCULATE = 'Recalculate (Input Changed)';

// ---------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------

function setButtonStale5() {
    if (calcButtonM5 && calcButtonM5.innerText !== BTN_TEXT_RECALCULATE) {
        calcButtonM5.innerText = BTN_TEXT_RECALCULATE;
        calcButtonM5.classList.add('opacity-90', 'ring-2', 'ring-yellow-400', 'ring-offset-2');
        if (printButtonM5) {
            printButtonM5.disabled = true;
            printButtonM5.classList.add('opacity-50', 'cursor-not-allowed');
        }
    }
}

function setButtonFresh5() {
    if (calcButtonM5) {
        calcButtonM5.innerText = BTN_TEXT_CALCULATE;
        calcButtonM5.classList.remove('opacity-90', 'ring-2', 'ring-yellow-400', 'ring-offset-2');
    }
}

function renderToAllViews(htmlContent) {
    if (resultsDesktopM5) resultsDesktopM5.innerHTML = htmlContent;
    if (resultsMobileM5) resultsMobileM5.innerHTML = htmlContent;
}

function updateMobileSummary(kpi1Label, kpi1Value, kpi2Label, kpi2Value) {
    if (!summaryMobileM5) return;
    summaryMobileM5.innerHTML = `
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
// Core Calculation Logic - Two-Stage Single Compressor
// ---------------------------------------------------------------------

/**
 * 基于高低压级理论排量计算最优中间压力
 * 使用流量平衡方法：通过迭代寻优找到中间压力，使得高压级吸气量与（低压排气+过冷器补气）质量流量平衡
 * @param {Object} params - 计算参数
 * @param {string} params.fluid - 工质名称
 * @param {number} params.Te_C - 蒸发温度 (°C)
 * @param {number} params.Tc_C - 冷凝温度 (°C)
 * @param {number} params.superheat_K - 过热度 (K)
 * @param {number} params.flow_m3h - 低压级理论排量 (m³/h)
 * @param {number} params.eta_v_lp - 低压级容积效率
 * @param {number} params.eta_v_hp - 高压级容积效率
 * @param {number} params.eta_s_lp - 低压级等熵效率
 * @param {number} params.eta_s_hp - 高压级等熵效率
 * @param {number} params.vi_ratio - 容积比 (Vi,L / Vi,H)，如果提供则使用
 * @param {number} params.disp_lp - 低压级排量 (m³/h)，如果提供则使用
 * @param {number} params.disp_hp - 高压级排量 (m³/h)，如果提供则使用
 * @param {number} params.subcooling_K - 过冷度 (K)，用于ECO计算
 * @param {number} params.ecoSuperheat_K - ECO过热度 (K)，用于ECO计算
 * @param {number} params.ecoDt_K - ECO过冷度/接近度 (K)，用于ECO计算
 * @returns {number|null} 最优中间压力 (Pa)，如果无法计算则返回 null
 */
function calculateOptimalIntermediatePressure({
    fluid,
    Te_C,
    Tc_C,
    superheat_K,
    flow_m3h,
    eta_v_lp,
    eta_v_hp,
    eta_s_lp,
    eta_s_hp,
    vi_ratio = null,
    disp_lp = null,
    disp_hp = null,
    subcooling_K = 5.0,
    ecoSuperheat_K = 5.0,
    ecoDt_K = 5.0
}) {
    if (!CP_INSTANCE) return null;
    
    try {
        const T_evap_K = Te_C + 273.15;
        const T_cond_K = Tc_C + 273.15;
        const Pe_Pa = CP_INSTANCE.PropsSI('P', 'T', T_evap_K, 'Q', 1, fluid);
        const Pc_Pa = CP_INSTANCE.PropsSI('P', 'T', T_cond_K, 'Q', 1, fluid);
        
        // 获取高压级理论排量
        let V_th_HP = null;
        if (disp_hp !== null && disp_hp > 0) {
            V_th_HP = disp_hp; // 高压级理论排量 (m³/h)
        } else if (vi_ratio !== null && vi_ratio > 0 && flow_m3h > 0) {
            // 通过容积比计算高压级排量
            V_th_HP = flow_m3h / vi_ratio;
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
        const V_th_LP = flow_m3h; // 低压级理论排量 (m³/h)
        const m_dot_lp = (V_th_LP * eta_v_lp * rho1) / 3600.0; // kg/s
        
        // 状态点 5 (冷凝器出口/过冷前)
        const T5_K = T_cond_K - subcooling_K;
        const h5 = CP_INSTANCE.PropsSI('H', 'T', T5_K, 'P', Pc_Pa, fluid);
        
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
            // 2. 过冷器侧计算
            // =========================================================
            // 主路入口：点5 (冷凝器出口，T_cond - DT_sc)
            // 主路出口 (点 6)：从 h5 冷却至 T_mid_sat + DT_approach（在冷凝压力下）
            const T6_K = T_intermediate_sat_K + ecoDt_K; // DT_approach 是过冷器接近度
            const h6 = CP_INSTANCE.PropsSI('H', 'T', T6_K, 'P', Pc_Pa, fluid);
            
            // 补气路：从点5等焓节流到中间压力（点7）
            const h7 = h5; // 等焓节流：h7 = h5（在中间压力下）
            
            // 补气路出口 (点 8)：在过冷器中吸热变为过热蒸汽（过热度为 DT_sh_mid，在中间压力下）
            const T8_K = T_intermediate_sat_K + ecoSuperheat_K;
            const h8 = CP_INSTANCE.PropsSI('H', 'T', T8_K, 'P', P_intermediate_Pa, fluid);
            
            // 能量平衡求补气量 m_dot_inj
            // 主路放热 = 补气路吸热
            // m_dot_lp * (h5 - h6) = m_dot_inj * (h8 - h7)
            const h_diff_main = h5 - h6;
            const h_diff_inj = h8 - h7;
            
            let m_dot_inj = 0;
            if (h_diff_main > 0 && h_diff_inj > 0) {
                m_dot_inj = (m_dot_lp * h_diff_main) / h_diff_inj;
            }
            
            // 总质量流量（低压排气 + 补气）
            const m_dot_total = m_dot_lp + m_dot_inj;
            
            // 边界情况检查：确保总质量流量有效
            if (m_dot_total <= 0 || !isFinite(m_dot_total)) {
                console.warn("Invalid m_dot_total in intermediate pressure calculation. Using geometric mean.");
                return Math.sqrt(Pe_Pa * Pc_Pa);
            }
            
            // =========================================================
            // 3. 高压级吸气 (点 3) - 混合后
            // =========================================================
            // 混合焓：低压排气与补气混合
            // 注意：在单机双级压缩机中，补气混合发生在压缩过程中
            // 使用实际压缩后的焓值h2进行混合，这样eta_s_lp的变化会直接影响混合状态
            // h2 = h1 + (h2s - h1) / eta_s_lp，考虑了等熵效率的影响
            const h_mix = (m_dot_lp * h2 + m_dot_inj * h8) / m_dot_total;
            const h3 = h_mix;
            
            // 计算点 3 的比容和温度
            let T3_K, rho3;
            try {
                T3_K = CP_INSTANCE.PropsSI('T', 'H', h3, 'P', P_intermediate_Pa, fluid);
                rho3 = CP_INSTANCE.PropsSI('D', 'H', h3, 'P', P_intermediate_Pa, fluid);
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
            // 修正：当 flow_error > 0 时，需要增加压力，所以 adjustment_factor 应该 > 1
            // 使用对数空间调整，更稳定
            let adjustment_factor;
            const abs_error = Math.abs(flow_error);
            
            if (abs_error > 0.1) {
                // 误差较大时，使用较大的调整步长（但限制最大变化）
                // 使用符号函数确保方向正确
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
        
        // 放宽验证：只检查是否在Pe和Pc之间，移除过于严格的倍数限制
        // 中间压力只要在合理范围内即可接受
        return P_intermediate_Pa;
        
    } catch (error) {
        console.warn("Calculate Optimal Intermediate Pressure Error:", error.message);
        return null; // 出错时返回 null，将使用几何平均法
    }
}

// 双级循环计算（复用 Mode 4 的 ECO 逻辑，但强制启用 ECO）
function computeTwoStageCycle({
    fluid,
    Te_C,
    Tc_C,
    superheat_K,
    subcooling_K,
    flow_m3h,
    eta_v_lp,      // 低压级容积效率
    eta_s_lp,      // 低压级等熵效率
    eta_s_hp,      // 高压级等熵效率（高压级不需要η_v，因为流量由补气决定）
    // 中间压力参数（双级压缩必需）
    interPressMode = 'auto', // 'auto' | 'manual'
    interSatTemp_C = null,
    // 压缩机参数（用于优化中间压力计算）
    vi_ratio = null,      // 容积比 (Vi,L / Vi,H)
    disp_lp = null,       // 低压级排量 (m³/h)
    disp_hp = null,       // 高压级排量 (m³/h)
    // ECO参数（双级压缩仅保留过冷器 Subcooler 模式）
    ecoSuperheat_K = 5,
    ecoDt_K = 5.0,
    // SLHX参数
    isSlhxEnabled = false,
    slhxEff = 0.5,
    // 排气温度参数
    T_2a_est_C = null,
    T_mid_est_C = null  // 低压级设定排气温度
}) {
    const T_evap_K = Te_C + 273.15;
    const T_cond_K = Tc_C + 273.15;

    const Pe_Pa = CP_INSTANCE.PropsSI('P', 'T', T_evap_K, 'Q', 1, fluid);
    const Pc_Pa = CP_INSTANCE.PropsSI('P', 'T', T_cond_K, 'Q', 1, fluid);

    // 点 1：蒸发器出口（含过热）
    const T1_K = T_evap_K + superheat_K;
    const h1_base = CP_INSTANCE.PropsSI('H', 'T', T1_K, 'P', Pe_Pa, fluid);
    const s1_base = CP_INSTANCE.PropsSI('S', 'T', T1_K, 'P', Pe_Pa, fluid);
    const rho1_base = CP_INSTANCE.PropsSI('D', 'T', T1_K, 'P', Pe_Pa, fluid);

    // 点 3：冷凝器出口（含过冷）
    const T3_K = T_cond_K - subcooling_K;
    const h3 = CP_INSTANCE.PropsSI('H', 'T', T3_K, 'P', Pc_Pa, fluid);

    // =========================================================
    // 确定中间压力（双级压缩的核心）
    // =========================================================
    let P_intermediate_Pa, T_intermediate_sat_K;
    if (interPressMode === 'auto') {
        // 自动模式：优先使用基于容积比和效率的优化算法
        // 高压级容积效率：单机双级压缩机通常两级容积效率相近，使用低压级值
        const eta_v_hp = eta_v_lp; // 简化假设
        
        const optimalPressure = calculateOptimalIntermediatePressure({
            fluid,
            Te_C,
            Tc_C,
            superheat_K,
            subcooling_K,
            flow_m3h,
            eta_v_lp,
            eta_v_hp,
            eta_s_lp,
            eta_s_hp,
            vi_ratio,
            disp_lp,
            disp_hp,
            ecoSuperheat_K,
            ecoDt_K
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
        // 手动模式：用户指定中间饱和温度
        T_intermediate_sat_K = interSatTemp_C + 273.15;
        P_intermediate_Pa = CP_INSTANCE.PropsSI('P', 'T', T_intermediate_sat_K, 'Q', 0.5, fluid);
    }

    // 验证中间压力合理性
    if (P_intermediate_Pa <= Pe_Pa || P_intermediate_Pa >= Pc_Pa) {
        throw new Error(`无效的中间压力：P_intermediate (${(P_intermediate_Pa/1e5).toFixed(2)} bar) 必须在 P_s 和 P_d 之间`);
    }

    // =========================================================
    // ECO和SLHX迭代计算（复用 Mode 4 逻辑）
    // =========================================================
    let T_suc_K = T1_K;
    let h_suc = h1_base;
    let rho_suc = rho1_base, s_suc = s1_base;
    let m_dot_suc = 0;
    let h_liq_in = h3;
    let h_liq_out = h3;
    
    let m_dot_inj = 0, m_dot_total = 0;
    let h_5 = h3, h_6 = 0, h_7 = h3;
    let m_p5 = 0, m_p6 = 0, m_p7 = 0;

    for (let iter = 0; iter < 5; iter++) {
        // 1. Update Suction Properties
        if (iter === 0) {
            s_suc = CP_INSTANCE.PropsSI('S', 'T', T_suc_K, 'P', Pe_Pa, fluid);
        } else {
            try {
                rho_suc = CP_INSTANCE.PropsSI('D', 'H', h_suc, 'P', Pe_Pa, fluid);
                s_suc = CP_INSTANCE.PropsSI('S', 'H', h_suc, 'P', Pe_Pa, fluid);
                T_suc_K = CP_INSTANCE.PropsSI('T', 'H', h_suc, 'P', Pe_Pa, fluid);
            } catch (e) {
                rho_suc = CP_INSTANCE.PropsSI('D', 'T', T_suc_K, 'P', Pe_Pa, fluid);
            }
        }

        // 2. Mass Flow Calculation - 使用低压级容积效率
        const V_th_m3_s = flow_m3h / 3600.0;
        m_dot_suc = V_th_m3_s * eta_v_lp * rho_suc;

    // =========================================================
    // 3. ECONOMIZER (ECO) Calculation - 仅保留过冷器 (Subcooler)
    // =========================================================
    // 使用中间压力 P_intermediate_Pa（过冷侧换热），高压 Pc_Pa（主路过冷）
    const h_eco_liq = CP_INSTANCE.PropsSI('H', 'T', T_intermediate_sat_K, 'Q', 0, fluid);
    const h_eco_vap = CP_INSTANCE.PropsSI('H', 'T', T_intermediate_sat_K, 'Q', 1, fluid);
    h_7 = h3; // 从冷凝器出口节流到中间压力（等焓）

    // 过冷器模式
    // 主路：从h3（冷凝器出口，T_cond - DT_sc）冷却至T_mid_sat + DT_approach
    const T_5_K = T_intermediate_sat_K + ecoDt_K; // 主路出口温度（在冷凝压力下）
    h_5 = CP_INSTANCE.PropsSI('H', 'T', T_5_K, 'P', Pc_Pa, fluid);
    
    // 补气路：从h3等焓节流到中间压力，然后在过冷器中吸热变为过热蒸汽
    h_7 = h3; // 等焓节流到中间压力
    const T_inj_K = T_intermediate_sat_K + ecoSuperheat_K; // 补气过热温度
    h_6 = CP_INSTANCE.PropsSI('H', 'T', T_inj_K, 'P', P_intermediate_Pa, fluid);
    h_liq_in = h_5;
    const h_diff_main = h3 - h_5;
    const h_diff_inj = h_6 - h_7;
    if (h_diff_main <= 0 || h_diff_inj <= 0) {
        throw new Error(`过冷器能量平衡异常：主路放热=${h_diff_main.toFixed(1)} J/kg，支路吸热=${h_diff_inj.toFixed(1)} J/kg`);
    }
    m_dot_inj = (m_dot_suc * h_diff_main) / h_diff_inj;
    m_dot_total = m_dot_suc + m_dot_inj;
    m_p5 = m_dot_suc;
    m_p7 = m_dot_inj;
    m_p6 = m_dot_inj;

        // 4. SLHX Loop
        if (isSlhxEnabled) {
            const P_liq_side = Pc_Pa;  // 仅过冷器模式，液侧在高压
            const T_liq_in = CP_INSTANCE.PropsSI('T', 'H', h_liq_in, 'P', P_liq_side, fluid);
            const Cp_liq = CP_INSTANCE.PropsSI('C', 'H', h_liq_in, 'P', P_liq_side, fluid);
            const Cp_vap = CP_INSTANCE.PropsSI('C', 'H', h1_base, 'P', Pe_Pa, fluid);
            const C_liq = m_dot_suc * Cp_liq;
            const C_vap = m_dot_suc * Cp_vap;
            const C_min = Math.min(C_liq, C_vap);
            const Q_max = C_min * (T_liq_in - T1_K);
            const Q_slhx = slhxEff * Q_max;
            const h_suc_new = h1_base + (Q_slhx / m_dot_suc);
            const h_liq_out_new = h_liq_in - (Q_slhx / m_dot_suc);
            const diff = Math.abs(h_suc_new - h_suc);
            h_suc = h_suc_new;
            h_liq_out = h_liq_out_new;
            if (diff < 100) break;
        } else {
            h_suc = h1_base;
            h_liq_out = h_liq_in;
            break;
        }
    }

    // =========================================================
    // 两级压缩功计算
    // =========================================================
    // 第一级压缩：P_s → P_intermediate（使用低压级等熵效率）
    const h_mid_1s = CP_INSTANCE.PropsSI('H', 'P', P_intermediate_Pa, 'S', s_suc, fluid);
    const W_s1_ideal = m_dot_suc * (h_mid_1s - h_suc);
    const W_s1 = W_s1_ideal / eta_s_lp;  // 低压级实际功

    // =========================================================
    // 低压级排气点（mid点）计算：考虑油冷
    // =========================================================
    // 计算实际压缩后的焓值（考虑等熵效率）
    const h_mid_actual = h_suc + (h_mid_1s - h_suc) / eta_s_lp;
    const T_mid_actual_K = CP_INSTANCE.PropsSI('T', 'P', P_intermediate_Pa, 'H', h_mid_actual, fluid);
    const T_mid_actual_C = T_mid_actual_K - 273.15;

    // 低压级油冷负荷计算
    let Q_oil_lp_W = 0;
    let T_mid_final_C = 0;
    let h_mid_final = 0;

    if (T_mid_est_C !== null && !isNaN(T_mid_est_C)) {
        // 如果输入了设定排气温度
        if (T_mid_actual_C < T_mid_est_C) {
            // 实际排温低于设定排温，使用实际排温
            h_mid_final = h_mid_actual;
            T_mid_final_C = T_mid_actual_C;
            Q_oil_lp_W = 0;  // 无需油冷
        } else {
            // 实际排温大于等于设定排温，使用设定排温，多余热量由油冷冷却
            const T_mid_est_K = T_mid_est_C + 273.15;
            const h_mid_target = CP_INSTANCE.PropsSI('H', 'T', T_mid_est_K, 'P', P_intermediate_Pa, fluid);
            
            // 油冷负荷 = 实际压缩功 - (目标焓值 - 吸气焓值)
            const energy_out_gas = m_dot_suc * h_mid_target;
            Q_oil_lp_W = W_s1 - (energy_out_gas - m_dot_suc * h_suc);
            
            if (Q_oil_lp_W < 0) {
                // 如果计算出的油冷负荷为负，说明输入温度不合理，使用实际值
                Q_oil_lp_W = 0;
                h_mid_final = h_mid_actual;
                T_mid_final_C = T_mid_actual_C;
            } else {
                h_mid_final = h_mid_target;
                T_mid_final_C = T_mid_est_C;
            }
        }
    } else {
        // 如果未输入设定排气温度，使用实际压缩值（无油冷）
        h_mid_final = h_mid_actual;
        T_mid_final_C = T_mid_actual_C;
        Q_oil_lp_W = 0;
    }

    // 补气混合（使用油冷后的mid点焓值）
    const h_mix = (m_dot_suc * h_mid_final + m_dot_inj * h_6) / m_dot_total;
    const s_mix = CP_INSTANCE.PropsSI('S', 'H', h_mix, 'P', P_intermediate_Pa, fluid);

    // 第二级压缩：P_intermediate → P_d（使用高压级等熵效率）
    const h_2s_stage2 = CP_INSTANCE.PropsSI('H', 'P', Pc_Pa, 'S', s_mix, fluid);
    const W_s2_ideal = m_dot_total * (h_2s_stage2 - h_mix);
    const W_s2 = W_s2_ideal / eta_s_hp;  // 高压级实际功

    const W_shaft_W = W_s1 + W_s2;  // 总轴功 = LP功 + HP功
    const W_input_W = W_shaft_W;

    // 系统入口总焓
    const h_system_in = m_dot_suc * h_suc + m_dot_inj * h_6;
    
    // =========================================================
    // 第 2 点计算：实际第二级排气点（未油冷前，计算中间状态）
    // =========================================================
    // 点2是计算中间状态，用于计算油冷负荷
    // 如果用户输入了设定排气温度，需要先计算点2的焓值（用于计算油冷负荷）
    // 否则使用基于等熵效率计算的值
    let h2_real, T2_real_C;
    if (T_2a_est_C !== null && !isNaN(T_2a_est_C)) {
        // 如果设定了排气温度，需要反推点2的状态来计算油冷负荷
        // 先假设点2等于点2a（无油冷情况），然后通过能量平衡计算实际点2
        // 简化处理：使用设定温度作为点2的参考，实际计算中会通过油冷调整
        const T2_est_K = T_2a_est_C + 273.15;
        h2_real = CP_INSTANCE.PropsSI('H', 'T', T2_est_K, 'P', Pc_Pa, fluid);
        T2_real_C = T_2a_est_C;
    } else {
        // 使用基于等熵效率计算的实际排气焓值
        h2_real = h_mix + (h_2s_stage2 - h_mix) / eta_s_hp;
        const T2_real_K = CP_INSTANCE.PropsSI('T', 'P', Pc_Pa, 'H', h2_real, fluid);
        T2_real_C = T2_real_K - 273.15;
    }
    
    // =========================================================
    // 第 2a 点计算：油冷后的排气点（设计目标）
    // =========================================================
    // 点2a是设计目标，如果设定了排气温度，点2a使用该设定值
    // 油冷负荷根据点2和点2a的差值计算
    let Q_oil_W = 0;
    let T_2a_final_C = 0;
    let h_2a_final = 0;
    
    if (T_2a_est_C !== null && !isNaN(T_2a_est_C)) {
        // 如果设定了排气温度，第 2a 点使用该设定温度（设计目标）
        // 油冷负荷 = 系统输入功 - (第 2a 点焓值 - 系统入口焓值)
        const T_2a_est_K = T_2a_est_C + 273.15;
        const h_2a_target = CP_INSTANCE.PropsSI('H', 'T', T_2a_est_K, 'P', Pc_Pa, fluid);
        const energy_out_gas = m_dot_total * h_2a_target;
        Q_oil_W = W_shaft_W - (energy_out_gas - h_system_in);
        T_2a_final_C = T_2a_est_C;
        if (Q_oil_W < 0) {
            // 如果计算出的油冷负荷为负，说明设定温度不合理，使用能量平衡计算
            Q_oil_W = 0;
            const h_2a_real = (h_system_in + W_shaft_W) / m_dot_total;
            const T_2a_real_K = CP_INSTANCE.PropsSI('T', 'P', Pc_Pa, 'H', h_2a_real, fluid);
            T_2a_final_C = T_2a_real_K - 273.15;
            h_2a_final = h_2a_real;
        } else {
            h_2a_final = (h_system_in + W_shaft_W - Q_oil_W) / m_dot_total;
        }
    } else {
        // 如果未设定排气温度，第 2a 点等于第 2 点（无油冷）
        h_2a_final = h2_real;
        T_2a_final_C = T2_real_C;
    }

    // 蒸发制冷量 & 冷凝放热
    const Q_evap_W = m_dot_suc * (h1_base - h_liq_out);
    const Q_cond_W = m_dot_total * (h_2a_final - h3);

    const COP_c = Q_evap_W / W_input_W;
    const COP_h = Q_cond_W / W_input_W;

    // =========================================================
    // 总油冷负荷计算
    // =========================================================
    const Q_oil_total_W = Q_oil_lp_W + Q_oil_W;

    // =========================================================
    // 过冷器选型参数计算
    // =========================================================
    // 热侧（主路）：点3（入口）→ 点5（出口）
    const T_3_C = T3_K - 273.15;
    // 重新计算点5的温度（因为T_5_K在循环内部定义）
    const T_5_K_recalc = T_intermediate_sat_K + ecoDt_K;
    const T_5_C = T_5_K_recalc - 273.15;
    const Q_subcooler_hot_W = m_dot_suc * (h3 - h_5);
    
    // 冷侧（补气路）：点7（入口）→ 点6（出口）
    const T_7_K = CP_INSTANCE.PropsSI('T', 'H', h_7, 'P', P_intermediate_Pa, fluid);
    const T_7_C = T_7_K - 273.15;
    // 重新计算点6的温度（因为T_inj_K在循环内部定义）
    const T_inj_K_recalc = T_intermediate_sat_K + ecoSuperheat_K;
    const T_6_C = T_inj_K_recalc - 273.15;
    const Q_subcooler_cold_W = m_dot_inj * (h_6 - h_7);
    
    const subcooler_selection = {
        hot_side: {
            inlet: {
                T_C: T_3_C,
                P_bar: Pc_Pa / 1e5,
                h_kJ: h3 / 1000,
                m_dot: m_dot_suc
            },
            outlet: {
                T_C: T_5_C,
                P_bar: Pc_Pa / 1e5,
                h_kJ: h_5 / 1000,
                m_dot: m_dot_suc
            },
            Q_kW: Q_subcooler_hot_W / 1000
        },
        cold_side: {
            inlet: {
                T_C: T_7_C,
                P_bar: P_intermediate_Pa / 1e5,
                h_kJ: h_7 / 1000,
                m_dot: m_dot_inj
            },
            outlet: {
                T_C: T_6_C,
                P_bar: P_intermediate_Pa / 1e5,
                h_kJ: h_6 / 1000,
                m_dot: m_dot_inj
            },
            Q_kW: Q_subcooler_cold_W / 1000
        }
    };

    // 节流
    const h4 = h_liq_out;
    const T4_K = CP_INSTANCE.PropsSI('T', 'P', Pe_Pa, 'H', h4, fluid);
    const T4_C = T4_K - 273.15;

    return {
        Pe_Pa,
        Pc_Pa,
        P_intermediate_Pa,
        T_intermediate_sat_K,
        m_dot: m_dot_suc,
        m_dot_total,
        m_dot_inj,
        h1: h1_base,
        h_suc,
        h2: h2_real,
        h2a: h_2a_final,
        h3,
        h4,
        h5: h_5,
        h6: h_6,
        h7: h_7,
        h_mid: h_mid_final,  // 使用油冷后的值
        h_mid_actual: h_mid_actual,  // 实际压缩值（油冷前）
        h_mix: h_mix,
        h_2s_stage2: h_2s_stage2,
        T1_K,
        T_mid_C: T_mid_final_C,  // mid点最终温度
        T_mid_actual_C: T_mid_actual_C,  // mid点实际温度（油冷前）
        T2_C: T2_real_C,
        T2a_C: T_2a_final_C,
        T3_K,
        T4_C,
        Q_evap_W,
        Q_cond_W,
        Q_oil_W,  // 高压级油冷负荷
        Q_oil_lp_W,  // 低压级油冷负荷
        Q_oil_total_W,  // 总油冷负荷
        subcooler_selection,  // 过冷器选型参数
        W_shaft_W,
        W_s1,  // 低压级轴功
        W_s2,  // 高压级轴功
        W_input_W,
        COP_c,
        COP_h,
        isSlhxEnabled,
        m_p5,
        m_p6,
        m_p7
    };
}

function calculateMode5() {
    renderToAllViews('<div class="flex justify-center p-10"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>');
    ['chart-desktop-m5', 'chart-mobile-m5'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    setTimeout(() => {
        try {
            // 读取输入
            const fluid = fluidSelect.value;
            const Te_C = parseFloat(tempEvapInput.value);
            const Tc_C = parseFloat(tempCondInput.value);
            const sh_K = parseFloat(superheatInput.value);
            const sc_K = parseFloat(subcoolInput.value);

            let flow = parseFloat(flowInput.value);
            if (compressorModel && compressorModel.value) {
                const brand = compressorBrand.value;
                const series = compressorSeries.value;
                const model = compressorModel.value;
                const displacement = getDisplacementByModel(brand, series, model);
                if (displacement !== null && (isNaN(flow) || flow <= 0)) {
                    flow = displacement;
                }
            }

            const eta_v_lp = parseFloat(etaVLpInput.value);
            const eta_s_lp = parseFloat(etaSLpInput.value);
            const eta_s_hp = parseFloat(etaSHpInput.value);

            // 中间压力设置
            const interPressModeValue = document.querySelector('input[name="inter_press_mode_m5"]:checked')?.value || 'auto';
            const interSatTempValue = interSatTempInput ? parseFloat(interSatTempInput.value) : null;

            // ECO参数：仅保留过冷器模式
            const ecoSuperheatValue = ecoSuperheatInput ? parseFloat(ecoSuperheatInput.value) : 5;
            const ecoDtValue = ecoDtInput ? parseFloat(ecoDtInput.value) : 5.0;

            // SLHX参数
            const isSlhxEnabled = slhxCheckbox && slhxCheckbox.checked;
            const slhxEffValue = slhxEff ? parseFloat(slhxEff.value) : 0.5;

            // 排气温度
            const T_2a_est_C = tempDischargeActualInput ? parseFloat(tempDischargeActualInput.value) : null;
            const T_mid_est_C = tempDischargeMidInput ? (tempDischargeMidInput.value === '' ? null : parseFloat(tempDischargeMidInput.value)) : null;  // 低压级设定排气温度

            // 验证输入
            if (isNaN(Te_C) || isNaN(Tc_C) || isNaN(sh_K) || isNaN(sc_K) || 
                isNaN(flow) || isNaN(eta_v_lp) || isNaN(eta_s_lp) || isNaN(eta_s_hp)) {
                throw new Error('请输入完整且有效的数值参数。');
            }

            if (flow <= 0 || eta_v_lp <= 0 || eta_s_lp <= 0 || eta_s_hp <= 0 || sh_K < 0 || sc_K < 0) {
                throw new Error('流量和效率必须大于0，过热度/过冷度不能为负。');
            }

            if (Tc_C <= Te_C) {
                throw new Error('冷凝温度必须高于蒸发温度。');
            }

            if (interPressModeValue === 'manual' && (isNaN(interSatTempValue) || interSatTempValue === null)) {
                throw new Error('手动模式下必须指定中间饱和温度。');
            }

            // 获取压缩机参数（用于优化中间压力计算）
            let vi_ratio = null, disp_lp = null, disp_hp = null;
            if (compressorBrand && compressorSeries && compressorModel) {
                const brand = compressorBrand.value;
                const series = compressorSeries.value;
                const model = compressorModel.value;
                if (brand && series && model) {
                    const detail = getModelDetail(brand, series, model);
                    if (detail) {
                        if (typeof detail.vi_ratio === 'number') {
                            vi_ratio = detail.vi_ratio;
                        }
                        if (typeof detail.disp_lp === 'number') {
                            disp_lp = detail.disp_lp;
                        }
                        if (typeof detail.disp_hp === 'number') {
                            disp_hp = detail.disp_hp;
                        }
                    }
                }
            }

            // 执行计算
            const result = computeTwoStageCycle({
                fluid,
                Te_C,
                Tc_C,
                superheat_K: sh_K,
                subcooling_K: sc_K,
                flow_m3h: flow,
                eta_v_lp,
                eta_s_lp,
                eta_s_hp,
                interPressMode: interPressModeValue,
                interSatTemp_C: interSatTempValue,
                vi_ratio,
                disp_lp,
                disp_hp,
                ecoSuperheat_K: ecoSuperheatValue,
                ecoDt_K: ecoDtValue,
                isSlhxEnabled,
                slhxEff: slhxEffValue,
                T_2a_est_C,
                T_mid_est_C
            });

            // 构造状态点表
            const statePoints = [];
            statePoints.push({
                name: '1',
                desc: 'Evap Out',
                temp: (result.T1_K - 273.15).toFixed(1),
                press: (result.Pe_Pa / 1e5).toFixed(2),
                enth: (result.h1 / 1000).toFixed(1),
                flow: result.m_dot.toFixed(4)
            });

            if (result.isSlhxEnabled) {
                let T_suc_K;
                try {
                    T_suc_K = CP_INSTANCE.PropsSI('T', 'H', result.h_suc, 'P', result.Pe_Pa, fluid);
                } catch (e) {
                    T_suc_K = result.T1_K;
                }
                statePoints.push({
                    name: "1'",
                    desc: 'Comp In (SLHX)',
                    temp: (T_suc_K - 273.15).toFixed(1),
                    press: (result.Pe_Pa / 1e5).toFixed(2),
                    enth: (result.h_suc / 1000).toFixed(1),
                    flow: result.m_dot.toFixed(4)
                });
            }

            statePoints.push({
                name: 'mid',
                desc: 'Stage1 Out (After Oil Cooler)',
                temp: result.T_mid_C.toFixed(1),  // 使用最终温度
                press: (result.P_intermediate_Pa / 1e5).toFixed(2),
                enth: (result.h_mid / 1000).toFixed(1),  // 使用最终焓值
                flow: result.m_dot.toFixed(4)
            });

            statePoints.push({
                name: 'mix',
                desc: 'After Mixing',
                temp: (CP_INSTANCE.PropsSI('T', 'P', result.P_intermediate_Pa, 'H', result.h_mix, fluid) - 273.15).toFixed(1),
                press: (result.P_intermediate_Pa / 1e5).toFixed(2),
                enth: (result.h_mix / 1000).toFixed(1),
                flow: result.m_dot_total.toFixed(4)
            });

            // 2: 压缩机实际排气（未油冷前，计算中间状态）
            statePoints.push({
                name: '2',
                desc: 'Discharge (Before Oil Cooler, Calc)',
                temp: result.T2_C.toFixed(1),
                press: (result.Pc_Pa / 1e5).toFixed(2),
                enth: (result.h2 / 1000).toFixed(1),
                flow: result.m_dot_total.toFixed(4)
            });

            // 2a: 油冷后排气（设计目标）
            statePoints.push({
                name: '2a',
                desc: 'After Oil Cooler (Design Target)',
                temp: result.T2a_C.toFixed(1),
                press: (result.Pc_Pa / 1e5).toFixed(2),
                enth: (result.h2a / 1000).toFixed(1),
                flow: result.m_dot_total.toFixed(4)
            });

            statePoints.push({
                name: '3',
                desc: 'Cond Out',
                temp: (result.T3_K - 273.15).toFixed(1),
                press: (result.Pc_Pa / 1e5).toFixed(2),
                enth: (result.h3 / 1000).toFixed(1),
                flow: result.m_dot_total.toFixed(4)
            });

            // 仅保留过冷器模式
            const T_7_K = CP_INSTANCE.PropsSI('T', 'P', result.P_intermediate_Pa, 'Q', 0, fluid);
            const T_6_K = CP_INSTANCE.PropsSI('T', 'P', result.P_intermediate_Pa, 'H', result.h6, fluid);
            const T_5_K = CP_INSTANCE.PropsSI('T', 'P', result.Pc_Pa, 'H', result.h5, fluid);
            statePoints.push({
                name: '7',
                desc: 'Inj Valve Out',
                temp: (T_7_K - 273.15).toFixed(1),
                press: (result.P_intermediate_Pa / 1e5).toFixed(2),
                enth: (result.h7 / 1000).toFixed(1),
                flow: result.m_dot_inj.toFixed(4)
            });
            statePoints.push({
                name: '6',
                desc: 'Injection Gas',
                temp: (T_6_K - 273.15).toFixed(1),
                press: (result.P_intermediate_Pa / 1e5).toFixed(2),
                enth: (result.h6 / 1000).toFixed(1),
                flow: result.m_dot_inj.toFixed(4)
            });
            statePoints.push({
                name: '5',
                desc: 'Subcooler Out',
                temp: (T_5_K - 273.15).toFixed(1),
                press: (result.Pc_Pa / 1e5).toFixed(2),
                enth: (result.h5 / 1000).toFixed(1),
                flow: result.m_dot.toFixed(4)
            });

            if (result.isSlhxEnabled) {
                // 5' 始终在 Pc（过冷器模式）
                let T_5p_K;
                try {
                    T_5p_K = CP_INSTANCE.PropsSI('T', 'H', result.h4, 'P', result.Pc_Pa, fluid);
                } catch (e) {
                    T_5p_K = result.T3_K;
                }
                statePoints.push({
                    name: "5'",
                    desc: 'Exp Valve In (SLHX)',
                    temp: (T_5p_K - 273.15).toFixed(1),
                    press: (result.Pc_Pa / 1e5).toFixed(2),
                    enth: (result.h4 / 1000).toFixed(1),
                    flow: result.m_dot.toFixed(4)
                });
            }

            statePoints.push({
                name: '4',
                desc: 'Exp Valve Out',
                temp: result.T4_C.toFixed(1),
                press: (result.Pe_Pa / 1e5).toFixed(2),
                enth: (result.h4 / 1000).toFixed(1),
                flow: result.m_dot.toFixed(4)
            });

            // 绘制 P-h 图
            const point = (name, h_j, p_pa, pos = 'top') => ({ 
                name, 
                value: [h_j / 1000, p_pa / 1e5], 
                label: { position: pos, show: true } 
            });

            const pt1 = point('1', result.h1, result.Pe_Pa, 'bottom');
            const pt1_p = point("1'", result.h_suc, result.Pe_Pa, 'bottom');
            const pt_mid = point('mid', result.h_mid, result.P_intermediate_Pa, 'right');
            const pt6 = point('6', result.h6, result.P_intermediate_Pa, 'left');
            const pt_mix = point('mix', result.h_mix, result.P_intermediate_Pa, 'left');
            const pt2 = point('2', result.h2, result.Pc_Pa, 'top');
            const pt3 = point('3', result.h3, result.Pc_Pa, 'top');
            const pt4 = point('4', result.h4, result.Pe_Pa, 'bottom');

            // 5' 始终位于节流前的高压侧（冷凝压力 Pc），与模式一/四保持一致
            let P_5p_chart = result.Pc_Pa;
            const pt5_p = result.isSlhxEnabled ? point("5'", result.h4, P_5p_chart, 'top') : null;

            let mainPoints = [], ecoLiquidPoints = [], ecoVaporPoints = [];

            // 仅过冷器模式：拓扑与 Mode 2/4 Subcooler 完全一致
            const pt7 = point('7', result.h7, result.P_intermediate_Pa, 'right');
            const pt5_subcooler = point('5', result.h5, result.Pc_Pa, 'top');
            const pt1_start = result.isSlhxEnabled ? pt1_p : pt1;

            // 主循环：4 -> 1 -> [1'] -> mid -> mix -> 2 -> 3
            mainPoints = [pt4, pt1];
            if (result.isSlhxEnabled) {
                mainPoints.push(pt1_start);
            }
            mainPoints.push(pt_mid, pt_mix, pt2, pt3);

            // 液路：3 -> 5 -> [5'] -> 4
            if (result.isSlhxEnabled) {
                const pt5_p_subcooler = point("5'", result.h4, result.Pc_Pa, 'top');
                ecoLiquidPoints = [pt3, pt5_subcooler, pt5_p_subcooler, pt4];
            } else {
                ecoLiquidPoints = [pt3, pt5_subcooler, pt4];
            }

            // 补气路：3 -> 7 -> 6 -> mix（连接到混合点，因为mid点和点6混合后形成mix点）
            const pt3_clone = point('', result.h3, result.Pc_Pa);
            ecoVaporPoints = [pt3_clone, pt7, pt6, pt_mix];

            ['chart-desktop-m5', 'chart-mobile-m5'].forEach(id => {
                drawPHDiagram(id, {
                    title: `Two-Stage Single Compressor (${fluid})`,
                    mainPoints: mainPoints,
                    ecoLiquidPoints: ecoLiquidPoints,
                    ecoVaporPoints: ecoVaporPoints,
                    xLabel: 'h (kJ/kg)',
                    yLabel: 'P (bar)'
                });
            });

            // 渲染结果面板
            const html = `
                <div class="grid grid-cols-2 gap-4 mb-6">
                    ${createKpiCard('制冷量', (result.Q_evap_W / 1000).toFixed(2), 'kW', 'Cooling Capacity', 'blue')}
                    ${createKpiCard('总轴功率', (result.W_shaft_W / 1000).toFixed(2), 'kW', 'Total Shaft Power', 'orange')}
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div class="bg-white/60 p-4 rounded-2xl border border-white/50">
                        ${createSectionHeader('Low Pressure Stage', '❄️')}
                        ${createDetailRow('轴功 (LP)', `${(result.W_s1 / 1000).toFixed(2)} kW`)}
                        ${createDetailRow('Q_evap', `${(result.Q_evap_W / 1000).toFixed(2)} kW`)}
                        ${createDetailRow('m_dot_suc', `${result.m_dot.toFixed(4)} kg/s`)}
                        ${createDetailRow('Q_oil (LP)', `${(result.Q_oil_lp_W / 1000).toFixed(2)} kW`)}
                        ${createDetailRow('T_mid', `${result.T_mid_C.toFixed(1)} °C`)}
                    </div>
                    <div class="bg-white/60 p-4 rounded-2xl border border-white/50">
                        ${createSectionHeader('High Pressure Stage', '🔥')}
                        ${createDetailRow('轴功 (HP)', `${(result.W_s2 / 1000).toFixed(2)} kW`)}
                        ${createDetailRow('Q_cond', `${(result.Q_cond_W / 1000).toFixed(2)} kW`)}
                        ${createDetailRow('m_dot_inj', `${result.m_dot_inj.toFixed(4)} kg/s`)}
                        ${createDetailRow('m_dot_total', `${result.m_dot_total.toFixed(4)} kg/s`)}
                        ${createDetailRow('Q_oil (HP)', `${(result.Q_oil_W / 1000).toFixed(2)} kW`)}
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div class="bg-white/60 p-4 rounded-2xl border border-white/50">
                        ${createSectionHeader('System Performance', '📈')}
                        ${createDetailRow('总轴功率', `${(result.W_shaft_W / 1000).toFixed(2)} kW`)}
                        ${createDetailRow('COP_c', result.COP_c.toFixed(3), true)}
                        ${createDetailRow('COP_h', result.COP_h.toFixed(3))}
                        ${createDetailRow('总油冷负荷', `${(result.Q_oil_total_W / 1000).toFixed(2)} kW`)}
                    </div>
                    <div class="bg-white/60 p-4 rounded-2xl border border-white/50">
                        ${createSectionHeader('Intermediate Pressure', '⚙️')}
                        ${createDetailRow('P_intermediate', `${(result.P_intermediate_Pa / 1e5).toFixed(2)} bar`)}
                        ${createDetailRow('T_intermediate', `${(result.T_intermediate_sat_K - 273.15).toFixed(1)} °C`)}
                    </div>
                </div>

                ${result.subcooler_selection ? `
                <div class="bg-white/60 p-4 rounded-2xl border border-white/50 mb-4">
                    ${createSectionHeader('Subcooler Selection Parameters', '🔧')}
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        <div>
                            <h5 class="text-xs font-bold text-gray-600 mb-2">热侧（主路）</h5>
                            <div class="space-y-1 text-xs">
                                <div class="bg-gray-50/50 p-2 rounded">
                                    <div class="font-semibold text-gray-700 mb-1">入口（点3）</div>
                                    <div class="text-gray-600">温度: ${result.subcooler_selection.hot_side.inlet.T_C.toFixed(1)} °C</div>
                                    <div class="text-gray-600">压力: ${result.subcooler_selection.hot_side.inlet.P_bar.toFixed(2)} bar</div>
                                    <div class="text-gray-600">焓值: ${result.subcooler_selection.hot_side.inlet.h_kJ.toFixed(1)} kJ/kg</div>
                                    <div class="text-gray-600">流量: ${result.subcooler_selection.hot_side.inlet.m_dot.toFixed(4)} kg/s</div>
                                </div>
                                <div class="bg-gray-50/50 p-2 rounded">
                                    <div class="font-semibold text-gray-700 mb-1">出口（点5）</div>
                                    <div class="text-gray-600">温度: ${result.subcooler_selection.hot_side.outlet.T_C.toFixed(1)} °C</div>
                                    <div class="text-gray-600">压力: ${result.subcooler_selection.hot_side.outlet.P_bar.toFixed(2)} bar</div>
                                    <div class="text-gray-600">焓值: ${result.subcooler_selection.hot_side.outlet.h_kJ.toFixed(1)} kJ/kg</div>
                                    <div class="text-gray-600">流量: ${result.subcooler_selection.hot_side.outlet.m_dot.toFixed(4)} kg/s</div>
                                </div>
                                <div class="bg-blue-50/50 p-2 rounded mt-2">
                                    <div class="font-semibold text-blue-700">换热量: ${result.subcooler_selection.hot_side.Q_kW.toFixed(2)} kW</div>
                                </div>
                            </div>
                        </div>
                        <div>
                            <h5 class="text-xs font-bold text-gray-600 mb-2">冷侧（补气路）</h5>
                            <div class="space-y-1 text-xs">
                                <div class="bg-gray-50/50 p-2 rounded">
                                    <div class="font-semibold text-gray-700 mb-1">入口（点7）</div>
                                    <div class="text-gray-600">温度: ${result.subcooler_selection.cold_side.inlet.T_C.toFixed(1)} °C</div>
                                    <div class="text-gray-600">压力: ${result.subcooler_selection.cold_side.inlet.P_bar.toFixed(2)} bar</div>
                                    <div class="text-gray-600">焓值: ${result.subcooler_selection.cold_side.inlet.h_kJ.toFixed(1)} kJ/kg</div>
                                    <div class="text-gray-600">流量: ${result.subcooler_selection.cold_side.inlet.m_dot.toFixed(4)} kg/s</div>
                                </div>
                                <div class="bg-gray-50/50 p-2 rounded">
                                    <div class="font-semibold text-gray-700 mb-1">出口（点6）</div>
                                    <div class="text-gray-600">温度: ${result.subcooler_selection.cold_side.outlet.T_C.toFixed(1)} °C</div>
                                    <div class="text-gray-600">压力: ${result.subcooler_selection.cold_side.outlet.P_bar.toFixed(2)} bar</div>
                                    <div class="text-gray-600">焓值: ${result.subcooler_selection.cold_side.outlet.h_kJ.toFixed(1)} kJ/kg</div>
                                    <div class="text-gray-600">流量: ${result.subcooler_selection.cold_side.outlet.m_dot.toFixed(4)} kg/s</div>
                                </div>
                                <div class="bg-blue-50/50 p-2 rounded mt-2">
                                    <div class="font-semibold text-blue-700">换热量: ${result.subcooler_selection.cold_side.Q_kW.toFixed(2)} kW</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                ` : ''}

                <div class="space-y-1 bg-white/40 p-4 rounded-2xl border border-white/50 shadow-inner">
                    ${createSectionHeader('State Points', '📊')}
                    ${createStateTable(statePoints)}
                </div>
            `;

            renderToAllViews(html);

            updateMobileSummary('Q_evap', `${(result.Q_evap_W / 1000).toFixed(2)} kW`, 'COP', result.COP_c.toFixed(2));

            openMobileSheet('m5');

            setButtonFresh5();
            if (printButtonM5) printButtonM5.disabled = false;

            lastCalculationData = {
                fluid,
                Te_C,
                Tc_C,
                result
            };

            const inputState = SessionState.collectInputs('calc-form-mode-5');
            HistoryDB.add(
                'M5',
                `${fluid} • ${(result.Q_evap_W / 1000).toFixed(2)} kW • COP ${result.COP_c.toFixed(2)}`,
                inputState,
                { 'Q_evap': `${(result.Q_evap_W / 1000).toFixed(2)} kW`, COP: result.COP_c.toFixed(2) }
            );
        } catch (error) {
            console.error(error);
            renderToAllViews(createErrorCard(error.message));
            if (printButtonM5) printButtonM5.disabled = true;
        }
    }, 50);
}

function printReportMode5() {
    if (!lastCalculationData) return;
    const d = lastCalculationData;
    const resultDiv = document.querySelector('.print-results');
    let tableText = '\n\nState Points:\n--------------------\nPoint\tT(C)\tP(bar)\th(kJ)\tm(kg/s)\n';
    tableText += `Q_evap\t${(d.result.Q_evap_W / 1000).toFixed(3)} kW\n`;
    tableText += `W_input\t${(d.result.W_input_W / 1000).toFixed(3)} kW\n`;
    tableText += `COP_c\t${d.result.COP_c.toFixed(3)}\n`;
    resultDiv.innerText = `Two-Stage Single Compressor Report:\n` + tableText;
    window.print();
}

// ---------------------------------------------------------------------
// Compressor Model Selection Handlers
// ---------------------------------------------------------------------

function initCompressorModelSelectorsM5() {
    // Mode 5 (单机双级模式): 只保留前川 LSC、MS、SS 系列，其余品牌全部删除
    const brands = getFilteredBrands('m5');
    compressorBrand.innerHTML = '<option value="">-- 选择品牌 --</option>';
    brands.forEach(brand => {
        const option = document.createElement('option');
        option.value = brand;
        option.textContent = brand;
        compressorBrand.appendChild(option);
    });

    compressorBrand.addEventListener('change', () => {
        const brand = compressorBrand.value;
        compressorSeries.innerHTML = '<option value="">-- 选择系列 --</option>';
        compressorModel.innerHTML = '<option value="">-- 选择型号 --</option>';
        compressorSeries.disabled = !brand;
        compressorModel.disabled = true;
        modelDisplacementInfo.classList.add('hidden');

        if (brand) {
            const series = getFilteredSeriesByBrand('m5', brand);
            series.forEach(s => {
                const option = document.createElement('option');
                option.value = s;
                option.textContent = s;
                compressorSeries.appendChild(option);
            });
            compressorSeries.disabled = false;
        }
    });

    compressorSeries.addEventListener('change', () => {
        const brand = compressorBrand.value;
        const series = compressorSeries.value;
        compressorModel.innerHTML = '<option value="">-- 选择型号 --</option>';
        compressorModel.disabled = !series;
        modelDisplacementInfo.classList.add('hidden');

        if (brand && series) {
            const models = getModelsBySeries(brand, series);
            models.forEach(m => {
                const option = document.createElement('option');
                option.value = m.model;
                option.textContent = m.model;
                compressorModel.appendChild(option);
            });
            compressorModel.disabled = false;
        }
    });

    compressorModel.addEventListener('change', () => {
        const brand = compressorBrand.value;
        const series = compressorSeries.value;
        const model = compressorModel.value;

        if (brand && series && model) {
            const detail = getModelDetail(brand, series, model);
            if (detail) {
                // 默认使用 displacement 作为输入排量
                const baseDisp = typeof detail.disp_lp === 'number'
                    ? detail.disp_lp
                    : detail.displacement;

                // 前川两级机型：展示更多规格信息
                if (typeof detail.disp_lp === 'number' && typeof detail.disp_hp === 'number') {
                    const viText = typeof detail.vi_ratio === 'number'
                        ? `, Vi≈${detail.vi_ratio.toFixed(2)}`
                        : '';
                    const rotorText = detail.rotor_code
                        ? `, 转子: ${detail.rotor_code}`
                        : '';
                    modelDisplacementInfo.innerHTML = `
                        <span class="font-bold">低压级排量:</span> ${detail.disp_lp.toFixed(0)} m³/h
                        <span class="ml-2 font-bold">高压级排量:</span> ${detail.disp_hp.toFixed(0)} m³/h
                        <span class="ml-2 text-xs text-purple-700">${viText}${rotorText}</span>
                    `;
                    modelDisplacementValue.textContent = detail.disp_lp.toFixed(0);
                } else {
                    // 其他品牌保持原有显示
                    modelDisplacementInfo.innerHTML = `
                        <span class="font-bold">理论排量:</span> <span id="model_displacement_value_m5">${baseDisp.toFixed(0)}</span> m³/h
                    `;
                    modelDisplacementValue.textContent = baseDisp.toFixed(0);
                }

                modelDisplacementInfo.classList.remove('hidden');
                
                if (flowInput) {
                    flowInput.value = baseDisp.toFixed(2);
                    setButtonStale5();
                }
                
                // 选择压缩机型号后，自动更新中间压力（如果模式为自动）
                updateIntermediatePressureM5();
            } else {
                modelDisplacementInfo.classList.add('hidden');
            }
        } else {
            modelDisplacementInfo.classList.add('hidden');
        }
    });
}

// ---------------------------------------------------------------------
// Intermediate Pressure Update
// ---------------------------------------------------------------------

function updateIntermediatePressureM5() {
    if (!CP_INSTANCE || !interSatTempInput) return;
    
    try {
        // 检查中间压力模式是否为自动
        const interPressModeValue = document.querySelector('input[name="inter_press_mode_m5"]:checked')?.value || 'auto';
        if (interPressModeValue !== 'auto') return; // 手动模式时不更新
        
        const fluid = fluidSelect.value;
        const Te_C = parseFloat(tempEvapInput.value);
        const Tc_C = parseFloat(tempCondInput.value);
        const superheat_K = parseFloat(superheatInput.value);
        const subcooling_K = parseFloat(subcoolInput.value);
        const flow_m3h = parseFloat(flowInput.value);
        const eta_v_lp = parseFloat(etaVLpInput.value);
        const eta_s_lp = parseFloat(etaSLpInput.value);
        const eta_s_hp = parseFloat(etaSHpInput.value);
        
        // ECO参数（用于估算补气流量）
        const ecoSuperheat_K = ecoSuperheatInput ? parseFloat(ecoSuperheatInput.value) : 5.0;
        const ecoDt_K = ecoDtInput ? parseFloat(ecoDtInput.value) : 5.0;
        
        if (isNaN(Te_C) || isNaN(Tc_C) || Tc_C <= Te_C) return;
        if (isNaN(superheat_K) || isNaN(subcooling_K) || isNaN(flow_m3h)) return;
        
        // 效率参数验证：如果为空或无效，使用默认值或返回
        if (isNaN(eta_v_lp) || eta_v_lp <= 0 || eta_v_lp > 1) return;
        if (isNaN(eta_s_lp) || eta_s_lp <= 0 || eta_s_lp > 1) return;
        if (isNaN(eta_s_hp) || eta_s_hp <= 0 || eta_s_hp > 1) return;
        
        // 高压级容积效率：如果没有单独输入，假设与低压级相同
        // 注意：单机双级压缩机通常两级容积效率相近
        const eta_v_hp = eta_v_lp; // 简化假设，实际可能需要单独输入
        
        const Pe_Pa = CP_INSTANCE.PropsSI('P', 'T', Te_C + 273.15, 'Q', 1, fluid);
        const Pc_Pa = CP_INSTANCE.PropsSI('P', 'T', Tc_C + 273.15, 'Q', 1, fluid);
        
        if (!Pe_Pa || !Pc_Pa || Pe_Pa <= 0 || Pc_Pa <= 0) return;
        
        // 获取压缩机参数（用于优化中间压力计算）
        let vi_ratio = null, disp_lp = null, disp_hp = null;
        if (compressorBrand && compressorSeries && compressorModel) {
            const brand = compressorBrand.value;
            const series = compressorSeries.value;
            const model = compressorModel.value;
            if (brand && series && model) {
                const detail = getModelDetail(brand, series, model);
                if (detail) {
                    if (typeof detail.vi_ratio === 'number') {
                        vi_ratio = detail.vi_ratio;
                    }
                    if (typeof detail.disp_lp === 'number') {
                        disp_lp = detail.disp_lp;
                    }
                    if (typeof detail.disp_hp === 'number') {
                        disp_hp = detail.disp_hp;
                    }
                }
            }
        }
        
        // 优先使用基于容积比和效率的优化算法
        let P_intermediate_Pa = null;
        if (vi_ratio !== null || (disp_lp !== null && disp_hp !== null)) {
            // 确保所有效率参数都有效
            if (eta_v_lp > 0 && eta_v_hp > 0 && eta_s_lp > 0 && eta_s_hp > 0) {
                P_intermediate_Pa = calculateOptimalIntermediatePressure({
                    fluid,
                    Te_C,
                    Tc_C,
                    superheat_K,
                    subcooling_K,
                    flow_m3h,
                    eta_v_lp,
                    eta_v_hp,
                    eta_s_lp,
                    eta_s_hp,
                    vi_ratio,
                    disp_lp,
                    disp_hp,
                    ecoSuperheat_K,
                    ecoDt_K
                });
            }
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
        console.warn("Update Intermediate Pressure M5 Error (Ignored):", error.message);
    }
}

// ---------------------------------------------------------------------
// Auto Efficiency Calculation
// ---------------------------------------------------------------------

function updateAndDisplayEfficienciesM5Lp() {
    if (!CP_INSTANCE || !autoEffLpCheckbox || !autoEffLpCheckbox.checked) return;
    
    try {
        const fluid = fluidSelect.value;
        const Te_C = parseFloat(tempEvapInput.value);
        const Tc_C = parseFloat(tempCondInput.value);
        
        if (isNaN(Te_C) || isNaN(Tc_C) || Tc_C <= Te_C) return;
        
        const Pe_Pa = CP_INSTANCE.PropsSI('P', 'T', Te_C + 273.15, 'Q', 1, fluid);
        const Pc_Pa = CP_INSTANCE.PropsSI('P', 'T', Tc_C + 273.15, 'Q', 1, fluid);
        
        if (!Pe_Pa || !Pc_Pa || Pe_Pa <= 0 || Pc_Pa <= 0) return;
        
        // 计算中间压力（用于LP压比）
        const P_intermediate_Pa = Math.sqrt(Pe_Pa * Pc_Pa);
        
        // LP压比：Pe -> P_intermediate
        const pressureRatioLp = P_intermediate_Pa / Pe_Pa;
        const efficienciesLp = calculateEmpiricalEfficiencies(pressureRatioLp);
        
        if (etaVLpInput) etaVLpInput.value = efficienciesLp.eta_v;
        if (etaSLpInput) etaSLpInput.value = efficienciesLp.eta_s;
        
        // 更新中间压力显示
        updateIntermediatePressureM5();
        
    } catch (error) {
        console.warn("Auto-Eff M5 LP Error (Ignored):", error.message);
    }
}

function updateAndDisplayEfficienciesM5Hp() {
    if (!CP_INSTANCE || !autoEffHpCheckbox || !autoEffHpCheckbox.checked) return;
    
    try {
        const fluid = fluidSelect.value;
        const Te_C = parseFloat(tempEvapInput.value);
        const Tc_C = parseFloat(tempCondInput.value);
        
        if (isNaN(Te_C) || isNaN(Tc_C) || Tc_C <= Te_C) return;
        
        const Pe_Pa = CP_INSTANCE.PropsSI('P', 'T', Te_C + 273.15, 'Q', 1, fluid);
        const Pc_Pa = CP_INSTANCE.PropsSI('P', 'T', Tc_C + 273.15, 'Q', 1, fluid);
        
        if (!Pe_Pa || !Pc_Pa || Pe_Pa <= 0 || Pc_Pa <= 0) return;
        
        // 计算中间压力（用于HP压比）
        const P_intermediate_Pa = Math.sqrt(Pe_Pa * Pc_Pa);
        
        // HP压比：P_intermediate -> Pc
        const pressureRatioHp = Pc_Pa / P_intermediate_Pa;
        const efficienciesHp = calculateEmpiricalEfficiencies(pressureRatioHp);
        
        if (etaSHpInput) etaSHpInput.value = efficienciesHp.eta_s;
        
        // 更新中间压力显示
        updateIntermediatePressureM5();
        
    } catch (error) {
        console.warn("Auto-Eff M5 HP Error (Ignored):", error.message);
    }
}

export function triggerMode5EfficiencyUpdate() {
    updateAndDisplayEfficienciesM5Lp();
    updateAndDisplayEfficienciesM5Hp();
    updateIntermediatePressureM5();
}

export function initMode5(CP) {
    CP_INSTANCE = CP;

    calcButtonM5 = document.getElementById('calc-button-mode-5');
    calcFormM5 = document.getElementById('calc-form-mode-5');
    printButtonM5 = document.getElementById('print-button-mode-5');
    resultsDesktopM5 = document.getElementById('results-desktop-m5');
    resultsMobileM5 = document.getElementById('mobile-results-m5');
    summaryMobileM5 = document.getElementById('mobile-summary-m5');

    // 输入元素
    fluidSelect = document.getElementById('fluid_m5');
    fluidInfoDiv = document.getElementById('fluid-info-m5');
    tempEvapInput = document.getElementById('temp_evap_m5');
    tempCondInput = document.getElementById('temp_cond_m5');
    superheatInput = document.getElementById('superheat_m5');
    subcoolInput = document.getElementById('subcooling_m5');
    flowInput = document.getElementById('flow_m3h_m5');
    etaVLpInput = document.getElementById('eta_v_m5_lp');
    etaSLpInput = document.getElementById('eta_s_m5_lp');
    autoEffLpCheckbox = document.getElementById('auto-eff-m5-lp');
    etaSHpInput = document.getElementById('eta_s_m5_hp');
    autoEffHpCheckbox = document.getElementById('auto-eff-m5-hp');
    compressorBrand = document.getElementById('compressor_brand_m5');
    compressorSeries = document.getElementById('compressor_series_m5');
    compressorModel = document.getElementById('compressor_model_m5');
    modelDisplacementInfo = document.getElementById('model_displacement_info_m5');
    modelDisplacementValue = document.getElementById('model_displacement_value_m5');
    ecoCheckbox = document.getElementById('enable_eco_m5');
    ecoSatTempInput = document.getElementById('temp_eco_sat_m5');
    ecoSuperheatInput = document.getElementById('eco_superheat_m5');
    ecoDtInput = document.getElementById('eco_dt_m5');
    slhxCheckbox = document.getElementById('enable_slhx_m5');
    slhxEff = document.getElementById('slhx_effectiveness_m5');
    tempDischargeActualInput = document.getElementById('temp_discharge_actual_m5');
    tempDischargeMidInput = document.getElementById('temp_discharge_mid_m5');  // 低压级设定排气温度输入
    interSatTempInput = document.getElementById('temp_inter_sat_m5');

    // Initialize compressor model selectors
    if (compressorBrand && compressorSeries && compressorModel) {
        initCompressorModelSelectorsM5();
    }

    if (calcFormM5) {
        calcFormM5.addEventListener('submit', (e) => {
            e.preventDefault();
            calculateMode5();
        });

        const inputs = calcFormM5.querySelectorAll('input, select');
        inputs.forEach((input) => {
            input.addEventListener('input', setButtonStale5);
            input.addEventListener('change', setButtonStale5);
        });

        if (fluidSelect && fluidInfoDiv) {
            fluidSelect.addEventListener('change', () => {
                updateFluidInfo(fluidSelect, fluidInfoDiv, CP_INSTANCE);
                updateAndDisplayEfficienciesM5Lp();
                updateAndDisplayEfficienciesM5Hp();
                updateIntermediatePressureM5(); // 流体变化时也更新中间压力
            });
        }

        // 自动效率更新监听器
        [tempEvapInput, tempCondInput, autoEffLpCheckbox, autoEffHpCheckbox].forEach(input => {
            if (input) {
                input.addEventListener('change', () => {
                    updateAndDisplayEfficienciesM5Lp();
                    updateAndDisplayEfficienciesM5Hp();
                    updateIntermediatePressureM5(); // 更新中间压力
                });
                input.addEventListener('input', () => {
                    if (autoEffLpCheckbox && autoEffLpCheckbox.checked) updateAndDisplayEfficienciesM5Lp();
                    if (autoEffHpCheckbox && autoEffHpCheckbox.checked) updateAndDisplayEfficienciesM5Hp();
                    updateIntermediatePressureM5(); // 温度变化时也更新中间压力
                });
            }
        });

        // 效率输入框监听器（手动设定效率时也更新中间压力）
        [etaVLpInput, etaSLpInput, etaSHpInput].forEach(input => {
            if (input) {
                // 使用防抖，避免频繁更新，但确保最终会更新
                let updateTimeout = null;
                const scheduleUpdate = () => {
                    if (updateTimeout) clearTimeout(updateTimeout);
                    updateTimeout = setTimeout(() => {
                        updateIntermediatePressureM5();
                    }, 150); // 150ms 防抖
                };
                
                input.addEventListener('input', scheduleUpdate);
                input.addEventListener('change', () => {
                    if (updateTimeout) clearTimeout(updateTimeout);
                    updateIntermediatePressureM5();
                });
                input.addEventListener('blur', () => {
                    if (updateTimeout) clearTimeout(updateTimeout);
                    updateIntermediatePressureM5();
                });
            }
        });

        if (autoEffLpCheckbox) {
            autoEffLpCheckbox.addEventListener('change', () => {
                if (autoEffLpCheckbox.checked) {
                    updateAndDisplayEfficienciesM5Lp();
                }
                updateIntermediatePressureM5(); // 切换自动/手动时也更新中间压力
            });
        }
        
        if (autoEffHpCheckbox) {
            autoEffHpCheckbox.addEventListener('change', () => {
                if (autoEffHpCheckbox.checked) {
                    updateAndDisplayEfficienciesM5Hp();
                }
                updateIntermediatePressureM5(); // 切换自动/手动时也更新中间压力
            });
        }

        // 中间压力模式切换监听器
        const interPressModeRadios = document.querySelectorAll('input[name="inter_press_mode_m5"]');
        interPressModeRadios.forEach(radio => {
            if (radio) {
                radio.addEventListener('change', () => {
                    updateIntermediatePressureM5(); // 切换模式时更新中间压力
                });
            }
        });

        if (printButtonM5) {
            printButtonM5.addEventListener('click', printReportMode5);
        }
        
        // 初始化时触发一次效率更新和中间压力更新
        setTimeout(() => {
            if (autoEffLpCheckbox && autoEffLpCheckbox.checked) {
                updateAndDisplayEfficienciesM5Lp();
            }
            if (autoEffHpCheckbox && autoEffHpCheckbox.checked) {
                updateAndDisplayEfficienciesM5Hp();
            }
            updateIntermediatePressureM5(); // 初始化时更新中间压力
        }, 100);
    }

    console.log('Mode 5 (Two-Stage Single Compressor) initialized.');
}


