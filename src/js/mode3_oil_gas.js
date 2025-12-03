// =====================================================================
// mode3_oil_gas.js: 模式二 (气体压缩) - v6.1 Fixed
// 职责: 气体压缩核心计算 + 后冷却器选型 + 严格单位审计
// =====================================================================

import { updateFluidInfo } from './coolprop_loader.js';
import { calculateEmpiricalEfficiencies } from './efficiency_models.js';
import { 
    createKpiCard, 
    createDetailRow, 
    createSectionHeader, 
    createErrorCard,
    createStateTable 
} from './components.js';
import { drawPHDiagram } from './charts.js';
import { HistoryDB, SessionState } from './storage.js';

let CP_INSTANCE = null;
let lastCalculationData = null; 

// UI References
let calcButtonM3, calcFormM3, printButtonM3, fluidSelectM3, fluidInfoDivM3;
let resultsDesktopM3, resultsMobileM3, summaryMobileM3;
let tempDischargeActualM3;
let autoEffCheckboxM3, pressInM3, pressOutM3, etaVM3, etaIsoM3;
// Aftercooler Inputs
let acCheckbox, acTempTargetInput, acDropInput;

// Button States
const BTN_TEXT_CALCULATE = "Calculate Gas Compression";
const BTN_TEXT_RECALCULATE = "Recalculate (Input Changed)";

// ---------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------

function setButtonStale3() {
    if (calcButtonM3 && calcButtonM3.innerText !== BTN_TEXT_RECALCULATE) {
        calcButtonM3.innerText = BTN_TEXT_RECALCULATE;
        calcButtonM3.classList.add('opacity-90', 'ring-2', 'ring-yellow-400', 'ring-offset-2');
        if(printButtonM3) {
            printButtonM3.disabled = true;
            printButtonM3.classList.add('opacity-50', 'cursor-not-allowed');
        }
    }
}

function setButtonFresh3() {
    if (calcButtonM3) {
        calcButtonM3.innerText = BTN_TEXT_CALCULATE;
        calcButtonM3.classList.remove('opacity-90', 'ring-2', 'ring-yellow-400', 'ring-offset-2');
    }
}

function renderToAllViews(htmlContent) {
    if(resultsDesktopM3) resultsDesktopM3.innerHTML = htmlContent;
    if(resultsMobileM3) resultsMobileM3.innerHTML = htmlContent;
}

function updateMobileSummary(powerValue, effLabel, effValue) {
    if (!summaryMobileM3) return;
    summaryMobileM3.innerHTML = `
        <div>
            <p class="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Shaft Power</p>
            <p class="text-xl font-bold text-gray-900">${powerValue}</p>
        </div>
        <div class="text-right">
            <p class="text-[10px] text-gray-500 uppercase tracking-wider font-bold">${effLabel}</p>
            <p class="text-xl font-bold text-pink-600">${effValue}</p>
        </div>
    `;
}

function updateAndDisplayEfficienciesM3() {
    if (!CP_INSTANCE || !autoEffCheckboxM3 || !autoEffCheckboxM3.checked) return;
    try {
        const Pe_bar = parseFloat(pressInM3.value);
        const Pc_bar = parseFloat(pressOutM3.value);
        if (isNaN(Pe_bar) || isNaN(Pc_bar) || Pc_bar <= Pe_bar) return;
        
        const pressureRatio = Pc_bar / Pe_bar;
        const efficiencies = calculateEmpiricalEfficiencies(pressureRatio);
        
        if (etaVM3) etaVM3.value = efficiencies.eta_v;
        
        const effTypeRadio = document.querySelector('input[name="eff_type_m3"]:checked');
        if (effTypeRadio && etaIsoM3) {
            if (effTypeRadio.value === 'isothermal') {
                etaIsoM3.value = efficiencies.eta_iso;
            } else {
                etaIsoM3.value = efficiencies.eta_s;
            }
        }
    } catch (e) {
        console.warn("Auto-Eff M3 Error:", e);
    }
}

