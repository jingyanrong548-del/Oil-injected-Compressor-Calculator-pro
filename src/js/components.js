// =====================================================================
// components.js: Apple-style UI 组件工厂 (v7.4 Generic Impact Grid)
// 职责: 生成标准化 HTML 片段，支持 ECO 和 SLHX 的通用效益矩阵
// =====================================================================

/**
 * 生成 KPI 核心指标卡片
 */
export function createKpiCard(title, value, unit, subtext = '', accentColor = 'default') {
    const colorMap = {
        default: 'text-gray-900',
        blue: 'text-blue-600',
        green: 'text-emerald-600',
        orange: 'text-orange-600',
        teal: 'text-teal-600'
    };
    const textColor = colorMap[accentColor] || colorMap.default;

    return `
    <div class="bg-white/60 p-4 rounded-2xl border border-white/50 shadow-sm flex flex-col justify-between transition-all hover:bg-white/80">
        <span class="text-xs font-medium text-gray-500 uppercase tracking-wide">${title}</span>
        <div class="mt-2 flex items-baseline">
            <span class="text-3xl font-bold tracking-tight ${textColor}">${value}</span>
            <span class="ml-1 text-sm font-medium text-gray-500">${unit}</span>
        </div>
        ${subtext ? `<div class="mt-2 text-xs text-gray-400 font-medium">${subtext}</div>` : ''}
    </div>
    `;
}

/**
 * 生成详细数据行 (Key-Value List)
 */
export function createDetailRow(label, value, isHighlight = false) {
    const bgClass = isHighlight ? 'bg-blue-50/50 rounded-lg -mx-2 px-2 py-1' : 'py-1';
    return `
    <div class="flex justify-between items-center text-sm ${bgClass}">
        <span class="text-gray-500">${label}</span>
        <span class="font-medium font-mono text-gray-800">${value}</span>
    </div>
    `;
}

/**
 * 生成分节标题
 */
export function createSectionHeader(title, icon = '') {
    return `
    <div class="flex items-center space-x-2 mb-3 mt-6 pb-2 border-b border-gray-100/80">
        ${icon ? `<span class="text-base grayscale opacity-80">${icon}</span>` : ''}
        <h4 class="text-xs font-bold text-gray-400 uppercase tracking-widest">${title}</h4>
    </div>
    `;
}

/**
 * 生成错误提示卡片
 */
export function createErrorCard(message) {
    return `
    <div class="p-4 rounded-2xl bg-red-50/80 border border-red-100 text-red-800 backdrop-blur-sm shadow-sm flex items-start gap-3 animate-fade-in">
        <svg class="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
        </svg>
        <div>
            <h3 class="text-sm font-bold">计算中断</h3>
            <p class="text-xs mt-1 opacity-90 leading-relaxed">${message}</p>
        </div>
    </div>
    `;
}

/**
 * [Updated v7.4] 通用效益矩阵 (Impact Grid)
 * 适用于 ECO (Teal) 和 SLHX (Orange) 的对比分析
 * @param {object} data - { Qc: {val, diff}, Qh: {val, diff}, COPc: {val, diff}, COPh: {val, diff} }
 * @param {string} theme - 'teal' | 'orange'
 */
