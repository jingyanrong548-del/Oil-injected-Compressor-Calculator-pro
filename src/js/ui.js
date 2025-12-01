// =====================================================================
// ui.js: UI 交互逻辑 (v5.0 Polynomial Support)
// 职责: 界面事件监听、显隐控制、历史记录管理、智能粘贴、图表自适应
// =====================================================================

import { HistoryDB } from './storage.js';
import { resizeAllCharts } from './charts.js';
import { AppState } from './state.js'; // [New] 引入状态管理

export function initUI() {
    console.log("🚀 UI Initializing (v5.0 with Polynomial Support)...");

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
            if(confirm('Clear history?')) { HistoryDB.clear(); renderHistoryList(); }
        });
    }

    function renderHistoryList() {
        const records = HistoryDB.getAll();
        if(!historyList) return;
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
    // 2. Tab & Restore Logic (标签页切换与数据恢复)
    // -----------------------------------------------------------------
    const tabs = [
        { btnId: 'tab-btn-m2', contentId: 'tab-content-m2', sheetId: 'mobile-sheet-m2', calcBtnId: 'calc-button-mode-2' },
        { btnId: 'tab-btn-m3', contentId: 'tab-content-m3', sheetId: 'mobile-sheet-m3', calcBtnId: 'calc-button-mode-3' }
    ];

    function switchTab(idx) {
        tabs.forEach((t, i) => {
            const btn = document.getElementById(t.btnId);
            const content = document.getElementById(t.contentId);
            const sheet = document.getElementById(t.sheetId);
            if(i===idx) {
                if(btn) { btn.classList.add('bg-white', 'shadow-sm', 'text-gray-900'); btn.classList.remove('text-gray-500'); }
                if(content) { content.classList.remove('hidden', 'opacity-0'); content.classList.add('opacity-100'); }
                if(sheet) sheet.classList.remove('hidden');
            } else {
                if(btn) { btn.classList.remove('bg-white', 'shadow-sm', 'text-gray-900'); btn.classList.add('text-gray-500'); }
                if(content) { content.classList.add('hidden', 'opacity-0'); content.classList.remove('opacity-100'); }
                if(sheet) sheet.classList.add('hidden');
            }
        });
    }
    
    tabs.forEach((t, i) => {
        const btn = document.getElementById(t.btnId);
        if(btn) btn.addEventListener('click', () => switchTab(i));
    });

    function loadRecord(rec) {
        const idx = rec.mode === 'M2' ? 0 : 1;
        switchTab(idx);
        // const formId = rec.mode === 'M2' ? 'calc-form-mode-2' : 'calc-form-mode-3'; // Unused
        const inputs = rec.inputs;
        if (inputs) {
            Object.keys(inputs).forEach(k => {
                const el = document.getElementById(k);
                if(el) {
                    if(el.type==='checkbox') { el.checked = inputs[k]; el.dispatchEvent(new Event('change')); }
                    else if (el.type !== 'radio') { el.value = inputs[k]; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); }
                } else {
                    // Check radio buttons
                    const radios = document.querySelectorAll(`input[name="${k}"]`);
                    radios.forEach(r => { if(r.value === inputs[k]) { r.checked=true; r.dispatchEvent(new Event('change')); }});
                }
            });
            // Try auto-calculate after loading
            setTimeout(() => {
                const btn = document.getElementById(tabs[idx].calcBtnId);
                if(btn) btn.click();
            }, 100);
        }
    }

    // -----------------------------------------------------------------
    // 3. Mobile Sheet Logic (移动端底部抽屉)
    // -----------------------------------------------------------------
    function setupBottomSheet(sId, hId, cId) {
        const s = document.getElementById(sId), h = document.getElementById(hId), c = document.getElementById(cId);
        if(!s || !h) return;
        
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
        if(c) c.addEventListener('click', (e) => { e.stopPropagation(); toggle(false); });
    }
    setupBottomSheet('mobile-sheet-m2', 'sheet-handle-m2', 'mobile-close-m2');
    setupBottomSheet('mobile-sheet-m3', 'sheet-handle-m3', 'mobile-close-m3');

    // -----------------------------------------------------------------
    // 4. Inputs Setup & Standard Logic (普通模式输入控制)
    // -----------------------------------------------------------------
    function setupRadioToggle(name, cb) {
        document.querySelectorAll(`input[name="${name}"]`).forEach(r => r.addEventListener('change', () => { if(r.checked) cb(r.value); }));
        const c = document.querySelector(`input[name="${name}"]:checked`); if(c) cb(c.value);
    }
    
    // Mode 2: Refrigeration Settings
    setupRadioToggle('flow_mode_m2', v => {
        const rpmPanel = document.getElementById('rpm-inputs-m2');
        const volPanel = document.getElementById('vol-inputs-m2');
        if(rpmPanel) rpmPanel.style.display = v==='rpm'?'grid':'none';
        if(volPanel) volPanel.style.display = v==='vol'?'block':'none';
    });
    
    const ecoCb = document.getElementById('enable_eco_m2');
    if(ecoCb) ecoCb.addEventListener('change', () => {
        document.getElementById('eco-settings-m2').classList.toggle('hidden', !ecoCb.checked);
        document.getElementById('eco-placeholder-m2').classList.toggle('hidden', ecoCb.checked);
    });
    
    setupRadioToggle('eco_type_m2', v => {
        const subcoolerInputs = document.getElementById('eco-subcooler-inputs-m2');
        if(subcoolerInputs) {
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
            
            // 智能推荐逻辑: 如果输入框为空，计算几何平均温度推荐值
            if (e.value === '') {
                const Te = parseFloat(document.getElementById('temp_evap_m2').value) || 0;
                const Tc = parseFloat(document.getElementById('temp_cond_m2').value) || 40;
                
                // 计算开尔文下的几何平均，再转回摄氏度
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
        if(motorGroup) motorGroup.style.display = v==='input'?'block':'none';
        if(label) label.textContent = v==='input'?'总等熵效率':'等熵效率';
    });
    
    // Mode 3: Gas Settings
    setupRadioToggle('flow_mode_m3', v => {
        const rpmPanel = document.getElementById('rpm-inputs-m3');
        const volPanel = document.getElementById('vol-inputs-m3');
        if(rpmPanel) rpmPanel.style.display = v==='rpm'?'grid':'none';
        if(volPanel) volPanel.style.display = v==='vol'?'block':'none';
    });

    // Auto Lock Helpers (Checkboxes)
    const setupLock = (id, ids) => {
        const b = document.getElementById(id);
        if(!b) return;
        b.addEventListener('change', () => ids.forEach(i => {
            const e = document.getElementById(i); if(e) { e.disabled=b.checked; e.classList.toggle('opacity-50', b.checked); }
        }));
        const event = new Event('change'); b.dispatchEvent(event);
    }
    setupLock('auto-eff-m2', ['eta_s_m2', 'eta_v_m2']);
    setupLock('auto-eff-m3', ['eta_iso_m3', 'eta_v_m3']);

    // -----------------------------------------------------------------
    // 5. Polynomial Mode Logic (✨ 新增：多项式拟合交互)
    // -----------------------------------------------------------------
    
    // 模型切换 Toggle 监听
    const setupModelToggle = () => {
        // 监听名为 'model_select_m2' 的所有 radio input
        const toggles = document.querySelectorAll('input[name="model_select_m2"]');
        const geoPanel = document.getElementById('geometry-input-panel');
        const polyPanel = document.getElementById('polynomial-input-panel');
        
        const updateDisplay = (mode) => {
            if (mode === AppState.MODES.GEOMETRY) {
                if (geoPanel) geoPanel.classList.remove('hidden');
                if (polyPanel) polyPanel.classList.add('hidden');
                AppState.setMode(AppState.MODES.GEOMETRY);
            } else {
                if (geoPanel) geoPanel.classList.add('hidden');
                if (polyPanel) polyPanel.classList.remove('hidden');
                AppState.setMode(AppState.MODES.POLYNOMIAL);
            }
        };

        toggles.forEach(t => {
            t.addEventListener('change', (e) => {
                if(e.target.checked) updateDisplay(e.target.value);
            });
        });
        
        // 初始化：读取当前选中的 radio (若 HTML 中有 checked 属性)
        const checked = document.querySelector('input[name="model_select_m2"]:checked');
        if (checked) updateDisplay(checked.value);
    };

    // Excel 智能粘贴监听器
    const setupSmartPaste = () => {
        // 使用事件委托或直接绑定
        // 假设我们在 HTML 中会给系数 Input 添加 'poly-coeff-input' 类
        // 并且它们在 DOM 中的顺序就是 C0-C9
        const polyInputs = document.querySelectorAll('.poly-coeff-input');
        
        polyInputs.forEach(input => {
            input.addEventListener('paste', (e) => {
                e.preventDefault(); // 阻止默认粘贴
                
                // 1. 获取剪贴板数据
                const clipboardData = (e.clipboardData || window.clipboardData).getData('text');
                if (!clipboardData) return;

                // 2. 解析数据 (支持 Tab, 逗号, 空格, 换行分隔)
                // 过滤掉空字符串，只保留有效数值
                const values = clipboardData
                    .split(/[\t,\s\n]+/)
                    .map(v => v.trim())
                    .filter(v => v !== '' && !isNaN(parseFloat(v)));

                if (values.length === 0) return;

                // 3. 确定粘贴目标组
                // 找到当前 input 所在的容器（例如 Mass Flow 或 Power 的 grid）
                // 从而只填充该组内的 input
                const container = input.closest('.grid'); 
                if (!container) return;

                // 获取该组内所有的系数输入框
                const groupInputs = Array.from(container.querySelectorAll('.poly-coeff-input'));
                const startIndex = groupInputs.indexOf(input);

                if (startIndex === -1) return;

                // 4. 填充数据
                let pasteCount = 0;
                for (let i = 0; i < values.length; i++) {
                    const targetIndex = startIndex + i;
                    if (targetIndex < groupInputs.length) {
                        groupInputs[targetIndex].value = values[i];
                        // 触发 input 事件以确保任何绑定的状态更新逻辑被执行
                        groupInputs[targetIndex].dispatchEvent(new Event('input'));
                        pasteCount++;
                    }
                }

                // 5. 反馈
                console.log(`[Smart Paste] Pasted ${pasteCount} coefficients starting from index ${startIndex}`);
                
                // 视觉反馈: 添加临时的蓝色边框
                input.classList.add('ring-2', 'ring-teal-500');
                setTimeout(() => input.classList.remove('ring-2', 'ring-teal-500'), 600);
            });
        });
    };

    // 执行新功能的初始化
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

    console.log("✅ UI v5.0 Initialized.");
}