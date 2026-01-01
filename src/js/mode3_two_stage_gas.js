// =====================================================================
// mode3_two_stage_gas.js: 双级气体压缩模块 - v1.0
// 职责: 双级气体压缩计算，支持低压级和高压级独立配置，包含后冷却器功能
// 参考: mode5 (去除ECO/SLHX), mode6 (压缩机配置), mode3 (后冷却器)
// =====================================================================

import { createKpiCard, createDetailRow, createSectionHeader, createErrorCard, createStateTable } from './components.js';
import { drawPHDiagram, drawTSDiagram, getChartInstance } from './charts.js';
import { HistoryDB, SessionState } from './storage.js';
import { openMobileSheet } from './ui.js';
import { updateFluidInfo } from './coolprop_loader.js';
import { calculateEmpiricalEfficiencies } from './efficiency_models.js';
import i18next from './i18n.js';
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
let calcButtonM3TS, calcFormM3TS, printButtonM3TS;
let resultsDesktopM3TS, resultsMobileM3TS, summaryMobileM3TS;

// 输入元素
let fluidSelect, fluidInfoDiv, pressInInput, tempInInput, pressOutInput;
let interPressMode, interPressInput;

// 低压级输入元素
let flowLpInput;
let etaVLpInput, etaSLpInput, autoEffLpCheckbox;
let compressorBrandLp, compressorSeriesLp, compressorModelLp, modelDisplacementInfoLp, modelDisplacementValueLp;
let tempDischargeActualLpInput;
let acCheckboxLp, acTempTargetLp, acDropLp;

// 高压级输入元素
let flowHpInput;
let etaVHpInput, etaSHpInput, autoEffHpCheckbox;
let compressorBrandHp, compressorSeriesHp, compressorModelHp, modelDisplacementInfoHp, modelDisplacementValueHp;
let tempDischargeActualHpInput;
let acCheckboxHp, acTempTargetHp, acDropHp;

const getBtnTextCalculate = () => i18next.t('common.calculate');
const getBtnTextRecalculate = () => i18next.t('common.recalculate');

// ---------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------

function setButtonStale3TS() {
    if (calcButtonM3TS && calcButtonM3TS.innerText !== getBtnTextRecalculate()) {
        calcButtonM3TS.innerText = getBtnTextRecalculate();
        calcButtonM3TS.classList.add('opacity-90', 'ring-2', 'ring-yellow-400', 'ring-offset-2');
        if (printButtonM3TS) {
            printButtonM3TS.disabled = true;
            printButtonM3TS.classList.add('opacity-50', 'cursor-not-allowed');
        }
    }
}

function setButtonFresh3TS() {
    if (calcButtonM3TS) {
        calcButtonM3TS.innerText = getBtnTextCalculate();
        calcButtonM3TS.classList.remove('opacity-90', 'ring-2', 'ring-yellow-400', 'ring-offset-2');
    }
}

function renderToAllViews(htmlContent) {
    if (resultsDesktopM3TS) resultsDesktopM3TS.innerHTML = htmlContent;
    if (resultsMobileM3TS) resultsMobileM3TS.innerHTML = htmlContent;
}

