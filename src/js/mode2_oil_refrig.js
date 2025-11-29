// =====================================================================
// mode2_oil_refrig.js: 模式一 (制冷热泵) - v3.8 ECO Matrix Edition
// 职责: 核心计算 -> 影子计算(基准对比) -> 生成效益矩阵 -> 双向渲染
// =====================================================================

import { updateFluidInfo } from './coolprop_loader.js';
import { calculateEmpiricalEfficiencies } from './efficiency_models.js';
import { 
    createKpiCard, 
    createDetailRow, 
    createSectionHeader, 
    createErrorCard,
    createStateTable,
    createEcoImpactGrid // [New] 引入矩阵组件
} from './components.js';
import { drawPHDiagram } from './charts.js';
import { HistoryDB, SessionState } from './storage.js';

let CP_INSTANCE = null;
let lastCalculationData = null; 

// UI References
let calcButtonM2, calcFormM2, printButtonM2, fluidSelectM2, fluidInfoDivM2;
let resultsDesktopM2, resultsMobileM2, summaryMobileM2;
let autoEffCheckboxM2, tempEvapM2, tempCondM2, etaVM2, etaSM2;
let ecoCheckbox, ecoSatTempInput, ecoSuperheatInput, tempDischargeActualM2;

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
// Core Calculation Logic
// ---------------------------------------------------------------------
function calculateMode2() {
    // 1. Loading State
    renderToAllViews('<div class="flex justify-center p-10"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div></div>');
    ['chart-desktop-m2', 'chart-mobile-m2'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.classList.add('hidden');
    });
    
    setTimeout(() => {
        try {
            // --- Input Reading ---
            const fluid = fluidSelectM2.value;
            const Te_C = parseFloat(document.getElementById('temp_evap_m2').value);
            const Tc_C = parseFloat(document.getElementById('temp_cond_m2').value);
            const superheat_K = parseFloat(document.getElementById('superheat_m2').value);
            const subcooling_K = parseFloat(document.getElementById('subcooling_m2').value);
            const T_2a_est_C = parseFloat(tempDischargeActualM2.value);
            const flow_mode = document.querySelector('input[name="flow_mode_m2"]:checked').value;
            const eff_mode = document.querySelector('input[name="eff_mode_m2"]:checked').value;
            const motor_eff = parseFloat(document.getElementById('motor_eff_m2').value);
            const eta_v = parseFloat(etaVM2.value);
            const eta_s_input = parseFloat(etaSM2.value);

            const isEcoEnabled = ecoCheckbox.checked;
            const ecoType = document.querySelector('input[name="eco_type_m2"]:checked').value; 
            const ecoPressMode = document.querySelector('input[name="eco_press_mode_m2"]:checked').value; 
            const eco_superheat_K = parseFloat(document.getElementById('eco_superheat_m2').value);

            if (T_2a_est_C <= Tc_C) throw new Error("Discharge temp must be higher than Condensing temp.");
            if (isNaN(Te_C) || isNaN(eta_v)) throw new Error("Invalid numeric input.");

            // --- Calculation (CoolProp) ---
            const T_evap_K = Te_C + 273.15;
            const T_cond_K = Tc_C + 273.15;
            const Pe_Pa = CP_INSTANCE.PropsSI('P', 'T', T_evap_K, 'Q', 1, fluid);
            const Pc_Pa = CP_INSTANCE.PropsSI('P', 'T', T_cond_K, 'Q', 1, fluid);

            const T_1_K = T_evap_K + superheat_K;
            const h_1 = CP_INSTANCE.PropsSI('H', 'T', T_1_K, 'P', Pe_Pa, fluid);
            const s_1 = CP_INSTANCE.PropsSI('S', 'T', T_1_K, 'P', Pe_Pa, fluid);
            const rho_1 = CP_INSTANCE.PropsSI('D', 'T', T_1_K, 'P', Pe_Pa, fluid);
            
            const T_3_K = T_cond_K - subcooling_K;
            const h_3 = CP_INSTANCE.PropsSI('H', 'T', T_3_K, 'P', Pc_Pa, fluid); 

            let V_th_m3_s, rpm_display = "-";
            if (flow_mode === 'rpm') {
                const rpm = parseFloat(document.getElementById('rpm_m2').value);
                const disp = parseFloat(document.getElementById('displacement_m2').value);
                V_th_m3_s = rpm * (disp / 1e6) / 60.0;
                rpm_display = `${rpm} RPM`;
            } else {
                const flow_m3h = parseFloat(document.getElementById('flow_m3h_m2').value);
                V_th_m3_s = flow_m3h / 3600.0;
            }
            const V_act_m3_s = V_th_m3_s * eta_v;
            const m_dot_suc = V_act_m3_s * rho_1;

            // --- ECO Calculation & 7-Point Analysis ---
            let m_dot_inj = 0, m_dot_total = m_dot_suc;
            let P_eco_Pa = 0, T_eco_sat_K = 0;
            
            // Safe Init
            let h_4 = 0, h_5 = 0, h_6 = 0, h_7 = 0;
            let m_p5 = 0, m_p6 = 0, m_p7 = 0; 
            
            h_5 = h_3; h_4 = h_3; 
            
            // Visualization Arrays
            let mainPoints = [], ecoLiquidPoints = [], ecoVaporPoints = [];  
            const point = (name, h, p_pa, pos='top') => ({ name, value: [h/1000, p_pa/1e5], label: { position: pos, show: true } });
            const rawP = (h, p_pa) => [h/1000, p_pa/1e5];

            if (isEcoEnabled) {
                if (ecoPressMode === 'auto') {
                    P_eco_Pa = Math.sqrt(Pe_Pa * Pc_Pa);
                    T_eco_sat_K = CP_INSTANCE.PropsSI('T', 'P', P_eco_Pa, 'Q', 0, fluid);
                } else {
                    const T_eco_sat_C_Input = parseFloat(ecoSatTempInput.value);
                    T_eco_sat_K = T_eco_sat_C_Input + 273.15;
                    P_eco_Pa = CP_INSTANCE.PropsSI('P', 'T', T_eco_sat_K, 'Q', 0.5, fluid);
                }

                const h_eco_sat_liq = CP_INSTANCE.PropsSI('H', 'T', T_eco_sat_K, 'Q', 0, fluid);
                const h_eco_sat_vap = CP_INSTANCE.PropsSI('H', 'T', T_eco_sat_K, 'Q', 1, fluid);
                h_7 = h_3; 

                if (ecoType === 'flash_tank') {
                    h_6 = h_eco_sat_vap; 
                    h_5 = h_eco_sat_liq; 
                    const x_flash = (h_7 - h_5) / (h_6 - h_5);
                    m_dot_inj = m_dot_suc * (x_flash / (1 - x_flash));
                    m_dot_total = m_dot_suc + m_dot_inj;
                    h_4 = h_5; 
                    m_p7 = m_dot_total; m_p5 = m_dot_suc; m_p6 = m_dot_inj;   

                    const pt3 = point('3', h_3, Pc_Pa, 'top');
                    const pt7 = point('7', h_7, P_eco_Pa, 'right');
                    const pt5 = point('5', h_5, P_eco_Pa, 'bottom');
                    const pt6 = point('6', h_6, P_eco_Pa, 'left');
                    const pt4 = point('4', h_4, Pe_Pa, 'bottom');
                    const pt1 = point('1', h_1, Pe_Pa, 'bottom');

                    mainPoints = [pt4, pt1]; 
                    ecoLiquidPoints = [rawP(h_3, Pc_Pa), pt7, pt5, pt4]; 
                    ecoVaporPoints = [rawP(h_7, P_eco_Pa), pt6];

                } else {
                    const T_inj_K = T_eco_sat_K + eco_superheat_K;
                    h_6 = CP_INSTANCE.PropsSI('H', 'T', T_inj_K, 'P', P_eco_Pa, fluid); 
                    const T_5_K = T_eco_sat_K + 5.0;
                    h_5 = CP_INSTANCE.PropsSI('H', 'T', T_5_K, 'P', Pc_Pa, fluid); 
                    h_4 = h_5; 
                    m_dot_inj = (m_dot_suc * (h_3 - h_5)) / (h_6 - h_7);
                    m_dot_total = m_dot_suc + m_dot_inj; 
                    m_p5 = m_dot_suc; m_p7 = m_dot_inj; m_p6 = m_dot_inj; 

                    const pt3 = point('3', h_3, Pc_Pa, 'top');
                    const pt5 = point('5', h_5, Pc_Pa, 'top');
                    const pt4 = point('4', h_4, Pe_Pa, 'bottom');
                    const pt7 = point('7', h_7, P_eco_Pa, 'right');
                    const pt6 = point('6', h_6, P_eco_Pa, 'left');
                    const pt1 = point('1', h_1, Pe_Pa, 'bottom');

                    mainPoints = [pt4, pt1]; 
                    ecoLiquidPoints = [pt3, pt5, pt4]; 
                    ecoVaporPoints = [rawP(h_3, Pc_Pa), pt7, pt6];  
                }
            } else {
                h_4 = h_3;
                m_dot_total = m_dot_suc;
                const pt1 = point('1', h_1, Pe_Pa, 'bottom');
                const pt3 = point('3', h_3, Pc_Pa, 'top');
                const pt4 = point('4', h_4, Pe_Pa, 'bottom');
                mainPoints = [pt1]; 
                ecoLiquidPoints = [pt3, pt4]; 
                ecoVaporPoints = [];
            }

            // Calc Cooling
            const Q_evap_W = m_dot_suc * (h_1 - h_4);

            // Power
            let W_ideal_W = 0;
            if (!isEcoEnabled) {
                const h_2s = CP_INSTANCE.PropsSI('H', 'P', Pc_Pa, 'S', s_1, fluid);
                W_ideal_W = m_dot_suc * (h_2s - h_1);
            } else {
                const h_mid_1s = CP_INSTANCE.PropsSI('H', 'P', P_eco_Pa, 'S', s_1, fluid);
                const W_s1 = m_dot_suc * (h_mid_1s - h_1);
                const h_mix_s = (m_dot_suc * h_mid_1s + m_dot_inj * h_6) / m_dot_total;
                const s_mix = CP_INSTANCE.PropsSI('S', 'H', h_mix_s, 'P', P_eco_Pa, fluid);
                const h_2s_stage2 = CP_INSTANCE.PropsSI('H', 'P', Pc_Pa, 'S', s_mix, fluid);
                const W_s2 = m_dot_total * (h_2s_stage2 - h_mix_s);
                W_ideal_W = W_s1 + W_s2;
            }

            let W_shaft_W, W_input_W, eta_total_display;
            if (eff_mode === 'shaft') {
                W_shaft_W = W_ideal_W / eta_s_input;
                W_input_W = W_shaft_W / motor_eff;
                eta_total_display = W_ideal_W / W_input_W;
            } else {
                W_input_W = W_ideal_W / eta_s_input;
                W_shaft_W = W_input_W * motor_eff;
                eta_total_display = eta_s_input;
            }

            // Heat Balance
            const h_system_in = (m_dot_suc * h_1 + m_dot_inj * h_6); 
            const T_2a_est_K = T_2a_est_C + 273.15;
            const h_2a_target = CP_INSTANCE.PropsSI('H', 'T', T_2a_est_K, 'P', Pc_Pa, fluid);
            const energy_out_gas = m_dot_total * h_2a_target;
            
            let Q_oil_W = W_shaft_W - (energy_out_gas - h_system_in);
            let T_2a_final_C = T_2a_est_C;
            let isAdishargeCorrection = false;

            if (Q_oil_W < 0) {
                Q_oil_W = 0;
                const h_2a_real = (h_system_in + W_shaft_W) / m_dot_total;
                const T_2a_real_K = CP_INSTANCE.PropsSI('T', 'P', Pc_Pa, 'H', h_2a_real, fluid);
                T_2a_final_C = T_2a_real_K - 273.15;
                isAdishargeCorrection = true;
            }
            const h_2a_final = (h_system_in + W_shaft_W - Q_oil_W) / m_dot_total;
            const Q_cond_W = m_dot_total * (h_2a_final - h_3);
            const Q_heating_total_W = Q_cond_W + Q_oil_W;

            const COP_R = Q_evap_W / W_input_W;
            const COP_H = Q_heating_total_W / W_input_W;

            // --- Shadow Calculation (Baseline Analysis) ---
            let ecoGridHtml = '';
            if (isEcoEnabled) {
                // 1. Base Cooling (h4_base = h3)
                const Q_c0 = m_dot_suc * (h_1 - h_3);
                
                // 2. Base Power (Single Stage)
                const h_2s_base = CP_INSTANCE.PropsSI('H', 'P', Pc_Pa, 'S', s_1, fluid);
                const W_ideal0 = m_dot_suc * (h_2s_base - h_1);
                
                let W_in0 = 0, W_shaft0 = 0;
                if (eff_mode === 'shaft') {
                    // Use same eta_s input for baseline
                    W_shaft0 = W_ideal0 / eta_s_input;
                    W_in0 = W_shaft0 / motor_eff;
                } else {
                    W_in0 = W_ideal0 / eta_s_input; // eta_s_input is total eff
                    W_shaft0 = W_in0 * motor_eff;
                }

                // 3. Base Heating (Q_c0 + W_shaft0 - Q_oil?) 
                // Approx Heat = Q_c0 + W_shaft0. (Assume similar oil load or ignore)
                // Better: Q_h0 = Q_c0 + W_shaft0.
                const Q_h0 = Q_c0 + W_shaft0;

                // 4. Base COPs
                const COP_c0 = Q_c0 / W_in0;
                const COP_h0 = Q_h0 / W_in0;

                // 5. Diff Helper
                const getDiff = (curr, base) => ((curr - base) / base) * 100;

                const ecoData = {
                    Qc: { val: (Q_evap_W/1000).toFixed(2), diff: getDiff(Q_evap_W, Q_c0) },
                    Qh: { val: (Q_heating_total_W/1000).toFixed(2), diff: getDiff(Q_heating_total_W, Q_h0) },
                    COPc: { val: COP_R.toFixed(2), diff: getDiff(COP_R, COP_c0) },
                    COPh: { val: COP_H.toFixed(2), diff: getDiff(COP_H, COP_h0) }
                };

                ecoGridHtml = createEcoImpactGrid(ecoData);
            }

            // --- Chart Finalization ---
            const pt2 = point('2', h_2a_final, Pc_Pa, 'top');
            const pt3 = point('3', h_3, Pc_Pa, 'top');
            const pt4 = point('4', h_4, Pe_Pa, 'bottom');
            const pt1 = point('1', h_1, Pe_Pa, 'bottom');

            if (!isEcoEnabled) {
                mainPoints = [pt1, pt2, pt3, pt4, pt1];
            } else {
                if (ecoType === 'flash_tank') {
                    mainPoints.push(pt2, pt3);
                } else {
                    const pt5 = point('5', h_5, Pc_Pa, 'top');
                    mainPoints = [pt4, pt1, pt2, pt3, pt5, pt4];
                }
            }

            // Draw
            ['chart-desktop-m2', 'chart-mobile-m2'].forEach(id => {
                drawPHDiagram(id, {
                    title: `P-h Diagram (${fluid})`,
                    mainPoints, ecoLiquidPoints, ecoVaporPoints,
                    xLabel: 'Enthalpy (kJ/kg)', yLabel: 'Pressure (bar)'
                });
            });

            // Table Data
            let T_7_disp = '-', T_5_disp = '-';
            if (isEcoEnabled) {
                T_7_disp = (T_eco_sat_K - 273.15).toFixed(1);
                if (ecoType === 'flash_tank') {
                    T_5_disp = (T_eco_sat_K - 273.15).toFixed(1);
                } else {
                    const T_5_K = T_eco_sat_K + 5.0; 
                    T_5_disp = (T_5_K - 273.15).toFixed(1);
                }
            }
            const T_4_disp = Te_C.toFixed(1);

            const statePoints = [
                { name: '1', desc: 'Suction', temp: Te_C.toFixed(1), press: (Pe_Pa/1e5).toFixed(2), enth: (h_1/1000).toFixed(1), flow: m_dot_suc.toFixed(3) },
                { name: '2', desc: 'Discharge', temp: T_2a_final_C.toFixed(1), press: (Pc_Pa/1e5).toFixed(2), enth: (h_2a_final/1000).toFixed(1), flow: m_dot_total.toFixed(3) },
                { name: '3', desc: 'Cond Out', temp: (T_3_K-273.15).toFixed(1), press: (Pc_Pa/1e5).toFixed(2), enth: (h_3/1000).toFixed(1), flow: m_dot_total.toFixed(3) },
            ];

            if (isEcoEnabled) {
                statePoints.push(
                    { name: '7', desc: 'ECO In', temp: T_7_disp, press: (P_eco_Pa/1e5).toFixed(2), enth: (h_7/1000).toFixed(1), flow: m_p7.toFixed(3) },
                    { name: '6', desc: 'ECO Vap', temp: (isEcoEnabled && ecoType==='flash_tank' ? (T_eco_sat_K-273.15).toFixed(1) : '-'), press: (P_eco_Pa/1e5).toFixed(2), enth: (h_6/1000).toFixed(1), flow: m_p6.toFixed(3) },
                    { name: '5', desc: 'ECO Liq', temp: T_5_disp, press: (ecoType==='subcooler' ? (Pc_Pa/1e5).toFixed(2) : (P_eco_Pa/1e5).toFixed(2)), enth: (h_5/1000).toFixed(1), flow: m_p5.toFixed(3) }
                );
            }
            
            statePoints.push(
                { name: '4', desc: 'Evap In', temp: T_4_disp, press: (Pe_Pa/1e5).toFixed(2), enth: (h_4/1000).toFixed(1), flow: m_dot_suc.toFixed(3) }
            );

            statePoints.sort((a, b) => parseInt(a.name) - parseInt(b.name));

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
                    
                    ${isEcoEnabled ? `
                        ${createSectionHeader('Economizer Benefit', '⚡')}
                        ${createDetailRow('P_eco', `${(P_eco_Pa/1e5).toFixed(2)} bar`)}
                        ${ecoGridHtml}
                    ` : ''}

                    ${createSectionHeader('7-Point Analysis (Flow)', '📊')}
                    ${createStateTable(statePoints)}
                </div>
            `;

            renderToAllViews(html);
            updateMobileSummary('Cooling', `${(Q_evap_W/1000).toFixed(1)} kW`, 'COP', COP_R.toFixed(2));
            setButtonFresh2();
            if(printButtonM2) printButtonM2.disabled = false;

            lastCalculationData = { fluid, statePoints, COP_R, COP_H, Q_evap_W, Q_cond_W, Q_oil_W };

            // Auto Save
            const inputState = SessionState.collectInputs('calc-form-mode-2');
            const historyTitle = `${fluid} • ${(Q_evap_W/1000).toFixed(1)} kW`;
            const historySummary = { 'COP': COP_R.toFixed(2), 'Power': `${(W_input_W/1000).toFixed(1)} kW` };
            HistoryDB.add('M2', historyTitle, inputState, historySummary);

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
        if (printButtonM2) printButtonM2.addEventListener('click', printReportMode2);
    }
    console.log("Mode 2 (ECO Matrix) initialized.");
}

function printReportMode2() {
    if (!lastCalculationData) return;
    const d = lastCalculationData;
    const resultDiv = document.querySelector('.print-results');
    let tableText = "\n\n7-Point Analysis:\n----------------------------------------\nPoint\tT(C)\tP(bar)\th(kJ)\tm(kg/s)\n";
    d.statePoints.forEach(p => { tableText += `${p.name}\t${p.temp}\t${p.press}\t${p.enth}\t${p.flow}\n`; });
    resultDiv.innerText = `Full report generated at ${new Date().toLocaleString()}` + tableText;
    window.print();
}
export function triggerMode2EfficiencyUpdate() {
    if (autoEffCheckboxM2 && autoEffCheckboxM2.checked) updateAndDisplayEfficienciesM2();
}