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
    // ECO参数（双级压缩仅保留过冷器 Subcooler 模式）
    ecoSuperheat_K = 5,
    ecoDt_K = 5.0,
    // SLHX参数
    isSlhxEnabled = false,
    slhxEff = 0.5,
    // 排气温度参数
    T_2a_est_C = null
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
        // 自动模式：几何平均法
        P_intermediate_Pa = Math.sqrt(Pe_Pa * Pc_Pa);
        T_intermediate_sat_K = CP_INSTANCE.PropsSI('T', 'P', P_intermediate_Pa, 'Q', 0, fluid);
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
    const T_inj_K = T_intermediate_sat_K + ecoSuperheat_K;
    h_6 = CP_INSTANCE.PropsSI('H', 'T', T_inj_K, 'P', P_intermediate_Pa, fluid);
    const T_5_K = T_intermediate_sat_K + ecoDt_K;
    h_5 = CP_INSTANCE.PropsSI('H', 'T', T_5_K, 'P', Pc_Pa, fluid);
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

    // 补气混合
    const h_mix = (m_dot_suc * h_mid_1s + m_dot_inj * h_6) / m_dot_total;
    const s_mix = CP_INSTANCE.PropsSI('S', 'H', h_mix, 'P', P_intermediate_Pa, fluid);

    // 第二级压缩：P_intermediate → P_d（使用高压级等熵效率）
    const h_2s_stage2 = CP_INSTANCE.PropsSI('H', 'P', Pc_Pa, 'S', s_mix, fluid);
    const W_s2_ideal = m_dot_total * (h_2s_stage2 - h_mix);
    const W_s2 = W_s2_ideal / eta_s_hp;  // 高压级实际功

    const W_shaft_W = W_s1 + W_s2;  // 总轴功 = LP功 + HP功
    const W_input_W = W_shaft_W;

    // 实际第二级排气焓值（未油冷前），用于 P-h 图与状态点 2（使用高压级等熵效率）
    const h2_real = h_mix + (h_2s_stage2 - h_mix) / eta_s_hp;
    const T2_real_K = CP_INSTANCE.PropsSI('T', 'P', Pc_Pa, 'H', h2_real, fluid);
    const T2_real_C = T2_real_K - 273.15;

    // 系统入口总焓
    const h_system_in = m_dot_suc * h_suc + m_dot_inj * h_6;
    
    // 油冷负荷计算
    let Q_oil_W = 0;
    let T_2a_final_C = 0;
    let h_2a_final = 0;
    
    if (T_2a_est_C !== null && !isNaN(T_2a_est_C)) {
        const T_2a_est_K = T_2a_est_C + 273.15;
        const h_2a_target = CP_INSTANCE.PropsSI('H', 'T', T_2a_est_K, 'P', Pc_Pa, fluid);
        const energy_out_gas = m_dot_total * h_2a_target;
        Q_oil_W = W_shaft_W - (energy_out_gas - h_system_in);
        T_2a_final_C = T_2a_est_C;
        if (Q_oil_W < 0) {
            Q_oil_W = 0;
            const h_2a_real = (h_system_in + W_shaft_W) / m_dot_total;
            const T_2a_real_K = CP_INSTANCE.PropsSI('T', 'P', Pc_Pa, 'H', h_2a_real, fluid);
            T_2a_final_C = T_2a_real_K - 273.15;
            h_2a_final = h_2a_real;
        } else {
            h_2a_final = (h_system_in + W_shaft_W - Q_oil_W) / m_dot_total;
        }
    } else {
        const h_2a_target = h_system_in + (W_shaft_W / m_dot_total);
        h_2a_final = h_2a_target;
        const T2a_K = CP_INSTANCE.PropsSI('T', 'P', Pc_Pa, 'H', h_2a_final, fluid);
        T_2a_final_C = T2a_K - 273.15;
    }

    // 蒸发制冷量 & 冷凝放热
    const Q_evap_W = m_dot_suc * (h1_base - h_liq_out);
    const Q_cond_W = m_dot_total * (h_2a_final - h3);

    const COP_c = Q_evap_W / W_input_W;
    const COP_h = Q_cond_W / W_input_W;

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
        h_mid: h_mid_1s,
        h_mix: h_mix,
        h_2s_stage2: h_2s_stage2,
        T1_K,
        T2_C: T2_real_C,
        T2a_C: T_2a_final_C,
        T3_K,
        T4_C,
        Q_evap_W,
        Q_cond_W,
        Q_oil_W,
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
                ecoSuperheat_K: ecoSuperheatValue,
                ecoDt_K: ecoDtValue,
                isSlhxEnabled,
                slhxEff: slhxEffValue,
                T_2a_est_C
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
                desc: 'Stage1 Out (Pre-Inj)',
                temp: (CP_INSTANCE.PropsSI('T', 'P', result.P_intermediate_Pa, 'H', result.h_mid, fluid) - 273.15).toFixed(1),
                press: (result.P_intermediate_Pa / 1e5).toFixed(2),
                enth: (result.h_mid / 1000).toFixed(1),
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

            // 2: 压缩机实际排气（未油冷前）
            statePoints.push({
                name: '2',
                desc: 'Discharge (Before Oil Cooler)',
                temp: result.T2_C.toFixed(1),
                press: (result.Pc_Pa / 1e5).toFixed(2),
                enth: (result.h2 / 1000).toFixed(1),
                flow: result.m_dot_total.toFixed(4)
            });

            // 2a: 油冷后排气
            statePoints.push({
                name: '2a',
                desc: 'After Oil Cooler',
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

            // 补气路：3 -> 7 -> 6
            const pt3_clone = point('', result.h3, result.Pc_Pa);
            ecoVaporPoints = [pt3_clone, pt7, pt6];

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
                        ${createDetailRow('Q_oil', `${(result.Q_oil_W / 1000).toFixed(2)} kW`)}
                    </div>
                    <div class="bg-white/60 p-4 rounded-2xl border border-white/50">
                        ${createSectionHeader('High Pressure Stage', '🔥')}
                        ${createDetailRow('轴功 (HP)', `${(result.W_s2 / 1000).toFixed(2)} kW`)}
                        ${createDetailRow('Q_cond', `${(result.Q_cond_W / 1000).toFixed(2)} kW`)}
                        ${createDetailRow('m_dot_inj', `${result.m_dot_inj.toFixed(4)} kg/s`)}
                        ${createDetailRow('m_dot_total', `${result.m_dot_total.toFixed(4)} kg/s`)}
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div class="bg-white/60 p-4 rounded-2xl border border-white/50">
                        ${createSectionHeader('System Performance', '📈')}
                        ${createDetailRow('总轴功率', `${(result.W_shaft_W / 1000).toFixed(2)} kW`)}
                        ${createDetailRow('COP_c', result.COP_c.toFixed(3), true)}
                        ${createDetailRow('COP_h', result.COP_h.toFixed(3))}
                    </div>
                    <div class="bg-white/60 p-4 rounded-2xl border border-white/50">
                        ${createSectionHeader('Intermediate Pressure', '⚙️')}
                        ${createDetailRow('P_intermediate', `${(result.P_intermediate_Pa / 1e5).toFixed(2)} bar`)}
                        ${createDetailRow('T_intermediate', `${(result.T_intermediate_sat_K - 273.15).toFixed(1)} °C`)}
                    </div>
                </div>

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
        
        if (isNaN(Te_C) || isNaN(Tc_C) || Tc_C <= Te_C) return;
        
        const Pe_Pa = CP_INSTANCE.PropsSI('P', 'T', Te_C + 273.15, 'Q', 1, fluid);
        const Pc_Pa = CP_INSTANCE.PropsSI('P', 'T', Tc_C + 273.15, 'Q', 1, fluid);
        
        if (!Pe_Pa || !Pc_Pa || Pe_Pa <= 0 || Pc_Pa <= 0) return;
        
        // 计算中间压力（几何平均法）
        const P_intermediate_Pa = Math.sqrt(Pe_Pa * Pc_Pa);
        
        // 计算中间饱和温度
        const T_intermediate_sat_K = CP_INSTANCE.PropsSI('T', 'P', P_intermediate_Pa, 'Q', 0, fluid);
        const T_intermediate_sat_C = T_intermediate_sat_K - 273.15;
        
        // 更新中间压力输入框的值（即使输入框是禁用的）
        if (interSatTempInput) {
            interSatTempInput.value = T_intermediate_sat_C.toFixed(2);
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
                input.addEventListener('input', () => {
                    updateIntermediatePressureM5();
                });
                input.addEventListener('change', () => {
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


