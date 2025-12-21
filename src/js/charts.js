// =====================================================================
// charts.js: 可视化引擎 (v7.2 SLHX Support)
// 职责: P-h 图绘制，支持 SLHX 拓扑结构 (1->1', 5->5') 及 Label 优化
// =====================================================================

import * as echarts from 'echarts';

const chartInstances = {};

const COLORS = {
    primary: '#14B8A6',   // Teal (主循环 1-2-3-4)
    ecoLiquid: '#F97316', // Orange (液路/回热冷却 3-5-5')
    ecoVapor: '#3B82F6',  // Blue (补气回路)
    saturation: '#9CA3AF', // Gray (饱和线)
    grid: '#E5E7EB',
    text: '#6B7280',
    bgTooltip: 'rgba(255, 255, 255, 0.95)'
};

export function getChartInstance(domId) {
    const dom = document.getElementById(domId);
    if (!dom) return null;
    if (!chartInstances[domId]) {
        chartInstances[domId] = echarts.init(dom, null, { renderer: 'canvas' });
        window.addEventListener('resize', () => {
            chartInstances[domId] && chartInstances[domId].resize();
        });
    }
    return chartInstances[domId];
}

export function drawPHDiagram(domId, data) {
    const chart = getChartInstance(domId);
    if (!chart) return;

    const container = document.getElementById(domId);
    if (container && container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        chart.resize();
    }

    const { 
        mainPoints, 
        ecoLiquidPoints = [], 
        ecoVaporPoints = [],
        saturationLiquidPoints = [],
        saturationVaporPoints = [],
        title = 'Thermodynamic Cycle',
        xLabel = 'Enthalpy (kJ/kg)',
        yLabel = 'Pressure (bar)'
    } = data;

    // Helper: Extract Y values for scaling
    // 兼容数组格式 [x, y] 和对象格式 { value: [x, y] }
    const extractY = (arr) => arr.map(p => Array.isArray(p) ? p[1] : p.value[1]).filter(y => y > 0);
    const allY = [...extractY(mainPoints), ...extractY(ecoLiquidPoints), ...extractY(ecoVaporPoints)];
    
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
                data: ecoLiquidPoints,
                smooth: 0,
                symbol: 'circle',
                symbolSize: 4,
                // 液路虚线
                lineStyle: { width: 2, type: 'dashed', color: COLORS.ecoLiquid },
                itemStyle: { color: COLORS.ecoLiquid },
                label: labelStyle, // 允许个别点(如5')开启显示
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

    chart.setOption(option, true); // 使用 notMerge=true 强制完全替换配置
    chart.resize(); // 确保图表尺寸正确
}

export function drawTSDiagram(domId, data) {
    const chart = getChartInstance(domId);
    if (!chart) return;

    const container = document.getElementById(domId);
    if (container && container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        chart.resize();
    }

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

    chart.setOption(option, true); // 使用 notMerge=true 强制完全替换配置
    chart.resize(); // 确保图表尺寸正确
}

export function resizeAllCharts() {
    Object.keys(chartInstances).forEach(id => chartInstances[id].resize());
}