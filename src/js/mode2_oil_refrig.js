// =====================================================================
// mode2_oil_refrig.js: 模式一 (制冷热泵) 模块 - (v2.9 Energy Balance Fix)
// 职责: 执行制冷循环计算，支持闪发罐/过冷器两种经济器模型。
// 修复: 增加能量守恒校验，解决油冷负荷为负的问题，自动修正排气温度。
// =====================================================================

import { updateFluidInfo } from './coolprop_loader.js';
import { calculateEmpiricalEfficiencies } from './efficiency_models.js';

let CP_INSTANCE = null;
let lastMode2ResultText = null;

// UI 元素引用
let calcButtonM2, resultsDivM2, calcFormM2, printButtonM2, fluidSelectM2, fluidInfoDivM2;
let allInputsM2;
let autoEffCheckboxM2, tempEvapM2, tempCondM2, etaVM2, etaSM2;
// ECO 相关 UI
let ecoCheckbox, ecoTypeRadios, ecoSatTempInput, ecoSuperheatInput, tempDischargeActualM2;

// 状态样式
const btnText2 = "计算性能 (模式一)";
const btnTextStale2 = "重新计算 (模式一)";
const classesFresh2 = ['bg-green-600', 'hover:bg-green-700', 'text-white'];
const classesStale2 = ['bg-yellow-500', 'hover:bg-yellow-600', 'text-black'];

function setButtonStale2() {
    if (calcButtonM2 && calcButtonM2.textContent !== btnTextStale2) {
        calcButtonM2.textContent = btnTextStale2;
        calcButtonM2.classList.remove(...classesFresh2);
        calcButtonM2.classList.add(...classesStale2);
        printButtonM2.disabled = true;
        lastMode2ResultText = null;
    }
}

function setButtonFresh2() {
    if (calcButtonM2) {
        calcButtonM2.textContent = btnText2;
        calcButtonM2.classList.remove(...classesStale2);
        calcButtonM2.classList.add(...classesFresh2);
    }
}

// 自动更新效率
function updateAndDisplayEfficienciesM2() {
    if (!CP_INSTANCE || !autoEffCheckboxM2 || !autoEffCheckboxM2.checked) return;
    try {
        const fluid = fluidSelectM2.value;
        const Te_C = parseFloat(tempEvapM2.value);
        const Tc_C = parseFloat(tempCondM2.value);
        if (isNaN(Te_C) || isNaN(Tc_C) || Tc_C <= Te_C) return;
        
        // 简单估算使用总压比
        const Pe_Pa = CP_INSTANCE.PropsSI('P', 'T', Te_C + 273.15, 'Q', 1, fluid);
        const Pc_Pa = CP_INSTANCE.PropsSI('P', 'T', Tc_C + 273.15, 'Q', 1, fluid);
        const pressureRatio = Pc_Pa / Pe_Pa;
        
        const efficiencies = calculateEmpiricalEfficiencies(pressureRatio);
        etaVM2.value = efficiencies.eta_v;
        etaSM2.value = efficiencies.eta_s;
    } catch (error) {
        console.warn("更新经验效率时物性查询失败:", error.message);
    }
}

