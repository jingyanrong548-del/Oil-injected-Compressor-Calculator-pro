// =====================================================================
// charts.js: 可视化引擎 (v7.2 SLHX Support)
// 职责: P-h 图绘制，支持 SLHX 拓扑结构 (1->1', 5->5') 及 Label 优化
// =====================================================================

import * as echarts from 'echarts';
import i18next from './i18n.js';

const chartInstances = {};

const COLORS = {
    primary: '#14B8A6',   // Teal (主循环 1-2-3-4)
    ecoLiquid: '#F97316', // Orange (液路/回热冷却 3-5-5')
    ecoVapor: '#3B82F6',  // Blue (补气回路，通用)
    intercoolerVapor: '#8B5CF6', // Purple (中冷辅助循环 - 中间冷却器ECO补气路)
    economizerVapor: '#EF4444',  // Red (经济器循环 - 高压级ECO补气路)
    saturation: '#9CA3AF', // Gray (饱和线)
    grid: '#E5E7EB',
    text: '#6B7280',
    bgTooltip: 'rgba(255, 255, 255, 0.95)'
};

export function getChartInstance(domId, silent = false) {
    const dom = document.getElementById(domId);
    if (!dom) return null;
    
    // 检查容器是否可见且有尺寸
    const rect = dom.getBoundingClientRect();
    const isVisible = rect.width > 0 && rect.height > 0 && 
                      dom.offsetWidth > 0 && dom.offsetHeight > 0 &&
                      !dom.classList.contains('hidden') &&
                      getComputedStyle(dom).display !== 'none';
    
    if (!isVisible) {
        // 如果容器不可见或尺寸为0，返回null，避免ECharts报错
        // 对于移动端容器，静默跳过（silent=true时不输出警告）
        if (!silent && !domId.includes('mobile')) {
            console.warn(`[Charts] Container ${domId} is not visible or has zero size. Skipping chart initialization.`);
        }
        return null;
    }
    
    if (!chartInstances[domId]) {
        try {
            chartInstances[domId] = echarts.init(dom, null, { renderer: 'canvas' });
            window.addEventListener('resize', () => {
                if (chartInstances[domId]) {
                    const container = document.getElementById(domId);
                    if (container) {
                        const rect = container.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            chartInstances[domId].resize();
                        }
                    }
                }
            });
        } catch (error) {
            console.error(`[Charts] Failed to initialize chart for ${domId}:`, error);
            return null;
        }
    }
    return chartInstances[domId];
}

export function drawPHDiagram(domId, data) {
    const container = document.getElementById(domId);
    if (!container) {
        // 对于移动端容器，静默跳过
        if (!domId.includes('mobile')) {
            console.warn(`[Charts] Container ${domId} not found`);
        }
        return;
    }
    
    // 检查是否为移动端容器
    const isMobile = domId.includes('mobile');
    
    // 确保容器可见
    if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
    }
    
    // 等待DOM更新后再初始化图表
    setTimeout(() => {
        // 对于移动端容器，如果不可见则静默跳过
        const rect = container.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0 && 
                          container.offsetWidth > 0 && container.offsetHeight > 0 &&
                          !container.classList.contains('hidden') &&
                          getComputedStyle(container).display !== 'none';
        
        if (!isVisible) {
            // 移动端容器可能在sheet未展开时不可见，这是正常的，静默跳过
            if (!isMobile) {
                console.warn(`[Charts] Container ${domId} is not visible, will retry when visible`);
            }
            // 对于移动端，如果sheet可能稍后会展开，延迟重试
            if (isMobile) {
                setTimeout(() => {
                    const retryContainer = document.getElementById(domId);
                    if (retryContainer) {
                        const retryRect = retryContainer.getBoundingClientRect();
                        if (retryRect.width > 0 && retryRect.height > 0) {
                            const retryChart = getChartInstance(domId, true);
                            if (retryChart) {
                                drawPHDiagramInternal(retryChart, domId, data);
                            }
                        }
                    }
                }, 500);
            }
            return;
        }
        
        const chart = getChartInstance(domId, isMobile);
        if (!chart) {
            // 移动端容器静默跳过
            if (!isMobile) {
                console.warn(`[Charts] Could not create chart instance for ${domId}`);
            }
            return;
        }
        
        drawPHDiagramInternal(chart, domId, data);
    }, 0);
}

