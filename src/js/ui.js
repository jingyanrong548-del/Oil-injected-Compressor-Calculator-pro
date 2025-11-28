// =====================================================================
// ui.js: UI 交互逻辑 (v3.4 Final Fix)
// 职责: 确保历史记录按钮点击有效，抽屉能滑出
// =====================================================================

import { HistoryDB } from './storage.js';

export function initUI() {
    console.log("🚀 UI Initializing...");

    // --- 1. History Drawer Logic ---
    const historyBtn = document.getElementById('history-btn');
    const historyDrawer = document.getElementById('history-drawer');
    const historyCloseBtn = document.getElementById('history-close-btn');
    const historyClearBtn = document.getElementById('history-clear-btn');
    const historyList = document.getElementById('history-list');

    // 调试：确认元素是否存在
    if(historyBtn) console.log("✅ History Button Found");
    else console.error("❌ History Button NOT Found");

    if(historyDrawer) console.log("✅ History Drawer Found");
    else console.error("❌ History Drawer NOT Found");

    function toggleHistory(show) {
        if (!historyDrawer) return;
        if (show) {
            historyDrawer.classList.remove('translate-x-full'); // 滑入
            renderHistoryList();
        } else {
            historyDrawer.classList.add('translate-x-full'); // 滑出
        }
    }

    if (historyBtn) {
        historyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log("👆 Button Clicked!");
            toggleHistory(true);
        });
    }

    if (historyCloseBtn) historyCloseBtn.addEventListener('click', () => toggleHistory(false));
    
    // 点击空白处关闭
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

    // --- 2. Tab & Restore Logic ---
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
                if(btn) btn.classList.add('bg-white', 'shadow-sm', 'text-gray-900');
                if(btn) btn.classList.remove('text-gray-500');
                if(content) content.classList.remove('hidden');
                if(sheet) sheet.classList.remove('hidden');
            } else {
                if(btn) btn.classList.remove('bg-white', 'shadow-sm', 'text-gray-900');
                if(btn) btn.classList.add('text-gray-500');
                if(content) content.classList.add('hidden');
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
        const formId = rec.mode === 'M2' ? 'calc-form-mode-2' : 'calc-form-mode-3';
        const inputs = rec.inputs;
        if (inputs) {
            Object.keys(inputs).forEach(k => {
                const el = document.getElementById(k);
                if(el) {
                    if(el.type==='checkbox') el.checked = inputs[k];
                    else el.value = inputs[k];
                    el.dispatchEvent(new Event('change'));
                } else {
                    // Radios
                    const radios = document.querySelectorAll(`input[name="${k}"]`);
                    radios.forEach(r => { if(r.value === inputs[k]) { r.checked=true; r.dispatchEvent(new Event('change')); }});
                }
            });
            setTimeout(() => document.getElementById(tabs[idx].calcBtnId).click(), 100);
        }
    }

    // --- 3. Inputs Setup (Simplified) ---
    // Mode 2
    setupRadioToggle('flow_mode_m2', v => {
        document.getElementById('rpm-inputs-m2').style.display = v==='rpm'?'grid':'none';
        document.getElementById('vol-inputs-m2').style.display = v==='vol'?'block':'none';
    });
    const ecoCb = document.getElementById('enable_eco_m2');
    if(ecoCb) ecoCb.addEventListener('change', () => {
        document.getElementById('eco-settings-m2').classList.toggle('hidden', !ecoCb.checked);
        document.getElementById('eco-placeholder-m2').classList.toggle('hidden', ecoCb.checked);
    });
    setupRadioToggle('eco_type_m2', v => document.getElementById('eco-subcooler-inputs-m2').classList.toggle('hidden', v!=='subcooler'));
    setupRadioToggle('eco_press_mode_m2', v => {
        const e = document.getElementById('temp_eco_sat_m2');
        e.disabled = v==='auto'; e.classList.toggle('opacity-50', v==='auto'); if(v==='auto') e.value='';
    });
    setupRadioToggle('eff_mode_m2', v => {
        document.getElementById('motor-eff-group-m2').style.display = v==='input'?'block':'none';
        document.getElementById('eta_s_label_m2').textContent = v==='input'?'总等熵效率':'等熵效率';
    });
    
    // Mode 3
    setupRadioToggle('flow_mode_m3', v => {
        document.getElementById('rpm-inputs-m3').style.display = v==='rpm'?'grid':'none';
        document.getElementById('vol-inputs-m3').style.display = v==='vol'?'block':'none';
    });

    // Auto Lock
    function setupLock(bid, ids) {
        const b = document.getElementById(bid);
        if(!b) return;
        b.addEventListener('change', () => ids.forEach(i => {
            const e = document.getElementById(i); if(e) { e.disabled=b.checked; e.classList.toggle('opacity-50', b.checked); }
        }));
        // Init
        const event = new Event('change'); b.dispatchEvent(event);
    }
    setupLock('auto-eff-m2', ['eta_s_m2', 'eta_v_m2']);
    setupLock('auto-eff-m3', ['eta_iso_m3', 'eta_v_m3']);

    // Mobile Sheet
    function setupSheet(sid, hid, cid) {
        const s = document.getElementById(sid), h = document.getElementById(hid), c = document.getElementById(cid);
        if(!s) return;
        h.addEventListener('click', () => s.classList.toggle('translate-y-0')); // Simple toggle
        if(c) c.addEventListener('click', (e) => { e.stopPropagation(); s.classList.remove('translate-y-0'); });
    }
    setupSheet('mobile-sheet-m2', 'sheet-handle-m2', 'mobile-close-m2');
    setupSheet('mobile-sheet-m3', 'sheet-handle-m3', 'mobile-close-m3');

    function setupRadioToggle(name, cb) {
        document.querySelectorAll(`input[name="${name}"]`).forEach(r => r.addEventListener('change', () => { if(r.checked) cb(r.value); }));
        const c = document.querySelector(`input[name="${name}"]:checked`); if(c) cb(c.value);
    }

    console.log("✅ UI v3.4 Initialized.");
}