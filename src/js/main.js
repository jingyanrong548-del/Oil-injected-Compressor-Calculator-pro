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
import i18next, { changeLanguage, toggleLanguage } from './i18n.js';

// 2. 主应用逻辑: 等待 DOM 加载完毕
document.addEventListener('DOMContentLoaded', () => {
    // 2.1 i18n已经在导入时初始化，这里直接使用
    
    // 2.2 初始化i18n并更新所有静态文本
    const updateI18nElements = () => {
        // 更新所有带有data-i18n属性的元素
        document.querySelectorAll('[data-i18n]').forEach(el => {
            if (!el) return;
            const key = el.getAttribute('data-i18n');
            if (key) {
                try {
                    if (el.tagName === 'INPUT' && el.type !== 'submit' && el.type !== 'button') {
                        el.placeholder = i18next.t(key);
                    } else if (el.tagName === 'TITLE') {
                        el.textContent = i18next.t(key);
                    } else {
                        el.textContent = i18next.t(key);
                    }
                } catch (e) {
                    console.warn(`[i18n] Failed to update element with key ${key}:`, e);
                }
            }
        });
        
        // 更新所有带有data-i18n-attr的元素
        document.querySelectorAll('[data-i18n-attr]').forEach(el => {
            if (!el) return;
            const attr = el.getAttribute('data-i18n-attr');
            const key = el.getAttribute('data-i18n');
            if (attr && key) {
                try {
                    el.setAttribute(attr, i18next.t(key));
                } catch (e) {
                    console.warn(`[i18n] Failed to update attribute ${attr} with key ${key}:`, e);
                }
            }
        });
        
        // 更新语言切换按钮文本
        const langBtn = document.getElementById('lang-btn');
        if (langBtn) {
            const span = langBtn.querySelector('span');
            if (span) {
                const currentLang = i18next.language;
                span.textContent = currentLang === 'zh-CN' ? 'CN' : 'EN';
            }
        }
    };
    
    // 设置语言切换按钮事件（只绑定一次）
    const langBtn = document.getElementById('lang-btn');
    if (langBtn && !langBtn.hasAttribute('data-i18n-bound')) {
        langBtn.setAttribute('data-i18n-bound', 'true');
        langBtn.addEventListener('click', () => {
            toggleLanguage();
            // 更新按钮显示
            setTimeout(() => {
                updateI18nElements();
            }, 100);
        });
    }
    
    // 立即更新一次
    updateI18nElements();
    
    // 监听语言变化事件
    window.addEventListener('languageChanged', updateI18nElements);

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
        'calc-button-mode-2': i18next.t('common.calculate'),
        'calc-button-mode-3': i18next.t('common.calculate'),
        'calc-button-mode-4': i18next.t('common.calculate'),
        'calc-button-mode-5': i18next.t('common.calculate'),
        'calc-button-mode-6': i18next.t('common.calculate'),
        'calc-button-mode-7': i18next.t('common.calculate')
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
                    btn.textContent = buttonTexts[btn.id] || i18next.t('common.calculate');
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
            const errorMsg = i18next.t('errors.libraryLoadFailed', { message: err.message });
            
            buttons.forEach(btn => {
                if (btn) {
                    btn.textContent = i18next.t('common.loadingFailed');
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