function drawPHDiagramInternal(chart, domId, data) {

    const { 
        mainPoints, 
        ecoLiquidPoints = [], 
        ecoVaporPoints = [],
        intercoolerVaporPoints = [], // 中冷辅助循环（中间冷却器ECO补气路）
        economizerVaporPoints = [],  // 经济器循环（高压级ECO补气路）
        saturationLiquidPoints = [],
        saturationVaporPoints = [],
        title = i18next.t('charts.thermodynamicCycle'),
        xLabel = i18next.t('charts.enthalpy'),
        yLabel = i18next.t('charts.pressure')
    } = data;

    // Helper: Extract Y values for scaling
    // 兼容数组格式 [x, y] 和对象格式 { value: [x, y] }
    // 过滤掉null值（用于断开连接的占位符）
    const extractY = (arr) => arr
        .filter(p => p !== null && p !== undefined) // 过滤null值
        .map(p => Array.isArray(p) ? p[1] : (p.value ? p.value[1] : null))
        .filter(y => y !== null && y !== undefined && y > 0);
    const allY = [
        ...extractY(mainPoints), 
        ...extractY(ecoLiquidPoints), 
        ...extractY(ecoVaporPoints),
        ...extractY(intercoolerVaporPoints),
        ...extractY(economizerVaporPoints)
    ];
    
    // [v7.2 Fix] 针对低温工ZX（如 R23）优化 Y 轴下限，防止压缩
    let minY = 1, maxY = 100;
    if (allY.length > 0) {
        minY = Math.min(...allY) * 0.6; // 留出更多底部空间给 1 -> 1' 线
        maxY = Math.max(...allY) * 1.4;
    }

    // [Critical] Label 样式：确保显示点名称 (1, 1', 2...) 而非坐标值
    const labelStyle = {
        show: false, // 默认关闭，由数据点具体的 label.show 控制
        formatter: (param) => param.name, 
        color: '#111827',
        fontSize: 11,
        fontWeight: 'bold',
        fontFamily: 'Inter, sans-serif',
        backgroundColor: 'rgba(255,255,255,0.85)', // 提高遮盖力，防止 SLHX 线条干扰文字
        borderRadius: 3,
        padding: [2, 4],
        distance: 5
    };

    const option = {
        title: {
            text: title,
            left: 'center',
            textStyle: { fontFamily: 'Inter, sans-serif', fontSize: 12, color: COLORS.text, fontWeight: 'normal' },
            top: 5
        },
        tooltip: {
            trigger: 'axis',
            backgroundColor: COLORS.bgTooltip,
            backdropFilter: 'blur(4px)',
            borderWidth: 0,
            shadowColor: 'rgba(0, 0, 0, 0.1)',
            shadowBlur: 10,
            formatter: (params) => {
                // 优化 Tooltip 显示，过滤掉重复点
                let html = `<div class="font-bold mb-1 border-b border-gray-100 pb-1 text-xs text-gray-700">${params[0].axisValueLabel} kJ/kg</div>`;
                const seen = new Set();
                
                params.forEach(item => {
                    const val = item.data.value ? item.data.value[1] : item.data[1];
                    const name = item.name ? `[${item.name}]` : '';
                    const key = `${item.seriesName}-${name}`; // 唯一键
                    
                    if (val && !seen.has(key)) {
                        seen.add(key);
                        // SLHX 特殊标注
                        const isSlhxPoint = name.includes("'"); 
                        const style = isSlhxPoint ? 'font-weight:bold; color:#F97316' : 'font-weight:normal';
                        
                        html += `<div class="flex justify-between gap-3 text-xs mt-1">
                            <span>${item.marker} <span style="${style}">${name}</span> ${item.seriesName}</span>
                            <span class="font-mono font-bold text-gray-800">${val.toFixed(2)} bar</span>
                        </div>`;
                    }
                });
                return html;
            }
        },
        grid: { 
            top: 35, right: 30, bottom: 25, left: 50, 
            show: false,
            containLabel: true // 防止 Label 溢出
        },
        xAxis: {
            type: 'value',
            name: xLabel,
            nameLocation: 'middle',
            nameGap: 25,
            axisLine: { show: false },
            splitLine: { show: true, lineStyle: { type: 'dashed', color: COLORS.grid } },
            axisLabel: { color: COLORS.text, fontSize: 10 },
            scale: true
        },
        yAxis: {
            type: 'log',
            name: yLabel,
            min: minY,
            max: maxY,
            axisLine: { show: false },
            splitLine: { show: true, lineStyle: { type: 'dashed', color: COLORS.grid } },
            axisLabel: { color: COLORS.text, fontSize: 10, formatter: v => v < 1 ? v.toFixed(2) : v.toFixed(0) },
            logBase: 10,
            minorSplitLine: { show: false }
        },
        series: [
            {
                name: 'Main Cycle',
                type: 'line',
                data: mainPoints,
                smooth: 0,
                symbol: 'circle',
                symbolSize: 6,
                // 主循环强制开启 Label (显示 1, 2, 3, 4, 1' 等)
                label: { ...labelStyle, show: true }, 
                itemStyle: { color: COLORS.primary },
                lineStyle: { width: 2.5, color: COLORS.primary },
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: 'rgba(20, 184, 166, 0.15)' },
                        { offset: 1, color: 'rgba(20, 184, 166, 0.0)' }
                    ])
                },
                z: 10 // 确保主循环在最上层
            },
            {
                name: 'Liquid/SLHX',
                type: 'line',
                // 保留null值，ECharts会自动处理null来断开连接
                data: ecoLiquidPoints,
                smooth: 0,
                symbol: 'circle',
                symbolSize: 4,
                // 液路虚线
                lineStyle: { width: 2, type: 'dashed', color: COLORS.ecoLiquid },
                itemStyle: { color: COLORS.ecoLiquid },
                label: labelStyle, // 允许个别点(如5')开启显示
                z: 5,
                // 使用connectNulls: false来确保null值断开连接
                connectNulls: false
            },
            {
                name: 'Injection',
                type: 'line',
                data: ecoVaporPoints,
                smooth: 0,
                symbol: 'triangle',
                symbolSize: 5,
                itemStyle: { color: COLORS.ecoVapor },
                lineStyle: { width: 2, type: 'dotted', color: COLORS.ecoVapor },
                label: labelStyle,
                z: 6
            },
            {
                name: 'Intercooler Injection',
                type: 'line',
                data: intercoolerVaporPoints,
                smooth: 0,
                symbol: 'triangle',
                symbolSize: 5,
                itemStyle: { color: COLORS.intercoolerVapor },
                lineStyle: { width: 2, type: 'dotted', color: COLORS.intercoolerVapor },
                label: labelStyle,
                z: 7
            },
            {
                name: 'Economizer Injection',
                type: 'line',
                data: economizerVaporPoints,
                smooth: 0,
                symbol: 'triangle',
                symbolSize: 5,
                itemStyle: { color: COLORS.economizerVapor },
                lineStyle: { width: 2, type: 'dotted', color: COLORS.economizerVapor },
                label: labelStyle,
                z: 8
            },
            {
                name: 'Saturation Liquid',
                type: 'line',
                data: saturationLiquidPoints,
                smooth: true,
                symbol: 'none',
                lineStyle: { width: 1.5, color: COLORS.saturation, type: 'solid' },
                label: { show: false },
                z: 1
            },
            {
                name: 'Saturation Vapor',
                type: 'line',
                data: saturationVaporPoints,
                smooth: true,
                symbol: 'none',
                lineStyle: { width: 1.5, color: COLORS.saturation, type: 'solid' },
                label: { show: false },
                z: 1
            }
        ],
        animationDuration: 400,
        animationEasing: 'cubicOut'
    };

    try {
        chart.setOption(option, true); // 使用 notMerge=true 强制完全替换配置
        // 延迟resize，确保DOM已完全更新
        setTimeout(() => {
            const container = document.getElementById(domId);
            if (container && chart) {
                const rect = container.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    chart.resize();
                }
            }
        }, 50);
    } catch (error) {
        console.error(`[Charts] Error setting chart option for ${domId}:`, error);
    }
}

