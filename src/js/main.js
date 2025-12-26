// =====================================================================
// main.js: 应用主入口 - (v2.9 最终初始化修复版)
// 职责: 1. 建立清晰的、单向的初始化流程，彻底解决加载失败问题。
// =====================================================================

// 1. 导入所有需要的模块
import { loadCoolProp, updateFluidInfo } from './coolprop_loader.js';
import { initMode2, triggerMode2EfficiencyUpdate } from './mode2_oil_refrig.js';
import { initMode3, triggerMode3EfficiencyUpdate } from './mode3_oil_gas.js';
import { initMode3TwoStage, triggerMode3TwoStageEfficiencyUpdate } from './mode3_two_stage_gas.js';
import { initMode4, triggerMode4EfficiencyUpdate } from './mode4_cascade.js';
import { initMode5, triggerMode5EfficiencyUpdate } from './mode5_two_stage_single.js';
import { initMode6, triggerMode6EfficiencyUpdate } from './mode6_two_stage_double.js';
import { initMode7, triggerMode7EfficiencyUpdate } from './mode7_ammonia_heatpump.js';
import { initUI } from './ui.js';
import { APP_VERSION } from './version.js'; 

// 2. 主应用逻辑: 等待 DOM 加载完毕
document.addEventListener('DOMContentLoaded', () => {

    // 3. 首先，立即初始化所有不依赖于CoolProp的UI交互
    initUI();
    
    // 3.1 更新版本号显示
    APP_VERSION.updateDisplay();

    // 4. 定义需要被更新状态的元素
    const buttons = [
        document.getElementById('calc-button-mode-2'),
        document.getElementById('calc-button-mode-3'),
        document.getElementById('calc-button-mode-3-two-stage'),
        document.getElementById('calc-button-mode-4'),
        document.getElementById('calc-button-mode-5'),
        document.getElementById('calc-button-mode-6'),
        document.getElementById('calc-button-mode-7')
    ];
    
    const fluidInfos = [
        { select: document.getElementById('fluid_m2'), info: document.getElementById('fluid-info-m2') },
        { select: document.getElementById('fluid_m3'), info: document.getElementById('fluid-info-m3') },
        { select: document.getElementById('fluid_m3_two_stage'), info: document.getElementById('fluid-info-m3-two-stage') },
        { select: document.getElementById('fluid_m4_lt'), info: document.getElementById('fluid-info-m4-lt') },
        { select: document.getElementById('fluid_m4_ht'), info: document.getElementById('fluid-info-m4-ht') },
        { select: document.getElementById('fluid_m5'), info: document.getElementById('fluid-info-m5') },
        { select: document.getElementById('fluid_m6'), info: document.getElementById('fluid-info-m6') },
        { select: document.getElementById('fluid_m7'), info: document.getElementById('fluid-info-m7') }
    ];

    const buttonTexts = {
        'calc-button-mode-2': '计算',
        'calc-button-mode-3': '计算',
        'calc-button-mode-4': '计算',
        'calc-button-mode-5': '计算',
        'calc-button-mode-6': '计算',
        'calc-button-mode-7': '计算'
    };

    // 5. 然后，开始异步加载 CoolProp 物性库
    loadCoolProp()
        .then((CP) => {
            // 6. (成功) 物性库加载成功!
            console.log("CoolProp loaded successfully.");

            // 7. 在CoolProp加载成功后，才初始化依赖于它的计算模块
            initMode2(CP);
            initMode3(CP);
            initMode3TwoStage(CP);
            initMode4(CP);
            initMode5(CP);
            initMode6(CP);
            initMode7(CP);

            // 8. 更新所有计算按钮的状态
            buttons.forEach(btn => {
                if (btn) {
                    btn.textContent = buttonTexts[btn.id] || "计算";
                    btn.disabled = false;
                }
            });
            
            // 9. 更新所有物性显示框, 显示默认工质信息
            fluidInfos.forEach(fi => {
                if (fi.select && fi.info) {
                    updateFluidInfo(fi.select, fi.info, CP);
                }
            });
            
            // 10. [修复] 在所有模块都初始化完毕后，再手动触发一次初始的经验效率计算
            triggerMode2EfficiencyUpdate();
            triggerMode3EfficiencyUpdate();
            triggerMode3TwoStageEfficiencyUpdate();
            triggerMode4EfficiencyUpdate();
            triggerMode5EfficiencyUpdate();
            triggerMode6EfficiencyUpdate();
            triggerMode7EfficiencyUpdate();

        })
        .catch((err) => {
            // 11. (失败) 物性库加载失败!
            console.error("Failed to load CoolProp:", err);
            const errorMsg = `物性库加载失败: ${err.message}`;
            
            buttons.forEach(btn => {
                if (btn) {
                    btn.textContent = "物性库加载失败";
                    btn.disabled = true;
                }
            });
            
            fluidInfos.forEach(fi => {
                if (fi.info) {
                    fi.info.textContent = errorMsg;
                    fi.info.style.color = 'red';
                }
            });
        });
});
import '../css/style.css';