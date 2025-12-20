// =====================================================================
// ui.js: UI 交互逻辑 (v7.2 SLHX & VSD Support)
// 职责: 界面事件监听、显隐控制、历史记录管理、智能粘贴、图表自适应
// =====================================================================

import { HistoryDB } from './storage.js';
import { resizeAllCharts } from './charts.js';
import { AppState } from './state.js';

export function initUI() {
    console.log("🚀 UI Initializing (v7.2 SLHX)...");

    // -----------------------------------------------------------------
    // 1. History Drawer Logic (历史记录侧边栏)
    // -----------------------------------------------------------------
    const historyBtn = document.getElementById('history-btn');
    const historyDrawer = document.getElementById('history-drawer');
    const historyCloseBtn = document.getElementById('history-close-btn');
    const historyClearBtn = document.getElementById('history-clear-btn');
    const historyList = document.getElementById('history-list');

    function toggleHistory(show) {
        if (!historyDrawer) return;
        if (show) {
            historyDrawer.classList.remove('translate-x-full');
            renderHistoryList();
        } else {
            historyDrawer.classList.add('translate-x-full');
        }
    }

    if (historyBtn) {
        historyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleHistory(true);
        });
    }

    if (historyCloseBtn) historyCloseBtn.addEventListener('click', () => toggleHistory(false));

    document.addEventListener('click', (e) => {
        if (historyDrawer && !historyDrawer.classList.contains('translate-x-full')) {
            if (!historyDrawer.contains(e.target) && !historyBtn.contains(e.target)) {
                toggleHistory(false);
            }
        }
    });

    if (historyClearBtn) {
        historyClearBtn.addEventListener('click', () => {
            if (confirm('Clear history?')) { HistoryDB.clear(); renderHistoryList(); }
        });
    }

    function renderHistoryList() {
        const records = HistoryDB.getAll();
        if (!historyList) return;
        historyList.innerHTML = '';
        if (records.length === 0) {
            historyList.innerHTML = `<div class="text-center text-gray-400 mt-20 text-sm">No records yet.<br>Calculate to save.</div>`;
            return;
        }
        records.forEach(rec => {
            const el = document.createElement('div');
            el.className = 'bg-white/60 p-3 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all cursor-pointer mb-3 backdrop-blur-sm relative group';
            el.innerHTML = `
                <div class="flex justify-between items-start mb-1">
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">${rec.mode}</span>
                    <span class="text-[10px] text-gray-400 font-mono">${HistoryDB.formatTime(rec.timestamp)}</span>
                </div>
                <h4 class="text-sm font-bold text-gray-800">${rec.title}</h4>
                <button class="delete-btn absolute right-2 top-2 text-red-400 hover:text-red-600 px-2">×</button>
            `;
            el.addEventListener('click', () => { loadRecord(rec); toggleHistory(false); });
            el.querySelector('.delete-btn').addEventListener('click', (e) => {
                e.stopPropagation(); HistoryDB.delete(rec.id); renderHistoryList();
            });
            historyList.appendChild(el);
        });
    }

    // -----------------------------------------------------------------
    // 2. Tab & Restore Logic (两级导航：主标签 + 子标签)
    // -----------------------------------------------------------------
    // 主标签：气体压缩、制冷热泵
    const mainTabs = [
        { btnId: 'tab-btn-refrig', contentId: 'tab-content-refrig', subNavId: 'refrig-sub-nav' },
        { btnId: 'tab-btn-gas', contentId: 'tab-content-gas', subNavId: null }
    ];

    // 子标签（制冷热泵模式下的4个子模式）
    const subTabs = [
        { btnId: 'sub-tab-btn-m2', contentId: 'sub-tab-content-m2', sheetId: 'mobile-sheet-m2', calcBtnId: 'calc-button-mode-2' },
        { btnId: 'sub-tab-btn-m4', contentId: 'sub-tab-content-m4', sheetId: 'mobile-sheet-m4', calcBtnId: 'calc-button-mode-4' },
        { btnId: 'sub-tab-btn-m5', contentId: 'sub-tab-content-m5', sheetId: 'mobile-sheet-m5', calcBtnId: 'calc-button-mode-5' },
        { btnId: 'sub-tab-btn-m6', contentId: 'sub-tab-content-m6', sheetId: 'mobile-sheet-m6', calcBtnId: 'calc-button-mode-6' }
    ];

    // 模式标识到导航索引的映射
    const modeToNavMap = {
        'M2': { mainIdx: 0, subIdx: 0 },  // 制冷热泵 -> 单级
        'M3': { mainIdx: 1, subIdx: null }, // 气体压缩
        'M4': { mainIdx: 0, subIdx: 1 },  // 制冷热泵 -> 复叠
        'M5': { mainIdx: 0, subIdx: 2 },  // 制冷热泵 -> 单机双级
        'M6': { mainIdx: 0, subIdx: 3 }   // 制冷热泵 -> 双机双级
    };

    // 主标签切换函数
    function switchMainTab(mainIdx) {
        mainTabs.forEach((t, i) => {
            const btn = document.getElementById(t.btnId);
            const content = document.getElementById(t.contentId);
            const subNav = t.subNavId ? document.getElementById(t.subNavId) : null;
            
            if (i === mainIdx) {
                // 选中状态
                if (btn) {
                    btn.classList.add('bg-white', 'shadow-md', 'text-gray-900', 'font-bold', 'ring-2', 'ring-blue-500/30');
                    btn.classList.remove('text-gray-500', 'font-semibold');
                }
                if (content) {
                    content.classList.remove('hidden', 'opacity-0');
                    content.classList.add('opacity-100');
                }
                // 显示/隐藏子导航
                if (subNav) {
                    subNav.classList.remove('hidden');
                }
            } else {
                // 未选中状态
                if (btn) {
                    btn.classList.remove('bg-white', 'shadow-md', 'text-gray-900', 'font-bold', 'ring-2', 'ring-blue-500/30');
                    btn.classList.add('text-gray-500', 'font-semibold');
                }
                if (content) {
                    content.classList.add('hidden', 'opacity-0');
                    content.classList.remove('opacity-100');
                }
                // 隐藏子导航
                if (subNav) {
                    subNav.classList.add('hidden');
                }
            }
        });

        // 如果切换到制冷热泵模式，默认显示第一个子模式（单级）
        if (mainIdx === 0) {
            switchSubTab(0);
        }
    }

    // 子标签切换函数
    function switchSubTab(subIdx) {
        console.log(`[UI] Switching to sub-tab index: ${subIdx}`);
        
        // 确保父容器 tab-content-refrig 是可见的
        const refrigContainer = document.getElementById('tab-content-refrig');
        if (refrigContainer) {
            refrigContainer.classList.remove('hidden', 'opacity-0');
            refrigContainer.classList.add('opacity-100');
            // 强制设置样式，使用 !important 确保父容器可见
            refrigContainer.style.setProperty('display', 'block', 'important');
            refrigContainer.style.setProperty('visibility', 'visible', 'important');
            refrigContainer.style.setProperty('opacity', '1', 'important');
        } else {
            console.error('[UI] tab-content-refrig container not found!');
        }
        
        subTabs.forEach((t, i) => {
            const btn = document.getElementById(t.btnId);
            const content = document.getElementById(t.contentId);
            const sheet = document.getElementById(t.sheetId);
            
            if (i === subIdx) {
                // 选中状态
                if (btn) {
                    btn.classList.add('bg-white', 'shadow-md', 'text-gray-900', 'font-bold', 'ring-2', 'ring-blue-500/30');
                    btn.classList.remove('text-gray-500', 'font-semibold');
                } else {
                    console.error(`[UI] Sub-tab button not found: ${t.btnId}`);
                }
                
                if (content) {
                    // 强制移除所有可能隐藏元素的类
                    content.classList.remove('hidden', 'opacity-0');
                    content.classList.add('opacity-100');
                    
                    // 检查并修复父容器
                    let parent = content.parentElement;
                    while (parent && parent !== document.body) {
                        const parentStyle = getComputedStyle(parent);
                        if (parentStyle.display === 'none' || parent.classList.contains('hidden')) {
                            console.warn(`[UI] Parent element ${parent.id || parent.tagName} is hidden, fixing...`);
                            parent.classList.remove('hidden');
                            parent.style.setProperty('display', 'block', 'important');
                            parent.style.setProperty('visibility', 'visible', 'important');
                        }
                        parent = parent.parentElement;
                    }
                    
                    // 直接设置样式，使用 !important 确保可见（优先级最高）
                    content.style.setProperty('display', 'block', 'important');
                    content.style.setProperty('visibility', 'visible', 'important');
                    content.style.setProperty('opacity', '1', 'important');
                    content.style.setProperty('position', 'relative', 'important');
                    
                    // 再次检查 offsetParent
                    setTimeout(() => {
                        if (content.offsetParent === null) {
                            console.error(`[UI] Content ${t.contentId} still has offsetParent null after fix!`);
                            console.error(`[UI] Computed styles: display=${getComputedStyle(content).display}, visibility=${getComputedStyle(content).visibility}, opacity=${getComputedStyle(content).opacity}`);
                            // 尝试更激进的方法
                            content.style.setProperty('display', 'block', 'important');
                            content.style.setProperty('position', 'static', 'important');
                        } else {
                            console.log(`[UI] Sub-tab content ${t.contentId} is now visible (offsetParent: ${content.offsetParent.tagName})`);
                        }
                    }, 10);
                    
                    console.log(`[UI] Sub-tab content ${t.contentId} made visible (display: ${getComputedStyle(content).display}, opacity: ${getComputedStyle(content).opacity})`);
                } else {
                    console.error(`[UI] Sub-tab content not found: ${t.contentId}`);
                }
                
                if (sheet) {
                    sheet.classList.remove('hidden');
                    sheet.style.display = '';
                }
            } else {
                // 未选中状态
                if (btn) {
                    btn.classList.remove('bg-white', 'shadow-md', 'text-gray-900', 'font-bold', 'ring-2', 'ring-blue-500/30');
                    btn.classList.add('text-gray-500', 'font-semibold');
                }
                if (content) {
                    content.classList.add('hidden', 'opacity-0');
                    content.classList.remove('opacity-100');
                    // 确保隐藏
                    content.style.display = 'none';
                }
                if (sheet) {
                    sheet.classList.add('hidden');
                    sheet.style.display = 'none';
                }
            }
        });
    }

    // 主标签事件监听
    mainTabs.forEach((t, i) => {
        const btn = document.getElementById(t.btnId);
        if (btn) btn.addEventListener('click', () => switchMainTab(i));
    });

    // 子标签事件监听
    subTabs.forEach((t, i) => {
        const btn = document.getElementById(t.btnId);
        if (btn) btn.addEventListener('click', () => switchSubTab(i));
    });

    function loadRecord(rec) {
        const navInfo = modeToNavMap[rec.mode];
        if (!navInfo) {
            console.warn(`Unknown mode: ${rec.mode}`);
            return;
        }

        // 切换到对应的主标签
        switchMainTab(navInfo.mainIdx);

        // 如果是制冷热泵模式，切换到对应的子标签
        if (navInfo.subIdx !== null) {
            setTimeout(() => switchSubTab(navInfo.subIdx), 50);
        }

        // 恢复输入数据
        const inputs = rec.inputs;
        if (inputs) {
            Object.keys(inputs).forEach(k => {
                const el = document.getElementById(k);
                if (el) {
                    if (el.type === 'checkbox') {
                        el.checked = inputs[k];
                        el.dispatchEvent(new Event('change'));
                    } else if (el.type !== 'radio') {
                        el.value = inputs[k];
                        el.dispatchEvent(new Event('input'));
                        el.dispatchEvent(new Event('change'));
                    }
                } else {
                    const radios = document.querySelectorAll(`input[name="${k}"]`);
                    radios.forEach(r => {
                        if (r.value === inputs[k]) {
                            r.checked = true;
                            r.dispatchEvent(new Event('change'));
                        }
                    });
                }
            });

            // 触发计算按钮
            setTimeout(() => {
                let calcBtnId = null;
                if (rec.mode === 'M3') {
                    calcBtnId = 'calc-button-mode-3';
                } else {
                    const subTab = subTabs[navInfo.subIdx];
                    if (subTab) calcBtnId = subTab.calcBtnId;
                }
                if (calcBtnId) {
                    const btn = document.getElementById(calcBtnId);
                    if (btn) btn.click();
                }
            }, 150);
        }
    }

    // -----------------------------------------------------------------
    // 3. Mobile Sheet Logic (移动端底部抽屉)
    // -----------------------------------------------------------------
    function setupBottomSheet(sId, hId, cId) {
        const s = document.getElementById(sId), h = document.getElementById(hId), c = document.getElementById(cId);
        if (!s || !h) return;

        let isExpanded = false;

        const toggle = (force) => {
            isExpanded = force !== undefined ? force : !isExpanded;
            s.classList.toggle('translate-y-0', isExpanded);
            s.classList.toggle('translate-y-[calc(100%-80px)]', !isExpanded);
            s.classList.toggle('shadow-2xl', isExpanded);

            if (isExpanded) {
                setTimeout(() => { resizeAllCharts(); }, 350);
            }
        };

        h.addEventListener('click', () => toggle());
        if (c) c.addEventListener('click', (e) => { e.stopPropagation(); toggle(false); });
    }
    setupBottomSheet('mobile-sheet-m2', 'sheet-handle-m2', 'mobile-close-m2');
    setupBottomSheet('mobile-sheet-m3', 'sheet-handle-m3', 'mobile-close-m3');
    setupBottomSheet('mobile-sheet-m4', 'sheet-handle-m4', 'mobile-close-m4');
    setupBottomSheet('mobile-sheet-m5', 'sheet-handle-m5', 'mobile-close-m5');
    setupBottomSheet('mobile-sheet-m6', 'sheet-handle-m6', 'mobile-close-m6');

    // -----------------------------------------------------------------
    // 4. Inputs Setup & Standard Logic
    // -----------------------------------------------------------------
    function setupRadioToggle(name, cb) {
        document.querySelectorAll(`input[name="${name}"]`).forEach(r => r.addEventListener('change', () => { if (r.checked) cb(r.value); }));
        const c = document.querySelector(`input[name="${name}"]:checked`); if (c) cb(c.value);
    }

    // Mode 2: Refrigeration Settings
    setupRadioToggle('flow_mode_m2', v => {
        const rpmPanel = document.getElementById('rpm-inputs-m2');
        const volPanel = document.getElementById('vol-inputs-m2');
        if (rpmPanel) rpmPanel.style.display = v === 'rpm' ? 'grid' : 'none';
        if (volPanel) volPanel.style.display = v === 'vol' ? 'block' : 'none';
    });

    // ECO Toggle Logic
    const ecoCb = document.getElementById('enable_eco_m2');
    if (ecoCb) ecoCb.addEventListener('change', () => {
        document.getElementById('eco-settings-m2').classList.toggle('hidden', !ecoCb.checked);
        document.getElementById('eco-placeholder-m2').classList.toggle('hidden', ecoCb.checked);
    });

    // [New v7.2] SLHX Toggle Logic
    const slhxCb = document.getElementById('enable_slhx_m2');
    if (slhxCb) slhxCb.addEventListener('change', () => {
        document.getElementById('slhx-settings-m2').classList.toggle('hidden', !slhxCb.checked);
        document.getElementById('slhx-placeholder-m2').classList.toggle('hidden', slhxCb.checked);
    });

    setupRadioToggle('eco_type_m2', v => {
        const subcoolerInputs = document.getElementById('eco-subcooler-inputs-m2');
        if (subcoolerInputs) {
            subcoolerInputs.classList.toggle('hidden', v !== 'subcooler');
        }
    });

    // Smart Suggestion for Manual ECO Pressure
    setupRadioToggle('eco_press_mode_m2', v => {
        const e = document.getElementById('temp_eco_sat_m2');
        if (!e) return;

        if (v === 'auto') {
            e.disabled = true;
            e.value = '';
            e.placeholder = 'Auto';
            e.classList.add('opacity-50', 'bg-gray-100/50');
        } else {
            e.disabled = false;
            e.classList.remove('opacity-50', 'bg-gray-100/50');

            if (e.value === '') {
                const Te = parseFloat(document.getElementById('temp_evap_m2').value) || 0;
                const Tc = parseFloat(document.getElementById('temp_cond_m2').value) || 40;

                const Te_K = Te + 273.15;
                const Tc_K = Tc + 273.15;
                const T_rec = Math.sqrt(Te_K * Tc_K) - 273.15;

                e.value = T_rec.toFixed(1);
            }
            e.placeholder = 'e.g. ' + e.value;
        }
    });

    setupRadioToggle('eff_mode_m2', v => {
        const motorGroup = document.getElementById('motor-eff-group-m2');
        const label = document.getElementById('eta_s_label_m2');
        if (motorGroup) motorGroup.style.display = v === 'input' ? 'block' : 'none';
        if (label) label.textContent = v === 'input' ? '总等熵效率' : '等熵效率';
    });

    // Mode 3: Gas Settings
    setupRadioToggle('flow_mode_m3', v => {
        const rpmPanel = document.getElementById('rpm-inputs-m3');
        const volPanel = document.getElementById('vol-inputs-m3');
        if (rpmPanel) rpmPanel.style.display = v === 'rpm' ? 'grid' : 'none';
        if (volPanel) volPanel.style.display = v === 'vol' ? 'block' : 'none';
    });

    // Auto Lock Helpers
    const setupLock = (id, ids) => {
        const b = document.getElementById(id);
        if (!b) return;
        b.addEventListener('change', () => ids.forEach(i => {
            const e = document.getElementById(i); if (e) { e.disabled = b.checked; e.classList.toggle('opacity-50', b.checked); }
        }));
        const event = new Event('change'); b.dispatchEvent(event);
    }
    setupLock('auto-eff-m2', ['eta_s_m2', 'eta_v_m2']);
    setupLock('auto-eff-m3', ['eta_iso_m3', 'eta_v_m3']);
    setupLock('auto-eff-m4-lt', ['eta_v_m4_lt', 'eta_s_m4_lt']);
    setupLock('auto-eff-m4-ht', ['eta_v_m4_ht', 'eta_s_m4_ht']);
    setupLock('auto-eff-m5-lp', ['eta_v_m5_lp', 'eta_s_m5_lp']);
    setupLock('auto-eff-m5-hp', ['eta_s_m5_hp']);
    setupLock('auto-eff-m6-lp', ['eta_v_m6_lp', 'eta_s_m6_lp']);
    setupLock('auto-eff-m6-hp', ['eta_v_m6_hp', 'eta_s_m6_hp']);

    // Mode 4: ECO Toggle Logic (HT only - LT取消ECO)
    const ecoCbHt = document.getElementById('enable_eco_m4_ht');
    if (ecoCbHt) ecoCbHt.addEventListener('change', () => {
        document.getElementById('eco-settings-m4-ht').classList.toggle('hidden', !ecoCbHt.checked);
        document.getElementById('eco-placeholder-m4-ht').classList.toggle('hidden', ecoCbHt.checked);
    });

    // Mode 4: SLHX Toggle Logic (LT only - HT取消SLHX)
    const slhxCbLt = document.getElementById('enable_slhx_m4_lt');
    if (slhxCbLt) slhxCbLt.addEventListener('change', () => {
        document.getElementById('slhx-settings-m4-lt').classList.toggle('hidden', !slhxCbLt.checked);
        document.getElementById('slhx-placeholder-m4-lt').classList.toggle('hidden', slhxCbLt.checked);
    });

    // Mode 6: Intermediate Cooler (ECO) Toggle Logic
    const ecoCbM6 = document.getElementById('enable_eco_m6');
    if (ecoCbM6) ecoCbM6.addEventListener('change', () => {
        const settings = document.getElementById('eco-settings-m6');
        const placeholder = document.getElementById('eco-placeholder-m6');
        if (settings) settings.classList.toggle('hidden', !ecoCbM6.checked);
        if (placeholder) placeholder.classList.toggle('hidden', ecoCbM6.checked);
    });
    
    // Mode 6: ECO Type Toggle - Intermediate Cooler
    setupRadioToggle('eco_type_m6', v => {
        const flashTankInputs = document.getElementById('eco-flash-tank-inputs-m6');
        const subcoolerInputs = document.getElementById('eco-subcooler-inputs-m6');
        if (flashTankInputs) flashTankInputs.classList.toggle('hidden', v !== 'flash_tank');
        if (subcoolerInputs) subcoolerInputs.classList.toggle('hidden', v !== 'subcooler');
    });
    
    // Mode 6: ECO Toggle Logic - Low Pressure Stage
    const ecoCbM6Lp = document.getElementById('enable_eco_m6_lp');
    if (ecoCbM6Lp) ecoCbM6Lp.addEventListener('change', () => {
        const settings = document.getElementById('eco-settings-m6-lp');
        const placeholder = document.getElementById('eco-placeholder-m6-lp');
        if (settings) settings.classList.toggle('hidden', !ecoCbM6Lp.checked);
        if (placeholder) placeholder.classList.toggle('hidden', ecoCbM6Lp.checked);
    });
    
    // Mode 6: ECO Toggle Logic - High Pressure Stage
    const ecoCbM6Hp = document.getElementById('enable_eco_m6_hp');
    if (ecoCbM6Hp) ecoCbM6Hp.addEventListener('change', () => {
        const settings = document.getElementById('eco-settings-m6-hp');
        const placeholder = document.getElementById('eco-placeholder-m6-hp');
        if (settings) settings.classList.toggle('hidden', !ecoCbM6Hp.checked);
        if (placeholder) placeholder.classList.toggle('hidden', ecoCbM6Hp.checked);
    });
    
    // Mode 6: ECO Type Toggle - Low Pressure Stage
    setupRadioToggle('eco_type_m6_lp', v => {
        const subcoolerInputs = document.getElementById('eco-subcooler-inputs-m6-lp');
        if (subcoolerInputs) {
            subcoolerInputs.classList.toggle('hidden', v !== 'subcooler');
        }
    });
    
    // Mode 6: ECO Type Toggle - High Pressure Stage
    setupRadioToggle('eco_type_m6_hp', v => {
        const subcoolerInputs = document.getElementById('eco-subcooler-inputs-m6-hp');
        if (subcoolerInputs) {
            subcoolerInputs.classList.toggle('hidden', v !== 'subcooler');
        }
    });

    // Mode 4: ECO Type Toggle (HT only)
    setupRadioToggle('eco_type_m4_ht', v => {
        const subcoolerInputs = document.getElementById('eco-subcooler-inputs-m4-ht');
        if (subcoolerInputs) {
            subcoolerInputs.classList.toggle('hidden', v !== 'subcooler');
        }
    });

    // Mode 4: ECO Pressure Mode Toggle (HT only) - Auto update saturation temp
    setupRadioToggle('eco_press_mode_m4_ht', v => {
        const satTempInput = document.getElementById('temp_eco_sat_m4_ht');
        if (satTempInput) {
            satTempInput.disabled = v === 'auto';
            satTempInput.classList.toggle('bg-white/50', v === 'auto');
        }
    });

    // Mode 5: Intermediate Pressure Mode Toggle
    setupRadioToggle('inter_press_mode_m5', v => {
        const satTempInput = document.getElementById('temp_inter_sat_m5');
        if (satTempInput) {
            satTempInput.disabled = v === 'auto';
            satTempInput.classList.toggle('bg-white/50', v === 'auto');
        }
    });

    // Mode 5: SLHX Toggle Logic
    const slhxCbM5 = document.getElementById('enable_slhx_m5');
    if (slhxCbM5) slhxCbM5.addEventListener('change', () => {
        document.getElementById('slhx-settings-m5').classList.toggle('hidden', !slhxCbM5.checked);
        document.getElementById('slhx-placeholder-m5').classList.toggle('hidden', slhxCbM5.checked);
    });

    // Mode 6: Intermediate Pressure Mode Toggle
    setupRadioToggle('inter_press_mode_m6', v => {
        const satTempInput = document.getElementById('temp_inter_sat_m6');
        if (satTempInput) {
            satTempInput.disabled = v === 'auto';
            satTempInput.classList.toggle('bg-white/50', v === 'auto');
        }
    });

    // Mode 4: Cascade Settings
    setupRadioToggle('flow_mode_m4_lt', v => {
        const rpmPanel = document.getElementById('rpm-inputs-m4-lt');
        const volPanel = document.getElementById('vol-inputs-m4-lt');
        if (rpmPanel) rpmPanel.style.display = v === 'rpm' ? 'grid' : 'none';
        if (volPanel) volPanel.style.display = v === 'vol' ? 'block' : 'none';
    });

    setupRadioToggle('flow_mode_m4_ht', v => {
        const rpmPanel = document.getElementById('rpm-inputs-m4-ht');
        const volPanel = document.getElementById('vol-inputs-m4-ht');
        if (rpmPanel) rpmPanel.style.display = v === 'rpm' ? 'grid' : 'none';
        if (volPanel) volPanel.style.display = v === 'vol' ? 'block' : 'none';
    });
    
    // Mode 3 Smart Moisture Unit Switcher
    const fluidM3 = document.getElementById('fluid_m3');
    const moistTypeM3 = document.getElementById('moisture_type_m3');
    const moistValM3 = document.getElementById('moisture_val_m3');

    if (fluidM3 && moistTypeM3 && moistValM3) {
        fluidM3.addEventListener('change', () => {
            const fluid = fluidM3.value;
            if (fluid === 'Air') {
                moistTypeM3.value = 'rh';
                moistValM3.value = '50'; // Default 50% RH
            }
            else if (fluid === 'Water') {
                moistTypeM3.value = 'rh';
                moistValM3.value = '0';
                moistValM3.disabled = true;
            }
            else {
                moistTypeM3.value = 'ppmw';
                moistValM3.value = '100'; // Default 100 PPMw
                moistValM3.disabled = false;
            }
        });
    }

    // -----------------------------------------------------------------
    // 5. Polynomial Mode Logic (显隐控制与智能粘贴)
    // -----------------------------------------------------------------

    // 模型切换 Toggle 监听
    const setupModelToggle = () => {
        const toggles = document.querySelectorAll('input[name="model_select_m2"]');
        const geoPanel = document.getElementById('geometry-input-panel');
        const polyPanel = document.getElementById('polynomial-input-panel');
        const effPanel = document.getElementById('efficiency-panel-m2'); 

        const updateDisplay = (mode) => {
            if (mode === AppState.MODES.GEOMETRY) {
                if (geoPanel) geoPanel.classList.remove('hidden');
                if (polyPanel) polyPanel.classList.add('hidden');
                if (effPanel) effPanel.classList.remove('hidden');
                AppState.setMode(AppState.MODES.GEOMETRY);
            } else {
                if (geoPanel) geoPanel.classList.add('hidden');
                if (polyPanel) polyPanel.classList.remove('hidden');
                if (effPanel) effPanel.classList.add('hidden');
                AppState.setMode(AppState.MODES.POLYNOMIAL);
            }
        };

        toggles.forEach(t => {
            t.addEventListener('change', (e) => {
                if (e.target.checked) updateDisplay(e.target.value);
            });
        });

        const checked = document.querySelector('input[name="model_select_m2"]:checked');
        if (checked) updateDisplay(checked.value);
    };

    // Excel 智能粘贴监听器
    const setupSmartPaste = () => {
        const polyInputs = document.querySelectorAll('.poly-coeff-input');

        polyInputs.forEach(input => {
            input.addEventListener('paste', (e) => {
                e.preventDefault();

                const clipboardData = (e.clipboardData || window.clipboardData).getData('text');
                if (!clipboardData) return;

                const values = clipboardData
                    .split(/[\t,\s\n]+/)
                    .map(v => v.trim())
                    .filter(v => v !== '' && !isNaN(parseFloat(v)));

                if (values.length === 0) return;

                const container = input.closest('.grid');
                if (!container) return;

                const groupInputs = Array.from(container.querySelectorAll('.poly-coeff-input'));
                const startIndex = groupInputs.indexOf(input);

                if (startIndex === -1) return;

                let pasteCount = 0;
                for (let i = 0; i < values.length; i++) {
                    const targetIndex = startIndex + i;
                    if (targetIndex < groupInputs.length) {
                        groupInputs[targetIndex].value = values[i];
                        groupInputs[targetIndex].dispatchEvent(new Event('input'));
                        pasteCount++;
                    }
                }

                console.log(`[Smart Paste] Pasted ${pasteCount} coefficients.`);

                input.classList.add('ring-2', 'ring-teal-500');
                setTimeout(() => input.classList.remove('ring-2', 'ring-teal-500'), 600);
            });
        });
    };

    setupModelToggle();
    setupSmartPaste();

    // -----------------------------------------------------------------
    // 6. Global UI Effects
    // -----------------------------------------------------------------
    document.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('mousedown', () => btn.classList.add('scale-[0.98]'));
        btn.addEventListener('mouseup', () => btn.classList.remove('scale-[0.98]'));
        btn.addEventListener('mouseleave', () => btn.classList.remove('scale-[0.98]'));
    });

    // 初始化默认状态：显示制冷热泵模式的第一个子模式（单级）
    switchMainTab(0);
    switchSubTab(0);

    // -----------------------------------------------------------------
    // 7. 初始化验证：检查所有必要的元素是否存在
    // -----------------------------------------------------------------
    console.log("[UI] Validating UI elements...");
    
    // 验证主标签
    let allValid = true;
    mainTabs.forEach((t, i) => {
        const btn = document.getElementById(t.btnId);
        const content = document.getElementById(t.contentId);
        const subNav = t.subNavId ? document.getElementById(t.subNavId) : null;
        
        if (!btn) {
            console.error(`[UI] Main tab button not found: ${t.btnId}`);
            allValid = false;
        }
        if (!content) {
            console.error(`[UI] Main tab content not found: ${t.contentId}`);
            allValid = false;
        }
        if (t.subNavId && !subNav) {
            console.error(`[UI] Sub navigation not found: ${t.subNavId}`);
            allValid = false;
        }
    });
    
    // 验证子标签
    subTabs.forEach((t, i) => {
        const btn = document.getElementById(t.btnId);
        const content = document.getElementById(t.contentId);
        const sheet = document.getElementById(t.sheetId);
        
        if (!btn) {
            console.error(`[UI] Sub-tab button not found: ${t.btnId}`);
            allValid = false;
        }
        if (!content) {
            console.error(`[UI] Sub-tab content not found: ${t.contentId}`);
            allValid = false;
        } else {
            // 检查内容是否在正确的父容器内
            const refrigContainer = document.getElementById('tab-content-refrig');
            if (refrigContainer && !refrigContainer.contains(content)) {
                console.error(`[UI] Sub-tab content ${t.contentId} is not inside tab-content-refrig!`);
                allValid = false;
            }
        }
        if (!sheet) {
            console.warn(`[UI] Mobile sheet not found: ${t.sheetId} (this is optional)`);
        }
    });
    
    if (allValid) {
        console.log("[UI] ✅ All UI elements validated successfully");
    } else {
        console.error("[UI] ❌ Some UI elements are missing or incorrectly placed!");
    }

    console.log("✅ UI v7.2 Initialized.");
}

// 导出函数：自动展开移动端结果面板
export function openMobileSheet(mode) {
    const sheet = document.getElementById(`mobile-sheet-${mode}`);
    const handle = document.getElementById(`sheet-handle-${mode}`);
    
    if (sheet && handle && sheet.classList.contains('translate-y-[calc(100%-80px)]')) {
        console.log(`[UI] Auto-expanding mobile sheet for ${mode}`);
        handle.click();
    }
}