export function drawTSDiagram(domId, data) {
    const container = document.getElementById(domId);
    if (!container) {
        // 对于移动端容器，静默跳过
        if (!domId.includes('mobile')) {
            console.error(`Container ${domId} not found for T-S diagram`);
        }
        return;
    }
    
    // 检查是否为移动端容器
    const isMobile = domId.includes('mobile');
    
    // 确保容器可见
    if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
    }
    
    // 等待DOM更新后再初始化图表
    setTimeout(() => {
        // 对于移动端容器，如果不可见则静默跳过
        const rect = container.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0 && 
                          container.offsetWidth > 0 && container.offsetHeight > 0 &&
                          !container.classList.contains('hidden') &&
                          getComputedStyle(container).display !== 'none';
        
        if (!isVisible) {
            // 移动端容器可能在sheet未展开时不可见，这是正常的，静默跳过
            if (!isMobile) {
                console.warn(`[Charts] Container ${domId} is not visible, will retry when visible`);
            }
            // 对于移动端，如果sheet可能稍后会展开，延迟重试
            if (isMobile) {
                setTimeout(() => {
                    const retryContainer = document.getElementById(domId);
                    if (retryContainer) {
                        const retryRect = retryContainer.getBoundingClientRect();
                        if (retryRect.width > 0 && retryRect.height > 0) {
                            const retryChart = getChartInstance(domId, true);
                            if (retryChart) {
                                drawTSDiagramInternal(retryChart, domId, data);
                            }
                        }
                    }
                }, 500);
            }
            return;
        }
        
        const chart = getChartInstance(domId, isMobile);
        if (!chart) {
            // 移动端容器静默跳过
            if (!isMobile) {
                console.warn(`[Charts] Could not create chart instance for ${domId}`);
            }
            return;
        }
        
        drawTSDiagramInternal(chart, domId, data);
    }, 0);
}

