// =====================================================================
// storage.js: 本地数据持久化模块 (v1.0 Fixed)
// 职责: 必须存在此文件，否则 ui.js 无法加载，会导致所有按钮失效！
// =====================================================================

import i18next from './i18n.js';

const DB_KEY = 'comp_pro_history_v1';
const MAX_RECORDS = 50; 

export const HistoryDB = {
    add(mode, title, inputState, resultSummary) {
        try {
            const records = this.getAll();
            const newRecord = {
                id: Date.now().toString(36) + Math.random().toString(36).substr(2),
                timestamp: Date.now(),
                mode,
                title,
                inputs: inputState,
                results: resultSummary
            };
            records.unshift(newRecord);
            if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
            localStorage.setItem(DB_KEY, JSON.stringify(records));
            return true;
        } catch (e) {
            console.error("[Storage] Save failed:", e);
            return false;
        }
    },

    getAll() {
        try {
            const raw = localStorage.getItem(DB_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    },

    delete(id) {
        let records = this.getAll();
        records = records.filter(r => r.id !== id);
        localStorage.setItem(DB_KEY, JSON.stringify(records));
    },

    clear() {
        localStorage.removeItem(DB_KEY);
    },

    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffSec = Math.floor((now - date) / 1000);

        if (diffSec < 60) return i18next.t('storage.justNow');
        if (diffSec < 3600) return i18next.t('storage.minutesAgo', { count: Math.floor(diffSec/60) });
        
        if (date.toDateString() === now.toDateString()) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
};

export const SessionState = {
    collectInputs(formId) {
        const form = document.getElementById(formId);
        if (!form) return {};
        const inputs = form.querySelectorAll('input, select');
        const data = {};
        inputs.forEach(el => {
            if (el.type === 'radio' || el.type === 'checkbox') {
                if (el.type === 'radio' && el.checked) data[el.name] = el.value;
                if (el.type === 'checkbox') data[el.id] = el.checked;
            } else {
                data[el.id] = el.value;
            }
        });
        return data;
    }
};