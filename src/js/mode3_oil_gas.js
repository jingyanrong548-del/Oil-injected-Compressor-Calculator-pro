// =====================================================================
// mode3_oil_gas.js: 模式三 (气体压缩) - v7.1 Final
// 职责: 气体压缩核心计算 + 通用湿度(RH/PDP/PPM) + 冷凝计算 + VSD + UI修复
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
import { AppState } from './state.js';
import { openMobileSheet } from './ui.js'; 

let CP_INSTANCE = null;
let lastCalculationData = null; 

// UI References
let calcButtonM3, calcFormM3, printButtonM3, fluidSelectM3, fluidInfoDivM3;
let resultsDesktopM3, resultsMobileM3, summaryMobileM3;
let tempDischargeActualM3;
let autoEffCheckboxM3, pressInM3, pressOutM3, etaVM3, etaIsoM3;
// AC Inputs
let acCheckbox, acTempTargetInput, acDropInput;
// Wet Gas & VSD Inputs
let moistureTypeInput, moistureValInput, condensateOutput;
let vsdCheckbox, ratedRpmInput;

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

/**
 * [v7.1 New] 通用湿度转换器：将各类输入转换为水蒸气分压 (P_vap)
 * @param {string} type - 'rh', 'pdp', 'ppmw', 'ppmv'
 * @param {number} value - 用户输入值
 * @param {number} P_total_Pa - 总压力 (Pa)
 * @param {number} T_K - 气体温度 (K)
 * @param {string} fluid - 干气介质名称 (用于计算摩尔质量)
 * @returns {number} P_vap (Pa)
 */
function calculateVaporPressure(type, value, P_total_Pa, T_K, fluid) {
    if (value <= 0) return 0;

    // 1. 饱和蒸汽压 (当前温度)
    const P_sat_T = CP_INSTANCE.PropsSI('P', 'T', T_K, 'Q', 1, 'Water');

    switch (type) {
        case 'rh': // 相对湿度 %
            return (value / 100) * P_sat_T;

        case 'pdp': // 压力露点 °C
            // 计算露点对应的饱和压力
            const T_dp_K = value + 273.15;
            // 露点不能高于当前干球温度（否则已经是液态了）
            if (T_dp_K > T_K) {
                console.warn("PDP > T_gas, assuming saturation.");
                return P_sat_T; 
            }
            return CP_INSTANCE.PropsSI('P', 'T', T_dp_K, 'Q', 1, 'Water');

        case 'ppmv': // 体积/摩尔比 (Parts Per Million Volume) -> 摩尔分数
            // P_partial = y_i * P_total
            return (value / 1e6) * P_total_Pa;

        case 'ppmw': // 质量比 (Parts Per Million Weight) -> mg/kg
            // 需要摩尔质量换算: y_w = (m_w / M_w) / [ (m_w / M_w) + (m_g / M_g) ]
            const M_w = 18.01528; // Water kg/kmol (approx)
            let M_g = 28.96;      // Default Air
            try {
                // CoolProp Molar Mass returns kg/mol, convert to kg/kmol
                M_g = CP_INSTANCE.PropsSI('MOLAR_MASS', '', 0, '', 0, fluid) * 1000; 
            } catch(e) { console.warn("Molar Mass lookup failed, using Air default"); }

            const n_w = value / M_w;
            const n_g = (1e6 - value) / M_g;
            const y_w = n_w / (n_w + n_g); // Mole fraction
            
            return y_w * P_total_Pa;

        default:
            return 0;
    }
}