export function createImpactGrid(data, theme = 'teal') {
    
    // 主题配置
    const themes = {
        teal: {
            container: 'bg-teal-50/30 border-teal-100/50',
            label: 'text-teal-600/70',
            icon: '⚡'
        },
        orange: {
            container: 'bg-orange-50/30 border-orange-100/50',
            label: 'text-orange-600/70',
            icon: '🔥'
        }
    };
    const t = themes[theme] || themes.teal;

    // 内部辅助：生成带箭头的小标签
    const renderBadge = (diff) => {
        // 微小差异忽略
        if (Math.abs(diff) < 0.05) return `<span class="text-[9px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded ml-auto border border-gray-200">-</span>`;

        const isPos = diff > 0;
        // 绿色(提升) / 红色(下降)
        const bgClass = isPos ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100';
        const arrow = isPos ? '▲' : '▼';

        return `<span class="text-[9px] ${bgClass} border px-1.5 py-0.5 rounded ml-auto font-bold tracking-tight shadow-sm min-w-[45px] text-center">${arrow} ${Math.abs(diff).toFixed(1)}%</span>`;
    };

    // 内部辅助：生成单个格子
    const renderItem = (label, obj, unit = '') => `
        <div class="bg-white/60 rounded-xl p-2.5 border border-white/60 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
            <div class="text-[9px] ${t.label} uppercase font-bold tracking-wider mb-1 flex items-center gap-1">
                ${label}
            </div>
            <div class="flex items-center justify-between">
                <div class="flex items-baseline">
                    <span class="text-sm font-bold text-gray-800 font-mono">${obj.val}</span>
                    <span class="text-[9px] text-gray-400 ml-0.5">${unit}</span>
                </div>
                ${renderBadge(obj.diff)}
            </div>
        </div>
    `;

    return `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 mb-2 animate-fade-in ${t.container} p-2 rounded-2xl border border-dashed">
        ${renderItem('Cooling Cap.', data.Qc, 'kW')}
        ${renderItem('Heating Cap.', data.Qh, 'kW')}
        ${renderItem('Cooling COP', data.COPc)}
        ${renderItem('Heating COP', data.COPh)}
    </div>
    `;
}

/**
 * 生成状态点数据表格 (Standard Engineering Units)
 */
export function createStateTable(points) {
    if (!points || points.length === 0) return '';

    const rows = points.map((p, index) => {
        const bgClass = index % 2 === 0 ? 'bg-white/40' : 'bg-transparent';
        // Highlight ECO or SLHX points
        const isSpecial = p.name.includes("'") || ['5','6','7'].includes(p.name);
        const rowStyle = isSpecial ? 'font-medium text-blue-900' : 'text-gray-600';

        return `
        <tr class="${bgClass} text-xs transition-colors hover:bg-white/60">
            <td class="py-2 pl-3 font-semibold text-gray-700 whitespace-nowrap sticky left-0 z-10 bg-white/20 backdrop-blur-[1px]">
                ${p.name}
                ${p.desc ? `<div class="text-[9px] text-gray-400 font-normal font-sans tracking-tight">${p.desc}</div>` : ''}
            </td>
            <td class="py-2 text-right font-mono ${rowStyle} tracking-tight whitespace-nowrap">${p.temp}</td>
            <td class="py-2 text-right font-mono ${rowStyle} tracking-tight whitespace-nowrap">${p.press}</td>
            <td class="py-2 text-right font-mono ${rowStyle} tracking-tight whitespace-nowrap">${p.enth}</td>
            <td class="py-2 pr-3 text-right font-mono font-bold text-gray-800 tracking-tight whitespace-nowrap">${p.flow}</td>
        </tr>
        `;
    }).join('');

    return `
    <div class="overflow-x-auto rounded-xl border border-white/40 shadow-sm bg-gray-50/20 backdrop-blur-sm mt-4 no-scrollbar touch-pan-x">
        <table class="min-w-full">
            <thead>
                <tr class="border-b border-gray-200/50 bg-gray-100/40 text-left text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                    <th class="py-2 pl-3 whitespace-nowrap sticky left-0 z-10 bg-gray-50/80 backdrop-blur-[2px]">Point</th>
                    <th class="py-2 text-right whitespace-nowrap">T [°C]</th>
                    <th class="py-2 text-right whitespace-nowrap">P [bar]</th>
                    <th class="py-2 text-right whitespace-nowrap">h [kJ/kg]</th>
                    <th class="py-2 pr-3 text-right whitespace-nowrap">m [kg/s]</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-100/30">
                ${rows}
            </tbody>
        </table>
    </div>
    `;
}