// =====================================================================
// Core Calculation Logic (v6.0)
// =====================================================================
function calculateMode3() {
    renderToAllViews('<div class="flex justify-center p-10"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>');
    
    ['chart-desktop-m3', 'chart-mobile-m3'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.classList.add('hidden');
    });

    setTimeout(() => {
        try {
            // --- Input Reading ---
            const fluid = fluidSelectM3.value;
            const Pe_bar = parseFloat(document.getElementById('press_in_m3').value);
            const Te_C = parseFloat(document.getElementById('temp_in_m3').value);
            const Pc_bar = parseFloat(document.getElementById('press_out_m3').value);
            const T_2a_actual_C = parseFloat(tempDischargeActualM3.value);
            const flow_mode = document.querySelector('input[name="flow_mode_m3"]:checked').value;
            const eff_mode = document.querySelector('input[name="eff_mode_m3"]:checked').value; 
            const motor_eff = parseFloat(document.getElementById('motor_eff_m3').value);
            const efficiency_type = document.querySelector('input[name="eff_type_m3"]:checked').value;
            const eta_v = parseFloat(etaVM3.value);
            const eta_input = parseFloat(etaIsoM3.value);

            if (isNaN(Pe_bar) || isNaN(Pc_bar) || isNaN(Te_C) || isNaN(T_2a_actual_C) || isNaN(eta_v) || isNaN(eta_input)) 
                throw new Error("Invalid Input: Please check numeric fields.");
            if (Pc_bar <= Pe_bar) throw new Error("Discharge pressure must be higher than suction pressure.");
            
            // Flow Calculation
            let V_th_m3_s;
            if (flow_mode === 'rpm') {
                const rpm = parseFloat(document.getElementById('rpm_m3').value);
                const disp = parseFloat(document.getElementById('displacement_m3').value);
                V_th_m3_s = rpm * (disp / 1e6) / 60.0;
            } else {
                const flow_m3h = parseFloat(document.getElementById('flow_m3h_m3').value);
                V_th_m3_s = flow_m3h / 3600.0;
            }

            // --- Physics Calculation ---
            const Pe_Pa = Pe_bar * 1e5;
            const Pc_Pa = Pc_bar * 1e5;
            const T_1_K = Te_C + 273.15;

            const h_1 = CP_INSTANCE.PropsSI('H', 'T', T_1_K, 'P', Pe_Pa, fluid);
            const s_1 = CP_INSTANCE.PropsSI('S', 'T', T_1_K, 'P', Pe_Pa, fluid);
            const rho_1 = CP_INSTANCE.PropsSI('D', 'T', T_1_K, 'P', Pe_Pa, fluid);
            
            const V_act_m3_s = V_th_m3_s * eta_v;
            const m_dot_act = V_act_m3_s * rho_1;

            // Ideal Work
            const R_gas = CP_INSTANCE.PropsSI('GAS_CONSTANT', '', 0, '', 0, fluid) / CP_INSTANCE.PropsSI('MOLAR_MASS', '', 0, '', 0, fluid);
            const W_iso_W = m_dot_act * R_gas * T_1_K * Math.log(Pc_Pa / Pe_Pa);
            
            const h_2s = CP_INSTANCE.PropsSI('H', 'P', Pc_Pa, 'S', s_1, fluid);
            const Ws_W = m_dot_act * (h_2s - h_1);
            
            let W_shaft_W, eta_iso_shaft, eta_s_shaft;
            let input_shaft_efficiency = eta_input;
            if (eff_mode === 'input') input_shaft_efficiency = eta_input / motor_eff;

            if (efficiency_type === 'isothermal') {
                eta_iso_shaft = input_shaft_efficiency;
                W_shaft_W = W_iso_W / eta_iso_shaft;
                eta_s_shaft = Ws_W / W_shaft_W; 
            } else {
                eta_s_shaft = input_shaft_efficiency;
                W_shaft_W = Ws_W / eta_s_shaft;
                eta_iso_shaft = W_iso_W / W_shaft_W; 
            }
            
            const W_input_W = W_shaft_W / motor_eff;

            const T_2a_act_K = T_2a_actual_C + 273.15;
            const h_2a_act = CP_INSTANCE.PropsSI('H', 'T', T_2a_act_K, 'P', Pc_Pa, fluid);
            
            const Q_gas_heat_W = m_dot_act * (h_2a_act - h_1);
            const Q_oil_W = W_shaft_W - Q_gas_heat_W;

            if (Q_oil_W < 0) throw new Error(`Negative Oil Load (${(Q_oil_W/1000).toFixed(2)} kW).`);

            // --- Aftercooler Calculation ---
            const isAcEnabled = acCheckbox ? acCheckbox.checked : false;
            let Q_ac_W = 0;
            let h_3 = h_2a_act;
            let P_3_Pa = Pc_Pa;
            let ac_html = '';

            // Chart Points (Unit: kJ, bar)
            const point = (name, h_j, p_bar, pos) => ({ name, value: [h_j/1000, p_bar], label: { position: pos, show: true } });
            let mainPoints = [
                point('1', h_1, Pe_bar, 'bottom'),
                point('2', h_2a_act, Pc_bar, 'top')
            ];

            // State Table Data
            let statePoints = [
                { name: '1', desc: 'Inlet', temp: Te_C.toFixed(1), press: Pe_bar.toFixed(2), enth: (h_1/1000).toFixed(1), flow: m_dot_act.toFixed(4) },
                { name: '2', desc: 'Discharge', temp: T_2a_actual_C.toFixed(1), press: Pc_bar.toFixed(2), enth: (h_2a_act/1000).toFixed(1), flow: m_dot_act.toFixed(4) }
            ];

            if (isAcEnabled) {
                const T_ac_target_C = parseFloat(acTempTargetInput.value);
                const P_drop_bar = parseFloat(acDropInput.value);
                
                if (isNaN(T_ac_target_C) || isNaN(P_drop_bar)) throw new Error("Invalid Aftercooler Inputs.");
                
                const T_3_K = T_ac_target_C + 273.15;
                P_3_Pa = (Pc_bar - P_drop_bar) * 1e5;
                h_3 = CP_INSTANCE.PropsSI('H', 'T', T_3_K, 'P', P_3_Pa, fluid);
                Q_ac_W = m_dot_act * (h_2a_act - h_3);

                statePoints.push({
                    name: '3', desc: 'AC Out',
                    temp: T_ac_target_C.toFixed(1),
                    press: (P_3_Pa/1e5).toFixed(2),
                    enth: (h_3/1000).toFixed(1),
                    flow: m_dot_act.toFixed(4)
                });
                mainPoints.push(point('3', h_3, P_3_Pa/1e5, 'left'));

                ac_html = `
                    ${createSectionHeader('Post-Treatment (Aftercooler)', '❄️')}
                    ${createDetailRow('Heat Load', `${(Q_ac_W/1000).toFixed(2)} kW`)}
                    ${createDetailRow('Outlet Temp', `${T_ac_target_C.toFixed(1)} °C`)}
                    ${createDetailRow('Delivery Press', `${(P_3_Pa/1e5).toFixed(2)} bar`)}
                `;
            }

            // --- Visualization ---
            ['chart-desktop-m3', 'chart-mobile-m3'].forEach(id => {
                drawPHDiagram(id, {
                    title: `Compression Process (${fluid})`,
                    mainPoints: mainPoints,
                    xLabel: 'Enthalpy (kJ/kg)',
                    yLabel: 'Pressure (bar)'
                });
            });

            // --- Render Dashboard ---
            const html = `
                <div class="grid grid-cols-2 gap-4 mb-6">
                    ${createKpiCard('轴功率 (Shaft)', (W_shaft_W/1000).toFixed(2), 'kW', `In: ${(W_input_W/1000).toFixed(2)}`, 'blue')}
                    ${createKpiCard('油冷负荷 (Oil)', (Q_oil_W/1000).toFixed(2), 'kW', 'Heat Removed', 'orange')}
                </div>

                <div class="space-y-1 bg-white/40 p-4 rounded-2xl border border-white/50 shadow-inner">
                    ${createSectionHeader('Efficiencies (Shaft)')}
                    ${createDetailRow('等温效率 (η_iso)', eta_iso_shaft.toFixed(3), efficiency_type === 'isothermal')}
                    ${createDetailRow('等熵效率 (η_s)', eta_s_shaft.toFixed(3), efficiency_type === 'isentropic')}
                    ${createDetailRow('容积效率 (η_v)', eta_v.toFixed(3))}
                    
                    ${createSectionHeader('Work & Heat', '🔥')}
                    ${createDetailRow('理论等温功', `${(W_iso_W/1000).toFixed(2)} kW`)}
                    ${createDetailRow('气体温升吸热', `${(Q_gas_heat_W/1000).toFixed(2)} kW`)}

                    ${ac_html}

                    ${createSectionHeader('State Points Detail', '📊')}
                    ${createStateTable(statePoints)}
                </div>
            `;

            renderToAllViews(html);

            const mainEffLabel = efficiency_type === 'isothermal' ? 'Iso-Eff' : 'Isen-Eff';
            const mainEffValue = efficiency_type === 'isothermal' ? eta_iso_shaft.toFixed(3) : eta_s_shaft.toFixed(3);
            updateMobileSummary(`${(W_shaft_W/1000).toFixed(1)} kW`, mainEffLabel, mainEffValue);

            setButtonFresh3();
            if(printButtonM3) printButtonM3.disabled = false;

            lastCalculationData = { fluid, statePoints, W_shaft_W, eta_iso_shaft, eta_s_shaft, Q_oil_W, Q_ac_W };
            
            const inputState = SessionState.collectInputs('calc-form-mode-3');
            HistoryDB.add('M3', `${fluid} • ${(W_shaft_W/1000).toFixed(1)} kW`, inputState, { 'Power': `${(W_shaft_W/1000).toFixed(2)} kW` });

        } catch (error) {
            renderToAllViews(createErrorCard(error.message));
            console.error(error);
            if(printButtonM3) printButtonM3.disabled = true;
        }
    }, 50);
}

