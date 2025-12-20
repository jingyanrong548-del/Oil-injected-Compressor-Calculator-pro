// =====================================================================
// mode2_oil_refrig.js: 模式一 (制冷热泵) - v7.4.4 Flash Tank Fix
// 职责: “双核计算” + VSD + SLHX迭代 + 影子计算
// 修复: 
// 1. [v7.4.3] P-h图 Subcooler 2-3 断线修复
// 2. [v7.4.4] P-h图 Flash Tank 2-3 断线修复 (本次修复)
// =====================================================================

import { openMobileSheet } from './ui.js';
import { updateFluidInfo } from './coolprop_loader.js';
import { calculateEmpiricalEfficiencies } from './efficiency_models.js';
import { 
    createKpiCard, 
    createDetailRow, 
    createSectionHeader, 
    createErrorCard,
    createStateTable,
    createImpactGrid 
} from './components.js';
import { drawPHDiagram } from './charts.js';
import { HistoryDB, SessionState } from './storage.js';
import { AppState } from './state.js'; 
import { calculatePoly10, calculatePolyVSD } from './logic/polynomial_models.js';
import { 
    getFilteredBrands,
    getFilteredSeriesByBrand,
    getModelsBySeries, 
    getDisplacementByModel 
} from './compressor_models.js';

let CP_INSTANCE = null;
let lastCalculationData = null; 

// UI References
let calcButtonM2, calcFormM2, printButtonM2, fluidSelectM2, fluidInfoDivM2;
let resultsDesktopM2, resultsMobileM2, summaryMobileM2;
let autoEffCheckboxM2, tempEvapM2, tempCondM2, etaVM2, etaSM2;
let ecoCheckbox, ecoSatTempInput, ecoSuperheatInput, ecoDtInput, tempDischargeActualM2;
let polyRefRpmInput, polyRefDispInput, vsdCheckboxM2, ratedRpmInputM2, polyCorrectionPanel;
let slhxCheckbox, slhxEffInput;
// Compressor Model Selectors
let compressorBrandM2, compressorSeriesM2, compressorModelM2, modelDisplacementInfoM2, modelDisplacementValueM2;
let flowM3hM2;

// Button States
const BTN_TEXT_CALCULATE = "Calculate Performance";
const BTN_TEXT_RECALCULATE = "Recalculate (Input Changed)";

// ---------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------

function setButtonStale2() {
    if (calcButtonM2 && calcButtonM2.innerText !== BTN_TEXT_RECALCULATE) {
        calcButtonM2.innerText = BTN_TEXT_RECALCULATE;
        calcButtonM2.classList.add('opacity-90', 'ring-2', 'ring-yellow-400', 'ring-offset-2');
        if(printButtonM2) {
            printButtonM2.disabled = true;
            printButtonM2.classList.add('opacity-50', 'cursor-not-allowed');
        }
    }
}

function setButtonFresh2() {
    if (calcButtonM2) {
        calcButtonM2.innerText = BTN_TEXT_CALCULATE;
        calcButtonM2.classList.remove('opacity-90', 'ring-2', 'ring-yellow-400', 'ring-offset-2');
    }
}

function renderToAllViews(htmlContent) {
    if(resultsDesktopM2) resultsDesktopM2.innerHTML = htmlContent;
    if(resultsMobileM2) resultsMobileM2.innerHTML = htmlContent;
}

