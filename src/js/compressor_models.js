// =====================================================================
// compressor_models.js: 压缩机型号数据库
// 职责: 存储各品牌压缩机的型号与理论排量数据，支持扩展
// =====================================================================

/**
 * 压缩机型号数据库
 * 结构: { brand: { series: [{ model, displacement, ...extra }] } }
 * displacement 单位: m³/h (理论输气量)
 *
 * 对于日本前川（MYCOM）单机双级机型，额外字段：
 *  - disp_lp: 低压级理论排量 (m³/h)
 *  - disp_hp: 高压级理论排量 (m³/h)
 *  - vi_ratio: 级间容积比 (Vi,L / Vi,H)
 *  - rotor_code: 典型转子代码描述
 * 其中 displacement 字段等同于 disp_lp，确保旧逻辑仍然可用。
 */
export const COMPRESSOR_MODELS = {
    '冰山': {
        'LG系列': [
            { model: 'LG12.5', displacement: 276 },
            { model: 'LG16', displacement: 580 },
            { model: 'LG20', displacement: 1215 },
            { model: 'LG25', displacement: 2395 },
            { model: 'LG31.5', displacement: 4622 }
        ],
        'VLG系列': [
            { model: 'VLG163D', displacement: 544 },
            { model: 'VLG163', displacement: 641 },
            { model: 'VLG193D', displacement: 892 },
            { model: 'VLG193T', displacement: 1237 },
            { model: 'VLG234D', displacement: 1600 },
            { model: 'VLG234', displacement: 1872 },
            { model: 'VLG268D', displacement: 2401 },
            { model: 'VLG268', displacement: 2829 },
            { model: 'VLG268T', displacement: 3327 },
            { model: 'VLG324D', displacement: 4248 },
            { model: 'VLG324', displacement: 5006 },
            { model: 'VLG324T', displacement: 5886 },
            { model: 'VLG373D', displacement: 6454 },
            { model: 'VLG373', displacement: 7606 },
            { model: 'VLG373T', displacement: 8943 }
        ],
        'LGC系列': [
            { model: 'LGC12.5DZ', displacement: 170 },
            { model: 'LGC12.5Z', displacement: 250 },
            { model: 'LGC16Z', displacement: 400 }
        ]
    },
    // 日本前川（MYCOM）单机双级系列，仅在 Mode 5 中使用其扩展字段
    '前川(MYCOM)': {
        'LSC两级系列': [
            {
                model: '1610SLC-52',
                displacement: 367,      // = disp_lp
                disp_lp: 367,
                disp_hp: 135,
                vi_ratio: 2.7,
                rotor_code: '160mm / 100mm'
            },
            {
                model: '1612LSC',
                displacement: 622,
                disp_lp: 622,
                disp_hp: 197,
                vi_ratio: 3.16,
                rotor_code: '160mm / 125mm'
            },
            {
                model: '2016LSC',
                displacement: 1210,
                disp_lp: 1210,
                disp_hp: 519,
                vi_ratio: 2.33,
                rotor_code: '200mm / 160mm'
            },
            {
                model: '2520LSC',
                displacement: 2360,
                disp_lp: 2360,
                disp_hp: 810,
                vi_ratio: 2.91,
                rotor_code: '250mm / 200mm'
            },
            {
                model: '3225LSC',
                displacement: 4740,
                disp_lp: 4740,
                disp_hp: 1580,
                vi_ratio: 3.0,
                rotor_code: '320mm / 250mm'
            },
            {
                model: '4032LSC',
                displacement: 9700,
                disp_lp: 9700,
                disp_hp: 3170,
                vi_ratio: 3.06,
                rotor_code: '400mm / 320mm'
            }
        ],
        'MS系列': [
            {
                model: '1210MS',
                displacement: 162,      // = disp_lp
                disp_lp: 162,
                disp_hp: 67,
                rotor_code: '最小型单机双级'
            },
            {
                model: '1612MS',
                displacement: 367,
                disp_lp: 367,
                disp_hp: 135,
                rotor_code: '常用机型'
            },
            {
                model: '2016MS',
                displacement: 715,
                disp_lp: 715,
                disp_hp: 267,
                rotor_code: '中型机'
            },
            {
                model: '2520MS',
                displacement: 1318,
                disp_lp: 1318,
                disp_hp: 519,
                rotor_code: 'MS系列大机型'
            }
        ],
        'SS系列': [
            {
                model: '1612SS',
                displacement: 240,      // = disp_lp
                disp_lp: 240,
                disp_hp: 115,
                rotor_code: '强化级间压比'
            },
            {
                model: '2016SS',
                displacement: 465,
                disp_lp: 465,
                disp_hp: 225,
                rotor_code: '强化级间压比'
            },
            {
                model: '2520SS',
                displacement: 895,
                disp_lp: 895,
                disp_hp: 435,
                rotor_code: '强化级间压比'
            }
        ]
    },
    '雪人股份': {
        'SRM系列': [
            { model: 'SRM-12L', displacement: 265 },
            { model: 'SRM-16S', displacement: 435 },
            { model: 'SRM-16M', displacement: 544 },
            { model: 'SRM-16L', displacement: 652 },
            { model: 'SRM-20S', displacement: 850 },
            { model: 'SRM-20M', displacement: 1100 },
            { model: 'SRM-20L', displacement: 1270 },
            { model: 'SRM-20LL', displacement: 1500 },
            { model: 'SRM-26S', displacement: 1659 },
            { model: 'SRM-26M', displacement: 2075 },
            { model: 'SRM-26L', displacement: 2478 },
            { model: 'SRM-26LL', displacement: 2940 },
            { model: 'SRM-34S', displacement: 3360 },
            { model: 'SRM-34M', displacement: 4280 },
            { model: 'SRM-34L', displacement: 5084 },
            { model: 'SRM-34LL', displacement: 6350 },
            { model: 'SRM-41S', displacement: 6804 },
            { model: 'SRM-41M', displacement: 8410 },
            { model: 'SRM-41L', displacement: 10850 }
        ]
    }
    // 预留扩展：冰轮系列、武冷系列等
    // '冰轮': { ... },
    // '武冷': { ... }
};