function printReportMode3() {
    if (!lastCalculationData) return;
    const d = lastCalculationData;
    const resultDiv = document.querySelector('.print-results');
    let tableText = "\n\nState Points:\n--------------------\nPoint\tT(C)\tP(bar)\th(kJ)\tm(kg/s)\n";
    d.statePoints.forEach(p => { tableText += `${p.name}\t${p.temp}\t${p.press}\t${p.enth}\t${p.flow}\n`; });
    resultDiv.innerText = `Gas Compression Report:\nOil Load: ${(d.Q_oil_W/1000).toFixed(3)} kW` + tableText;
    window.print();
}

export function triggerMode3EfficiencyUpdate() {
    if (autoEffCheckboxM3 && autoEffCheckboxM3.checked) updateAndDisplayEfficienciesM3();
}

export function initMode3(CP) {
    CP_INSTANCE = CP;
    
    calcButtonM3 = document.getElementById('calc-button-mode-3');
    calcFormM3 = document.getElementById('calc-form-mode-3');
    printButtonM3 = document.getElementById('print-button-mode-3');
    fluidSelectM3 = document.getElementById('fluid_m3');
    fluidInfoDivM3 = document.getElementById('fluid-info-m3');
    tempDischargeActualM3 = document.getElementById('temp_discharge_actual_m3');
    resultsDesktopM3 = document.getElementById('results-desktop-m3');
    resultsMobileM3 = document.getElementById('mobile-results-m3');
    summaryMobileM3 = document.getElementById('mobile-summary-m3');
    autoEffCheckboxM3 = document.getElementById('auto-eff-m3');
    pressInM3 = document.getElementById('press_in_m3');
    pressOutM3 = document.getElementById('press_out_m3');
    etaVM3 = document.getElementById('eta_v_m3');
    etaIsoM3 = document.getElementById('eta_iso_m3');
    
    // [New] AC References (Matched with index.html v6.1)
    acCheckbox = document.getElementById('enable_aftercooler_m3');
    acTempTargetInput = document.getElementById('temp_aftercooler_target_m3');
    acDropInput = document.getElementById('press_drop_aftercooler_m3');

    if (calcFormM3) {
        calcFormM3.addEventListener('submit', (e) => { e.preventDefault(); calculateMode3(); });
        
        const inputs = calcFormM3.querySelectorAll('input, select');
        inputs.forEach(input => {
            input.addEventListener('input', setButtonStale3);
            input.addEventListener('change', setButtonStale3);
        });

        fluidSelectM3.addEventListener('change', () => updateFluidInfo(fluidSelectM3, fluidInfoDivM3, CP_INSTANCE));

        [pressInM3, pressOutM3, autoEffCheckboxM3].forEach(input => {
            if(input) input.addEventListener('change', updateAndDisplayEfficienciesM3);
        });
        
        // AC Toggle Logic
        if (acCheckbox) {
            acCheckbox.addEventListener('change', () => {
                const settings = document.getElementById('ac-settings-m3');
                const placeholder = document.getElementById('ac-placeholder-m3');
                if (settings) settings.classList.toggle('hidden', !acCheckbox.checked);
                if (placeholder) placeholder.classList.toggle('hidden', acCheckbox.checked);
                setButtonStale3();
            });
        }
        
        document.querySelectorAll('input[name="eff_type_m3"]').forEach(r => {
            r.addEventListener('change', updateAndDisplayEfficienciesM3);
        });
        
        if (printButtonM3) printButtonM3.addEventListener('click', printReportMode3);
    }
    console.log("Mode 3 (Clean JS) initialized.");
}