// =====================================================================
// i18n.js: 国际化配置模块
// 职责: 初始化i18next，管理多语言资源，提供语言切换功能
// =====================================================================

import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import zhCN from '../locales/zh-CN.json';
import enUS from '../locales/en-US.json';

// 初始化i18next
i18next
    .use(LanguageDetector)
    .init({
        resources: {
            'zh-CN': {
                translation: zhCN
            },
            'en-US': {
                translation: enUS
            }
        },
        fallbackLng: 'zh-CN',
        defaultNS: 'translation',
        interpolation: {
            escapeValue: false
        },
        detection: {
            order: ['localStorage', 'navigator'],
            caches: [],
            lookupLocalStorage: 'i18nextLng'
        }
    });

/**
 * 切换语言
 * @param {string} lng - 语言代码 ('zh-CN' | 'en-US')
 */
export function changeLanguage(lng) {
    i18next.changeLanguage(lng).then(() => {
        // 更新HTML lang属性
        if (document.documentElement) {
            document.documentElement.lang = lng;
        }
        
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
        
        // 更新所有带有data-i18n-attr的元素（用于title、placeholder等属性）
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
        
        // 触发自定义事件，通知其他模块更新
        window.dispatchEvent(new CustomEvent('languageChanged', { detail: { language: lng } }));
    }).catch(err => {
        console.error('[i18n] Failed to change language:', err);
    });
}

/**
 * 获取当前语言
 * @returns {string} 当前语言代码
 */
export function getCurrentLanguage() {
    return i18next.language || 'zh-CN';
}

/**
 * 切换中英文
 */
export function toggleLanguage() {
    const current = getCurrentLanguage();
    const newLang = current === 'zh-CN' ? 'en-US' : 'zh-CN';
    changeLanguage(newLang);
}

// 导出i18next实例
export default i18next;
export const t = i18next.t.bind(i18next);