/**
 * 获取所有品牌列表
 * @returns {string[]} 品牌名称数组
 */
export function getAllBrands() {
    return Object.keys(COMPRESSOR_MODELS);
}

/**
 * 获取指定品牌的所有系列
 * @param {string} brand - 品牌名称
 * @returns {string[]} 系列名称数组
 */
export function getSeriesByBrand(brand) {
    if (!COMPRESSOR_MODELS[brand]) return [];
    return Object.keys(COMPRESSOR_MODELS[brand]);
}

/**
 * 获取指定品牌和系列的所有型号
 * @param {string} brand - 品牌名称
 * @param {string} series - 系列名称
 * @returns {Array<{model: string, displacement: number}>} 型号数组
 */
export function getModelsBySeries(brand, series) {
    if (!COMPRESSOR_MODELS[brand] || !COMPRESSOR_MODELS[brand][series]) return [];
    return COMPRESSOR_MODELS[brand][series];
}

/**
 * 根据型号查找理论排量
 * @param {string} brand - 品牌名称
 * @param {string} series - 系列名称
 * @param {string} model - 型号
 * @returns {number|null} 理论排量 (m³/h)，未找到返回 null
 */
export function getDisplacementByModel(brand, series, model) {
    const models = getModelsBySeries(brand, series);
    const found = models.find(m => m.model === model);
    return found ? found.displacement : null;
}

/**
 * 获取完整型号对象（包括可能存在的扩展字段）
 * @param {string} brand
 * @param {string} series
 * @param {string} model
 * @returns {{model: string, displacement: number}|null}
 */
export function getModelDetail(brand, series, model) {
    const models = getModelsBySeries(brand, series);
    const found = models.find(m => m.model === model);
    return found || null;
}

/**
 * 根据完整型号字符串查找理论排量（自动匹配品牌和系列）
 * @param {string} modelString - 完整型号，如 "LG12.5" 或 "VLG163D"
 * @returns {number|null} 理论排量 (m³/h)，未找到返回 null
 */
export function findDisplacementByModelString(modelString) {
    for (const brand of getAllBrands()) {
        for (const series of getSeriesByBrand(brand)) {
            const displacement = getDisplacementByModel(brand, series, modelString);
            if (displacement !== null) {
                return displacement;
            }
        }
    }
    return null;
}

