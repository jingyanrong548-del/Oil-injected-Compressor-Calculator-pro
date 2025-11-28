// =====================================================================
// mode3_oil_gas.js: 模式二 (气体压缩) - UI 3.0 Cockpit Edition
// 职责: 执行气体压缩计算 -> 双向渲染 -> 更新移动端摘要栏
// =====================================================================

import { updateFluidInfo } from './coolprop_loader.js';
import { calculateEmpiricalEfficiencies } from './efficiency_models.js';
import { 
    createKpiCard, 
    createDetailRow, 
    createSectionHeader, 
    createErrorCard 
} from './components.js';

let CP_INSTANCE = null;
let lastCalculationData = null; 

// UI References
let calcButtonM3, calcFormM3, printButtonM3, fluidSelectM3, fluidInfoDivM3;
let resultsDesktopM3, resultsMobileM3, summaryMobileM3; // New UI Targets
let allInputsM3, tempDischargeActualM3;
let autoEffCheckboxM3, pressInM3, pressOutM3, etaVM3, etaIsoM3;

// Button States
const BTN_TEXT_CALCULATE = "Calculate Gas Compression";
const BTN_TEXT_RECALCULATE = "Recalculate (Input Changed)";

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

// 辅助函数：同时渲染内容到 PC 和 移动端容器
function renderToAllViews(htmlContent) {
    if(resultsDesktopM3) resultsDesktopM3.innerHTML = htmlContent;
    if(resultsMobileM3) resultsMobileM3.innerHTML = htmlContent;
}

// 辅助函数：更新移动端底部把手的摘要信息
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
        
        etaVM3.value = efficiencies.eta_v;
        const effType = document.querySelector('input[name="eff_type_m3"]:checked').value;
        if (effType === 'isothermal') {
            etaIsoM3.value = efficiencies.eta_iso;
        } else {
            etaIsoM3.value = efficiencies.eta_s;
        }
    } catch (e) {
        console.warn("Auto-Eff M3 Error:", e);
    }
}

// =====================================================================
// Core Calculation Logic
// =====================================================================
function calculateMode3() {
    // 1. Loading State
    const loadingHtml = '<div class="flex justify-center p-10"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>';
    renderToAllViews(loadingHtml);

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

            // Validation
            if (isNaN(Pe_bar) || isNaN(Pc_bar) || isNaN(Te_C) || isNaN(T_2a_actual_C) || isNaN(eta_v) || isNaN(eta_input)) 
                throw new Error("Invalid Input: Please check numeric fields.");
            if (Pc_bar <= Pe_bar) throw new Error("Discharge pressure must be higher than suction pressure.");
            if (T_2a_actual_C <= Te_C) throw new Error("Discharge temp must be higher than suction temp.");
            
            // Flow
            let V_th_m3_s, rpm_display = "-";
            if (flow_mode === 'rpm') {
                const rpm = parseFloat(document.getElementById('rpm_m3').value);
                const disp = parseFloat(document.getElementById('displacement_m3').value);
                V_th_m3_s = rpm * (disp / 1e6) / 60.0;
                rpm_display = `${rpm} RPM`;
            } else {
                const flow_m3h = parseFloat(document.getElementById('flow_m3h_m3').value);
                V_th_m3_s = flow_m3h / 3600.0;
            }

            const Pe_Pa = Pe_bar * 1e5;
            const Pc_Pa = Pc_bar * 1e5;
            const T_1_K = Te_C + 273.15;

            // State Points
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
            
            // Power & Efficiency Back-calc
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

            // Heat Balance
            const T_2a_act_K = T_2a_actual_C + 273.15;
            const h_2a_act = CP_INSTANCE.PropsSI('H', 'T', T_2a_act_K, 'P', Pc_Pa, fluid);
            const Q_gas_heat_W = m_dot_act * (h_2a_act - h_1);
            const Q_oil_W = W_shaft_W - Q_gas_heat_W;

            if (Q_oil_W < 0) throw new Error(`Negative Oil Load (${(Q_oil_W/1000).toFixed(2)} kW). Check efficiency or temps.`);

            // Cache for Print
            lastCalculationData = {
                fluid, Pe_bar, Pc_bar, m_dot: m_dot_act, 
                W_shaft_W, W_input_W, Q_gas_heat_W, Q_oil_W,
                eta_iso_shaft, eta_s_shaft, Te_C, T_2a_C: T_2a_actual_C
            };

            // --- 2. Render Dashboard ---
            const html = `
                <div class="grid grid-cols-2 gap-4 mb-6">
                    ${createKpiCard('轴功率 (Shaft)', (W_shaft_W/1000).toFixed(2), 'kW', `In: ${(W_input_W/1000).toFixed(2)}`, 'blue')}
                    ${createKpiCard('油冷负荷 (Oil)', (Q_oil_W/1000).toFixed(2), 'kW', 'Heat Removed', 'orange')}
                </div>

                <div class="space-y-1 bg-white/40 p-4 rounded-2xl border border-white/50 shadow-inner">
                    ${createSectionHeader('Flow & Pressure')}
                    ${createDetailRow('实际流量 (Mass)', `${m_dot_act.toFixed(4)} kg/s`)}
                    ${createDetailRow('吸气 (Inlet)', `${Pe_bar.toFixed(2)} bar / ${Te_C.toFixed(1)}°C`)}
                    ${createDetailRow('排气 (Discharge)', `${Pc_bar.toFixed(2)} bar / ${T_2a_actual_C.toFixed(1)}°C`)}
                    ${createDetailRow('压比 (PR)', (Pc_bar/Pe_bar).toFixed(2))}

                    ${createSectionHeader('Efficiencies (Shaft)')}
                    ${createDetailRow('等温效率 (η_iso)', eta_iso_shaft.toFixed(3), efficiency_type === 'isothermal')}
                    ${createDetailRow('等熵效率 (η_s)', eta_s_shaft.toFixed(3), efficiency_type === 'isentropic')}
                    ${createDetailRow('容积效率 (η_v)', eta_v.toFixed(3))}
                    
                    ${createSectionHeader('Work & Heat', '🔥')}
                    ${createDetailRow('理论等温功', `${(W_iso_W/1000).toFixed(2)} kW`)}
                    ${createDetailRow('气体温升吸热', `${(Q_gas_heat_W/1000).toFixed(2)} kW`)}
                </div>
            `;

            renderToAllViews(html);

            // --- 3. Update Mobile Summary ---
            // Display Shaft Power & The selected efficiency type
            const mainEffLabel = efficiency_type === 'isothermal' ? 'Iso-Eff' : 'Isen-Eff';
            const mainEffValue = efficiency_type === 'isothermal' ? eta_iso_shaft.toFixed(3) : eta_s_shaft.toFixed(3);
            
            updateMobileSummary(
                `${(W_shaft_W/1000).toFixed(1)} kW`, 
                mainEffLabel, 
                mainEffValue
            );

            setButtonFresh3();
            if(printButtonM3) {
                printButtonM3.disabled = false;
                printButtonM3.classList.remove('opacity-50', 'cursor-not-allowed');
            }

        } catch (error) {
            renderToAllViews(createErrorCard(error.message));
            console.error(error);
            if(printButtonM3) printButtonM3.disabled = true;
        }
    }, 50);
}