function updateMobileSummary(kpi1Label, kpi1Value, kpi2Label, kpi2Value) {
    if (!summaryMobileM2) return;
    summaryMobileM2.innerHTML = `
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

function updateAndDisplayEfficienciesM2() {
    if (!CP_INSTANCE || !autoEffCheckboxM2 || !autoEffCheckboxM2.checked) return;
    if (AppState.currentMode !== AppState.MODES.GEOMETRY) return; 

    try {
        const fluid = fluidSelectM2.value;
        const Te_C = parseFloat(tempEvapM2.value);
        const Tc_C = parseFloat(tempCondM2.value);
        if (isNaN(Te_C) || isNaN(Tc_C) || Tc_C <= Te_C) return;
        
        const Pe_Pa = CP_INSTANCE.PropsSI('P', 'T', Te_C + 273.15, 'Q', 1, fluid);
        const Pc_Pa = CP_INSTANCE.PropsSI('P', 'T', Tc_C + 273.15, 'Q', 1, fluid);
        
        if (!Pe_Pa || !Pc_Pa) return;

        const pressureRatio = Pc_Pa / Pe_Pa;
        const efficiencies = calculateEmpiricalEfficiencies(pressureRatio);
        
        if (etaVM2) etaVM2.value = efficiencies.eta_v;
        if (etaSM2) etaSM2.value = efficiencies.eta_s;

    } catch (error) {
        console.warn("Auto-Eff Error (Ignored):", error.message);
    }
}

// ---------------------------------------------------------------------
// Compressor Model Selection Handlers
// ---------------------------------------------------------------------

function initCompressorModelSelectorsM2() {
    // Populate brand dropdown (Mode 2: 前川只保留N系列，其余品牌保留全部)
    const brands = getFilteredBrands('m2');
    compressorBrandM2.innerHTML = '<option value="">-- 选择品牌 --</option>';
    brands.forEach(brand => {
        const option = document.createElement('option');
        option.value = brand;
        option.textContent = brand;
        compressorBrandM2.appendChild(option);
    });

    // Brand change handler
    compressorBrandM2.addEventListener('change', () => {
        const brand = compressorBrandM2.value;
        compressorSeriesM2.innerHTML = '<option value="">-- 选择系列 --</option>';
        compressorModelM2.innerHTML = '<option value="">-- 选择型号 --</option>';
        compressorSeriesM2.disabled = !brand;
        compressorModelM2.disabled = true;
        modelDisplacementInfoM2.classList.add('hidden');

        if (brand) {
            const series = getFilteredSeriesByBrand('m2', brand);
            series.forEach(s => {
                const option = document.createElement('option');
                option.value = s;
                option.textContent = s;
                compressorSeriesM2.appendChild(option);
            });
            compressorSeriesM2.disabled = false;
        }
    });

    // Series change handler
    compressorSeriesM2.addEventListener('change', () => {
        const brand = compressorBrandM2.value;
        const series = compressorSeriesM2.value;
        compressorModelM2.innerHTML = '<option value="">-- 选择型号 --</option>';
        compressorModelM2.disabled = !series;
        modelDisplacementInfoM2.classList.add('hidden');

        if (brand && series) {
            const models = getModelsBySeries(brand, series);
            models.forEach(m => {
                const option = document.createElement('option');
                option.value = m.model;
                option.textContent = m.model;
                compressorModelM2.appendChild(option);
            });
            compressorModelM2.disabled = false;
        }
    });

    // Model change handler - Auto-fill displacement and switch to volume mode
    compressorModelM2.addEventListener('change', () => {
        const brand = compressorBrandM2.value;
        const series = compressorSeriesM2.value;
        const model = compressorModelM2.value;

        if (brand && series && model) {
            const displacement = getDisplacementByModel(brand, series, model);
            if (displacement !== null) {
                modelDisplacementValueM2.textContent = displacement.toFixed(0);
                modelDisplacementInfoM2.classList.remove('hidden');
                
                // Automatically switch to volume mode (流量定义)
                const volModeRadio = document.querySelector('input[name="flow_mode_m2"][value="vol"]');
                const rpmModeRadio = document.querySelector('input[name="flow_mode_m2"][value="rpm"]');
                if (volModeRadio && rpmModeRadio) {
                    volModeRadio.checked = true;
                    rpmModeRadio.checked = false;
                    
                    // Trigger change event to update UI
                    volModeRadio.dispatchEvent(new Event('change', { bubbles: true }));
                }
                
                // Auto-fill flow_m3h_m2
                if (flowM3hM2) {
                    flowM3hM2.value = displacement.toFixed(2);
                    setButtonStale2();
                }
            } else {
                modelDisplacementInfoM2.classList.add('hidden');
            }
        } else {
            modelDisplacementInfoM2.classList.add('hidden');
        }
    });

    // Flow mode change handler - Auto-fill when switching to volume mode
    document.querySelectorAll('input[name="flow_mode_m2"]').forEach(radio => {
        radio.addEventListener('change', () => {
            if (radio.value === 'vol' && compressorModelM2.value) {
                const brand = compressorBrandM2.value;
                const series = compressorSeriesM2.value;
                const model = compressorModelM2.value;
                const displacement = getDisplacementByModel(brand, series, model);
                if (displacement !== null && flowM3hM2) {
                    flowM3hM2.value = displacement.toFixed(2);
                    setButtonStale2();
                }
            }
        });
    });
}

// ---------------------------------------------------------------------
// Core Calculation Logic
// ---------------------------------------------------------------------
function calculateMode2() {
    renderToAllViews('<div class="flex justify-center p-10"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div></div>');
    ['chart-desktop-m2', 'chart-mobile-m2'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.classList.add('hidden');
    });
    
    setTimeout(() => {
        try {
            // --- Common Input Reading ---
            const fluid = fluidSelectM2.value;
            const Te_C = parseFloat(document.getElementById('temp_evap_m2').value);
            const Tc_C = parseFloat(document.getElementById('temp_cond_m2').value);
            const superheat_K = parseFloat(document.getElementById('superheat_m2').value);
            const subcooling_K = parseFloat(document.getElementById('subcooling_m2').value);
            const T_2a_est_C = parseFloat(tempDischargeActualM2.value);
            const motor_eff = parseFloat(document.getElementById('motor_eff_m2').value);
            
            // VSD Inputs
            const isVsdEnabled = vsdCheckboxM2.checked;
            const ratedRpm = parseFloat(ratedRpmInputM2.value) || 2900;
            const currentRpm = parseFloat(document.getElementById('rpm_m2').value) || 2900;
            const rpmRatio = isVsdEnabled ? (currentRpm / ratedRpm) : 1.0;

            // SLHX Inputs
            const isSlhxEnabled = slhxCheckbox.checked;
            const slhxEff = parseFloat(slhxEffInput.value) || 0.5;

            AppState.updateVSD(isVsdEnabled, ratedRpm, currentRpm);
            AppState.updateSLHX(isSlhxEnabled, slhxEff);

            if (isNaN(Te_C) || isNaN(Tc_C) || T_2a_est_C <= Tc_C) 
                throw new Error("Invalid Temp Inputs (Discharge > Cond > Evap).");

            // --- Common Physics (CoolProp SI Units) ---
            const T_evap_K = Te_C + 273.15;
            const T_cond_K = Tc_C + 273.15;
            const Pe_Pa = CP_INSTANCE.PropsSI('P', 'T', T_evap_K, 'Q', 1, fluid);
            const Pc_Pa = CP_INSTANCE.PropsSI('P', 'T', T_cond_K, 'Q', 1, fluid);

            // Point 1: Evaporator Outlet (Base without SLHX)
            const T_1_K = T_evap_K + superheat_K;
            const h_1 = CP_INSTANCE.PropsSI('H', 'T', T_1_K, 'P', Pe_Pa, fluid);
            // Reference Density at Evap Out (for SLHX shadow comparison)
            const rho_1 = CP_INSTANCE.PropsSI('D', 'T', T_1_K, 'P', Pe_Pa, fluid); 
            
            // Point 3: Condenser Outlet
            const T_3_K = T_cond_K - subcooling_K;
            const h_3 = CP_INSTANCE.PropsSI('H', 'T', T_3_K, 'P', Pc_Pa, fluid); 

            // =========================================================
            // ITERATIVE SOLVER (SLHX & Suction Density)
            // =========================================================
            let T_suc_K = T_1_K;
            let h_suc = h_1;
            let rho_suc = rho_1, s_suc = 0;
            let m_dot_suc = 0, W_shaft_W = 0;
            let h_liq_in = h_3; 
            let h_liq_out = h_3; 
            
            const isEcoEnabled = ecoCheckbox.checked;
            const ecoType = document.querySelector('input[name="eco_type_m2"]:checked').value; 
            const ecoPressMode = document.querySelector('input[name="eco_press_mode_m2"]:checked').value; 
            const eco_superheat_K = parseFloat(document.getElementById('eco_superheat_m2').value);
            const eco_dt_K = parseFloat(document.getElementById('eco_dt_m2').value) || 5.0;
            let m_dot_inj = 0, m_dot_total = 0;
            let P_eco_Pa = 0, T_eco_sat_K = 0;
            let h_5 = h_3, h_6 = 0, h_7 = h_3; 
            let m_p5 = 0, m_p6 = 0, m_p7 = 0; 

            let eta_v_display = null, eta_s_display = null;
            let efficiency_info_text = "";

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

                // 2. Mass Flow Calculation
                if (AppState.currentMode === AppState.MODES.GEOMETRY) {
                    const flow_mode = document.querySelector('input[name="flow_mode_m2"]:checked').value;
                    const eta_v_input = parseFloat(etaVM2.value);
                    if (isNaN(eta_v_input)) throw new Error("Invalid Volumetric Efficiency.");

                    let V_th_m3_s = 0;
                    if (flow_mode === 'rpm') {
                        const disp = parseFloat(document.getElementById('displacement_m2').value);
                        V_th_m3_s = currentRpm * (disp / 1e6) / 60.0;
                    } else {
                        const flow_m3h = parseFloat(flowM3hM2.value);
                        V_th_m3_s = flow_m3h / 3600.0;
                    }
                    m_dot_suc = V_th_m3_s * eta_v_input * rho_suc;
                    
                    eta_v_display = eta_v_input;
                    eta_s_display = parseFloat(etaSM2.value); 
                    efficiency_info_text = isVsdEnabled ? `Geo (VSD @ ${currentRpm})` : "Standard Geometry";

                } else {
                    // Polynomial Mode
                    const cInputs = Array.from(document.querySelectorAll('input[name="poly_flow"]')).map(i => i.value);
                    const dInputs = Array.from(document.querySelectorAll('input[name="poly_power"]')).map(i => i.value);
                    const corrInputs = Array.from(document.querySelectorAll('input[name="poly_corr"]')).map(i => i.value);
                    AppState.updateCoeffs('massFlow', cInputs);
                    AppState.updateCoeffs('power', dInputs);
                    AppState.updateCoeffs('correction', corrInputs);

                    let m_poly = calculatePolyVSD(AppState.polynomial.massFlowCoeffs, AppState.polynomial.correctionCoeffs, Te_C, Tc_C, rpmRatio);
                    // Density correction for SLHX: m_dot scales with density vs rated conditions (approx rho_1)
                    m_dot_suc = m_poly * (rho_suc / rho_1); 

                    const P_poly = calculatePolyVSD(AppState.polynomial.powerCoeffs, AppState.polynomial.correctionCoeffs, Te_C, Tc_C, rpmRatio);
                    W_shaft_W = P_poly * 1000;

                    const refRpm = parseFloat(polyRefRpmInput.value) || 2900;
                    const refDisp = parseFloat(polyRefDispInput.value) || 437.5;
                    const V_th_current = (isVsdEnabled ? currentRpm : refRpm) * (refDisp / 1e6) / 60.0;
                    eta_v_display = m_dot_suc / (rho_suc * V_th_current);
                    efficiency_info_text = isVsdEnabled ? "Poly (VSD Corr)" : "Poly-Fit";
                }

                // 3. ECO Calculation (Determines liquid state entering SLHX)
                if (isEcoEnabled) {
                    if (ecoPressMode === 'auto') {
                        P_eco_Pa = Math.sqrt(Pe_Pa * Pc_Pa);
                        T_eco_sat_K = CP_INSTANCE.PropsSI('T', 'P', P_eco_Pa, 'Q', 0, fluid);
                    } else {
                        const T_eco_input = parseFloat(ecoSatTempInput.value);
                        T_eco_sat_K = T_eco_input + 273.15;
                        P_eco_Pa = CP_INSTANCE.PropsSI('P', 'T', T_eco_sat_K, 'Q', 0.5, fluid);
                    }
                    const h_eco_liq = CP_INSTANCE.PropsSI('H', 'T', T_eco_sat_K, 'Q', 0, fluid);
                    const h_eco_vap = CP_INSTANCE.PropsSI('H', 'T', T_eco_sat_K, 'Q', 1, fluid);
                    h_7 = h_3; 

                    if (ecoType === 'flash_tank') {
                        h_6 = h_eco_vap; h_5 = h_eco_liq; 
                        const x_flash = (h_7 - h_5) / (h_6 - h_5);
                        m_dot_inj = m_dot_suc * (x_flash / (1 - x_flash));
                        m_dot_total = m_dot_suc + m_dot_inj;
                        h_liq_in = h_5; // Flash tank saturated liquid -> SLHX
                        m_p7 = m_dot_total; m_p5 = m_dot_suc; m_p6 = m_dot_inj;   
                    } else {
                        // Subcooler
                        const T_inj_K = T_eco_sat_K + eco_superheat_K;
                        h_6 = CP_INSTANCE.PropsSI('H', 'T', T_inj_K, 'P', P_eco_Pa, fluid); 
                        const T_5_K = T_eco_sat_K + eco_dt_K; 
                        h_5 = CP_INSTANCE.PropsSI('H', 'T', T_5_K, 'P', Pc_Pa, fluid); 
                        h_liq_in = h_5; // Subcooler outlet -> SLHX
                        m_dot_inj = (m_dot_suc * (h_3 - h_5)) / (h_6 - h_7); 
                        m_dot_total = m_dot_suc + m_dot_inj;
                        m_p5 = m_dot_suc; m_p7 = m_dot_inj; m_p6 = m_dot_inj;
                    }
                } else {
                    m_dot_total = m_dot_suc;
                    h_liq_in = h_3; // Condenser liquid -> SLHX
                }

                // 4. SLHX Loop
                if (isSlhxEnabled) {
                    const P_liq_side = (isEcoEnabled && ecoType === 'flash_tank') ? P_eco_Pa : Pc_Pa;
                    const T_liq_in = CP_INSTANCE.PropsSI('T', 'H', h_liq_in, 'P', P_liq_side, fluid);
                    
                    const Cp_liq = CP_INSTANCE.PropsSI('C', 'H', h_liq_in, 'P', P_liq_side, fluid);
                    const Cp_vap = CP_INSTANCE.PropsSI('C', 'H', h_1, 'P', Pe_Pa, fluid);
                    
                    const C_liq = m_dot_suc * Cp_liq;
                    const C_vap = m_dot_suc * Cp_vap;
                    const C_min = Math.min(C_liq, C_vap);
                    
                    const Q_max = C_min * (T_liq_in - T_1_K);
                    const Q_slhx = slhxEff * Q_max;
                    
                    const h_suc_new = h_1 + (Q_slhx / m_dot_suc);
                    const h_liq_out_new = h_liq_in - (Q_slhx / m_dot_suc);
                    
                    const diff = Math.abs(h_suc_new - h_suc);
                    h_suc = h_suc_new;
                    h_liq_out = h_liq_out_new;
                    
                    if (diff < 100) break; // Converged
                } else {
                    h_suc = h_1;
                    h_liq_out = h_liq_in;
                    break; 
                }
            } 

            // =========================================================
            // Work & Finalization
            // =========================================================
            let W_ideal_W = 0;
            let h_mid_1s = 0, h_mix_s = 0, h_2s_stage2 = 0;  // 用于p-h图
            if (!isEcoEnabled) {
                const h_2s = CP_INSTANCE.PropsSI('H', 'P', Pc_Pa, 'S', s_suc, fluid);
                W_ideal_W = m_dot_suc * (h_2s - h_suc);
            } else {
                h_mid_1s = CP_INSTANCE.PropsSI('H', 'P', P_eco_Pa, 'S', s_suc, fluid);
                const W_s1 = m_dot_suc * (h_mid_1s - h_suc);
                h_mix_s = (m_dot_suc * h_mid_1s + m_dot_inj * h_6) / m_dot_total;
                
                // 验证混合逻辑：h_mix_s应该小于h_mid_1s（因为h_6 < h_mid_1s）
                if (h_mix_s >= h_mid_1s) {
                    console.warn(`混合逻辑异常：h_mix_s (${h_mix_s.toFixed(1)} J/kg) >= h_mid_1s (${h_mid_1s.toFixed(1)} J/kg)，补气温度可能异常`);
                }
                
                const s_mix = CP_INSTANCE.PropsSI('S', 'H', h_mix_s, 'P', P_eco_Pa, fluid);
                h_2s_stage2 = CP_INSTANCE.PropsSI('H', 'P', Pc_Pa, 'S', s_mix, fluid);
                const W_s2 = m_dot_total * (h_2s_stage2 - h_mix_s);
                W_ideal_W = W_s1 + W_s2;
            }

            if (AppState.currentMode === AppState.MODES.GEOMETRY) {
                const eff_mode = document.querySelector('input[name="eff_mode_m2"]:checked').value;
                if (eff_mode === 'shaft') {
                    W_shaft_W = W_ideal_W / eta_s_display;
                } else {
                    W_shaft_W = (W_ideal_W / eta_s_display) * motor_eff;
                }
            } else {
                if (W_shaft_W > 0) eta_s_display = W_ideal_W / W_shaft_W;
            }

            const Q_evap_W = m_dot_suc * (h_1 - h_liq_out); 
            const W_input_W = W_shaft_W / motor_eff;

            const h6_safe = isEcoEnabled ? h_6 : 0;
            const h_system_in = (m_dot_suc * h_suc + m_dot_inj * h6_safe); 
            const T_2a_est_K = T_2a_est_C + 273.15;
            const h_2a_target = CP_INSTANCE.PropsSI('H', 'T', T_2a_est_K, 'P', Pc_Pa, fluid);
            const energy_out_gas = m_dot_total * h_2a_target;
            let Q_oil_W = W_shaft_W - (energy_out_gas - h_system_in);
            let T_2a_final_C = T_2a_est_C;

            if (Q_oil_W < 0) {
                Q_oil_W = 0;
                const h_2a_real = (h_system_in + W_shaft_W) / m_dot_total;
                const T_2a_real_K = CP_INSTANCE.PropsSI('T', 'P', Pc_Pa, 'H', h_2a_real, fluid);
                T_2a_final_C = T_2a_real_K - 273.15;
            }
            const h_2a_final = (h_system_in + W_shaft_W - Q_oil_W) / m_dot_total;
            const Q_cond_W = m_dot_total * (h_2a_final - h_3);
            const Q_heating_total_W = Q_cond_W + Q_oil_W;

            const COP_R = Q_evap_W / W_input_W;
            const COP_H = Q_heating_total_W / W_input_W;

            // =========================================================
            // SHADOW CALCULATION (Benefit Analysis) - v7.4.2
            // =========================================================
            
            // 1. SLHX Benefit (Current vs No-SLHX)
            let slhxHtml = '';
            if (isSlhxEnabled) {
                const m_dot_base = m_dot_suc * (rho_1 / rho_suc);
                const q_cool_base = m_dot_base * (h_1 - h_liq_in);
                
                // Recalculate base work with original suction state
                const s_1 = CP_INSTANCE.PropsSI('S', 'H', h_1, 'P', Pe_Pa, fluid);
                let w_shaft_base = 0;
                if (!isEcoEnabled) {
                    const h_2s_base = CP_INSTANCE.PropsSI('H', 'P', Pc_Pa, 'S', s_1, fluid);
                    const w_ideal_base = m_dot_base * (h_2s_base - h_1);
                    w_shaft_base = w_ideal_base / eta_s_display;
                } else {
                    const h_mid_1s_base = CP_INSTANCE.PropsSI('H', 'P', P_eco_Pa, 'S', s_1, fluid);
                    const w_s1_base = m_dot_base * (h_mid_1s_base - h_1);
                    const m_inj_base = m_dot_inj * (m_dot_base / m_dot_suc);
                    const m_total_base = m_dot_base + m_inj_base;
                    const h_mix_s_base = (m_dot_base * h_mid_1s_base + m_inj_base * h_6) / m_total_base;
                    const s_mix_base = CP_INSTANCE.PropsSI('S', 'H', h_mix_s_base, 'P', P_eco_Pa, fluid);
                    const h_2s_stage2_base = CP_INSTANCE.PropsSI('H', 'P', Pc_Pa, 'S', s_mix_base, fluid);
                    const w_s2_base = m_total_base * (h_2s_stage2_base - h_mix_s_base);
                    w_shaft_base = (w_s1_base + w_s2_base) / eta_s_display;
                }

                const w_in_base = w_shaft_base / motor_eff;
                const q_heat_base = q_cool_base + w_shaft_base;
                const cop_c_base = q_cool_base / w_in_base;
                const cop_h_base = q_heat_base / w_in_base;

                const slhxData = {
                    Qc: { val: (Q_evap_W/1000).toFixed(2), diff: ((Q_evap_W - q_cool_base)/q_cool_base)*100 },
                    Qh: { val: (Q_heating_total_W/1000).toFixed(2), diff: ((Q_heating_total_W - q_heat_base)/q_heat_base)*100 },
                    COPc: { val: COP_R.toFixed(2), diff: ((COP_R - cop_c_base)/cop_c_base)*100 },
                    COPh: { val: COP_H.toFixed(2), diff: ((COP_H - cop_h_base)/cop_h_base)*100 }
                };

                slhxHtml = `
                    ${createSectionHeader('SLHX Benefit', '🔥')}
                    ${createImpactGrid(slhxData, 'orange')}
                    ${createDetailRow('Suction Temp Rise', `+${(T_suc_K - T_1_K).toFixed(1)} K`)}
                `;
            }

            // 2. ECO Benefit (Current vs No-ECO)
            let ecoHtml = '';
            if (isEcoEnabled) {
                const q_cool_base_eco = m_dot_suc * (h_suc - h_3); 
                const h_2s_base_eco = CP_INSTANCE.PropsSI('H', 'P', Pc_Pa, 'S', s_suc, fluid);
                const W_ideal_base_eco = m_dot_suc * (h_2s_base_eco - h_suc);
                const W_shaft_base_eco = W_ideal_base_eco / eta_s_display;
                const w_in_base_eco = W_shaft_base_eco / motor_eff;
                const q_heat_base_eco = q_cool_base_eco + W_shaft_base_eco;
                const cop_c_base_eco = q_cool_base_eco / w_in_base_eco;
                const cop_h_base_eco = q_heat_base_eco / w_in_base_eco;

                const ecoData = {
                    Qc: { val: (Q_evap_W/1000).toFixed(2), diff: ((Q_evap_W - q_cool_base_eco)/q_cool_base_eco)*100 },
                    Qh: { val: (Q_heating_total_W/1000).toFixed(2), diff: ((Q_heating_total_W - q_heat_base_eco)/q_heat_base_eco)*100 },
                    COPc: { val: COP_R.toFixed(2), diff: ((COP_R - cop_c_base_eco)/cop_c_base_eco)*100 },
                    COPh: { val: COP_H.toFixed(2), diff: ((COP_H - cop_h_base_eco)/cop_h_base_eco)*100 }
                };

                ecoHtml = `
                    ${createSectionHeader('Economizer Benefit', '⚡')}
                    ${createDetailRow('P_eco', `${(P_eco_Pa/1e5).toFixed(2)} bar`)}
                    ${createImpactGrid(ecoData, 'teal')}
                `;
            }

            // --- Chart ---
            const point = (name, h_j, p_pa, pos='top') => ({ name, value: [h_j/1000, p_pa/1e5], label: { position: pos, show: true } });
            
            const pt1 = point('1', h_1, Pe_Pa, 'bottom');
            const pt1_p = point("1'", h_suc, Pe_Pa, 'bottom'); 
            const pt2 = point('2', h_2a_final, Pc_Pa, 'top');
            const pt3 = point('3', h_3, Pc_Pa, 'top');
            const pt4 = point('4', h_liq_out, Pe_Pa, 'bottom'); 
            
            // 点5'的压力（用于SLHX后的液体）
            let P_5p_chart = Pc_Pa;
            if (isEcoEnabled && ecoType === 'flash_tank') P_5p_chart = P_eco_Pa;
            const pt5_p = isSlhxEnabled ? point("5'", h_liq_out, P_5p_chart, 'top') : null;
            
            // 点5的压力（关键差异：Flash Tank用P_eco，Subcooler用Pc）
            let P_5_chart = Pc_Pa;
            if (isEcoEnabled && ecoType === 'flash_tank') P_5_chart = P_eco_Pa;
            const pt5 = isEcoEnabled ? point('5', h_5, P_5_chart, 'top') : null;

            let mainPoints = [], ecoLiquidPoints = [], ecoVaporPoints = [];

            if (!isEcoEnabled) {
                if (isSlhxEnabled) {
                    mainPoints = [pt1, pt1_p, pt2, pt3, pt5_p, pt4, pt1];
                } else {
                    mainPoints = [pt1, pt2, pt3, pt4, pt1];
                }
            } else {
                if (ecoType === 'flash_tank') {
                    const pt7 = point('7', h_7, P_eco_Pa, 'right');
                    
                    // 创建压缩线上的点：mid（第一级压缩终点，补气前）、mix（混合后的状态）、点2（实际排气点）
                    // 点6（补气点，混合前的状态）通过补气路显示
                    const pt1_start = isSlhxEnabled ? pt1_p : pt1;
                    const pt_mid = point('mid', h_mid_1s, P_eco_Pa, 'right');  // 第一级压缩终点（补气前）
                    const pt6 = point('6', h_6, P_eco_Pa, 'left');  // 点6（补气点，混合前的状态）
                    const pt_mix = point('mix', h_mix_s, P_eco_Pa, 'left');  // 混合点（混合后），在mid左边（焓值更小）
                    
                    // 压缩线：4 -> 1 -> 1' -> mid -> mix -> 2 -> 3
                    // 注意：点mix在点mid的左边（焓值更小），因为混合后温度降低
                    // 点6通过补气路连接到mix点，表示补气进入混合
                    // 压缩后排气只有1个点（点2）
                    mainPoints = [pt4, pt1, pt1_start, pt_mid, pt_mix, pt2, pt3];

                    // 液路：3 -> 7 -> 5 -> [5'] -> 4
                    ecoLiquidPoints = [pt3, pt7, pt5];
                    if (isSlhxEnabled) ecoLiquidPoints.push(pt5_p, pt4);
                    else ecoLiquidPoints.push(pt4);

                    // 补气路：7 -> 6（补气进入，点6表示混合前的补气状态）
                    ecoVaporPoints = [pt7, pt6];
                } else {
                    // Subcooler模式：双级压缩过程
                    const pt7 = point('7', h_7, P_eco_Pa, 'right');
                    
                    // 创建压缩线上的点：mid（第一级压缩终点，补气前）、mix（混合后的状态）、点2（实际排气点）
                    // 点6（补气点，混合前的状态）通过补气路显示
                    const pt1_start = isSlhxEnabled ? pt1_p : pt1;
                    const pt_mid = point('mid', h_mid_1s, P_eco_Pa, 'right');  // 第一级压缩终点（补气前）
                    const pt6 = point('6', h_6, P_eco_Pa, 'left');  // 点6（补气点，混合前的状态）
                    const pt_mix = point('mix', h_mix_s, P_eco_Pa, 'left');  // 混合点（混合后），在mid左边（焓值更小）
                    
                    // 液路：3 -> 5 -> [5'] -> 4
                    ecoLiquidPoints = [pt3, pt5];
                    if (isSlhxEnabled) ecoLiquidPoints.push(pt5_p, pt4);
                    else ecoLiquidPoints.push(pt4);

                    // 压缩线：4 -> 1 -> [1'] -> mid -> mix -> 2 -> 3
                    // 注意：点mix在点mid的左边（焓值更小），因为混合后温度降低
                    // 点6通过补气路连接到mix点，表示补气进入混合
                    // 压缩后排气只有1个点（点2）
                    mainPoints = [pt4, pt1];
                    if (isSlhxEnabled) {
                        mainPoints.push(pt1_start);
                    }
                    mainPoints.push(pt_mid, pt_mix, pt2, pt3);

                    // 补气路：3 -> 7 -> 6（补气进入，点6表示混合前的补气状态）
                    const pt3_clone = point('', h_3, Pc_Pa);
                    ecoVaporPoints = [pt3_clone, pt7, pt6];
                }
            }

            ['chart-desktop-m2', 'chart-mobile-m2'].forEach(id => {
                drawPHDiagram(id, {
                    title: `P-h Diagram (${fluid}) [${isSlhxEnabled?'SLHX+':''}${isEcoEnabled?'ECO+':''}]`,
                    mainPoints, ecoLiquidPoints, ecoVaporPoints,
                    xLabel: 'Enthalpy (kJ/kg)', yLabel: 'Pressure (bar)'
                });
            });

            // --- HTML Table ---
            // 注意：点1和点mid的质量流应该相同（都是m_dot_suc），因为补气发生在第一级压缩之后
            const statePoints = [
                { name: '1', desc: 'Evap Out', temp: Te_C.toFixed(1), press: (Pe_Pa/1e5).toFixed(2), enth: (h_1/1000).toFixed(1), flow: m_dot_suc.toFixed(3) },
            ];
            if (isSlhxEnabled) {
                statePoints.push({ name: "1'", desc: 'Comp In (SLHX)', temp: (T_suc_K-273.15).toFixed(1), press: (Pe_Pa/1e5).toFixed(2), enth: (h_suc/1000).toFixed(1), flow: m_dot_suc.toFixed(3) });
            }
            
            // 压缩过程状态点（带经济器时）
            if (isEcoEnabled) {
                // 点mid：第一级压缩终点（补气前）
                // 注意：点mid的质量流是经济器蒸发的气体量（补气流量m_dot_inj），不是蒸发器的蒸发量
                // 点1的质量流是蒸发器的蒸发量（m_dot_suc），两者概念不同
                const T_mid_K = CP_INSTANCE.PropsSI('T', 'P', P_eco_Pa, 'H', h_mid_1s, fluid);
                statePoints.push({
                    name: 'mid',
                    desc: 'Comp Stage1 Out (Pre-Inj)',
                    temp: (T_mid_K - 273.15).toFixed(1),
                    press: (P_eco_Pa / 1e5).toFixed(2),
                    enth: (h_mid_1s / 1000).toFixed(1),
                    flow: m_dot_inj.toFixed(3)  // 经济器蒸发的气体量（补气流量）
                });
                
                // 点mix：混合后的状态
                const T_mix_K = CP_INSTANCE.PropsSI('T', 'P', P_eco_Pa, 'H', h_mix_s, fluid);
                statePoints.push({
                    name: 'mix',
                    desc: 'After Mixing',
                    temp: (T_mix_K - 273.15).toFixed(1),
                    press: (P_eco_Pa / 1e5).toFixed(2),
                    enth: (h_mix_s / 1000).toFixed(1),
                    flow: m_dot_total.toFixed(3)
                });
            }
            
            statePoints.push(
                { name: '2', desc: 'Discharge', temp: T_2a_final_C.toFixed(1), press: (Pc_Pa/1e5).toFixed(2), enth: (h_2a_final/1000).toFixed(1), flow: m_dot_total.toFixed(3) },
                { name: '3', desc: 'Cond Out', temp: (T_3_K-273.15).toFixed(1), press: (Pc_Pa/1e5).toFixed(2), enth: (h_3/1000).toFixed(1), flow: m_dot_total.toFixed(3) }
            );
            
            if (isEcoEnabled) {
                // [Bug Fix 2]: Add Point 6 and 7 for ECO modes
                if (ecoType === 'flash_tank') {
                    statePoints.push(
                        { name: '7', desc: 'Flash In (Valve)', temp: (CP_INSTANCE.PropsSI('T','P',P_eco_Pa,'Q',0,fluid)-273.15).toFixed(1), press: (P_eco_Pa/1e5).toFixed(2), enth: (h_7/1000).toFixed(1), flow: m_p7.toFixed(3) },
                        { name: '6', desc: 'Injection Gas', temp: (CP_INSTANCE.PropsSI('T','P',P_eco_Pa,'Q',1,fluid)-273.15).toFixed(1), press: (P_eco_Pa/1e5).toFixed(2), enth: (h_6/1000).toFixed(1), flow: m_p6.toFixed(3) },
                        { name: '5', desc: 'ECO Liq Out', temp: (CP_INSTANCE.PropsSI('T','P',P_eco_Pa,'Q',0,fluid)-273.15).toFixed(1), press: (P_eco_Pa/1e5).toFixed(2), enth: (h_5/1000).toFixed(1), flow: m_p5.toFixed(3) }
                    );
                } else {
                    // Subcooler
                    statePoints.push(
                        { name: '7', desc: 'Inj Valve Out', temp: (CP_INSTANCE.PropsSI('T','P',P_eco_Pa,'Q',0,fluid)-273.15).toFixed(1), press: (P_eco_Pa/1e5).toFixed(2), enth: (h_7/1000).toFixed(1), flow: m_p7.toFixed(3) },
                        { name: '6', desc: 'Injection Gas', temp: (CP_INSTANCE.PropsSI('T','P',P_eco_Pa,'H',h_6,fluid)-273.15).toFixed(1), press: (P_eco_Pa/1e5).toFixed(2), enth: (h_6/1000).toFixed(1), flow: m_p6.toFixed(3) },
                        { name: '5', desc: 'Subcooler Out', temp: (CP_INSTANCE.PropsSI('T','P',Pc_Pa,'H',h_5,fluid)-273.15).toFixed(1), press: (Pc_Pa/1e5).toFixed(2), enth: (h_5/1000).toFixed(1), flow: m_p5.toFixed(3) }
                    );
                }
            }
            
            if (isSlhxEnabled) {
                statePoints.push({ 
                    name: "5'", 
                    desc: 'Exp Valve In', 
                    temp: (CP_INSTANCE.PropsSI('T','H',h_liq_out,'P',P_5p_chart,fluid)-273.15).toFixed(1), 
                    press: (P_5p_chart/1e5).toFixed(2), 
                    enth: (h_liq_out/1000).toFixed(1), 
                    flow: m_dot_suc.toFixed(3) 
                });
            }

            statePoints.push(
                { name: '4', desc: 'Evap In', temp: (CP_INSTANCE.PropsSI('T','P',Pe_Pa,'H',h_liq_out,fluid)-273.15).toFixed(1), press: (Pe_Pa/1e5).toFixed(2), enth: (h_liq_out/1000).toFixed(1), flow: m_dot_suc.toFixed(3) }
            );

            // Render
            const displayEtaV = eta_v_display !== null ? eta_v_display.toFixed(3) : "---";
            const displayEtaS = eta_s_display !== null ? eta_s_display.toFixed(3) : "---";

            let html = `
                <div class="grid grid-cols-2 gap-4 mb-6">
                    ${createKpiCard('制冷量 (Cooling)', (Q_evap_W/1000).toFixed(2), 'kW', `COP: ${COP_R.toFixed(2)}`, 'blue')}
                    ${createKpiCard('总供热 (Heating)', (Q_heating_total_W/1000).toFixed(2), 'kW', `COP: ${COP_H.toFixed(2)}`, 'orange')}
                </div>
                <div class="space-y-1 bg-white/40 p-4 rounded-2xl border border-white/50 shadow-inner">
                    ${createSectionHeader('Power & Efficiency')}
                    ${createDetailRow('Input Power', `${(W_input_W/1000).toFixed(2)} kW`, true)}
                    ${createDetailRow('Shaft Power', `${(W_shaft_W/1000).toFixed(2)} kW`)}
                    ${createDetailRow('Oil Load', `${(Q_oil_W/1000).toFixed(2)} kW`)}
                    ${createDetailRow('Calc Logic', efficiency_info_text)}
                    ${createDetailRow('Volumetric Eff (η_v)', displayEtaV, AppState.currentMode === 'polynomial')}
                    ${createDetailRow('Isentropic Eff (η_s)', displayEtaS, AppState.currentMode === 'polynomial')}
                    
                    ${isVsdEnabled ? createDetailRow('VSD Status', `${currentRpm} RPM / Ratio: ${rpmRatio.toFixed(2)}`) : ''}

                    ${slhxHtml}
                    ${ecoHtml}

                    ${createSectionHeader('State Points Detail', '📊')}
                    ${createStateTable(statePoints)}
                </div>
            `;

            renderToAllViews(html);
            updateMobileSummary('Cooling', `${(Q_evap_W/1000).toFixed(1)} kW`, 'COP', COP_R.toFixed(2));
            openMobileSheet('m2');
            
            setButtonFresh2();
            if(printButtonM2) printButtonM2.disabled = false;

            lastCalculationData = { fluid, statePoints, COP_R, COP_H, Q_evap_W, Q_cond_W, Q_oil_W };
            
            AppState.updateVSD(isVsdEnabled, ratedRpm, currentRpm);
            AppState.updateSLHX(isSlhxEnabled, slhxEff);
            const inputState = SessionState.collectInputs('calc-form-mode-2');
            HistoryDB.add('M2', `${fluid} • ${(Q_evap_W/1000).toFixed(1)} kW`, inputState, { 'COP': COP_R.toFixed(2) });

        } catch (error) {
            renderToAllViews(createErrorCard(error.message));
            console.error(error);
            if(printButtonM2) printButtonM2.disabled = true;
        }
    }, 50);
}

// ... Init & Exports
export function initMode2(CP) {
    CP_INSTANCE = CP;
    calcButtonM2 = document.getElementById('calc-button-mode-2');
    calcFormM2 = document.getElementById('calc-form-mode-2');
    printButtonM2 = document.getElementById('print-button-mode-2');
    fluidSelectM2 = document.getElementById('fluid_m2');
    fluidInfoDivM2 = document.getElementById('fluid-info-m2');
    tempDischargeActualM2 = document.getElementById('temp_discharge_actual_m2');
    resultsDesktopM2 = document.getElementById('results-desktop-m2');
    resultsMobileM2 = document.getElementById('mobile-results-m2');
    summaryMobileM2 = document.getElementById('mobile-summary-m2');
    autoEffCheckboxM2 = document.getElementById('auto-eff-m2');
    tempEvapM2 = document.getElementById('temp_evap_m2');
    tempCondM2 = document.getElementById('temp_cond_m2');
    etaVM2 = document.getElementById('eta_v_m2');
    etaSM2 = document.getElementById('eta_s_m2');
    ecoCheckbox = document.getElementById('enable_eco_m2');
    ecoSatTempInput = document.getElementById('temp_eco_sat_m2');
    ecoSuperheatInput = document.getElementById('eco_superheat_m2');
    ecoDtInput = document.getElementById('eco_dt_m2'); 
    
    // VSD / Poly Inputs
    polyRefRpmInput = document.getElementById('poly_ref_rpm');
    polyRefDispInput = document.getElementById('poly_ref_disp');
    vsdCheckboxM2 = document.getElementById('enable_vsd_m2');
    ratedRpmInputM2 = document.getElementById('rated_rpm_m2');
    polyCorrectionPanel = document.getElementById('poly-correction-panel');

    // SLHX
    slhxCheckbox = document.getElementById('enable_slhx_m2');
    slhxEffInput = document.getElementById('slhx_effectiveness_m2');

    // Compressor Model Selectors
    compressorBrandM2 = document.getElementById('compressor_brand_m2');
    compressorSeriesM2 = document.getElementById('compressor_series_m2');
    compressorModelM2 = document.getElementById('compressor_model_m2');
    modelDisplacementInfoM2 = document.getElementById('model_displacement_info_m2');
    modelDisplacementValueM2 = document.getElementById('model_displacement_value_m2');
    flowM3hM2 = document.getElementById('flow_m3h_m2');

    // Initialize compressor model selectors
    if (compressorBrandM2 && compressorSeriesM2 && compressorModelM2) {
        initCompressorModelSelectorsM2();
    }

    if (calcFormM2) {
        calcFormM2.addEventListener('submit', (e) => { e.preventDefault(); calculateMode2(); });
        
        calcFormM2.querySelectorAll('input, select').forEach(input => {
            input.addEventListener('input', setButtonStale2);
            input.addEventListener('change', setButtonStale2);
        });

        fluidSelectM2.addEventListener('change', () => updateFluidInfo(fluidSelectM2, fluidInfoDivM2, CP_INSTANCE));
        
        [tempEvapM2, tempCondM2, autoEffCheckboxM2].forEach(el => {
            if(el) el.addEventListener('change', updateAndDisplayEfficienciesM2);
        });

        if (vsdCheckboxM2) {
            vsdCheckboxM2.addEventListener('change', () => {
                const isVSD = vsdCheckboxM2.checked;
                const vsdInputs = document.getElementById('vsd-inputs-m2');
                if (vsdInputs) vsdInputs.classList.toggle('hidden', !isVSD);
                if (polyCorrectionPanel && AppState.currentMode === AppState.MODES.POLYNIAL) {
                    polyCorrectionPanel.classList.toggle('hidden', !isVSD);
                }
                setButtonStale2();
            });
        }

        document.querySelectorAll('input[name="model_select_m2"]').forEach(radio => {
            radio.addEventListener('change', () => {
                if (polyCorrectionPanel && vsdCheckboxM2.checked) {
                    polyCorrectionPanel.classList.toggle('hidden', radio.value !== 'polynomial');
                }
            });
        });

        if (printButtonM2) printButtonM2.addEventListener('click', printReportMode2);
    }
    console.log("Mode 2 (v7.4.4 Fix) initialized.");
}

function printReportMode2() {
    if (!lastCalculationData) return;
    const d = lastCalculationData;
    const resultDiv = document.querySelector('.print-results');
    let tableText = "\n\nState Points:\n----------------------------------------\nPoint\tT(C)\tP(bar)\th(kJ)\tm(kg/s)\n";
    d.statePoints.forEach(p => { tableText += `${p.name}\t${p.temp}\t${p.press}\t${p.enth}\t${p.flow}\n`; });
    resultDiv.innerText = `Full report generated at ${new Date().toLocaleString()}` + tableText;
    window.print();
}

export function triggerMode2EfficiencyUpdate() {
    if (autoEffCheckboxM2 && autoEffCheckboxM2.checked) updateAndDisplayEfficienciesM2();
}