function drawTSDiagramInternal(chart, domId, data) {

    const { 
        mainPoints, 
        ecoLiquidPoints = [], 
        ecoVaporPoints = [],
        saturationLiquidPoints = [],
        saturationVaporPoints = [],
        title = 'Thermodynamic Cycle',
        xLabel = 'Entropy (kJ/kg·K)',
        yLabel = 'Temperature (°C)'
    } = data;

    // Helper: Extract X and Y values for scaling
    const extractX = (arr) => arr.map(p => Array.isArray(p) ? p[0] : p.value[0]).filter(x => !isNaN(x));
    const extractY = (arr) => arr.map(p => Array.isArray(p) ? p[1] : p.value[1]).filter(y => !isNaN(y));
    // 包含饱和线数据以确保坐标轴范围正确
    const allX = [
        ...extractX(mainPoints), 
        ...extractX(ecoLiquidPoints), 
        ...extractX(ecoVaporPoints),
        ...extractX(saturationLiquidPoints),
        ...extractX(saturationVaporPoints)
    ];
    const allY = [
        ...extractY(mainPoints), 
        ...extractY(ecoLiquidPoints), 
        ...extractY(ecoVaporPoints),
        ...extractY(saturationLiquidPoints),
        ...extractY(saturationVaporPoints)
    ];
    
    let minX = 0, maxX = 10, minY = -50, maxY = 100;
    if (allX.length > 0) {
        minX = Math.min(...allX) * 0.95;
        maxX = Math.max(...allX) * 1.05;
    }
    if (allY.length > 0) {
        minY = Math.min(...allY) - 10;
        // 向上取整到最近的整数，避免出现 139.9999... 这样的值
        maxY = Math.ceil(Math.max(...allY) + 10);
    }

    const labelStyle = {
        show: false,
        formatter: (param) => param.name, 
        color: '#111827',
        fontSize: 11,
        fontWeight: 'bold',
        fontFamily: 'Inter, sans-serif',
        backgroundColor: 'rgba(255,255,255,0.85)',
        borderRadius: 3,
        padding: [2, 4],
        distance: 5
    };

    const option = {
        title: {
            text: title,
            left: 'center',
            textStyle: { fontFamily: 'Inter, sans-serif', fontSize: 12, color: COLORS.text, fontWeight: 'normal' },
            top: 5
        },
        tooltip: {
            trigger: 'axis',
            backgroundColor: COLORS.bgTooltip,
            backdropFilter: 'blur(4px)',
            borderWidth: 0,
            shadowColor: 'rgba(0, 0, 0, 0.1)',
            shadowBlur: 10,
            formatter: (params) => {
                let html = `<div class="font-bold mb-1 border-b border-gray-100 pb-1 text-xs text-gray-700">${params[0].axisValueLabel} kJ/kg·K</div>`;
                const seen = new Set();
                
                params.forEach(item => {
                    const val = item.data.value ? item.data.value[1] : item.data[1];
                    const name = item.name ? `[${item.name}]` : '';
                    const key = `${item.seriesName}-${name}`;
                    
                    if (val && !seen.has(key)) {
                        seen.add(key);
                        const isSlhxPoint = name.includes("'"); 
                        const style = isSlhxPoint ? 'font-weight:bold; color:#F97316' : 'font-weight:normal';
                        
                        html += `<div class="flex justify-between gap-3 text-xs mt-1">
                            <span>${item.marker} <span style="${style}">${name}</span> ${item.seriesName}</span>
                            <span class="font-mono font-bold text-gray-800">${val.toFixed(1)} °C</span>
                        </div>`;
                    }
                });
                return html;
            }
        },
        grid: { 
            top: 35, right: 30, bottom: 25, left: 50, 
            show: false,
            containLabel: true
        },
        xAxis: {
            type: 'value',
            name: xLabel,
            nameLocation: 'middle',
            nameGap: 25,
            axisLine: { show: false },
            splitLine: { show: true, lineStyle: { type: 'dashed', color: COLORS.grid } },
            axisLabel: { color: COLORS.text, fontSize: 10 },
            scale: true,
            min: minX,
            max: maxX
        },
        yAxis: {
            type: 'value',
            name: yLabel,
            min: minY,
            max: maxY,
            axisLine: { show: false },
            splitLine: { show: true, lineStyle: { type: 'dashed', color: COLORS.grid } },
            axisLabel: { 
                color: COLORS.text, 
                fontSize: 10,
                formatter: (v) => {
                    // 格式化温度标签，避免显示 139.9999... 这样的值
                    const rounded = Math.round(v * 10) / 10; // 四舍五入到小数点后1位
                    return rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1);
                }
            }
        },
        series: [
            {
                name: 'Main Cycle',
                type: 'line',
                data: mainPoints,
                smooth: 0,
                symbol: 'circle',
                symbolSize: 6,
                // 使用 labelStyle 作为默认配置，但数据点自己的 label 配置会覆盖它
                label: labelStyle, 
                itemStyle: { color: COLORS.primary },
                lineStyle: { width: 2.5, color: COLORS.primary },
                z: 10
            },
            {
                name: 'Liquid/SLHX',
                type: 'line',
                data: ecoLiquidPoints,
                smooth: 0,
                symbol: 'circle',
                symbolSize: 4,
                lineStyle: { width: 2, type: 'dashed', color: COLORS.ecoLiquid },
                itemStyle: { color: COLORS.ecoLiquid },
                label: labelStyle,
                z: 5
            },
            {
                name: 'Injection',
                type: 'line',
                data: ecoVaporPoints,
                smooth: 0,
                symbol: 'triangle',
                symbolSize: 5,
                itemStyle: { color: COLORS.ecoVapor },
                lineStyle: { width: 2, type: 'dotted', color: COLORS.ecoVapor },
                label: labelStyle,
                z: 6
            },
            {
                name: 'Saturation Liquid',
                type: 'line',
                data: saturationLiquidPoints,
                smooth: true,
                symbol: 'none',
                lineStyle: { width: 1.5, color: COLORS.saturation, type: 'solid' },
                label: { show: false },
                z: 1
            },
            {
                name: 'Saturation Vapor',
                type: 'line',
                data: saturationVaporPoints,
                smooth: true,
                symbol: 'none',
                lineStyle: { width: 1.5, color: COLORS.saturation, type: 'solid' },
                label: { show: false },
                z: 1
            }
        ],
        animationDuration: 400,
        animationEasing: 'cubicOut'
    };

    try {
        chart.setOption(option, true); // 使用 notMerge=true 强制完全替换配置
        // 延迟resize，确保DOM已完全更新
        setTimeout(() => {
            const container = document.getElementById(domId);
            if (container && chart) {
                const rect = container.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    chart.resize();
                }
            }
        }, 50);
    } catch (error) {
        console.error(`[Charts] Error setting chart option for ${domId}:`, error);
    }
}

