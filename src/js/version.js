// =====================================================================
// version.js: 版本号管理模块
// 职责: 自动管理应用版本号，遵循语义化版本号规则 (Semantic Versioning)
// 格式: MAJOR.MINOR.PATCH (例如: 7.2.1)
// =====================================================================

/**
 * 版本号配置
 * 遵循语义化版本号规则:
 * - MAJOR: 不兼容的 API 修改
 * - MINOR: 向后兼容的功能性新增
 * - PATCH: 向后兼容的问题修正
 */
export const APP_VERSION = {
    major: 7,
    minor: 2,
    patch: 19,
    
    /**
     * 获取完整版本号字符串
     * @returns {string} 格式: "v7.2.1"
     */
    getFull() {
        return `v${this.major}.${this.minor}.${this.patch}`;
    },
    
    /**
     * 获取简短版本号字符串（用于UI显示）
     * @returns {string} 格式: "7.2.1"
     */
    getShort() {
        return `${this.major}.${this.minor}.${this.patch}`;
    },
    
    /**
     * 递增 PATCH 版本号（用于bug修复）
     */
    incrementPatch() {
        this.patch++;
        this.save();
    },
    
    /**
     * 递增 MINOR 版本号（用于新功能）
     */
    incrementMinor() {
        this.minor++;
        this.patch = 0;
        this.save();
    },
    
    /**
     * 递增 MAJOR 版本号（用于重大变更）
     */
    incrementMajor() {
        this.major++;
        this.minor = 0;
        this.patch = 0;
        this.save();
    },
    
    /**
     * 保存版本号到 localStorage（用于跨会话保持）
     */
    save() {
        try {
            localStorage.setItem('app_version', JSON.stringify({
                major: this.major,
                minor: this.minor,
                patch: this.patch
            }));
        } catch (e) {
            console.warn('[Version] Failed to save version:', e);
        }
    },
    
    /**
     * 从 localStorage 加载版本号
     */
    load() {
        try {
            const saved = localStorage.getItem('app_version');
            if (saved) {
                const parsed = JSON.parse(saved);
                this.major = parsed.major || this.major;
                this.minor = parsed.minor || this.minor;
                this.patch = parsed.patch || this.patch;
            }
        } catch (e) {
            console.warn('[Version] Failed to load version:', e);
        }
    },
    
    /**
     * 更新页面中的版本号显示
     */
    updateDisplay() {
        const versionElements = document.querySelectorAll('[data-version]');
        versionElements.forEach(el => {
            el.textContent = this.getFull();
        });
        
        // 更新标题中的版本号
        const titleVersion = document.querySelector('.version-display');
        if (titleVersion) {
            titleVersion.textContent = `OCC Pro ${this.getFull()}`;
        }
    }
};

// 初始化：加载保存的版本号
APP_VERSION.load();

// 导出默认版本号字符串（用于直接使用）
export const VERSION_STRING = APP_VERSION.getFull();
export const VERSION_SHORT = APP_VERSION.getShort();