// =====================================================================
// Core Calculation Logic (v7.1 Wet Gas & Condensation)
// =====================================================================
function calculateMode3() {
    renderToAllViews('<div class="flex justify-center p-10"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>');
    
    ['chart-desktop-m3', 'chart-mobile-m3'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.classList.add('hidden');
    });

    setTimeout(() => {
        try {
            // --- 1. Input Reading ---
            const fluid = fluidSelectM3.value;
            const Pe_bar = parseFloat(pressInM3.value);
            const Te_C = parseFloat(document.getElementById('temp_in_m3').value);
            const Pc_bar = parseFloat(pressOutM3.value);
            const T_2a_actual_C = parseFloat(tempDischargeActualM3.value);
            
            const flow_mode = document.querySelector('input[name="flow_mode_m3"]:checked').value;
            const eff_mode = document.querySelector('input[name="eff_mode_m3"]:checked').value; 
            const motor_eff = parseFloat(document.getElementById('motor_eff_m3').value);
            const efficiency_type = document.querySelector('input[name="eff_type_m3"]:checked').value;
            const eta_v = parseFloat(etaVM3.value);
            const eta_input = parseFloat(etaIsoM3.value);
            
            // [v7.1] Universal Moisture Inputs
            const moistType = moistureTypeInput.value;
            const moistVal = parseFloat(moistureValInput.value) || 0;
            
            // [v7.0] VSD Inputs
            const isVsdEnabled = vsdCheckbox.checked;
            const ratedRpm = parseFloat(ratedRpmInput.value) || 2900;

            if (isNaN(Pe_bar) || isNaN(Pc_bar) || isNaN(Te_C) || isNaN(T_2a_actual_C) || isNaN(eta_v) || isNaN(eta_input)) 
                throw new Error("Invalid Input: Please check numeric fields.");
            if (Pc_bar <= Pe_bar) throw new Error("Discharge pressure must be higher than suction pressure.");
            
            // --- 2. Flow Calculation (Geometry) ---
            let currentRpm = 2900;
            let V_th_m3_s;
            
            if (flow_mode === 'rpm') {
                currentRpm = parseFloat(document.getElementById('rpm_m3').value);
                const disp = parseFloat(document.getElementById('displacement_m3').value);
                V_th_m3_s = currentRpm * (disp / 1e6) / 60.0;
            } else {
                const flow_m3h = parseFloat(document.getElementById('flow_m3h_m3').value);
                V_th_m3_s = flow_m3h / 3600.0;
            }

            const rpmRatio = isVsdEnabled ? (currentRpm / ratedRpm) : 1.0;
            
            // --- 3. Physics Calculation (Wet Gas Model) ---
            const Pe_Pa = Pe_bar * 1e5;
            const Pc_Pa = Pc_bar * 1e5;
            const T_1_K = Te_C + 273.15;

            // [v7.1 Universal Moisture Logic]
            let P_dry_Pa = Pe_Pa;
            let P_vap_Pa = 0;
            let rho_mix = 0;
            let m_dot_total = 0, m_dot_dry = 0, m_dot_vap = 0;
            let h_1_mix = 0;

            // 3.1 Inlet State Calculation
            if (moistVal > 0 && fluid !== 'Water') {
                // Call universal converter
                P_vap_Pa = calculateVaporPressure(moistType, moistVal, Pe_Pa, T_1_K, fluid);
                
                // Physics Check: Partial pressure validity
                if (P_vap_Pa >= Pe_Pa * 0.99) throw new Error(`Invalid Moisture: Vapor pressure too high. Is gas saturated?`);
                
                // Physics Check: Saturation check at inlet
                const P_sat_inlet = CP_INSTANCE.PropsSI('P', 'T', T_1_K, 'Q', 1, 'Water');
                if (P_vap_Pa > P_sat_inlet) {
                    console.warn("Input moisture exceeds saturation, clamping to 100% RH.");
                    P_vap_Pa = P_sat_inlet;
                }

                P_dry_Pa = Pe_Pa - P_vap_Pa;

                // Density Calculation (Amagat's Law / Dalton)
                // rho_mix = rho_dry_part + rho_vap_part (partial densities)
                const rho_dry = CP_INSTANCE.PropsSI('D', 'T', T_1_K, 'P', P_dry_Pa, fluid);
                // Vapor density at partial pressure
                const rho_vap = CP_INSTANCE.PropsSI('D', 'T', T_1_K, 'P', P_vap_Pa, 'Water');
                rho_mix = rho_dry + rho_vap;
                
                // Enthalpy (Mass Weighted)
                const h_dry = CP_INSTANCE.PropsSI('H', 'T', T_1_K, 'P', P_dry_Pa, fluid);
                const h_vap = CP_INSTANCE.PropsSI('H', 'T', T_1_K, 'P', P_vap_Pa, 'Water');
                
                const mass_frac_dry = rho_dry / rho_mix;
                const mass_frac_vap = rho_vap / rho_mix;
                h_1_mix = mass_frac_dry * h_dry + mass_frac_vap * h_vap;

            } else {
                // Dry Gas or Pure Steam
                P_dry_Pa = Pe_Pa;
                rho_mix = CP_INSTANCE.PropsSI('D', 'T', T_1_K, 'P', Pe_Pa, fluid);
                h_1_mix = CP_INSTANCE.PropsSI('H', 'T', T_1_K, 'P', Pe_Pa, fluid);
            }

            // Mass Flow Calculation
            const V_act_m3_s = V_th_m3_s * eta_v;
            m_dot_total = V_act_m3_s * rho_mix;
            
            // Calculate component mass flows for downstream use
            if (P_vap_Pa > 0) {
                // Recalculate densities to be precise with state
                const rho_vap_in = CP_INSTANCE.PropsSI('D', 'T', T_1_K, 'P', P_vap_Pa, 'Water');
                m_dot_vap = m_dot_total * (rho_vap_in / rho_mix);
                m_dot_dry = m_dot_total - m_dot_vap;
            } else {
                m_dot_dry = m_dot_total;
                m_dot_vap = 0;
            }

            // 3.2 Ideal Work (Compression)
            // Use Dry Gas properties for Gas Constant R approximation (standard industrial practice)
            const R_gas = CP_INSTANCE.PropsSI('GAS_CONSTANT', '', 0, '', 0, fluid) / CP_INSTANCE.PropsSI('MOLAR_MASS', '', 0, '', 0, fluid);
            const W_iso_W = m_dot_total * R_gas * T_1_K * Math.log(Pc_Pa / Pe_Pa);
            
            // Isentropic Work Estimate
            // Applying dry gas isentropic enthalpy rise to the total mass flow
            // This assumes the mixture behaves largely like the carrier gas thermally
            const h_2s_dry = CP_INSTANCE.PropsSI('H', 'P', Pc_Pa * (P_dry_Pa/Pe_Pa), 'S', CP_INSTANCE.PropsSI('S', 'T', T_1_K, 'P', P_dry_Pa, fluid), fluid);
            const h_1_dry = CP_INSTANCE.PropsSI('H', 'T', T_1_K, 'P', P_dry_Pa, fluid);
            const dh_s = h_2s_dry - h_1_dry;
            const Ws_W = m_dot_total * dh_s; 
            
            // 3.3 Efficiencies & Shaft Work
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

            // 3.4 Heat Balance & Discharge State
            const T_2a_act_K = T_2a_actual_C + 273.15;
            
            // Estimate Discharge Enthalpy (Dry Gas Part + Vapor Part at new Partial Pressures)
            // Assumption: Mole fractions remain constant during compression (no reaction/condensation inside screw)
            // P_partial_out = P_out * (P_partial_in / P_in)
            const h_2a_dry = CP_INSTANCE.PropsSI('H', 'T', T_2a_act_K, 'P', Pc_Pa * (P_dry_Pa/Pe_Pa), fluid);
            const h_2a_vap = P_vap_Pa > 0 ? CP_INSTANCE.PropsSI('H', 'T', T_2a_act_K, 'P', Pc_Pa * (P_vap_Pa/Pe_Pa), 'Water') : 0;
            
            let h_2a_mix;
            if (P_vap_Pa > 0) {
                h_2a_mix = (m_dot_dry * h_2a_dry + m_dot_vap * h_2a_vap) / m_dot_total;
            } else {
                h_2a_mix = CP_INSTANCE.PropsSI('H', 'T', T_2a_act_K, 'P', Pc_Pa, fluid);
            }
            
            const Q_gas_heat_W = m_dot_total * (h_2a_mix - h_1_mix);
            const Q_oil_W = W_shaft_W - Q_gas_heat_W;

            if (Q_oil_W < 0) throw new Error(`Negative Oil Load (${(Q_oil_W/1000).toFixed(2)} kW). Check Discharge Temp.`);

            // --- 4. Aftercooler & Condensation Calculation ---
            const isAcEnabled = acCheckbox ? acCheckbox.checked : false;
            let Q_ac_W = 0;
            let h_3 = h_2a_mix;
            let P_3_Pa = Pc_Pa;
            let ac_html = '';
            let condensate_kg_h = 0;

            // Chart Points helpers
            const point = (name, h_j, p_bar, pos) => ({ name, value: [h_j/1000, p_bar], label: { position: pos, show: true } });

            let mainPoints = [
                point('1', h_1_mix, Pe_bar, 'bottom'),
                point('2', h_2a_mix, Pc_bar, 'top')
            ];

            let statePoints = [
                { name: '1', desc: 'Inlet', temp: Te_C.toFixed(1), press: Pe_bar.toFixed(2), enth: (h_1_mix/1000).toFixed(1), flow: m_dot_total.toFixed(4) },
                { name: '2', desc: 'Discharge', temp: T_2a_actual_C.toFixed(1), press: Pc_bar.toFixed(2), enth: (h_2a_mix/1000).toFixed(1), flow: m_dot_total.toFixed(4) }
            ];

            if (isAcEnabled) {
                const T_ac_target_C = parseFloat(acTempTargetInput.value);
                const P_drop_bar = parseFloat(acDropInput.value);
                
                if (isNaN(T_ac_target_C) || isNaN(P_drop_bar)) throw new Error("Invalid Aftercooler Inputs.");
                
                const T_3_K = T_ac_target_C + 273.15;
                P_3_Pa = (Pc_bar - P_drop_bar) * 1e5;

                // 4.1 Condensation Check
                let m_vap_out = m_dot_vap;
                
                if (P_vap_Pa > 0) {
                    // Saturation Pressure at AC Outlet Temp
                    const P_sat_ac = CP_INSTANCE.PropsSI('P', 'T', T_3_K, 'Q', 1, 'Water');
                    
                    // Theoretical Partial Pressure of Water if no condensation
                    // P_vap_out_hyp = P_3_Pa * (P_vap_Pa / Pe_Pa)
                    const y_v_in = P_vap_Pa / Pe_Pa;
                    const P_vap_out_hyp = P_3_Pa * y_v_in;

                    if (P_vap_out_hyp > P_sat_ac) {
                        // Condensation occurs!
                        const P_dry_3 = P_3_Pa - P_sat_ac;
                        if (P_dry_3 <= 0) throw new Error("AC Temp too high or Pressure too low (Vacuum/Steam condition).");

                        const rho_dry_3 = CP_INSTANCE.PropsSI('D', 'T', T_3_K, 'P', P_dry_3, fluid);
                        const rho_vap_3 = CP_INSTANCE.PropsSI('D', 'T', T_3_K, 'P', P_sat_ac, 'Water');
                        
                        // Max mass of vapor that fits in that volume
                        const m_vap_max = (m_dot_dry / rho_dry_3) * rho_vap_3;

                        if (m_vap_max < m_dot_vap) {
                            condensate_kg_h = (m_dot_vap - m_vap_max) * 3600;
                            m_vap_out = m_vap_max; // Remaining vapor
                        }
                    }
                }

                // Update Output UI
                if (condensateOutput) {
                    if (condensate_kg_h > 0) {
                        condensateOutput.innerHTML = `💧 ${condensate_kg_h.toFixed(2)} kg/h`;
                        condensateOutput.className = "text-sm font-bold font-mono text-blue-600 animate-pulse";
                    } else {
                        condensateOutput.innerHTML = `<span class="text-gray-400">None (Dry)</span>`;
                        condensateOutput.className = "text-sm font-medium";
                    }
                }

                // 4.2 AC Outlet Enthalpy
                // Q_ac = H_in - H_out. Approximate using sensible + latent.
                // Sensible Cooling of Gas Mix
                const h_mix_3_approx = CP_INSTANCE.PropsSI('H', 'T', T_3_K, 'P', P_3_Pa, fluid); 
                // Note: h_2a_mix contains vapor enthalpy contributions.
                // To keep it simple for generic charts, we calculate Q_ac directly:
                // Q_ac_sensible = m_total * (h_2a_mix - h_mix_3_approx) 
                // This is a rough approximation assuming ideal mix behavior for Cp.
                
                // Better approach for Q_sensible: m_dry*dh_dry + m_vap*dh_vap
                const h_dry_3 = CP_INSTANCE.PropsSI('H', 'T', T_3_K, 'P', P_3_Pa * (P_dry_Pa/Pe_Pa), fluid);
                const h_vap_3 = CP_INSTANCE.PropsSI('H', 'T', T_3_K, 'Q', 1, 'Water'); // Sat vapor approx
                
                const H_out_sensible = m_dot_dry * h_dry_3 + m_dot_vap * h_vap_3; // Before condensation
                const H_in = m_dot_total * h_2a_mix;
                
                let Q_ac_W_calc = H_in - H_out_sensible;
                if (condensate_kg_h > 0) {
                    // Add Latent Heat: m_cond * h_fg
                    Q_ac_W_calc += (condensate_kg_h/3600) * 2260000;
                }
                
                Q_ac_W = Q_ac_W_calc;
                // For chart consistency, h_3 is strictly for plotting the gas path state
                h_3 = h_2a_mix - (Q_ac_W / m_dot_total); 

                statePoints.push({
                    name: '3', desc: 'AC Out',
                    temp: T_ac_target_C.toFixed(1),
                    press: (P_3_Pa/1e5).toFixed(2),
                    enth: (h_3/1000).toFixed(1),
                    flow: (m_dot_dry + m_vap_out).toFixed(4)
                });
                mainPoints.push(point('3', h_3, P_3_Pa/1e5, 'left'));

                ac_html = `
                    ${createSectionHeader('Post-Treatment (AC)', '❄️')}
                    ${createDetailRow('Cooling Load', `${(Q_ac_W/1000).toFixed(2)} kW`)}
                    ${createDetailRow('Outlet Temp', `${T_ac_target_C.toFixed(1)} °C`)}
                    ${createDetailRow('Outlet Press', `${(P_3_Pa/1e5).toFixed(2)} bar`)}
                    ${condensate_kg_h > 0 ? createDetailRow('💧 Condensate', `${condensate_kg_h.toFixed(2)} kg/h`, true) : ''}
                `;
            }

            // --- Visualization ---
            ['chart-desktop-m3', 'chart-mobile-m3'].forEach(id => {
                drawPHDiagram(id, {
                    title: `Process (${fluid}${moistVal>0 ? ` + Wet` : ''})`,
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
                    
                    ${createSectionHeader('Gas Properties', '☁️')}
                    ${createDetailRow('Fluid', fluid)}
                    ${createDetailRow('Moisture Input', `${moistVal} ${moistType.toUpperCase()}`)}
                    ${moistVal > 0 ? createDetailRow('P_vapor (In)', `${(P_vap_Pa/100).toFixed(2)} mbar`) : ''}

                    ${ac_html}

                    ${createSectionHeader('State Points Detail', '📊')}
                    ${createStateTable(statePoints)}
                </div>
            `;

            renderToAllViews(html);

            const mainEffLabel = efficiency_type === 'isothermal' ? 'Iso-Eff' : 'Isen-Eff';
            const mainEffValue = efficiency_type === 'isothermal' ? eta_iso_shaft.toFixed(3) : eta_s_shaft.toFixed(3);
            updateMobileSummary(`${(W_shaft_W/1000).toFixed(1)} kW`, mainEffLabel, mainEffValue);

            // [Fix] 移动端自动弹出结果面板 (v7.1)
            openMobileSheet('m3');

            setButtonFresh3();
            if(printButtonM3) printButtonM3.disabled = false;

            lastCalculationData = { fluid, statePoints, W_shaft_W, eta_iso_shaft, eta_s_shaft, Q_oil_W, Q_ac_W };
            
            // Save State
            AppState.updateVSD(isVsdEnabled, ratedRpm, currentRpm);
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
    
    // AC & Wet Gas References
    acCheckbox = document.getElementById('enable_aftercooler_m3');
    acTempTargetInput = document.getElementById('temp_aftercooler_target_m3');
    acDropInput = document.getElementById('press_drop_aftercooler_m3');
    // [v7.1] New Inputs
    moistureTypeInput = document.getElementById('moisture_type_m3');
    moistureValInput = document.getElementById('moisture_val_m3');
    condensateOutput = document.getElementById('condensate_rate_m3');
    
    // VSD References
    vsdCheckbox = document.getElementById('enable_vsd_m3');
    ratedRpmInput = document.getElementById('rated_rpm_m3');

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
        
        // AC Toggle
        if (acCheckbox) {
            acCheckbox.addEventListener('change', () => {
                const settings = document.getElementById('ac-settings-m3');
                const placeholder = document.getElementById('ac-placeholder-m3');
                if (settings) settings.classList.toggle('hidden', !acCheckbox.checked);
                if (placeholder) placeholder.classList.toggle('hidden', acCheckbox.checked);
                setButtonStale3();
            });
        }

        // VSD Toggle
        if (vsdCheckbox) {
            vsdCheckbox.addEventListener('change', () => {
                const vsdInputs = document.getElementById('vsd-inputs-m3');
                if(vsdInputs) vsdInputs.classList.toggle('hidden', !vsdCheckbox.checked);
            });
        }
        
        document.querySelectorAll('input[name="eff_type_m3"]').forEach(r => {
            r.addEventListener('change', updateAndDisplayEfficienciesM3);
        });
        
        if (printButtonM3) printButtonM3.addEventListener('click', printReportMode3);
    }
    console.log("Mode 3 (v7.1 Final) initialized.");
}