export function resizeAllCharts() {
    Object.keys(chartInstances).forEach(id => {
        const container = document.getElementById(id);
        if (container && chartInstances[id]) {
            const rect = container.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                try {
                    chartInstances[id].resize();
                } catch (error) {
                    console.warn(`[Charts] Error resizing chart ${id}:`, error);
                }
            }
        }
    });
}

// =====================================================================
// System Diagram for Mode 7 (Ammonia Heat Pump)
// =====================================================================

/**
 * 绘制氨热泵系统流程图
 * @param {string} domId - 容器DOM ID
 * @param {Object} nodeData - 节点参数数据
 * @param {Object} nodeData.point1 - 点1（蒸发器出口/压缩机入口）
 * @param {Object} nodeData.point2 - 点2（压缩机出口）
 * @param {Object} nodeData.point2b - 点2b（降低过热器出口，可选）
 * @param {Object} nodeData.point3 - 点3（冷凝器出口）
 * @param {Object} nodeData.point3p - 点3'（过冷器出口，可选）
 * @param {Object} nodeData.point4 - 点4（蒸发器入口）
 * @param {Object} nodeData.water - 热水回路参数
 * @param {boolean} nodeData.isDesuperheaterEnabled - 是否启用降低过热器
 * @param {boolean} nodeData.isSubcoolerEnabled - 是否启用过冷器
 * @param {boolean} nodeData.isOilCoolerEnabled - 是否启用油冷
 */