function updateMobileSummary(kpi1Label, kpi1Value, kpi2Label, kpi2Value) {
    if (!summaryMobileM3TS) return;
    summaryMobileM3TS.innerHTML = `
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
// Intermediate Pressure Calculation (简化版，无ECO)
// ---------------------------------------------------------------------

/**
 * 基于高低压级理论排量计算最优中间压力（气体压缩，无ECO）
 * @param {Object} params - 计算参数
 * @returns {number|null} 最优中间压力 (Pa)
 */
function calculateOptimalIntermediatePressureGas({
    fluid,
    Pe_Pa,
    Pc_Pa,
    Te_C,
    flow_lp_m3h,
    flow_hp_m3h,
    eta_v_lp,
    eta_v_hp,
    eta_s_lp
}) {
    if (!CP_INSTANCE) return null;
    
    try {
        // 状态点 1 (低压吸气) - 直接使用吸气温度
        const T1_K = Te_C + 273.15;
        const h1 = CP_INSTANCE.PropsSI('H', 'T', T1_K, 'P', Pe_Pa, fluid);
        const s1 = CP_INSTANCE.PropsSI('S', 'T', T1_K, 'P', Pe_Pa, fluid);
        const rho1 = CP_INSTANCE.PropsSI('D', 'T', T1_K, 'P', Pe_Pa, fluid);
        
        // 低压级质量流量
        const m_dot_lp = (flow_lp_m3h * eta_v_lp * rho1) / 3600.0; // kg/s
        
        // 初始值：几何平均法
        let P_intermediate_Pa = Math.sqrt(Pe_Pa * Pc_Pa);
        const P_min = Pe_Pa * 1.01;
        const P_max = Pc_Pa * 0.99;
        
        const maxIter = 100;
        const tolerance = 0.01;
        
        for (let iter = 0; iter < maxIter; iter++) {
            // 低压级出口 (等熵压缩)
            const h2s = CP_INSTANCE.PropsSI('H', 'P', P_intermediate_Pa, 'S', s1, fluid);
            const h2 = h1 + (h2s - h1) / eta_s_lp;
            
            // 高压级吸气（等于低压排气，无补气）
            const h_mix = h2;
            const m_dot_total = m_dot_lp;
            
            // 计算高压级吸气密度
            let T3_K, rho3;
            try {
                T3_K = CP_INSTANCE.PropsSI('T', 'H', h_mix, 'P', P_intermediate_Pa, fluid);
                rho3 = CP_INSTANCE.PropsSI('D', 'H', h_mix, 'P', P_intermediate_Pa, fluid);
            } catch (e) {
                return Math.sqrt(Pe_Pa * Pc_Pa);
            }
            
            if (rho3 <= 0 || !isFinite(rho3)) {
                return Math.sqrt(Pe_Pa * Pc_Pa);
            }
            
            // 高压级需要的排量
            const V_th_HP_required = (m_dot_total * 3600.0) / (eta_v_hp * rho3);
            const flow_error = (V_th_HP_required - flow_hp_m3h) / flow_hp_m3h;
            
            if (Math.abs(flow_error) < tolerance) {
                break;
            }
            
            // 调整中间压力
            const abs_error = Math.abs(flow_error);
            const sign = flow_error > 0 ? 1 : -1;
            let adjustment_factor;
            
            if (abs_error > 0.1) {
                adjustment_factor = 1.0 + sign * Math.min(abs_error * 0.2, 0.3);
            } else if (abs_error > 0.05) {
                adjustment_factor = 1.0 + sign * abs_error * 0.15;
            } else {
                adjustment_factor = 1.0 + sign * abs_error * 0.1;
            }
            
            let P_new = P_intermediate_Pa * adjustment_factor;
            P_new = Math.max(P_min, Math.min(P_max, P_new));
            
            const pressure_change = Math.abs(P_new - P_intermediate_Pa) / P_intermediate_Pa;
            if (pressure_change < 1e-6) {
                break;
            }
            
            P_intermediate_Pa = P_new;
        }
        
        if (P_intermediate_Pa <= Pe_Pa || P_intermediate_Pa >= Pc_Pa) {
            return Math.sqrt(Pe_Pa * Pc_Pa);
        }
        
        return P_intermediate_Pa;
        
    } catch (error) {
        console.warn("Calculate Optimal Intermediate Pressure Gas Error:", error.message);
        return null;
    }
}

// ---------------------------------------------------------------------
// Core Calculation Logic - Two-Stage Gas Compression
// ---------------------------------------------------------------------

/**
 * 双级气体压缩计算（无ECO，无SLHX，有后冷却器）
 */
function computeTwoStageGasCycle({
    fluid,
    Pe_bar,
    Te_C,
    Pc_bar,
    // 中间压力参数
    interPressMode = 'auto',
    interPress_bar = null,
    // 低压级参数
    flow_lp_m3h,
    eta_v_lp,
    eta_s_lp,
    T_discharge_lp_C = null,
    // 低压级后冷却器
    isAcLpEnabled = false,
    acTempTargetLp_C = null,
    acDropLp_bar = null,
    // 高压级参数
    flow_hp_m3h,
    eta_v_hp,
    eta_s_hp,
    T_discharge_hp_C = null,
    // 高压级后冷却器
    isAcHpEnabled = false,
    acTempTargetHp_C = null,
    acDropHp_bar = null
}) {
    const Pe_Pa = Pe_bar * 1e5;
    const Pc_Pa = Pc_bar * 1e5;
    
    // 点 1：低压级吸气 - 直接使用吸气温度
    const T1_K = Te_C + 273.15;
    const h1 = CP_INSTANCE.PropsSI('H', 'T', T1_K, 'P', Pe_Pa, fluid);
    const s1 = CP_INSTANCE.PropsSI('S', 'T', T1_K, 'P', Pe_Pa, fluid);
    const rho1 = CP_INSTANCE.PropsSI('D', 'T', T1_K, 'P', Pe_Pa, fluid);
    
    // 低压级质量流量
    const m_dot_lp = (flow_lp_m3h * eta_v_lp * rho1) / 3600.0; // kg/s
    
    // =========================================================
    // 确定中间压力
    // =========================================================
    let P_intermediate_Pa;
    if (interPressMode === 'auto') {
        const optimalPressure = calculateOptimalIntermediatePressureGas({
            fluid,
            Pe_Pa,
            Pc_Pa,
            Te_C,
            flow_lp_m3h,
            flow_hp_m3h,
            eta_v_lp,
            eta_v_hp,
            eta_s_lp
        });
        
        if (optimalPressure !== null && optimalPressure > Pe_Pa && optimalPressure < Pc_Pa) {
            P_intermediate_Pa = optimalPressure;
        } else {
            P_intermediate_Pa = Math.sqrt(Pe_Pa * Pc_Pa);
        }
    } else {
        // 手动模式：用户指定中间压力
        P_intermediate_Pa = interPress_bar * 1e5;
    }
    
    // =========================================================
    // 低压级压缩计算
    // =========================================================
    const h_mid_1s = CP_INSTANCE.PropsSI('H', 'P', P_intermediate_Pa, 'S', s1, fluid);
    const W_s1_ideal = m_dot_lp * (h_mid_1s - h1);
    const W_s1 = W_s1_ideal / eta_s_lp;
    
    // 低压级实际排气点
    const h_mid_actual = h1 + (h_mid_1s - h1) / eta_s_lp;
    const T_mid_actual_K = CP_INSTANCE.PropsSI('T', 'P', P_intermediate_Pa, 'H', h_mid_actual, fluid);
    const T_mid_actual_C = T_mid_actual_K - 273.15;
    
    // 低压级油冷计算
    let Q_oil_lp_W = 0;
    let T_mid_final_C = T_mid_actual_C;
    let h_mid_final = h_mid_actual;
    
    if (T_discharge_lp_C !== null && !isNaN(T_discharge_lp_C)) {
        if (T_mid_actual_C < T_discharge_lp_C) {
            h_mid_final = h_mid_actual;
            T_mid_final_C = T_mid_actual_C;
            Q_oil_lp_W = 0;
        } else {
            const T_mid_est_K = T_discharge_lp_C + 273.15;
            const h_mid_target = CP_INSTANCE.PropsSI('H', 'T', T_mid_est_K, 'P', P_intermediate_Pa, fluid);
            const energy_out_gas = m_dot_lp * h_mid_target;
            Q_oil_lp_W = W_s1 - (energy_out_gas - m_dot_lp * h1);
            
            if (Q_oil_lp_W < 0) {
                Q_oil_lp_W = 0;
                h_mid_final = h_mid_actual;
                T_mid_final_C = T_mid_actual_C;
            } else {
                h_mid_final = h_mid_target;
                T_mid_final_C = T_discharge_lp_C;
            }
        }
    }
    
    // 低压级后冷却器计算
    let h_mid_ac = h_mid_final;
    let T_mid_ac_C = T_mid_final_C;
    let P_mid_ac_Pa = P_intermediate_Pa;
    let Q_ac_lp_W = 0;
    
    if (isAcLpEnabled && acTempTargetLp_C !== null && acDropLp_bar !== null) {
        const T_ac_target_K = acTempTargetLp_C + 273.15;
        P_mid_ac_Pa = (P_intermediate_Pa / 1e5 - acDropLp_bar) * 1e5;
        
        // 计算后冷却器负荷
        const h_mid_ac_target = CP_INSTANCE.PropsSI('H', 'T', T_ac_target_K, 'P', P_mid_ac_Pa, fluid);
        Q_ac_lp_W = m_dot_lp * (h_mid_final - h_mid_ac_target);
        
        h_mid_ac = h_mid_ac_target;
        T_mid_ac_C = acTempTargetLp_C;
    }
    
    // =========================================================
    // 高压级压缩计算
    // =========================================================
    // 高压级吸气 = 低压级排气（经过后冷却器）
    const h_mix = h_mid_ac;
    const m_dot_total = m_dot_lp; // 无补气，总流量等于低压级流量
    // 使用后冷却器出口压力（如果启用）或中间压力
    const P_hp_inlet_Pa = isAcLpEnabled ? P_mid_ac_Pa : P_intermediate_Pa;
    const s_mix = CP_INSTANCE.PropsSI('S', 'H', h_mix, 'P', P_hp_inlet_Pa, fluid);
    
    // 高压级压缩（从P_hp_inlet_Pa压缩到Pc_Pa）
    const h_2s_stage2 = CP_INSTANCE.PropsSI('H', 'P', Pc_Pa, 'S', s_mix, fluid);
    const W_s2_ideal = m_dot_total * (h_2s_stage2 - h_mix);
    const W_s2 = W_s2_ideal / eta_s_hp;
    
    const W_shaft_W = W_s1 + W_s2;
    
    // 高压级实际排气点
    const h2_real = h_mix + (h_2s_stage2 - h_mix) / eta_s_hp;
    const T2_real_K = CP_INSTANCE.PropsSI('T', 'P', Pc_Pa, 'H', h2_real, fluid);
    const T2_real_C = T2_real_K - 273.15;
    
    // 高压级油冷计算
    let Q_oil_hp_W = 0;
    let T_2a_final_C = T2_real_C;
    let h_2a_final = h2_real;
    
    if (T_discharge_hp_C !== null && !isNaN(T_discharge_hp_C)) {
        const T_2a_est_K = T_discharge_hp_C + 273.15;
        const h_2a_target = CP_INSTANCE.PropsSI('H', 'T', T_2a_est_K, 'P', Pc_Pa, fluid);
        const energy_out_gas = m_dot_total * h_2a_target;
        const h_system_in = m_dot_total * h_mix;
        Q_oil_hp_W = W_s2 - (energy_out_gas - h_system_in);
        
        if (Q_oil_hp_W < 0) {
            Q_oil_hp_W = 0;
            h_2a_final = h2_real;
            T_2a_final_C = T2_real_C;
        } else {
            h_2a_final = h_2a_target;
            T_2a_final_C = T_discharge_hp_C;
        }
    }
    
    // 高压级后冷却器计算
    let h_2a_ac = h_2a_final;
    let T_2a_ac_C = T_2a_final_C;
    let P_2a_ac_Pa = Pc_Pa;
    let Q_ac_hp_W = 0;
    
    if (isAcHpEnabled && acTempTargetHp_C !== null && acDropHp_bar !== null) {
        const T_ac_target_K = acTempTargetHp_C + 273.15;
        P_2a_ac_Pa = (Pc_Pa / 1e5 - acDropHp_bar) * 1e5;
        
        const h_2a_ac_target = CP_INSTANCE.PropsSI('H', 'T', T_ac_target_K, 'P', P_2a_ac_Pa, fluid);
        Q_ac_hp_W = m_dot_total * (h_2a_final - h_2a_ac_target);
        
        h_2a_ac = h_2a_ac_target;
        T_2a_ac_C = acTempTargetHp_C;
    }
    
    const Q_oil_total_W = Q_oil_lp_W + Q_oil_hp_W;
    
    // 中间温度 = 低压级排气后的实际温度（经过油冷和后冷却器后）
    // 对于气体压缩，中间温度应该是实际排气温度，而不是饱和温度
    // 如果启用了后冷却器，使用后冷却器出口温度；否则使用油冷后温度
    const T_intermediate_K = (isAcLpEnabled ? T_mid_ac_C : T_mid_final_C) + 273.15;
    
    // =========================================================
    // 等温效率计算
    // =========================================================
    // 气体常数 R = R_universal / M
    const R_gas = CP_INSTANCE.PropsSI('GAS_CONSTANT', '', 0, '', 0, fluid) / CP_INSTANCE.PropsSI('MOLAR_MASS', '', 0, '', 0, fluid);
    
    // 低压级等温功和等温效率
    const W_iso_lp_W = m_dot_lp * R_gas * T1_K * Math.log(P_intermediate_Pa / Pe_Pa);
    const eta_iso_lp = W_iso_lp_W / W_s1;
    
    // 高压级等温功和等温效率
    // 使用高压级吸气温度（混合后温度）
    const T_mix_K = CP_INSTANCE.PropsSI('T', 'P', P_hp_inlet_Pa, 'H', h_mix, fluid);
    const W_iso_hp_W = m_dot_total * R_gas * T_mix_K * Math.log(Pc_Pa / P_hp_inlet_Pa);
    const eta_iso_hp = W_iso_hp_W / W_s2;
    
    // =========================================================
    // 后冷却器冷侧参数计算（用于换热器选型）
    // =========================================================
    // 假设冷却介质为水，入口温度30°C，出口温度40°C（典型值）
    const T_coolant_in_C = 30.0; // 冷却水入口温度
    const T_coolant_out_C = 40.0; // 冷却水出口温度
    const cp_water = 4.18; // 水的比热容 kJ/(kg·K)
    const deltaT_coolant = T_coolant_out_C - T_coolant_in_C; // K
    
    // 低压级后冷却器冷侧参数
    let m_dot_coolant_lp_kg_s = 0;
    if (isAcLpEnabled && Q_ac_lp_W > 0) {
        // Q = m_dot * cp * ΔT
        m_dot_coolant_lp_kg_s = (Q_ac_lp_W / 1000) / (cp_water * deltaT_coolant); // kg/s
    }
    
    // 高压级后冷却器冷侧参数
    let m_dot_coolant_hp_kg_s = 0;
    if (isAcHpEnabled && Q_ac_hp_W > 0) {
        m_dot_coolant_hp_kg_s = (Q_ac_hp_W / 1000) / (cp_water * deltaT_coolant); // kg/s
    }
    
    return {
        Pe_Pa,
        Pc_Pa,
        P_intermediate_Pa,
        T_intermediate_K,
        m_dot_lp,
        m_dot_total,
        h1,
        h_mid_actual,
        h_mid_final,
        h_mid_ac,
        h_mix,
        h2_real,
        h_2a_final,
        h_2a_ac,
        h_2s_stage2,
        T1_K,
        T_mid_actual_C,
        T_mid_final_C,
        T_mid_ac_C,
        T2_real_C,
        T_2a_final_C,
        T_2a_ac_C,
        Q_oil_lp_W,
        Q_oil_hp_W,
        Q_oil_total_W,
        Q_ac_lp_W,
        Q_ac_hp_W,
        W_shaft_W,
        W_s1,
        W_s2,
        W_iso_lp_W,
        W_iso_hp_W,
        eta_iso_lp,
        eta_iso_hp,
        P_mid_ac_Pa,
        P_2a_ac_Pa,
        P_hp_inlet_Pa: isAcLpEnabled ? P_mid_ac_Pa : P_intermediate_Pa,
        // 后冷却器冷侧参数
        T_coolant_in_C,
        T_coolant_out_C,
        m_dot_coolant_lp_kg_s,
        m_dot_coolant_hp_kg_s
    };
}

// ---------------------------------------------------------------------
// Main Calculation Function
// ---------------------------------------------------------------------

function calculateMode3TwoStage() {
    renderToAllViews('<div class="flex justify-center p-10"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>');
    ['chart-desktop-m3-two-stage', 'chart-mobile-m3-two-stage'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    setTimeout(() => {
        try {
            // 读取输入
            const fluid = fluidSelect.value;
            const Pe_bar = parseFloat(pressInInput.value);
            const Te_C = parseFloat(tempInInput.value);
            const Pc_bar = parseFloat(pressOutInput.value);

            // 中间压力设置
            const interPressModeValue = document.querySelector('input[name="inter_press_mode_m3_two_stage"]:checked')?.value || 'auto';
            const interPressValue = interPressInput ? parseFloat(interPressInput.value) : null;

            // 低压级参数
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
            const T_discharge_lp_C = tempDischargeActualLpInput ? parseFloat(tempDischargeActualLpInput.value) : null;
            
            // 低压级后冷却器
            const isAcLpEnabled = acCheckboxLp && acCheckboxLp.checked;
            const acTempTargetLp_C = isAcLpEnabled && acTempTargetLp ? parseFloat(acTempTargetLp.value) : null;
            const acDropLp_bar = isAcLpEnabled && acDropLp ? parseFloat(acDropLp.value) : null;

            // 高压级参数
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
            const T_discharge_hp_C = tempDischargeActualHpInput ? parseFloat(tempDischargeActualHpInput.value) : null;
            
            // 高压级后冷却器
            const isAcHpEnabled = acCheckboxHp && acCheckboxHp.checked;
            const acTempTargetHp_C = isAcHpEnabled && acTempTargetHp ? parseFloat(acTempTargetHp.value) : null;
            const acDropHp_bar = isAcHpEnabled && acDropHp ? parseFloat(acDropHp.value) : null;

            // 验证输入
            if (isNaN(Pe_bar) || isNaN(Pc_bar) || isNaN(Te_C) || 
                isNaN(flowLp) || isNaN(eta_v_lp) || isNaN(eta_s_lp) || 
                isNaN(flowHp) || isNaN(eta_v_hp) || isNaN(eta_s_hp)) {
                throw new Error('请输入完整且有效的数值参数。');
            }

            if (Pc_bar <= Pe_bar) {
                throw new Error('排气压力必须高于吸气压力。');
            }

            if (interPressModeValue === 'manual' && (isNaN(interPressValue) || interPressValue === null)) {
                throw new Error('手动模式下必须指定中间压力。');
            }

            // 执行计算
            const result = computeTwoStageGasCycle({
                fluid,
                Pe_bar,
                Te_C,
                Pc_bar,
                interPressMode: interPressModeValue,
                interPress_bar: interPressValue,
                flow_lp_m3h: flowLp,
                eta_v_lp,
                eta_s_lp,
                T_discharge_lp_C,
                isAcLpEnabled,
                acTempTargetLp_C,
                acDropLp_bar,
                flow_hp_m3h: flowHp,
                eta_v_hp,
                eta_s_hp,
                T_discharge_hp_C,
                isAcHpEnabled,
                acTempTargetHp_C,
                acDropHp_bar
            });

            // 构造状态点表
            const statePoints = [];
            statePoints.push({
                name: '1',
                desc: 'LP Inlet',
                temp: (result.T1_K - 273.15).toFixed(1),
                press: (result.Pe_Pa / 1e5).toFixed(2),
                enth: (result.h1 / 1000).toFixed(1),
                flow: result.m_dot_lp.toFixed(4)
            });

            statePoints.push({
                name: 'mid',
                desc: 'LP Discharge (After Oil Cooler)',
                temp: result.T_mid_final_C.toFixed(1),
                press: (result.P_intermediate_Pa / 1e5).toFixed(2),
                enth: (result.h_mid_final / 1000).toFixed(1),
                flow: result.m_dot_lp.toFixed(4)
            });

            // 确定高压级吸气压力
            const P_hp_inlet_Pa = isAcLpEnabled ? result.P_mid_ac_Pa : result.P_intermediate_Pa;
            
            if (isAcLpEnabled) {
                // 启用低压级后冷却器时，mid-AC就是mix点，合并显示
                statePoints.push({
                    name: 'mid-AC',
                    desc: 'LP Aftercooler Out / HP Inlet',
                    temp: result.T_mid_ac_C.toFixed(1),
                    press: (result.P_mid_ac_Pa / 1e5).toFixed(2),
                    enth: (result.h_mid_ac / 1000).toFixed(1),
                    flow: result.m_dot_lp.toFixed(4)
                });
            } else {
                // 未启用低压级后冷却器时，显示mix点
                const T_mix_K = CP_INSTANCE.PropsSI('T', 'P', result.P_intermediate_Pa, 'H', result.h_mix, fluid);
                const T_mix_C = T_mix_K - 273.15;
                statePoints.push({
                    name: 'mix',
                    desc: 'HP Inlet',
                    temp: parseFloat(T_mix_C.toFixed(1)),
                    press: (result.P_intermediate_Pa / 1e5).toFixed(2),
                    enth: (result.h_mix / 1000).toFixed(1),
                    flow: result.m_dot_total.toFixed(4)
                });
            }

            statePoints.push({
                name: '2',
                desc: 'HP Discharge (After Oil Cooler)',
                temp: result.T_2a_final_C.toFixed(1),
                press: (result.Pc_Pa / 1e5).toFixed(2),
                enth: (result.h_2a_final / 1000).toFixed(1),
                flow: result.m_dot_total.toFixed(4)
            });

            if (isAcHpEnabled) {
                statePoints.push({
                    name: '2-AC',
                    desc: 'HP Aftercooler Out',
                    temp: result.T_2a_ac_C.toFixed(1),
                    press: (result.P_2a_ac_Pa / 1e5).toFixed(2),
                    enth: (result.h_2a_ac / 1000).toFixed(1),
                    flow: result.m_dot_total.toFixed(4)
                });
            }

            // 绘制 P-h 图
            const point = (name, h_j, p_pa, pos = 'top') => ({ 
                name, 
                value: [h_j / 1000, p_pa / 1e5], 
                label: { position: pos, show: true } 
            });

            const pt1 = point('1', result.h1, result.Pe_Pa, 'bottom');
            const pt_mid = point('mid', result.h_mid_final, result.P_intermediate_Pa, 'right');
            const pt_mid_ac = isAcLpEnabled ? point('mid-AC', result.h_mid_ac, result.P_mid_ac_Pa, 'right') : null;
            const pt_mix = isAcLpEnabled ? null : point('mix', result.h_mix, P_hp_inlet_Pa, 'left');
            const pt2 = point('2', result.h_2a_final, result.Pc_Pa, 'top');
            const pt2_ac = isAcHpEnabled ? point('2-AC', result.h_2a_ac, result.P_2a_ac_Pa, 'top') : null;

            let mainPoints = [pt1, pt_mid];
            if (pt_mid_ac) mainPoints.push(pt_mid_ac);
            if (pt_mix) mainPoints.push(pt_mix);
            mainPoints.push(pt2);
            if (pt2_ac) mainPoints.push(pt2_ac);

            // 生成饱和线数据（对于气体，可能不需要，但保留接口）
            const satLinesPH = { liquidPH: [], vaporPH: [] };

            // 保存图表数据
            lastCalculationData = {
                fluid,
                Pe_bar,
                Pc_bar,
                Te_C,
                result,
                chartData: {
                    fluid,
                    mainPoints,
                    satLinesPH,
                    chartType: 'ph'
                }
            };

            // 绘制 P-h 图
            ['chart-desktop-m3-two-stage', 'chart-mobile-m3-two-stage'].forEach(id => {
                drawPHDiagram(id, {
                    title: `Two-Stage Gas Compression (${fluid})`,
                    mainPoints: mainPoints,
                    saturationLiquidPoints: satLinesPH.liquidPH,
                    saturationVaporPoints: satLinesPH.vaporPH,
                    xLabel: 'h (kJ/kg)',
                    yLabel: 'P (bar)'
                });
            });

            // 渲染结果面板
            const html = `
                <div class="grid grid-cols-2 gap-4 mb-6">
                    ${createKpiCard(i18next.t('components.totalShaftPower'), (result.W_shaft_W / 1000).toFixed(2), 'kW', i18next.t('components.totalShaftPower'), 'blue')}
                    ${createKpiCard('总油冷负荷', (result.Q_oil_total_W / 1000).toFixed(2), 'kW', 'Total Oil Cooling', 'orange')}
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div class="bg-white/60 p-4 rounded-2xl border border-white/50">
                        ${createSectionHeader('Low Pressure Stage', '❄️')}
                        ${createDetailRow('轴功 (LP)', `${(result.W_s1 / 1000).toFixed(2)} kW`)}
                        ${createDetailRow('等温功 (LP)', `${(result.W_iso_lp_W / 1000).toFixed(2)} kW`)}
                        ${createDetailRow('等温效率 (LP)', `${(result.eta_iso_lp * 100).toFixed(1)} %`)}
                        ${createDetailRow('m_dot_lp', `${result.m_dot_lp.toFixed(4)} kg/s`)}
                        ${createDetailRow('Q_oil (LP)', `${(result.Q_oil_lp_W / 1000).toFixed(2)} kW`)}
                        ${createDetailRow('T_mid', `${result.T_mid_final_C.toFixed(1)} °C`)}
                        ${isAcLpEnabled ? createDetailRow('Q_AC (LP)', `${(result.Q_ac_lp_W / 1000).toFixed(2)} kW`) : ''}
                    </div>
                    <div class="bg-white/60 p-4 rounded-2xl border border-white/50">
                        ${createSectionHeader('High Pressure Stage', '🔥')}
                        ${createDetailRow('轴功 (HP)', `${(result.W_s2 / 1000).toFixed(2)} kW`)}
                        ${createDetailRow('等温功 (HP)', `${(result.W_iso_hp_W / 1000).toFixed(2)} kW`)}
                        ${createDetailRow('等温效率 (HP)', `${(result.eta_iso_hp * 100).toFixed(1)} %`)}
                        ${createDetailRow('m_dot_total', `${result.m_dot_total.toFixed(4)} kg/s`)}
                        ${createDetailRow('Q_oil (HP)', `${(result.Q_oil_hp_W / 1000).toFixed(2)} kW`)}
                        ${createDetailRow('T_2a', `${result.T_2a_final_C.toFixed(1)} °C`)}
                        ${isAcHpEnabled ? createDetailRow('Q_AC (HP)', `${(result.Q_ac_hp_W / 1000).toFixed(2)} kW`) : ''}
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div class="bg-white/60 p-4 rounded-2xl border border-white/50">
                        ${createSectionHeader('System Performance', '📈')}
                        ${createDetailRow(i18next.t('components.totalShaftPower'), `${(result.W_shaft_W / 1000).toFixed(2)} kW`)}
                        ${createDetailRow('总油冷负荷', `${(result.Q_oil_total_W / 1000).toFixed(2)} kW`)}
                    </div>
                    <div class="bg-white/60 p-4 rounded-2xl border border-white/50">
                        ${createSectionHeader('Intermediate Pressure', '⚙️')}
                        ${createDetailRow('P_intermediate', `${(result.P_intermediate_Pa / 1e5).toFixed(2)} bar`)}
                        ${createDetailRow('T_intermediate', `${(result.T_intermediate_K - 273.15).toFixed(1)} °C`)}
                    </div>
                </div>

                <div class="space-y-1 bg-white/40 p-4 rounded-2xl border border-white/50 shadow-inner">
                    ${createSectionHeader('State Points', '📊')}
                    ${createStateTable(statePoints)}
                </div>
                
                ${isAcLpEnabled || isAcHpEnabled ? `
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 mt-4">
                    ${isAcLpEnabled ? `
                    <div class="bg-white/60 p-4 rounded-2xl border border-white/50">
                        ${createSectionHeader('LP Aftercooler (换热器选型参数)', '🌡️')}
                        <div class="mt-3 space-y-2">
                            <div class="text-xs font-semibold text-gray-600 mb-2">热侧（气体侧）：</div>
                            ${createDetailRow('入口温度', `${result.T_mid_final_C.toFixed(1)} °C`)}
                            ${createDetailRow('出口温度', `${result.T_mid_ac_C.toFixed(1)} °C`)}
                            ${createDetailRow('入口压力', `${(result.P_intermediate_Pa / 1e5).toFixed(2)} bar`)}
                            ${createDetailRow('出口压力', `${(result.P_mid_ac_Pa / 1e5).toFixed(2)} bar`)}
                            ${createDetailRow('质量流量', `${result.m_dot_lp.toFixed(4)} kg/s`)}
                            ${createDetailRow('热负荷', `${(result.Q_ac_lp_W / 1000).toFixed(2)} kW`)}
                        </div>
                        <div class="mt-4 space-y-2">
                            <div class="text-xs font-semibold text-gray-600 mb-2">冷侧（冷却介质侧）：</div>
                            <div class="text-xs text-amber-600 italic mb-2 px-2 py-1 bg-amber-50 rounded border border-amber-200">
                                ⚠️ 注：以下冷侧参数仅供参考，基于水冷假设（入口30°C，出口40°C）。实际选型时需根据现场条件、环境温度、水源情况等因素，选择风冷或水冷方式，并重新计算相应的冷却介质流量和温度参数。
                            </div>
                            ${createDetailRow('入口温度', `${result.T_coolant_in_C.toFixed(1)} °C`)}
                            ${createDetailRow('出口温度', `${result.T_coolant_out_C.toFixed(1)} °C`)}
                            ${createDetailRow('质量流量', `${result.m_dot_coolant_lp_kg_s.toFixed(4)} kg/s`)}
                            ${createDetailRow('体积流量', `${(result.m_dot_coolant_lp_kg_s * 3600).toFixed(2)} L/h`)}
                        </div>
                    </div>
                    ` : ''}
                    ${isAcHpEnabled ? `
                    <div class="bg-white/60 p-4 rounded-2xl border border-white/50">
                        ${createSectionHeader('HP Aftercooler (换热器选型参数)', '🌡️')}
                        <div class="mt-3 space-y-2">
                            <div class="text-xs font-semibold text-gray-600 mb-2">热侧（气体侧）：</div>
                            ${createDetailRow('入口温度', `${result.T_2a_final_C.toFixed(1)} °C`)}
                            ${createDetailRow('出口温度', `${result.T_2a_ac_C.toFixed(1)} °C`)}
                            ${createDetailRow('入口压力', `${(result.Pc_Pa / 1e5).toFixed(2)} bar`)}
                            ${createDetailRow('出口压力', `${(result.P_2a_ac_Pa / 1e5).toFixed(2)} bar`)}
                            ${createDetailRow('质量流量', `${result.m_dot_total.toFixed(4)} kg/s`)}
                            ${createDetailRow('热负荷', `${(result.Q_ac_hp_W / 1000).toFixed(2)} kW`)}
                        </div>
                        <div class="mt-4 space-y-2">
                            <div class="text-xs font-semibold text-gray-600 mb-2">冷侧（冷却介质侧）：</div>
                            <div class="text-xs text-amber-600 italic mb-2 px-2 py-1 bg-amber-50 rounded border border-amber-200">
                                ⚠️ 注：以下冷侧参数仅供参考，基于水冷假设（入口30°C，出口40°C）。实际选型时需根据现场条件、环境温度、水源情况等因素，选择风冷或水冷方式，并重新计算相应的冷却介质流量和温度参数。
                            </div>
                            ${createDetailRow('入口温度', `${result.T_coolant_in_C.toFixed(1)} °C`)}
                            ${createDetailRow('出口温度', `${result.T_coolant_out_C.toFixed(1)} °C`)}
                            ${createDetailRow('质量流量', `${result.m_dot_coolant_hp_kg_s.toFixed(4)} kg/s`)}
                            ${createDetailRow('体积流量', `${(result.m_dot_coolant_hp_kg_s * 3600).toFixed(2)} L/h`)}
                        </div>
                    </div>
                    ` : ''}
                </div>
                ` : ''}
            `;

            renderToAllViews(html);

            updateMobileSummary('Total Power', `${(result.W_shaft_W / 1000).toFixed(2)} kW`, 'Oil Cooling', `${(result.Q_oil_total_W / 1000).toFixed(2)} kW`);

            openMobileSheet('m3-two-stage');

            setButtonFresh3TS();
            if (printButtonM3TS) printButtonM3TS.disabled = false;

            const inputState = SessionState.collectInputs('calc-form-mode-3-two-stage');
            HistoryDB.add(
                'M3TS',
                `${fluid} • ${(result.W_shaft_W / 1000).toFixed(2)} kW`,
                inputState,
                { 'Power': `${(result.W_shaft_W / 1000).toFixed(2)} kW` }
            );
        } catch (error) {
            console.error(error);
            renderToAllViews(createErrorCard(error.message));
            if (printButtonM3TS) printButtonM3TS.disabled = true;
        }
    }, 50);
}

function printReportMode3TwoStage() {
    if (!lastCalculationData) return;
    const d = lastCalculationData;
    const resultDiv = document.querySelector('.print-results');
    let tableText = '\n\nState Points:\n--------------------\nPoint\tT(C)\tP(bar)\th(kJ)\tm(kg/s)\n';
    tableText += `Total Power\t${(d.result.W_shaft_W / 1000).toFixed(3)} kW\n`;
    tableText += `Oil Cooling\t${(d.result.Q_oil_total_W / 1000).toFixed(3)} kW\n`;
    resultDiv.innerText = `Two-Stage Gas Compression Report:\n` + tableText;
    window.print();
}

// ---------------------------------------------------------------------
// Compressor Model Selection Handlers
// ---------------------------------------------------------------------

function initCompressorModelSelectorsM3TS() {
    // 低压级压缩机选择器
    const brandsLp = getFilteredBrands('m3');
    compressorBrandLp.innerHTML = `<option value="">${i18next.t('common.selectBrand')}</option>`;
    brandsLp.forEach(brand => {
        const option = document.createElement('option');
        option.value = brand;
        option.textContent = brand;
        compressorBrandLp.appendChild(option);
    });

    compressorBrandLp.addEventListener('change', () => {
        const brand = compressorBrandLp.value;
        compressorSeriesLp.innerHTML = `<option value="">${i18next.t('common.selectSeries')}</option>`;
        compressorModelLp.innerHTML = `<option value="">${i18next.t('common.selectModel')}</option>`;
        compressorSeriesLp.disabled = !brand;
        compressorModelLp.disabled = true;
        modelDisplacementInfoLp.classList.add('hidden');

        if (brand) {
            const series = getFilteredSeriesByBrand('m3', brand);
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
        compressorModelLp.innerHTML = `<option value="">${i18next.t('common.selectModel')}</option>`;
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
                    setButtonStale3TS();
                    updateIntermediatePressureM3TS();
                }
            } else {
                modelDisplacementInfoLp.classList.add('hidden');
            }
        } else {
            modelDisplacementInfoLp.classList.add('hidden');
        }
    });

    // 高压级压缩机选择器（类似逻辑）
    const brandsHp = getFilteredBrands('m3');
    compressorBrandHp.innerHTML = `<option value="">${i18next.t('common.selectBrand')}</option>`;
    brandsHp.forEach(brand => {
        const option = document.createElement('option');
        option.value = brand;
        option.textContent = brand;
        compressorBrandHp.appendChild(option);
    });

    compressorBrandHp.addEventListener('change', () => {
        const brand = compressorBrandHp.value;
        compressorSeriesHp.innerHTML = `<option value="">${i18next.t('common.selectSeries')}</option>`;
        compressorModelHp.innerHTML = `<option value="">${i18next.t('common.selectModel')}</option>`;
        compressorSeriesHp.disabled = !brand;
        compressorModelHp.disabled = true;
        modelDisplacementInfoHp.classList.add('hidden');

        if (brand) {
            const series = getFilteredSeriesByBrand('m3', brand);
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
        compressorModelHp.innerHTML = `<option value="">${i18next.t('common.selectModel')}</option>`;
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
                    setButtonStale3TS();
                    updateIntermediatePressureM3TS();
                }
            } else {
                modelDisplacementInfoHp.classList.add('hidden');
            }
        } else {
            modelDisplacementInfoHp.classList.add('hidden');
        }
    });
}

// ---------------------------------------------------------------------
// Auto Efficiency Calculation
// ---------------------------------------------------------------------

function updateAndDisplayEfficienciesM3TSLp() {
    if (!CP_INSTANCE || !autoEffLpCheckbox || !autoEffLpCheckbox.checked) return;
    
    try {
        const Pe_bar = parseFloat(pressInInput.value);
        const Pc_bar = parseFloat(pressOutInput.value);
        
        if (isNaN(Pe_bar) || isNaN(Pc_bar) || Pc_bar <= Pe_bar) return;
        
        // 计算中间压力（用于LP压比）
        const Pe_Pa = Pe_bar * 1e5;
        const Pc_Pa = Pc_bar * 1e5;
        const P_intermediate_Pa = Math.sqrt(Pe_Pa * Pc_Pa);
        
        // LP压比：Pe -> P_intermediate
        const pressureRatioLp = P_intermediate_Pa / Pe_Pa;
        const efficienciesLp = calculateEmpiricalEfficiencies(pressureRatioLp);
        
        if (etaVLpInput) etaVLpInput.value = efficienciesLp.eta_v;
        if (etaSLpInput) etaSLpInput.value = efficienciesLp.eta_s;
        
    } catch (error) {
        console.warn("Auto-Eff M3TS LP Error (Ignored):", error.message);
    }
}

function updateAndDisplayEfficienciesM3TSHp() {
    if (!CP_INSTANCE || !autoEffHpCheckbox || !autoEffHpCheckbox.checked) return;
    
    try {
        const Pe_bar = parseFloat(pressInInput.value);
        const Pc_bar = parseFloat(pressOutInput.value);
        
        if (isNaN(Pe_bar) || isNaN(Pc_bar) || Pc_bar <= Pe_bar) return;
        
        // 计算中间压力（用于HP压比）
        const Pe_Pa = Pe_bar * 1e5;
        const Pc_Pa = Pc_bar * 1e5;
        const P_intermediate_Pa = Math.sqrt(Pe_Pa * Pc_Pa);
        
        // HP压比：P_intermediate -> Pc
        const pressureRatioHp = Pc_Pa / P_intermediate_Pa;
        const efficienciesHp = calculateEmpiricalEfficiencies(pressureRatioHp);
        
        if (etaVHpInput) etaVHpInput.value = efficienciesHp.eta_v;
        if (etaSHpInput) etaSHpInput.value = efficienciesHp.eta_s;
        
    } catch (error) {
        console.warn("Auto-Eff M3TS HP Error (Ignored):", error.message);
    }
}

export function triggerMode3TwoStageEfficiencyUpdate() {
    updateAndDisplayEfficienciesM3TSLp();
    updateAndDisplayEfficienciesM3TSHp();
}

// ---------------------------------------------------------------------
// Intermediate Pressure Update
// ---------------------------------------------------------------------

function updateIntermediatePressureM3TS() {
    if (!CP_INSTANCE || !interPressInput) return;
    
    try {
        const interPressModeValue = document.querySelector('input[name="inter_press_mode_m3_two_stage"]:checked')?.value || 'auto';
        if (interPressModeValue !== 'auto') return;
        
        const fluid = fluidSelect.value;
        const Pe_bar = parseFloat(pressInInput.value);
        const Pc_bar = parseFloat(pressOutInput.value);
        const Te_C = parseFloat(tempInInput.value);
        const flow_lp_m3h = parseFloat(flowLpInput.value);
        const flow_hp_m3h = parseFloat(flowHpInput.value);
        const eta_v_lp = parseFloat(etaVLpInput.value);
        const eta_v_hp = parseFloat(etaVHpInput.value);
        const eta_s_lp = parseFloat(etaSLpInput.value);
        
        if (isNaN(Pe_bar) || isNaN(Pc_bar) || Pc_bar <= Pe_bar) return;
        if (isNaN(flow_lp_m3h) || isNaN(flow_hp_m3h)) return;
        if (isNaN(eta_v_lp) || eta_v_lp <= 0 || eta_v_lp > 1) return;
        if (isNaN(eta_v_hp) || eta_v_hp <= 0 || eta_v_hp > 1) return;
        if (isNaN(eta_s_lp) || eta_s_lp <= 0 || eta_s_lp > 1) return;
        
        const Pe_Pa = Pe_bar * 1e5;
        const Pc_Pa = Pc_bar * 1e5;
        
        let P_intermediate_Pa = calculateOptimalIntermediatePressureGas({
            fluid,
            Pe_Pa,
            Pc_Pa,
            Te_C,
            flow_lp_m3h,
            flow_hp_m3h,
            eta_v_lp,
            eta_v_hp,
            eta_s_lp
        });
        
        if (P_intermediate_Pa === null || P_intermediate_Pa <= Pe_Pa || P_intermediate_Pa >= Pc_Pa) {
            P_intermediate_Pa = Math.sqrt(Pe_Pa * Pc_Pa);
        }
        
        const P_intermediate_bar = P_intermediate_Pa / 1e5;
        
        if (interPressInput) {
            interPressInput.value = P_intermediate_bar.toFixed(2);
            interPressInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        
    } catch (error) {
        console.warn("Update Intermediate Pressure M3TS Error (Ignored):", error.message);
    }
}

// ---------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------

export function initMode3TwoStage(CP) {
    CP_INSTANCE = CP;

    calcButtonM3TS = document.getElementById('calc-button-mode-3-two-stage');
    calcFormM3TS = document.getElementById('calc-form-mode-3-two-stage');
    printButtonM3TS = document.getElementById('print-button-mode-3-two-stage');
    resultsDesktopM3TS = document.getElementById('results-desktop-m3-two-stage');
    resultsMobileM3TS = document.getElementById('mobile-results-m3-two-stage');
    summaryMobileM3TS = document.getElementById('mobile-summary-m3-two-stage');

    // 输入元素
    fluidSelect = document.getElementById('fluid_m3_two_stage');
    fluidInfoDiv = document.getElementById('fluid-info-m3-two-stage');
    pressInInput = document.getElementById('press_in_m3_two_stage');
    tempInInput = document.getElementById('temp_in_m3_two_stage');
    pressOutInput = document.getElementById('press_out_m3_two_stage');
    interPressInput = document.getElementById('press_inter_m3_two_stage');

    // 低压级输入元素
    flowLpInput = document.getElementById('flow_m3h_m3_two_stage_lp');
    etaVLpInput = document.getElementById('eta_v_m3_two_stage_lp');
    etaSLpInput = document.getElementById('eta_s_m3_two_stage_lp');
    autoEffLpCheckbox = document.getElementById('auto-eff-m3-two-stage-lp');
    compressorBrandLp = document.getElementById('compressor_brand_m3_two_stage_lp');
    compressorSeriesLp = document.getElementById('compressor_series_m3_two_stage_lp');
    compressorModelLp = document.getElementById('compressor_model_m3_two_stage_lp');
    modelDisplacementInfoLp = document.getElementById('model_displacement_info_m3_two_stage_lp');
    modelDisplacementValueLp = document.getElementById('model_displacement_value_m3_two_stage_lp');
    tempDischargeActualLpInput = document.getElementById('temp_discharge_actual_m3_two_stage_lp');
    acCheckboxLp = document.getElementById('enable_aftercooler_m3_two_stage_lp');
    acTempTargetLp = document.getElementById('temp_aftercooler_target_m3_two_stage_lp');
    acDropLp = document.getElementById('press_drop_aftercooler_m3_two_stage_lp');

    // 高压级输入元素
    flowHpInput = document.getElementById('flow_m3h_m3_two_stage_hp');
    etaVHpInput = document.getElementById('eta_v_m3_two_stage_hp');
    etaSHpInput = document.getElementById('eta_s_m3_two_stage_hp');
    autoEffHpCheckbox = document.getElementById('auto-eff-m3-two-stage-hp');
    compressorBrandHp = document.getElementById('compressor_brand_m3_two_stage_hp');
    compressorSeriesHp = document.getElementById('compressor_series_m3_two_stage_hp');
    compressorModelHp = document.getElementById('compressor_model_m3_two_stage_hp');
    modelDisplacementInfoHp = document.getElementById('model_displacement_info_m3_two_stage_hp');
    modelDisplacementValueHp = document.getElementById('model_displacement_value_m3_two_stage_hp');
    tempDischargeActualHpInput = document.getElementById('temp_discharge_actual_m3_two_stage_hp');
    acCheckboxHp = document.getElementById('enable_aftercooler_m3_two_stage_hp');
    acTempTargetHp = document.getElementById('temp_aftercooler_target_m3_two_stage_hp');
    acDropHp = document.getElementById('press_drop_aftercooler_m3_two_stage_hp');

    // Initialize compressor model selectors
    if (compressorBrandLp && compressorSeriesLp && compressorModelLp &&
        compressorBrandHp && compressorSeriesHp && compressorModelHp) {
        initCompressorModelSelectorsM3TS();
    }

    if (calcFormM3TS) {
        calcFormM3TS.addEventListener('submit', (e) => {
            e.preventDefault();
            calculateMode3TwoStage();
        });

        const inputs = calcFormM3TS.querySelectorAll('input, select');
        inputs.forEach((input) => {
            input.addEventListener('input', setButtonStale3TS);
            input.addEventListener('change', setButtonStale3TS);
        });

        if (fluidSelect && fluidInfoDiv) {
            fluidSelect.addEventListener('change', () => {
                updateFluidInfo(fluidSelect, fluidInfoDiv, CP_INSTANCE);
                updateAndDisplayEfficienciesM3TSLp();
                updateAndDisplayEfficienciesM3TSHp();
                updateIntermediatePressureM3TS();
            });
        }

        // 自动效率更新监听器
        [pressInInput, pressOutInput, tempInInput, autoEffLpCheckbox, autoEffHpCheckbox].forEach(input => {
            if (input) {
                input.addEventListener('change', () => {
                    updateAndDisplayEfficienciesM3TSLp();
                    updateAndDisplayEfficienciesM3TSHp();
                    updateIntermediatePressureM3TS();
                });
                input.addEventListener('input', () => {
                    if (autoEffLpCheckbox && autoEffLpCheckbox.checked) updateAndDisplayEfficienciesM3TSLp();
                    if (autoEffHpCheckbox && autoEffHpCheckbox.checked) updateAndDisplayEfficienciesM3TSHp();
                    updateIntermediatePressureM3TS();
                });
            }
        });

        // 效率输入框监听器
        [etaVLpInput, etaSLpInput, etaVHpInput, etaSHpInput].forEach(input => {
            if (input) {
                let updateTimeout = null;
                const scheduleUpdate = () => {
                    if (updateTimeout) clearTimeout(updateTimeout);
                    updateTimeout = setTimeout(() => {
                        updateIntermediatePressureM3TS();
                    }, 150);
                };
                
                input.addEventListener('input', scheduleUpdate);
                input.addEventListener('change', () => {
                    if (updateTimeout) clearTimeout(updateTimeout);
                    updateIntermediatePressureM3TS();
                });
            }
        });

        // 排量输入框监听器 - 当排量变化时更新中间压力
        [flowLpInput, flowHpInput].forEach(input => {
            if (input) {
                let updateTimeout = null;
                const scheduleUpdate = () => {
                    if (updateTimeout) clearTimeout(updateTimeout);
                    updateTimeout = setTimeout(() => {
                        updateIntermediatePressureM3TS();
                    }, 150); // 150ms 防抖
                };
                
                input.addEventListener('input', scheduleUpdate);
                input.addEventListener('change', () => {
                    if (updateTimeout) clearTimeout(updateTimeout);
                    updateIntermediatePressureM3TS();
                });
            }
        });

        if (autoEffLpCheckbox) {
            autoEffLpCheckbox.addEventListener('change', () => {
                if (autoEffLpCheckbox.checked) {
                    updateAndDisplayEfficienciesM3TSLp();
                }
                updateIntermediatePressureM3TS();
            });
        }
        
        if (autoEffHpCheckbox) {
            autoEffHpCheckbox.addEventListener('change', () => {
                if (autoEffHpCheckbox.checked) {
                    updateAndDisplayEfficienciesM3TSHp();
                }
                updateIntermediatePressureM3TS();
            });
        }

        // 中间压力模式切换监听器
        const interPressModeRadios = document.querySelectorAll('input[name="inter_press_mode_m3_two_stage"]');
        interPressModeRadios.forEach(radio => {
            if (radio) {
                radio.addEventListener('change', () => {
                    updateIntermediatePressureM3TS();
                });
            }
        });

        // 后冷却器切换监听器
        if (acCheckboxLp) {
            acCheckboxLp.addEventListener('change', () => {
                const settings = document.getElementById('ac-settings-m3-two-stage-lp');
                const placeholder = document.getElementById('ac-placeholder-m3-two-stage-lp');
                if (settings) settings.classList.toggle('hidden', !acCheckboxLp.checked);
                if (placeholder) placeholder.classList.toggle('hidden', acCheckboxLp.checked);
                setButtonStale3TS();
            });
        }

        if (acCheckboxHp) {
            acCheckboxHp.addEventListener('change', () => {
                const settings = document.getElementById('ac-settings-m3-two-stage-hp');
                const placeholder = document.getElementById('ac-placeholder-m3-two-stage-hp');
                if (settings) settings.classList.toggle('hidden', !acCheckboxHp.checked);
                if (placeholder) placeholder.classList.toggle('hidden', acCheckboxHp.checked);
                setButtonStale3TS();
            });
        }

        if (printButtonM3TS) {
            printButtonM3TS.addEventListener('click', printReportMode3TwoStage);
        }
        
        // 初始化时触发一次效率更新和中间压力更新
        setTimeout(() => {
            if (autoEffLpCheckbox && autoEffLpCheckbox.checked) {
                updateAndDisplayEfficienciesM3TSLp();
            }
            if (autoEffHpCheckbox && autoEffHpCheckbox.checked) {
                updateAndDisplayEfficienciesM3TSHp();
            }
            updateIntermediatePressureM3TS();
        }, 100);
    }

    console.log('Mode 3 Two-Stage Gas Compression initialized.');
}

