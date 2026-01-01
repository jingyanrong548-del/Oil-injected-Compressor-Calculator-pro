// =====================================================================
// ui.js: UI 交互逻辑 (v7.2 SLHX & VSD Support)
// 职责: 界面事件监听、显隐控制、历史记录管理、智能粘贴、图表自适应
// =====================================================================

import { HistoryDB } from './storage.js';
import { resizeAllCharts, getChartInstance } from './charts.js';
import { AppState } from './state.js';
import i18next from './i18n.js';

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
            if (confirm(i18next.t('common.clearHistoryConfirm'))) { HistoryDB.clear(); renderHistoryList(); }
        });
    }

    function renderHistoryList() {
        const records = HistoryDB.getAll();
        if (!historyList) return;
        historyList.innerHTML = '';
        if (records.length === 0) {
            historyList.innerHTML = `<div class="text-center text-gray-400 mt-20 text-sm">${i18next.t('common.noRecords')}<br>${i18next.t('common.calculateToSave')}</div>`;
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
        { btnId: 'tab-btn-gas', contentId: 'tab-content-gas', subNavId: 'gas-sub-nav' }
    ];

    // 子标签（制冷热泵模式下的5个子模式）
    const subTabs = [
        { btnId: 'sub-tab-btn-m2', contentId: 'sub-tab-content-m2', sheetId: 'mobile-sheet-m2', calcBtnId: 'calc-button-mode-2', color: 'teal' },
        { btnId: 'sub-tab-btn-m4', contentId: 'sub-tab-content-m4', sheetId: 'mobile-sheet-m4', calcBtnId: 'calc-button-mode-4', color: 'sky' },
        { btnId: 'sub-tab-btn-m5', contentId: 'sub-tab-content-m5', sheetId: 'mobile-sheet-m5', calcBtnId: 'calc-button-mode-5', color: 'purple' },
        { btnId: 'sub-tab-btn-m6', contentId: 'sub-tab-content-m6', sheetId: 'mobile-sheet-m6', calcBtnId: 'calc-button-mode-6', color: 'indigo' },
        { btnId: 'sub-tab-btn-m7', contentId: 'sub-tab-content-m7', sheetId: 'mobile-sheet-m7', calcBtnId: 'calc-button-mode-7', color: 'teal' }
    ];

    // 子标签（气体压缩模式下的2个子模式）
    const gasSubTabs = [
        { btnId: 'sub-tab-btn-m3', contentId: 'sub-tab-content-m3', sheetId: 'mobile-sheet-m3', calcBtnId: 'calc-button-mode-3', color: 'orange' },
        { btnId: 'sub-tab-btn-m3-two-stage', contentId: 'sub-tab-content-m3-two-stage', sheetId: 'mobile-sheet-m3-two-stage', calcBtnId: 'calc-button-mode-3-two-stage', color: 'orange' }
    ];

    // 模式标识到导航索引的映射
    const modeToNavMap = {
        'M2': { mainIdx: 0, subIdx: 0 },  // 制冷热泵 -> 单级
        'M3': { mainIdx: 1, subIdx: 0 },   // 气体压缩 -> 单级
        'M3TS': { mainIdx: 1, subIdx: 1 }, // 气体压缩 -> 双级
        'M4': { mainIdx: 0, subIdx: 1 },  // 制冷热泵 -> 复叠
        'M5': { mainIdx: 0, subIdx: 2 },  // 制冷热泵 -> 单机双级
        'M6': { mainIdx: 0, subIdx: 3 },   // 制冷热泵 -> 双机双级
        'M7': { mainIdx: 0, subIdx: 4 }   // 制冷热泵 -> 氨热泵
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
                    if (i === 0) {
                        // 制冷热泵模式：Teal/青色
                        btn.classList.remove('bg-white', 'text-gray-600', 'font-semibold');
                        btn.classList.add('bg-teal-500', 'text-white', 'font-bold', 'shadow-md', 'ring-2', 'ring-teal-400');
                    } else {
                        // 气体压缩模式：Orange/橙色
                        btn.classList.remove('bg-white', 'text-gray-600', 'font-semibold');
                        btn.classList.add('bg-orange-500', 'text-white', 'font-bold', 'shadow-md', 'ring-2', 'ring-orange-400');
                    }
                }
                if (content) {
                    // 强制显示：移除hidden类，设置display和opacity
                    content.classList.remove('hidden', 'opacity-0');
                    content.classList.add('opacity-100');
                    content.style.setProperty('display', 'block', 'important');
                    content.style.setProperty('visibility', 'visible', 'important');
                    content.style.setProperty('opacity', '1', 'important');
                }
                // 显示/隐藏子导航
                if (subNav) {
                    subNav.classList.remove('hidden');
                    subNav.style.setProperty('display', 'block', 'important');
                }
            } else {
                // 未选中状态
                if (btn) {
                    // 移除所有颜色类，恢复为白色背景
                    btn.classList.remove('bg-teal-500', 'bg-orange-500', 'text-white', 'font-bold', 'shadow-md', 'ring-2', 'ring-teal-400', 'ring-orange-400');
                    btn.classList.add('bg-white', 'text-gray-600', 'font-semibold');
                }
                if (content) {
                    // 强制隐藏：添加hidden类，设置display为none
                    content.classList.add('hidden', 'opacity-0');
                    content.classList.remove('opacity-100');
                    content.style.setProperty('display', 'none', 'important');
                    content.style.setProperty('visibility', 'hidden', 'important');
                    content.style.setProperty('opacity', '0', 'important');
                }
                // 隐藏子导航
                if (subNav) {
                    subNav.classList.add('hidden');
                    subNav.style.setProperty('display', 'none', 'important');
                }
            }
        });

        // 如果切换到制冷热泵模式，默认显示第一个子模式（单级）
        if (mainIdx === 0) {
            switchSubTab(0);
        }
        // 如果切换到气体压缩模式，默认显示第一个子模式（单级）
        if (mainIdx === 1) {
            switchGasSubTab(0);
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
                    // 移除所有可能的颜色类
                    btn.classList.remove('bg-white', 'bg-teal-500', 'bg-sky-500', 'bg-purple-500', 'bg-indigo-500', 
                                       'text-gray-600', 'text-gray-900', 'text-white', 
                                       'font-semibold', 'ring-2', 'ring-teal-400', 'ring-sky-400', 'ring-purple-400', 'ring-indigo-400', 'ring-blue-500/30');
                    
                    // 根据子模式应用对应的颜色
                    const colorClasses = {
                        'teal': { bg: 'bg-teal-500', text: 'text-white', ring: 'ring-teal-400' },
                        'sky': { bg: 'bg-sky-500', text: 'text-white', ring: 'ring-sky-400' },
                        'purple': { bg: 'bg-purple-500', text: 'text-white', ring: 'ring-purple-400' },
                        'indigo': { bg: 'bg-indigo-500', text: 'text-white', ring: 'ring-indigo-400' }
                    };
                    
                    const colorClass = colorClasses[t.color] || colorClasses['teal'];
                    btn.classList.add(colorClass.bg, colorClass.text, 'font-bold', 'shadow-md', 'ring-2', colorClass.ring);
                } else {
                    console.error(`[UI] Sub-tab button not found: ${t.btnId}`);
                }
                
                if (content) {
                    // 第一步：移除所有隐藏相关的类（必须先移除hidden类，因为Tailwind的hidden类使用!important）
                    content.classList.remove('hidden', 'opacity-0');
                    content.classList.add('opacity-100');
                    
                    // 第二步：检查并修复所有父容器（向上遍历整个DOM树）
                    let parent = content.parentElement;
                    while (parent && parent !== document.body) {
                        const parentStyle = getComputedStyle(parent);
                        if (parentStyle.display === 'none' || parent.classList.contains('hidden')) {
                            console.warn(`[UI] Parent element ${parent.id || parent.tagName} is hidden, fixing...`);
                            parent.classList.remove('hidden', 'opacity-0');
                            parent.classList.add('opacity-100');
                            parent.style.setProperty('display', 'block', 'important');
                            parent.style.setProperty('visibility', 'visible', 'important');
                            parent.style.setProperty('opacity', '1', 'important');
                        }
                        parent = parent.parentElement;
                    }
                    
                    // 第三步：强制设置显示样式（使用 !important 覆盖Tailwind的hidden类）
                    content.style.setProperty('display', 'block', 'important');
                    content.style.setProperty('visibility', 'visible', 'important');
                    content.style.setProperty('opacity', '1', 'important');
                    content.style.setProperty('position', 'relative', 'important');
                    
                    // 第四步：修复所有直接子元素（确保内容区域也可见）
                    const directChildren = Array.from(content.children);
                    directChildren.forEach(child => {
                        const childStyle = getComputedStyle(child);
                        if (childStyle.display === 'none' || child.classList.contains('hidden')) {
                            console.warn(`[UI] Child element ${child.className || child.tagName} is hidden, fixing...`);
                            child.classList.remove('hidden', 'opacity-0');
                            child.style.setProperty('display', 'block', 'important');
                            child.style.setProperty('visibility', 'visible', 'important');
                            child.style.setProperty('opacity', '1', 'important');
                        }
                    });
                    
                    // 第五步：延迟检查，确保样式已应用
                    setTimeout(() => {
                        const computedStyle = getComputedStyle(content);
                        if (content.offsetParent === null || computedStyle.display === 'none') {
                            console.error(`[UI] Content ${t.contentId} still hidden after fix!`);
                            console.error(`[UI] Computed styles: display=${computedStyle.display}, visibility=${computedStyle.visibility}, opacity=${computedStyle.opacity}`);
                            // 再次强制设置，包括所有子元素
                            content.classList.remove('hidden');
                            content.style.setProperty('display', 'block', 'important');
                            content.style.setProperty('visibility', 'visible', 'important');
                            content.style.setProperty('opacity', '1', 'important');
                            content.style.setProperty('position', 'static', 'important');
                            
                            // 再次修复所有子元素
                            directChildren.forEach(child => {
                                child.classList.remove('hidden');
                                child.style.setProperty('display', 'block', 'important');
                                child.style.setProperty('visibility', 'visible', 'important');
                                child.style.setProperty('opacity', '1', 'important');
                            });
                        } else {
                            console.log(`[UI] Sub-tab content ${t.contentId} is now visible (offsetParent: ${content.offsetParent.tagName})`);
                        }
                    }, 100);
                    
                    console.log(`[UI] Sub-tab content ${t.contentId} made visible`);
                } else {
                    console.error(`[UI] Sub-tab content not found: ${t.contentId}`);
                }
                
                if (sheet) {
                    sheet.classList.remove('hidden');
                    sheet.style.display = '';
                }
            } else {
                // 未选中状态 - 强制隐藏所有未选中的子模式
                if (btn) {
                    // 移除所有颜色类，恢复为白色背景
                    btn.classList.remove('bg-teal-500', 'bg-sky-500', 'bg-purple-500', 'bg-indigo-500',
                                       'text-white', 'font-bold', 'shadow-md', 'ring-2',
                                       'ring-teal-400', 'ring-sky-400', 'ring-purple-400', 'ring-indigo-400');
                    btn.classList.add('bg-white', 'text-gray-600', 'font-semibold');
                }
                if (content) {
                    // 第一步：移除所有显示相关的类（特别是opacity-100，因为模式2初始状态没有hidden类）
                    content.classList.remove('opacity-100');
                    // 第二步：添加隐藏相关的类
                    content.classList.add('hidden', 'opacity-0');
                    // 第三步：强制设置隐藏样式（使用 !important 确保优先级最高）
                    content.style.setProperty('display', 'none', 'important');
                    content.style.setProperty('visibility', 'hidden', 'important');
                    content.style.setProperty('opacity', '0', 'important');
                    
                    // 第四步：隐藏所有直接子元素，防止内容区域仍然可见
                    const directChildren = Array.from(content.children);
                    directChildren.forEach(child => {
                        child.style.setProperty('display', 'none', 'important');
                        child.style.setProperty('visibility', 'hidden', 'important');
                        child.style.setProperty('opacity', '0', 'important');
                    });
                }
                if (sheet) {
                    sheet.classList.add('hidden');
                    sheet.style.setProperty('display', 'none', 'important');
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

    // 气体压缩子标签切换函数
    function switchGasSubTab(subIdx) {
        console.log(`[UI] Switching to gas sub-tab index: ${subIdx}`);
        
        const gasContainer = document.getElementById('tab-content-gas');
        if (gasContainer) {
            gasContainer.classList.remove('hidden', 'opacity-0');
            gasContainer.classList.add('opacity-100');
            gasContainer.style.setProperty('display', 'block', 'important');
            gasContainer.style.setProperty('visibility', 'visible', 'important');
            gasContainer.style.setProperty('opacity', '1', 'important');
        }
        
        gasSubTabs.forEach((t, i) => {
            const btn = document.getElementById(t.btnId);
            const content = document.getElementById(t.contentId);
            const sheet = document.getElementById(t.sheetId);
            
            if (i === subIdx) {
                // 选中状态
                if (btn) {
                    btn.classList.remove('bg-white', 'text-gray-600', 'font-semibold');
                    btn.classList.add('bg-orange-500', 'text-white', 'font-bold', 'shadow-md', 'ring-2', 'ring-orange-400');
                }
                
                if (content) {
                    content.classList.remove('hidden', 'opacity-0');
                    content.classList.add('opacity-100');
                    content.style.setProperty('display', 'block', 'important');
                    content.style.setProperty('visibility', 'visible', 'important');
                    content.style.setProperty('opacity', '1', 'important');
                }
                
                if (sheet) {
                    sheet.classList.remove('hidden');
                    sheet.style.display = '';
                }
            } else {
                // 未选中状态
                if (btn) {
                    btn.classList.remove('bg-orange-500', 'text-white', 'font-bold', 'shadow-md', 'ring-2', 'ring-orange-400');
                    btn.classList.add('bg-white', 'text-gray-600', 'font-semibold');
                }
                
                if (content) {
                    content.classList.remove('opacity-100');
                    content.classList.add('hidden', 'opacity-0');
                    content.style.setProperty('display', 'none', 'important');
                    content.style.setProperty('visibility', 'hidden', 'important');
                    content.style.setProperty('opacity', '0', 'important');
                }
                
                if (sheet) {
                    sheet.classList.add('hidden');
                    sheet.style.setProperty('display', 'none', 'important');
                }
            }
        });
    }

    // 气体压缩子标签事件监听
    gasSubTabs.forEach((t, i) => {
        const btn = document.getElementById(t.btnId);
        if (btn) btn.addEventListener('click', () => switchGasSubTab(i));
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
        if (navInfo.mainIdx === 0 && navInfo.subIdx !== null) {
            setTimeout(() => switchSubTab(navInfo.subIdx), 50);
        }
        // 如果是气体压缩模式，切换到对应的子标签
        if (navInfo.mainIdx === 1 && navInfo.subIdx !== null) {
            setTimeout(() => switchGasSubTab(navInfo.subIdx), 50);
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
                } else if (rec.mode === 'M3TS') {
                    calcBtnId = 'calc-button-mode-3-two-stage';
                } else if (navInfo.mainIdx === 0) {
                    const subTab = subTabs[navInfo.subIdx];
                    if (subTab) calcBtnId = subTab.calcBtnId;
                } else if (navInfo.mainIdx === 1) {
                    const subTab = gasSubTabs[navInfo.subIdx];
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
    setupBottomSheet('mobile-sheet-m3-two-stage', 'sheet-handle-m3-two-stage', 'mobile-close-m3-two-stage');
    setupBottomSheet('mobile-sheet-m4', 'sheet-handle-m4', 'mobile-close-m4');
    setupBottomSheet('mobile-sheet-m5', 'sheet-handle-m5', 'mobile-close-m5');
    setupBottomSheet('mobile-sheet-m6', 'sheet-handle-m6', 'mobile-close-m6');
    setupBottomSheet('mobile-sheet-m7', 'sheet-handle-m7', 'mobile-close-m7');

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
        if (label) label.textContent = v === 'input' ? i18next.t('mode2.totalIsentropicEfficiency') : i18next.t('mode2.isentropicEfficiency');
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
    setupLock('auto-eff-m3-two-stage-lp', ['eta_v_m3_two_stage_lp', 'eta_s_m3_two_stage_lp']);
    setupLock('auto-eff-m3-two-stage-hp', ['eta_v_m3_two_stage_hp', 'eta_s_m3_two_stage_hp']);

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
    // 中间冷却器ECO始终显示，不需要toggle逻辑
    // const ecoCbM6 = document.getElementById('enable_eco_m6');
    // if (ecoCbM6) ecoCbM6.addEventListener('change', () => {
    //     const settings = document.getElementById('eco-settings-m6');
    //     const placeholder = document.getElementById('eco-placeholder-m6');
    //     if (settings) settings.classList.toggle('hidden', !ecoCbM6.checked);
    //     if (placeholder) placeholder.classList.toggle('hidden', ecoCbM6.checked);
    // });
    
    // Mode 6: ECO Type Toggle - Intermediate Cooler
    setupRadioToggle('eco_type_m6', v => {
        const flashTankInputs = document.getElementById('eco-flash-tank-inputs-m6');
        const subcoolerInputs = document.getElementById('eco-subcooler-inputs-m6');
        // 确保两种模式的输入框互斥显示
        // 闪蒸罐模式：显示闪蒸罐输入框，隐藏过冷器输入框
        // 过冷器模式：隐藏闪蒸罐输入框，显示过冷器输入框
        if (flashTankInputs) {
            flashTankInputs.classList.toggle('hidden', v !== 'flash_tank');
        }
        if (subcoolerInputs) {
            subcoolerInputs.classList.toggle('hidden', v !== 'subcooler');
        }
    });
    
    // Mode 6: ECO Toggle Logic - High Pressure Stage
    const ecoCbM6Hp = document.getElementById('enable_eco_m6_hp');
    if (ecoCbM6Hp) ecoCbM6Hp.addEventListener('change', () => {
        const settings = document.getElementById('eco-settings-m6-hp');
        const placeholder = document.getElementById('eco-placeholder-m6-hp');
        if (settings) settings.classList.toggle('hidden', !ecoCbM6Hp.checked);
        if (placeholder) placeholder.classList.toggle('hidden', ecoCbM6Hp.checked);
    });
    
    // Mode 6: ECO Type Toggle - High Pressure Stage
    setupRadioToggle('eco_type_m6_hp', v => {
        const flashTankInputs = document.getElementById('eco-flash-tank-inputs-m6-hp');
        const subcoolerInputs = document.getElementById('eco-subcooler-inputs-m6-hp');
        // 闪蒸罐模式：显示提示信息，隐藏过冷器输入框
        // 过冷器模式：隐藏提示信息，显示过冷器输入框
        if (flashTankInputs) {
            flashTankInputs.classList.toggle('hidden', v !== 'flash_tank');
        }
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

    // Mode 3 Two-Stage: Intermediate Pressure Mode Toggle
    setupRadioToggle('inter_press_mode_m3_two_stage', v => {
        const pressInput = document.getElementById('press_inter_m3_two_stage');
        if (pressInput) {
            pressInput.disabled = v === 'auto';
            pressInput.classList.toggle('bg-white/50', v === 'auto');
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

    // Mode 7: Ammonia Heat Pump Flow Mode Toggle
    setupRadioToggle('flow_mode_m7', v => {
        const rpmPanel = document.getElementById('rpm-inputs-m7');
        const volPanel = document.getElementById('vol-inputs-m7');
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
    // 首先调用切换函数确保状态一致
    switchMainTab(0);
    switchSubTab(0);
    
    // 初始化气体压缩子标签：默认显示单级（但此时内容应该是隐藏的）
    // 注意：switchGasSubTab会显示tab-content-gas，所以需要在调用后再次隐藏
    switchGasSubTab(0);
    
    // 确保气体压缩内容被隐藏（因为switchGasSubTab会显示它）
    const gasContent = document.getElementById('tab-content-gas');
    if (gasContent) {
        gasContent.classList.add('hidden', 'opacity-0');
        gasContent.classList.remove('opacity-100');
        gasContent.style.setProperty('display', 'none', 'important');
        gasContent.style.setProperty('visibility', 'hidden', 'important');
        gasContent.style.setProperty('opacity', '0', 'important');
    }
    
    // 确保气体压缩子导航被隐藏
    const gasSubNav = document.getElementById('gas-sub-nav');
    if (gasSubNav) {
        gasSubNav.classList.add('hidden');
        gasSubNav.style.setProperty('display', 'none', 'important');
    }
    
    // 确保制冷热泵内容可见
    const refrigContent = document.getElementById('tab-content-refrig');
    if (refrigContent) {
        refrigContent.classList.remove('hidden', 'opacity-0');
        refrigContent.classList.add('opacity-100');
        refrigContent.style.setProperty('display', 'block', 'important');
        refrigContent.style.setProperty('visibility', 'visible', 'important');
        refrigContent.style.setProperty('opacity', '1', 'important');
    }
    
    // 确保制冷热泵子导航可见
    const refrigSubNav = document.getElementById('refrig-sub-nav');
    if (refrigSubNav) {
        refrigSubNav.classList.remove('hidden');
        refrigSubNav.style.setProperty('display', 'block', 'important');
    }

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
    
    if (sheet) {
        // 检查sheet是否处于折叠状态
        const isCollapsed = sheet.classList.contains('translate-y-[calc(100%-80px)]');
        if (isCollapsed) {
            console.log(`[UI] Auto-expanding mobile sheet for ${mode}`);
            // 直接操作DOM来展开sheet，确保展开成功
            sheet.classList.remove('translate-y-[calc(100%-80px)]');
            sheet.classList.add('translate-y-0', 'shadow-2xl');
            // 强制设置高度，确保容器有明确高度
            sheet.style.height = '95vh';
            const innerDiv = sheet.querySelector('.bg-white\\/90');
            if (innerDiv) {
                innerDiv.style.height = '100%';
                innerDiv.style.minHeight = '0';
            }
            // 触发图表调整，延迟执行以确保sheet已完全展开
            setTimeout(() => { 
                resizeAllCharts();
                // 尝试初始化移动端图表（如果之前因为不可见而跳过）
                const mobileChartId = `chart-mobile-${mode}`;
                const mobileChart = document.getElementById(mobileChartId);
                if (mobileChart && !mobileChart.classList.contains('hidden')) {
                    // 如果图表容器现在可见，触发resize以初始化
                    const chartInstance = getChartInstance(mobileChartId);
                    if (chartInstance) {
                        chartInstance.resize();
                    }
                }
            }, 350);
        }
    } else {
        console.warn(`[UI] Cannot find mobile sheet for ${mode}`);
    }
}