export function drawSystemDiagramM7(domId, nodeData) {
    const container = document.getElementById(domId);
    if (!container) {
        console.error(`Container ${domId} not found for system diagram`);
        return;
    }

    // 确保容器可见
    if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
    }

    // 清空容器
    container.innerHTML = '';

    // 获取容器尺寸（使用实际尺寸或默认值）
    const containerWidth = container.clientWidth || 800;
    const containerHeight = container.clientHeight || 600;

    // 定义组件尺寸
    const compWidth = 70;
    const compHeight = 50;
    const heWidth = 90;
    const heHeight = 45;
    const evapWidth = 100;
    const evapHeight = 40;
    const valveWidth = 25;
    const valveHeight = 25;
    const cardWidth = 130;
    const cardHeight = 65;

    // 计算所需的总高度和宽度
    let componentCount = 3; // 冷凝器、节流阀、蒸发器（基础组件）
    if (nodeData.isDesuperheaterEnabled) componentCount++;
    if (nodeData.isSubcoolerEnabled) componentCount++;
    
    const spacing = 70; // 组件间距
    const topMargin = 40;
    const bottomMargin = 50;
    const leftMargin = 180; // 为参数卡片留出空间
    const rightMargin = 180; // 为热水回路留出空间
    
    // 计算实际需要的尺寸
    const requiredHeight = topMargin + componentCount * spacing + bottomMargin;
    const requiredWidth = leftMargin + 200 + rightMargin; // 主循环宽度 + 左右边距
    
    // 使用动态尺寸，确保所有内容可见
    const width = Math.max(containerWidth, requiredWidth);
    const height = Math.max(containerHeight, requiredHeight);

    // 创建SVG元素
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.style.background = 'transparent';
    container.appendChild(svg);

    // 主循环布局（垂直排列）
    const refX = leftMargin + 100; // 制冷剂循环中心X
    let currentY = topMargin + 30;
    
    // 动态计算各组件Y位置
    const positions = {
        desuperheater: null,
        condenser: null,
        subcooler: null,
        valve: null,
        evap: null,
        comp: null
    };

    // 1. 降低过热器（可选）
    if (nodeData.isDesuperheaterEnabled) {
        positions.desuperheater = currentY;
        currentY += spacing;
    }

    // 2. 冷凝器
    positions.condenser = currentY;
    currentY += spacing;

    // 3. 过冷器（可选）
    if (nodeData.isSubcoolerEnabled) {
        positions.subcooler = currentY;
        currentY += spacing;
    }

    // 4. 节流阀
    positions.valve = currentY;
    currentY += spacing;

    // 5. 蒸发器
    positions.evap = currentY;
    
    // 6. 压缩机（与蒸发器水平对齐，在左侧）
    positions.comp = positions.evap;

    // 热水回路位置（右侧，与主循环对齐）
    const waterX = width - rightMargin - 50;
    const waterStartY = positions.subcooler || positions.condenser;
    const waterSpacing = spacing;

    // 定义颜色
    const refColor = '#14B8A6'; // 制冷剂 - 青色
    const waterColor = '#F97316'; // 热水 - 橙色
    const oilColor = '#8B5CF6'; // 油 - 紫色
    const bgColor = '#F9FAFB';
    const textColor = '#111827';
    const borderColor = '#D1D5DB';

    // 辅助函数：创建文本
    const createText = (x, y, text, fontSize = 11, fontWeight = 'normal', fill = textColor) => {
        const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        textEl.setAttribute('x', x);
        textEl.setAttribute('y', y);
        textEl.setAttribute('font-size', fontSize);
        textEl.setAttribute('font-weight', fontWeight);
        textEl.setAttribute('fill', fill);
        textEl.setAttribute('font-family', 'Inter, sans-serif');
        textEl.textContent = text;
        return textEl;
    };

    // 辅助函数：创建矩形组件
    const createRect = (x, y, width, height, fill, stroke, strokeWidth = 1.5) => {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x - width / 2);
        rect.setAttribute('y', y - height / 2);
        rect.setAttribute('width', width);
        rect.setAttribute('height', height);
        rect.setAttribute('fill', fill);
        rect.setAttribute('stroke', stroke);
        rect.setAttribute('stroke-width', strokeWidth);
        rect.setAttribute('rx', 4);
        return rect;
    };

    // 辅助函数：创建路径（箭头）
    const createArrow = (x1, y1, x2, y2, color, strokeWidth = 2) => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        const unitX = dx / len;
        const unitY = dy / len;
        
        // 箭头头部尺寸
        const arrowLen = 8;
        const arrowWidth = 5;
        
        // 箭头点
        const arrowX = x2 - unitX * arrowLen;
        const arrowY = y2 - unitY * arrowLen;
        const perpX = -unitY;
        const perpY = unitX;
        
        const pathData = `M ${x1} ${y1} L ${arrowX} ${arrowY} M ${x2} ${y2} L ${arrowX + perpX * arrowWidth} ${arrowY + perpY * arrowWidth} M ${x2} ${y2} L ${arrowX - perpX * arrowWidth} ${arrowY - perpY * arrowWidth}`;
        
        path.setAttribute('d', pathData);
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', strokeWidth);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-linecap', 'round');
        return path;
    };

    // 辅助函数：创建参数卡片（优化版本，更紧凑）
    const createParamCard = (x, y, pointName, data, isWater = false) => {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        
        if (!data) return group;

        const cardX = x - cardWidth / 2;
        const cardY = y - cardHeight / 2;

        // 背景
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('x', cardX);
        bg.setAttribute('y', cardY);
        bg.setAttribute('width', cardWidth);
        bg.setAttribute('height', cardHeight);
        bg.setAttribute('fill', isWater ? 'rgba(249, 115, 22, 0.1)' : 'rgba(20, 184, 166, 0.1)');
        bg.setAttribute('stroke', isWater ? waterColor : refColor);
        bg.setAttribute('stroke-width', 1.5);
        bg.setAttribute('rx', 6);
        group.appendChild(bg);

        // 标题
        const title = createText(x, cardY + 14, `点 ${pointName}`, 11, 'bold');
        group.appendChild(title);

        // 参数（更紧凑的布局）
        let yOffset = 26;
        if (data.T !== undefined) {
            const text = createText(cardX + 4, cardY + yOffset, `T: ${data.T.toFixed(1)}°C`, 9);
            group.appendChild(text);
            yOffset += 11;
        }
        if (data.P !== undefined) {
            const text = createText(cardX + 4, cardY + yOffset, `P: ${data.P.toFixed(2)}bar`, 9);
            group.appendChild(text);
            yOffset += 11;
        }
        if (data.h !== undefined) {
            const text = createText(cardX + 4, cardY + yOffset, `h: ${data.h.toFixed(1)}kJ/kg`, 9);
            group.appendChild(text);
        }

        return group;
    };

    // 绘制背景
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', width);
    bg.setAttribute('height', height);
    bg.setAttribute('fill', bgColor);
    svg.appendChild(bg);

    // 绘制标题
    const title = createText(width / 2, 25, '氨热泵系统流程图', 14, 'bold');
    svg.appendChild(title);

    // 绘制制冷剂循环组件
    // 1. 降低过热器（可选）
    if (nodeData.isDesuperheaterEnabled && positions.desuperheater) {
        const he = createRect(refX, positions.desuperheater, heWidth, heHeight, 'rgba(20, 184, 166, 0.2)', refColor);
        svg.appendChild(he);
        const label = createText(refX, positions.desuperheater, '降低过热器', 9, 'bold');
        svg.appendChild(label);
        
        // 参数卡片（右侧）
        if (nodeData.point2b) {
            const card = createParamCard(refX + heWidth/2 + cardWidth/2 + 10, positions.desuperheater, '2b', nodeData.point2b);
            svg.appendChild(card);
        }
    }

    // 2. 冷凝器
    const cond = createRect(refX, positions.condenser, heWidth, heHeight, 'rgba(20, 184, 166, 0.2)', refColor);
    svg.appendChild(cond);
    const condLabel = createText(refX, positions.condenser, '冷凝器', 9, 'bold');
    svg.appendChild(condLabel);
    
    // 点3参数卡片（右侧）
    if (nodeData.point3) {
        const card3 = createParamCard(refX + heWidth/2 + cardWidth/2 + 10, positions.condenser, '3', nodeData.point3);
        svg.appendChild(card3);
    }

    // 3. 过冷器（可选）
    if (nodeData.isSubcoolerEnabled && positions.subcooler) {
        const sub = createRect(refX, positions.subcooler, heWidth, heHeight, 'rgba(20, 184, 166, 0.2)', refColor);
        svg.appendChild(sub);
        const subLabel = createText(refX, positions.subcooler, '过冷器', 9, 'bold');
        svg.appendChild(subLabel);
        
        // 参数卡片（右侧）
        if (nodeData.point3p) {
            const card = createParamCard(refX + heWidth/2 + cardWidth/2 + 10, positions.subcooler, "3'", nodeData.point3p);
            svg.appendChild(card);
        }
    }

    // 4. 节流阀
    const valve = createRect(refX, positions.valve, valveWidth, valveHeight, 'rgba(156, 163, 175, 0.3)', borderColor);
    svg.appendChild(valve);
    const valveLabel = createText(refX, positions.valve, '节流阀', 8);
    svg.appendChild(valveLabel);

    // 5. 蒸发器
    const evap = createRect(refX, positions.evap, evapWidth, evapHeight, 'rgba(20, 184, 166, 0.2)', refColor);
    svg.appendChild(evap);
    const evapLabel = createText(refX, positions.evap, '蒸发器', 9, 'bold');
    svg.appendChild(evapLabel);
    
    // 点4参数卡片（右侧）
    if (nodeData.point4) {
        const card4 = createParamCard(refX + evapWidth/2 + cardWidth/2 + 10, positions.evap, '4', nodeData.point4);
        svg.appendChild(card4);
    }

    // 6. 压缩机（左侧，显示进口和出口）
    const compX = refX - 120;
    const comp = createRect(compX, positions.comp, compWidth, compHeight, 'rgba(20, 184, 166, 0.2)', refColor);
    svg.appendChild(comp);
    const compLabel = createText(compX, positions.comp - 8, '压缩机', 9, 'bold');
    svg.appendChild(compLabel);
    
    // 压缩机入口标注（点1）
    const compInletLabel = createText(compX - compWidth/2 - 15, positions.comp - 12, '入口', 8, 'normal');
    svg.appendChild(compInletLabel);
    if (nodeData.point1) {
        const point1Label = createText(compX - compWidth/2 - 15, positions.comp - 2, '点1', 9, 'bold', refColor);
        svg.appendChild(point1Label);
        const card1 = createParamCard(compX - cardWidth/2 - 10, positions.comp - 35, '1', nodeData.point1);
        svg.appendChild(card1);
    }
    
    // 压缩机出口标注（点2）
    const compOutletLabel = createText(compX + compWidth/2 + 15, positions.comp - 12, '出口', 8, 'normal');
    svg.appendChild(compOutletLabel);
    if (nodeData.point2) {
        const point2Label = createText(compX + compWidth/2 + 15, positions.comp - 2, '点2', 9, 'bold', refColor);
        svg.appendChild(point2Label);
        const card2 = createParamCard(compX - cardWidth/2 - 10, positions.comp + 35, '2', nodeData.point2);
        svg.appendChild(card2);
    }

    // 辅助函数：在管路上标注状态点
    const addPointLabelOnPipe = (x, y, pointName, offsetX = 0, offsetY = 0) => {
        const labelBg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        labelBg.setAttribute('cx', x + offsetX);
        labelBg.setAttribute('cy', y + offsetY);
        labelBg.setAttribute('r', 10);
        labelBg.setAttribute('fill', 'white');
        labelBg.setAttribute('stroke', refColor);
        labelBg.setAttribute('stroke-width', 2);
        svg.appendChild(labelBg);
        
        const labelText = createText(x + offsetX, y + offsetY + 4, pointName, 10, 'bold', refColor);
        labelText.setAttribute('text-anchor', 'middle');
        svg.appendChild(labelText);
    };

    // 绘制制冷剂流向箭头并在管路上标注状态点
    const arrowRefColor = refColor;
    
    // 压缩机出口 → 降低过热器/冷凝器
    if (nodeData.isDesuperheaterEnabled && positions.desuperheater) {
        const arrow1 = createArrow(compX + compWidth/2, positions.comp, refX - heWidth/2, positions.desuperheater, arrowRefColor);
        svg.appendChild(arrow1);
        // 在箭头中点标注点2
        const midX1 = (compX + compWidth/2 + refX - heWidth/2) / 2;
        const midY1 = (positions.comp + positions.desuperheater) / 2;
        addPointLabelOnPipe(midX1, midY1, '2', 0, 0);
        
        const arrow2 = createArrow(refX, positions.desuperheater + heHeight/2, refX, positions.condenser - heHeight/2, arrowRefColor);
        svg.appendChild(arrow2);
        // 在降低过热器出口标注点2b
        addPointLabelOnPipe(refX, positions.desuperheater + heHeight/2 + 15, '2b', 0, 0);
    } else {
        const arrow1 = createArrow(compX + compWidth/2, positions.comp, refX - heWidth/2, positions.condenser, arrowRefColor);
        svg.appendChild(arrow1);
        // 在箭头中点标注点2
        const midX1 = (compX + compWidth/2 + refX - heWidth/2) / 2;
        const midY1 = (positions.comp + positions.condenser) / 2;
        addPointLabelOnPipe(midX1, midY1, '2', 0, 0);
    }
    
    // 冷凝器 → 过冷器/节流阀
    if (nodeData.isSubcoolerEnabled && positions.subcooler) {
        const arrow3 = createArrow(refX, positions.condenser + heHeight/2, refX, positions.subcooler - heHeight/2, arrowRefColor);
        svg.appendChild(arrow3);
        // 在冷凝器出口标注点3
        addPointLabelOnPipe(refX, positions.condenser + heHeight/2 + 15, '3', 0, 0);
        
        const arrow4 = createArrow(refX, positions.subcooler + heHeight/2, refX, positions.valve - valveHeight/2, arrowRefColor);
        svg.appendChild(arrow4);
        // 在过冷器出口标注点3'
        addPointLabelOnPipe(refX, positions.subcooler + heHeight/2 + 15, "3'", 0, 0);
    } else {
        const arrow3 = createArrow(refX, positions.condenser + heHeight/2, refX, positions.valve - valveHeight/2, arrowRefColor);
        svg.appendChild(arrow3);
        // 在冷凝器出口标注点3
        addPointLabelOnPipe(refX, positions.condenser + heHeight/2 + 15, '3', 0, 0);
    }
    
    // 节流阀 → 蒸发器
    const arrow5 = createArrow(refX, positions.valve + valveHeight/2, refX, positions.evap - evapHeight/2, arrowRefColor);
    svg.appendChild(arrow5);
    // 在节流阀出口标注点4
    addPointLabelOnPipe(refX, positions.valve + valveHeight/2 + 15, '4', 0, 0);
    
    // 蒸发器 → 压缩机入口
    const arrow6 = createArrow(refX - evapWidth/2, positions.evap, compX - compWidth/2, positions.comp, arrowRefColor);
    svg.appendChild(arrow6);
    // 在蒸发器出口标注点1
    addPointLabelOnPipe(refX - evapWidth/2 - 15, positions.evap, '1', 0, 0);

    // 绘制热水回路
    if (nodeData.water) {
        // 热水回路标题放在顶部，避免重叠
        const waterLabelY = 25;
        const waterLabel = createText(waterX, waterLabelY, '热水回路', 11, 'bold', waterColor);
        svg.appendChild(waterLabel);

        // 热水流向（从下往上，与主循环对齐）
        const waterComponents = [];
        
        // 过冷器热水侧
        if (nodeData.isSubcoolerEnabled && positions.subcooler) {
            waterComponents.push({ 
                y: positions.subcooler, 
                label: '过冷器',
                temps: nodeData.waterTemps?.subcooler
            });
        }

        // 油冷器热水侧（如果有，放在过冷器和冷凝器之间）
        if (nodeData.isOilCoolerEnabled) {
            const oilY = positions.subcooler ? (positions.subcooler + positions.condenser) / 2 : positions.condenser;
            waterComponents.push({ 
                y: oilY, 
                label: '油冷',
                temps: nodeData.waterTemps?.oil_cooler
            });
        }

        // 冷凝器热水侧
        waterComponents.push({ 
            y: positions.condenser, 
            label: '冷凝器',
            temps: nodeData.waterTemps?.condenser
        });

        // 降低过热器热水侧
        if (nodeData.isDesuperheaterEnabled && positions.desuperheater) {
            waterComponents.push({ 
                y: positions.desuperheater, 
                label: '降低过热器',
                temps: nodeData.waterTemps?.desuperheater
            });
        }

        // 绘制热水组件
        waterComponents.forEach((comp, index) => {
            const waterHe = createRect(waterX, comp.y, heWidth - 20, heHeight - 10, 'rgba(249, 115, 22, 0.2)', waterColor);
            svg.appendChild(waterHe);
            const waterLabelText = createText(waterX, comp.y - 8, comp.label, 8, 'normal', waterColor);
            svg.appendChild(waterLabelText);
            
            // 标注热水节点温度
            if (comp.temps) {
                const tempText = createText(waterX, comp.y + 5, `${comp.temps.inlet.toFixed(1)}→${comp.temps.outlet.toFixed(1)}°C`, 8, 'normal', waterColor);
                tempText.setAttribute('text-anchor', 'middle');
                svg.appendChild(tempText);
                
                // 标注流量（如果有多个组件，只在第一个显示）
                if (index === 0 && comp.temps.flow) {
                    const flowText = createText(waterX, comp.y + 15, `${(comp.temps.flow * 3600 / 1000).toFixed(2)} m³/h`, 7, 'normal', waterColor);
                    flowText.setAttribute('text-anchor', 'middle');
                    svg.appendChild(flowText);
                }
            }
            
            // 绘制箭头（从下往上）
            if (index < waterComponents.length - 1) {
                const arrow = createArrow(waterX, comp.y + (heHeight - 10)/2, waterX, waterComponents[index + 1].y - (heHeight - 10)/2, waterColor);
                svg.appendChild(arrow);
            }
        });
    }

    // 绘制图例（放在底部）
    const legendY = height - 30;
    const legendX = 20;
    
    // 制冷剂图例
    const refLegendRect = createRect(legendX, legendY, 18, 12, refColor, refColor, 0);
    svg.appendChild(refLegendRect);
    const refLegendText = createText(legendX + 22, legendY + 4, i18next.t('ui.refrigerantR717'), 9);
    svg.appendChild(refLegendText);
    
    // 热水图例
    const waterLegendRect = createRect(legendX + 110, legendY, 18, 12, waterColor, waterColor, 0);
    svg.appendChild(waterLegendRect);
    const waterLegendText = createText(legendX + 132, legendY + 4, '热水', 9);
    svg.appendChild(waterLegendText);
}