// =====================================================================
// 核心计算逻辑
// =====================================================================
function calculateMode2() {
    try {
        // --- 1. 读取基础输入 ---
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

        // --- ECO 输入 & 模式判断 ---
        const isEcoEnabled = ecoCheckbox.checked;
        const ecoType = document.querySelector('input[name="eco_type_m2"]:checked').value; 
        const ecoPressMode = document.querySelector('input[name="eco_press_mode_m2"]:checked').value; 
        const eco_superheat_K = parseFloat(ecoSuperheatInput.value);

        // --- 校验 ---
        if (T_2a_est_C <= Tc_C) throw new Error(`预估排气温度 T2a (${T_2a_est_C}°C) 必须高于冷凝温度 Tc (${Tc_C}°C)。`);
        if (isNaN(Te_C) || isNaN(eta_v) || isNaN(eta_s_input)) throw new Error("输入参数包含无效数字。");

        // --- 2. 状态点计算 (CoolProp) ---
        const T_evap_K = Te_C + 273.15;
        const T_cond_K = Tc_C + 273.15;
        const Pe_Pa = CP_INSTANCE.PropsSI('P', 'T', T_evap_K, 'Q', 1, fluid);
        const Pc_Pa = CP_INSTANCE.PropsSI('P', 'T', T_cond_K, 'Q', 1, fluid);

        // 状态点 1: 吸气
        const T_1_K = T_evap_K + superheat_K;
        const h_1 = CP_INSTANCE.PropsSI('H', 'T', T_1_K, 'P', Pe_Pa, fluid);
        const s_1 = CP_INSTANCE.PropsSI('S', 'T', T_1_K, 'P', Pe_Pa, fluid);
        const rho_1 = CP_INSTANCE.PropsSI('D', 'T', T_1_K, 'P', Pe_Pa, fluid);

        // 状态点 3: 冷凝器出口 (高压液体)
        const T_3_K = T_cond_K - subcooling_K;
        const h_3 = CP_INSTANCE.PropsSI('H', 'T', T_3_K, 'P', Pc_Pa, fluid); 
        
        // --- 3. 流量计算 ---
        let V_th_m3_s, flow_input_source = "";
        if (flow_mode === 'rpm') {
            const rpm = parseFloat(document.getElementById('rpm_m2').value);
            const displacement_cm3 = parseFloat(document.getElementById('displacement_m2').value);
            V_th_m3_s = rpm * (displacement_cm3 / 1e6) / 60.0;
            flow_input_source = `(RPM: ${rpm}, Disp: ${displacement_cm3} cm³)`;
        } else {
            const flow_m3h = parseFloat(document.getElementById('flow_m3h_m2').value);
            V_th_m3_s = flow_m3h / 3600.0;
            flow_input_source = `(Flow: ${flow_m3h} m³/h)`;
        }
        const V_act_m3_s = V_th_m3_s * eta_v;
        const m_dot_suc = V_act_m3_s * rho_1; // 吸气质量流量

        // --- 4. 经济器 (ECO) 模型计算 ---
        let m_dot_inj = 0;
        let m_dot_total = m_dot_suc;
        let h_liquid_to_evap = h_3;
        let P_eco_Pa = 0;
        let h_inj = 0;
        let eco_info_str = "";
        let Q_evap_W_no_eco = m_dot_suc * (h_1 - h_3);

        if (isEcoEnabled) {
            let T_eco_sat_K;
            let eco_mode_desc = "";

            if (ecoPressMode === 'auto') {
                // 自动模式: 几何平均值 P_mid = sqrt(Pe * Pc)
                P_eco_Pa = Math.sqrt(Pe_Pa * Pc_Pa);
                T_eco_sat_K = CP_INSTANCE.PropsSI('T', 'P', P_eco_Pa, 'Q', 0, fluid);
                eco_mode_desc = "(自动优化)";
            } else {
                // 手动模式
                const T_eco_sat_C = parseFloat(ecoSatTempInput.value);
                if (isNaN(T_eco_sat_C)) throw new Error("手动模式下必须输入补气饱和温度。");
                if (T_eco_sat_C <= Te_C || T_eco_sat_C >= Tc_C) 
                    throw new Error(`补气饱和温度 (${T_eco_sat_C}°C) 必须介于蒸发 (${Te_C}°C) 和冷凝 (${Tc_C}°C) 之间。`);
                T_eco_sat_K = T_eco_sat_C + 273.15;
                P_eco_Pa = CP_INSTANCE.PropsSI('P', 'T', T_eco_sat_K, 'Q', 0.5, fluid);
                eco_mode_desc = "(手动设定)";
            }

            if (ecoType === 'flash_tank') {
                h_inj = CP_INSTANCE.PropsSI('H', 'T', T_eco_sat_K, 'Q', 1, fluid);
                const h_liq_sat_eco = CP_INSTANCE.PropsSI('H', 'T', T_eco_sat_K, 'Q', 0, fluid);
                h_liquid_to_evap = h_liq_sat_eco;
                
                const numerator = h_3 - h_liq_sat_eco;
                const denominator = h_inj - h_liq_sat_eco;
                if (denominator === 0) throw new Error("经济器计算错误: 潜热为0");
                const x_flash = numerator / denominator;
                
                if (x_flash < 0) throw new Error("经济器无效: 冷凝液过冷度过大，已低于中间压力饱和温度。");
                
                m_dot_inj = m_dot_suc * (x_flash / (1 - x_flash));
                eco_info_str = `类型: 闪发罐 ${eco_mode_desc}\n  补气压力 (Pm): ${(P_eco_Pa/1e5).toFixed(3)} bar\n  补气饱和温度: ${(T_eco_sat_K - 273.15).toFixed(2)} °C\n  闪发干度 (x): ${(x_flash*100).toFixed(2)} %`;

            } else {
                const T_inj_K = T_eco_sat_K + eco_superheat_K;
                h_inj = CP_INSTANCE.PropsSI('H', 'T', T_inj_K, 'P', P_eco_Pa, fluid);
                
                const T_liq_out_K = T_eco_sat_K + 5.0; 
                if (T_liq_out_K >= T_3_K) throw new Error("经济器无效: 目标过冷温度高于冷凝出口温度。");
                h_liquid_to_evap = CP_INSTANCE.PropsSI('H', 'T', T_liq_out_K, 'P', Pc_Pa, fluid);
                
                const heat_removed = m_dot_suc * (h_3 - h_liquid_to_evap);
                const enthalpy_gain_inj = h_inj - h_3; 
                m_dot_inj = heat_removed / enthalpy_gain_inj;
                eco_info_str = `类型: 过冷器 ${eco_mode_desc}\n  补气压力 (Pm): ${(P_eco_Pa/1e5).toFixed(3)} bar\n  补气饱和温度: ${(T_eco_sat_K - 273.15).toFixed(2)} °C`;
            }

            m_dot_total = m_dot_suc + m_dot_inj;
        }

        const h_4 = h_liquid_to_evap; 

        // --- 5. 压缩功耗计算 ---
        let W_ideal_W = 0;

        if (!isEcoEnabled) {
            const h_2s = CP_INSTANCE.PropsSI('H', 'P', Pc_Pa, 'S', s_1, fluid);
            W_ideal_W = m_dot_suc * (h_2s - h_1);
        } else {
            const h_mid_1s = CP_INSTANCE.PropsSI('H', 'P', P_eco_Pa, 'S', s_1, fluid);
            const W_s1 = m_dot_suc * (h_mid_1s - h_1);
            
            const h_mix_s = (m_dot_suc * h_mid_1s + m_dot_inj * h_inj) / m_dot_total;
            const s_mix = CP_INSTANCE.PropsSI('S', 'H', h_mix_s, 'P', P_eco_Pa, fluid);
            
            const h_2s_stage2 = CP_INSTANCE.PropsSI('H', 'P', Pc_Pa, 'S', s_mix, fluid);
            const W_s2 = m_dot_total * (h_2s_stage2 - h_mix_s);
            
            W_ideal_W = W_s1 + W_s2;
        }

        // 功率反算
        let W_shaft_W, W_input_W, eta_s_shaft, eta_s_total, eff_mode_desc;
        if (eff_mode === 'shaft') {
            eta_s_shaft = eta_s_input;
            W_shaft_W = W_ideal_W / eta_s_shaft;
            W_input_W = W_shaft_W / motor_eff;
            eta_s_total = W_ideal_W / W_input_W;
            eff_mode_desc = `效率基准: 轴功率 (η_s = ${eta_s_shaft.toFixed(4)})`;
        } else {
            eta_s_total = eta_s_input;
            W_input_W = W_ideal_W / eta_s_total;
            W_shaft_W = W_input_W * motor_eff;
            eta_s_shaft = W_ideal_W / W_shaft_W;
            eff_mode_desc = `效率基准: 输入功率 (η_total = ${eta_s_total.toFixed(4)})`;
        }

        // --- 6. 热平衡计算 (修正版) ---
        const Q_evap_W = m_dot_suc * (h_1 - h_4); 
        
        // 1. 系统输入总能量 (入口气体焓 + 补气焓)
        const h_system_in_total = (m_dot_suc * h_1 + m_dot_inj * h_inj);
        
        // 2. 目标排气状态 (按用户输入的 T_2a_est)
        const T_2a_est_K = T_2a_est_C + 273.15;
        const h_2a_target = CP_INSTANCE.PropsSI('H', 'T', T_2a_est_K, 'P', Pc_Pa, fluid);
        
        // 3. 计算气体温升所需的能量
        const energy_out_gas_target = m_dot_total * h_2a_target;
        
        // 4. 油冷负荷 = 轴功 - 气体温升耗能
        // Q_oil = W_shaft - (H_out - H_in)
        let Q_oil_W = W_shaft_W - (energy_out_gas_target - h_system_in_total);
        
        // 5. [关键修复] 能量守恒校验
        let T_2a_final_display_C = T_2a_est_C;
        let discharge_note = "";

        if (Q_oil_W < 0) {
            // 负负荷说明：输入的轴功都不足以把气体加热到预估排温，更别提还需要油冷却了。
            // 物理含义：压缩机处于“绝热”甚至“向外吸热”状态 (不合理)。
            // 修正动作：强制 Q_oil = 0 (绝热压缩)，并反算真实的排温。
            
            Q_oil_W = 0;
            
            // H_out_real = H_in + W_shaft
            const h_2a_real = (h_system_in_total + W_shaft_W) / m_dot_total;
            
            // 反算真实温度
            try {
                const T_2a_real_K = CP_INSTANCE.PropsSI('T', 'P', Pc_Pa, 'H', h_2a_real, fluid);
                T_2a_final_display_C = T_2a_real_K - 273.15;
                discharge_note = `\n  (注: 输入排温过高，能量守恒修正为 ${T_2a_final_display_C.toFixed(1)}°C)`;
            } catch(e) {
                discharge_note = `\n  (注: 能量校验失败，请检查输入)`;
            }
        }

        // 冷凝器负荷 (使用修正后的排气焓，或者保守计算)
        // 实际上 Q_cond = m_total * (h_2a_real - h_3)
        // 如果 Q_oil修正了，h_2a 也变了。为了严谨：
        const h_2a_final = (h_system_in_total + W_shaft_W - Q_oil_W) / m_dot_total;
        const Q_cond_W = m_dot_total * (h_2a_final - h_3); 
        
        // --- 7. ECO 性能对比 ---
        let eco_result_block = "";
        if (isEcoEnabled) {
            const Q_increase_pct = ((Q_evap_W - Q_evap_W_no_eco) / Q_evap_W_no_eco) * 100;
            const alpha = m_dot_inj / m_dot_suc;
            eco_result_block = `
--- 💡 经济器 (ECO) 性能分析 ---
${eco_info_str}
补气流量 (m_inj):     ${m_dot_inj.toFixed(4)} kg/s
补气率 (α = mi/ms):   ${(alpha * 100).toFixed(2)} %
蒸发器供液焓降:       ${((h_3 - h_4)/1000).toFixed(2)} kJ/kg
>> 制冷量提升:        +${Q_increase_pct.toFixed(2)} % (vs 无ECO)
`;
        }

        // --- 8. 生成报告 ---
        const COP_R = Q_evap_W / W_input_W;
        const COP_H = (Q_cond_W + Q_oil_W) / W_input_W;

        let output = `
--- 压缩机规格 ---
工质: ${fluid}
模式: ${isEcoEnabled ? "ECO 开启 (" + (ecoType==='flash_tank'?'闪发罐':'过冷器') + ")" : "单级压缩"}
流量源: ${flow_input_source}
------------------------
1. 蒸发侧 (Suction):
   Te = ${Te_C.toFixed(2)}°C, Pe = ${(Pe_Pa/1e5).toFixed(3)} bar
   吸气流量 (m_suc): ${m_dot_suc.toFixed(4)} kg/s
   吸气容积 (V_act): ${V_act_m3_s.toFixed(4)} m³/s

2. 压缩与排气 (Discharge):
   Tc = ${Tc_C.toFixed(2)}°C, Pc = ${(Pc_Pa/1e5).toFixed(3)} bar
   总排气流量 (m_tot): ${m_dot_total.toFixed(4)} kg/s
   预估排温 (T2a): ${T_2a_final_display_C.toFixed(1)}°C ${discharge_note}
${eco_result_block}
--- 功率与效率 ---
理论功 (W_ideal):    ${(W_ideal_W/1000).toFixed(3)} kW
轴功率 (W_shaft):    ${(W_shaft_W/1000).toFixed(3)} kW
输入功率 (W_input):  ${(W_input_W/1000).toFixed(3)} kW
${eff_mode_desc}
容积效率 (η_v):      ${eta_v.toFixed(3)}

========================================
           计算结果 (Results)
========================================
制冷量 (Q_evap):     ${(Q_evap_W/1000).toFixed(3)} kW
制冷 COP:           ${COP_R.toFixed(3)}
----------------------------------------
冷凝热 (Q_cond):     ${(Q_cond_W/1000).toFixed(3)} kW
油冷负荷 (Q_oil):     ${(Q_oil_W/1000).toFixed(3)} kW
总供热量 (Heating):   ${((Q_cond_W+Q_oil_W)/1000).toFixed(3)} kW
综合 COP (热):       ${COP_H.toFixed(3)}
`;

        resultsDivM2.textContent = output;
        lastMode2ResultText = output.trim();
        setButtonFresh2();
        printButtonM2.disabled = false;

    } catch (error) {
        resultsDivM2.textContent = `计算出错:\n${error.message}\n\n建议检查: 补气饱和温度是否在合理范围内？`;
        console.error(error);
        lastMode2ResultText = null;
        printButtonM2.disabled = true;
    }
}