// Print
function printReportMode3() {
    if (!lastCalculationData) return;
    const d = lastCalculationData;
    const container = document.getElementById('print-container');
    const table = container.querySelector('.print-table');
    const resultDiv = container.querySelector('.print-results');

    table.innerHTML = '';
    const rows = [
        ['Mode', 'Gas Compression'],
        ['Fluid', d.fluid],
        ['Pin / Pout', `${d.Pe_bar.toFixed(2)} / ${d.Pc_bar.toFixed(2)} bar`],
        ['Mass Flow', `${d.m_dot.toFixed(4)} kg/s`],
        ['Shaft Power', `${(d.W_shaft_W/1000).toFixed(3)} kW`],
        ['Iso Eff', d.eta_iso_shaft.toFixed(3)],
        ['Isen Eff', d.eta_s_shaft.toFixed(3)]
    ];
    rows.forEach(r => table.innerHTML += `<tr class="border-b"><th class="py-2 text-left">${r[0]}</th><td class="py-2 font-mono">${r[1]}</td></tr>`);

    resultDiv.innerText = `Heat Balance:\nOil Load: ${(d.Q_oil_W/1000).toFixed(3)} kW\nGas Heat Gain: ${(d.Q_gas_heat_W/1000).toFixed(3)} kW`;
    window.print();
}

export function triggerMode3EfficiencyUpdate() {
    if (autoEffCheckboxM3 && autoEffCheckboxM3.checked) updateAndDisplayEfficienciesM3();
}

export function initMode3(CP) {
    CP_INSTANCE = CP;
    
    // UI Refs
    calcButtonM3 = document.getElementById('calc-button-mode-3');
    calcFormM3 = document.getElementById('calc-form-mode-3');
    printButtonM3 = document.getElementById('print-button-mode-3');
    fluidSelectM3 = document.getElementById('fluid_m3');
    fluidInfoDivM3 = document.getElementById('fluid-info-m3');
    tempDischargeActualM3 = document.getElementById('temp_discharge_actual_m3');
    
    // New UI Targets
    resultsDesktopM3 = document.getElementById('results-desktop-m3');
    resultsMobileM3 = document.getElementById('mobile-results-m3');
    summaryMobileM3 = document.getElementById('mobile-summary-m3');

    // Inputs
    autoEffCheckboxM3 = document.getElementById('auto-eff-m3');
    pressInM3 = document.getElementById('press_in_m3');
    pressOutM3 = document.getElementById('press_out_m3');
    etaVM3 = document.getElementById('eta_v_m3');
    etaIsoM3 = document.getElementById('eta_iso_m3');
    
    if (calcFormM3) {
        calcFormM3.addEventListener('submit', (e) => { e.preventDefault(); calculateMode3(); });
        
        const inputs = calcFormM3.querySelectorAll('input, select');
        inputs.forEach(input => {
            input.addEventListener('input', setButtonStale3);
            input.addEventListener('change', setButtonStale3);
        });

        fluidSelectM3.addEventListener('change', () => updateFluidInfo(fluidSelectM3, fluidInfoDivM3, CP_INSTANCE));

        // Auto Eff Listeners
        [pressInM3, pressOutM3, autoEffCheckboxM3].forEach(input => {
            if(input) input.addEventListener('change', updateAndDisplayEfficienciesM3);
        });
        
        document.querySelectorAll('input[name="eff_type_m3"]').forEach(r => {
            r.addEventListener('change', updateAndDisplayEfficienciesM3);
        });
        
        if (printButtonM3) printButtonM3.addEventListener('click', printReportMode3);
    }
    console.log("Mode 3 (Cockpit UI) initialized.");
}