// 打印功能
function printReportMode2() {
    if (!lastMode2ResultText) {
        alert("请先计算结果再打印。");
        return;
    }
    const w = window.open('', '_blank');
    w.document.write(`<pre>${lastMode2ResultText}</pre>`);
    w.print();
    w.close();
}

// 导出接口 (UI 调用)
export function triggerMode2EfficiencyUpdate() {
    if (autoEffCheckboxM2 && autoEffCheckboxM2.checked) {
        updateAndDisplayEfficienciesM2();
    }
}

// 初始化
export function initMode2(CP) {
    CP_INSTANCE = CP;
    calcButtonM2 = document.getElementById('calc-button-mode-2');
    resultsDivM2 = document.getElementById('results-mode-2');
    calcFormM2 = document.getElementById('calc-form-mode-2');
    printButtonM2 = document.getElementById('print-button-mode-2');
    fluidSelectM2 = document.getElementById('fluid_m2');
    fluidInfoDivM2 = document.getElementById('fluid-info-m2');
    tempDischargeActualM2 = document.getElementById('temp_discharge_actual_m2');
    autoEffCheckboxM2 = document.getElementById('auto-eff-m2');
    
    // 输入字段
    tempEvapM2 = document.getElementById('temp_evap_m2');
    tempCondM2 = document.getElementById('temp_cond_m2');
    etaVM2 = document.getElementById('eta_v_m2');
    etaSM2 = document.getElementById('eta_s_m2');
    
    // ECO 字段
    ecoCheckbox = document.getElementById('enable_eco_m2');
    ecoSatTempInput = document.getElementById('temp_eco_sat_m2');
    ecoSuperheatInput = document.getElementById('eco_superheat_m2');

    if (calcFormM2) {
        calcFormM2.addEventListener('submit', (e) => { e.preventDefault(); calculateMode2(); });
        
        // 绑定所有输入框变化 -> 按钮变色
        const inputs = calcFormM2.querySelectorAll('input, select');
        inputs.forEach(input => {
            input.addEventListener('input', setButtonStale2);
            input.addEventListener('change', setButtonStale2);
        });

        fluidSelectM2.addEventListener('change', () => {
            updateFluidInfo(fluidSelectM2, fluidInfoDivM2, CP_INSTANCE);
        });
        
        // 自动效率触发
        [tempEvapM2, tempCondM2, autoEffCheckboxM2].forEach(el => {
            if(el) el.addEventListener('change', updateAndDisplayEfficienciesM2);
        });

        if (printButtonM2) {
            printButtonM2.addEventListener('click', printReportMode2);
        }
    }
    console.log("模式一 (制冷热泵) v2.9 Energy Balance Fix 已加载。");
}