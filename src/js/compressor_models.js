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
        ],
        'N系列': [
            { model: 'N125S**-L', displacement: 197 },
            { model: 'N125L**-L', displacement: 295 },
            { model: 'N160VS*-L', displacement: 415 },
            { model: 'N160VM*-L', displacement: 519 },
            { model: 'N160VL*-L', displacement: 622 },
            { model: 'N200VS*-L', displacement: 810 },
            { model: 'N200VM*-L', displacement: 1020 },
            { model: 'N200VL*-L', displacement: 1210 },
            { model: 'N250VS*-L', displacement: 1580 },
            { model: 'N250VM*-L', displacement: 1980 },
            { model: 'N250VL*-L', displacement: 2360 },
            { model: 'N320VSD-L', displacement: 3170 },
            { model: 'N320VMD-L', displacement: 3960 },
            { model: 'N320VLD-L', displacement: 4740 },
            { model: 'N320LLUD-L', displacement: 5600 },
            { model: 'N400VSD-L', displacement: 6480 },
            { model: 'N400VMD-L', displacement: 8140 }
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
        ],
        'SRH M系列': [
            { model: 'SRH-12M', displacement: 161, note: '12系列 (125~161 m³/h) 的大排量款' },
            { model: 'SRH-16M', displacement: 322, note: '16系列 (265~322 m³/h) 的大排量款' },
            { model: 'SRH-18M', displacement: 480, note: '18系列 (395~480 m³/h) 的大排量款' },
            { model: 'SRH-20M', displacement: 854, note: '20系列 (640~854 m³/h) 的大排量款' },
            { model: 'SRH-26M', displacement: 1409, note: '26系列 (1185~1409 m³/h) 的大排量款' },
            { model: 'SRH-28M', displacement: 2097, note: '28系列 (1640~2097 m³/h) 的大排量款' },
            { model: 'SRH-34M', displacement: 2770, note: '34系列 (2360~2770 m³/h) 的大排量款' }
        ]
    },
    '武冷': {
        'LG系列III': [
            { model: 'LG12.5III', displacement: 277 },
            { model: 'LG16IIID', displacement: 436 },
            { model: 'LG16III', displacement: 574 },
            { model: 'LG16IIIT', displacement: 640 },
            { model: 'LG20IIID', displacement: 852 },
            { model: 'LG20III', displacement: 1120 },
            { model: 'LG20IIIT', displacement: 1400 },
            { model: 'LG25IIID', displacement: 1663 },
            { model: 'LG23.3IIIT', displacement: 1907 },
            { model: 'LG25III', displacement: 2189 },
            { model: 'LG25IIIT', displacement: 2831 },
            { model: 'LG31.5IIID/S351', displacement: 3511.7 },
            { model: 'LG31.5III/S418', displacement: 4175 },
            { model: 'LG31.5IIIT/S568', displacement: 5678 },
            { model: 'S722', displacement: 7222.1 },
            { model: 'S812', displacement: 8120 },
            { model: 'S906', displacement: 9058.9 },
            { model: 'S1080', displacement: 10802 },
            { model: 'S1200', displacement: 11995 }
        ]
    },
    '烟冷': {
        'LG系列B': [
            { model: 'LG12B', displacement: 285 },
            { model: 'LG16BS', displacement: 385 },
            { model: 'LG16BM', displacement: 598 },
            { model: 'LG20BS', displacement: 806 },
            { model: 'LG20BM', displacement: 1120 },
            { model: 'LG20BL', displacement: 1486 },
            { model: 'LG25BS', displacement: 1825 },
            { model: 'LG25BM', displacement: 2289 },
            { model: 'LG25BL', displacement: 2840 },
            { model: 'LG32BS', displacement: 4341 },
            { model: 'LG32BM', displacement: 5182 },
            { model: 'LG32BL', displacement: 5890 },
            { model: 'LG40BS', displacement: 6514 },
            { model: 'LG40BM', displacement: 7539 },
            { model: 'LG40BL', displacement: 8960 },
            { model: 'LG50BS', displacement: 8960 },
            { model: 'LG50BM', displacement: 10500 },
            { model: 'LG50BL', displacement: 12000 }
        ]
    },
    '约克': {
        'RWBII系列': [
            { model: 'RWB II 60', displacement: 505 },
            { model: 'RWB II 76', displacement: 636 },
            { model: 'RWB II 100', displacement: 837 },
            { model: 'RWB II 134', displacement: 1116 },
            { model: 'RWB II 177', displacement: 1473 },
            { model: 'RWB II 222', displacement: 1853 },
            { model: 'RWB II 270', displacement: 2254 },
            { model: 'RWB II 316', displacement: 2636 },
            { model: 'RWB II 399', displacement: 3320 },
            { model: 'RWB II 480', displacement: 3991 },
            { model: 'RWB II 496', displacement: 4127 },
            { model: 'RWB II 676', displacement: 5627 },
            { model: 'RWB II 856', displacement: 7162 },
            { model: 'RWB II 1080', displacement: 9036 }
        ]
    },
    '豪顿': {
        'WRV滑动轴承系列': [
            { model: 'WRV163/1.45', displacement: 550 },
            { model: 'WRV163/1.80', displacement: 680 },
            { model: 'WRV204/1.10', displacement: 815 },
            { model: 'WRV204/1.45', displacement: 1095 },
            { model: 'WRV204/1.65', displacement: 1220 },
            { model: 'WRV204/1.93', displacement: 1340 },
            { model: 'WRVi255/1.10', displacement: 1590 },
            { model: 'WRVi255/1.30', displacement: 1755 },
            { model: 'WRVi255/1.45', displacement: 2150 },
            { model: 'WRVi255/1.65', displacement: 2395 },
            { model: 'WRVi255/1.93', displacement: 2630 },
            { model: 'WRV255/2.20', displacement: 3190 },
            { model: 'WRVi321/1.32', displacement: 3830 },
            { model: 'WRVi321/1.65', displacement: 4790 },
            { model: 'WRVi321/1.93', displacement: 5260 },
            { model: 'WRV321/2.20', displacement: 6385 },
            { model: 'WRVi365/165', displacement: 6771 },
            { model: 'WRVi365/193', displacement: 7920 },
            { model: 'WRV510/1.32', displacement: 7660 },
            { model: 'WRV510/1.65', displacement: 9575 },
            { model: 'WRV510/1.93', displacement: 10510 }
        ],
        'XRV滚动轴承系列': [
            { model: 'XRV127-R1', displacement: 293 },
            { model: 'XRV127-R3', displacement: 397 },
            { model: 'XRV127-R4', displacement: 489 },
            { model: 'XRV127-R5', displacement: 576 },
            { model: 'XRV163/1.65', displacement: 593 },
            { model: 'XRV163/1.95', displacement: 710 },
            { model: 'XRV204/1.10', displacement: 812 },
            { model: 'XRV204/1.45', displacement: 1070 },
            { model: 'XRV204/1.65', displacement: 1219 },
            { model: 'XRV204/1.93', displacement: 1348 }
        ]
    },
    '格拉索': {
        '标准系列': [
            { model: 'C(140)', displacement: 231.0 },
            { model: 'D(140)', displacement: 265.0 },
            { model: 'E(159)', displacement: 321.0 },
            { model: 'G(159)', displacement: 372.0 },
            { model: 'H(177)', displacement: 471.0 },
            { model: 'L(177)', displacement: 544.0 },
            { model: 'M(206)', displacement: 690.0 },
            { model: 'N(206)', displacement: 860.0 },
            { model: 'P(214)', displacement: 805.0 },
            { model: 'R(252)', displacement: 1040.0 },
            { model: 'S(252)', displacement: 1290.0 },
            { model: 'T(252)', displacement: 1460.0 },
            { model: 'V(255)', displacement: 1740.0 },
            { model: 'W(268)', displacement: 1990.0 },
            { model: 'Y(255)', displacement: 2390.0 },
            { model: 'Z(296)', displacement: 2748.0 },
            { model: 'XA(296)', displacement: 3250.0 },
            { model: 'XB(365)', displacement: 4150.0 },
            { model: 'XC(365)', displacement: 4900.0 },
            { model: 'XD(365)', displacement: 5800.0 },
            { model: 'XE', displacement: 7170.0 },
            { model: 'XF', displacement: 8560.0 }
        ]
    },
    '神户制钢': {
        'KS系列': [
            { model: 'KS8LGB', displacement: 100.6 },
            { model: 'KS10SGB', displacement: 148.8 },
            { model: 'KS11SGB', displacement: 216.8 },
            { model: 'KS12SGB', displacement: 287.6 },
            { model: 'KS13LGB', displacement: 400.9 },
            { model: 'KS16SGB', displacement: 587.9 },
            { model: 'KS16LGB', displacement: 711.2 },
            { model: 'KS19MNB', displacement: 939.3 },
            { model: 'KS19LNB', displacement: 1266.5 },
            { model: 'KS23MNB', displacement: 1770.9 },
            { model: 'KS23LNB', displacement: 2387.1 },
            { model: 'KS28MNB', displacement: 2917.0 },
            { model: 'KS28LNB', displacement: 3931.3 },
            { model: 'KS32MNB', displacement: 4765.8 },
            { model: 'KS32LNB', displacement: 5958.6 }
        ]
    },
    '汉钟': {
        'RC2-G系列': [
            { model: 'RC2-100G', displacement: 98 },
            { model: 'RC2-230G', displacement: 230 },
            { model: 'RC2-260G', displacement: 257 },
            { model: 'RC2-300G', displacement: 293 },
            { model: 'RC2-310G', displacement: 308 },
            { model: 'RC2-340G', displacement: 339 },
            { model: 'RC2-370G', displacement: 366 },
            { model: 'RC2-410G', displacement: 407 },
            { model: 'RC2-470G', displacement: 471 },
            { model: 'RC2-510G', displacement: 508 },
            { model: 'RC2-550G', displacement: 549 },
            { model: 'RC2-580G', displacement: 583 },
            { model: 'RC2-620G', displacement: 619 },
            { model: 'RC2-710G', displacement: 713 },
            { model: 'RC2-790G', displacement: 791 },
            { model: 'RC2-830G', displacement: 825 },
            { model: 'RC2-930G', displacement: 929 },
            { model: 'RC2-1020G', displacement: 1017 },
            { model: 'RC2-1270G', displacement: 1268 },
            { model: 'RC2-1530G', displacement: 1539 }
        ],
        'RC2-T系列': [
            { model: 'RC2-200T', displacement: 193 },
            { model: 'RC2-230T', displacement: 230 },
            { model: 'RC2-260T', displacement: 257 },
            { model: 'RC2-300T', displacement: 293 },
            { model: 'RC2-310T', displacement: 308 },
            { model: 'RC2-340T', displacement: 339 },
            { model: 'RC2-370T', displacement: 366 },
            { model: 'RC2-410T', displacement: 407 },
            { model: 'RC2-470T', displacement: 471 },
            { model: 'RC2-510T', displacement: 508 },
            { model: 'RC2-550T', displacement: 549 },
            { model: 'RC2-580T', displacement: 583 },
            { model: 'RC2-620T', displacement: 619 },
            { model: 'RC2-710T', displacement: 713 },
            { model: 'RC2-790T', displacement: 791 },
            { model: 'RC2-830T', displacement: 825 },
            { model: 'RC2-930T', displacement: 929 },
            { model: 'RC2-1020T', displacement: 1017 },
            { model: 'RC2-1130T', displacement: 1122 },
            { model: 'RC2-1270T', displacement: 1268 },
            { model: 'RC2-1530T', displacement: 1539 }
        ],
        'RC2-B系列': [
            { model: 'RC2-100B', displacement: 98 },
            { model: 'RC2-140B', displacement: 137 },
            { model: 'RC2-180B', displacement: 180 },
            { model: 'RC2-200B', displacement: 193 },
            { model: 'RC2-230B', displacement: 230 },
            { model: 'RC2-260B', displacement: 257 },
            { model: 'RC2-300B', displacement: 293 },
            { model: 'RC2-310B', displacement: 308 },
            { model: 'RC2-340B', displacement: 339 },
            { model: 'RC2-370B', displacement: 366 },
            { model: 'RC2-410B', displacement: 407 },
            { model: 'RC2-470B', displacement: 471 },
            { model: 'RC2-510B', displacement: 508 },
            { model: 'RC2-550B', displacement: 549 },
            { model: 'RC2-580B', displacement: 583 },
            { model: 'RC2-620B', displacement: 619 },
            { model: 'RC2-710B', displacement: 713 },
            { model: 'RC2-790B', displacement: 791 },
            { model: 'RC2-830B', displacement: 825 },
            { model: 'RC2-930B', displacement: 929 },
            { model: 'RC2-1020B', displacement: 1017 },
            { model: 'RC2-1130B', displacement: 1122 },
            { model: 'RC2-1270B', displacement: 1268 },
            { model: 'RC2-1530B', displacement: 1539 }
        ],
        'LT-S系列': [
            {
                model: 'LT-S-45/20-H',
                displacement: 436,      // = disp_lp
                disp_lp: 436,
                disp_hp: 193,
                vi_ratio: 2.259,
                rotor_code: '单机双级'
            },
            {
                model: 'LT-S-55/25-H',
                displacement: 546,      // = disp_lp
                disp_lp: 546,
                disp_hp: 257,
                vi_ratio: 2.125,
                rotor_code: '单机双级'
            },
            {
                model: 'LT-S-65/32-H',
                displacement: 654,      // = disp_lp
                disp_lp: 654,
                disp_hp: 322,
                vi_ratio: 2.031,
                rotor_code: '单机双级'
            },
            {
                model: 'LT-S-83/41-H',
                displacement: 830,      // = disp_lp
                disp_lp: 830,
                disp_hp: 409,
                vi_ratio: 2.029,
                rotor_code: '单机双级'
            }
        ]
    },
    '开利': {
        '06TU-G系列': [
            { model: '06TUG483', displacement: 670, note: '高温热泵专用 (Vi=G)' },
            { model: '06TUG554', displacement: 769, note: '高温热泵专用 (Vi=G)' }
        ],
        '06TS系列': [
            { model: '06TS*137', displacement: 190 },
            { model: '06TS*155', displacement: 215 },
            { model: '06TS*186', displacement: 258 }
        ],
        '06TT系列': [
            { model: '06TT*266', displacement: 369 },
            { model: '06TT*301', displacement: 418 },
            { model: '06TT*356', displacement: 494 }
        ],
        '06TU系列': [
            { model: '06TU*483', displacement: 670 },
            { model: '06TU*554', displacement: 769 }
        ],
        '06TV系列': [
            { model: '06TV*680', displacement: 944 },
            { model: '06TV*753', displacement: 1045 },
            { model: '06TV*819', displacement: 1137 },
            { model: '06TV*879', displacement: 1220 }
        ],
        '06TX系列': [
            { model: '06TX*13K', displacement: 1792 },
            { model: '06TX*14K', displacement: 1852 },
            { model: '06TX*15K', displacement: 2056 }
        ]
    }
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

/**
 * 根据模式获取过滤后的品牌列表
 * @param {string} mode - 模式标识: 'm2', 'm3', 'm4', 'm5', 'm6'
 * @returns {string[]} 过滤后的品牌名称数组
 */
export function getFilteredBrands(mode) {
    const allBrands = getAllBrands();
    
    if (mode === 'm5') {
        // Mode 5 (单机双级模式): 保留前川和汉钟品牌
        return allBrands.filter(brand => brand === '前川(MYCOM)' || brand === '汉钟');
    }
    
    // Mode 2, 3, 4, 6: 保留所有品牌
    return allBrands;
}

/**
 * 根据模式和品牌获取过滤后的系列列表
 * @param {string} mode - 模式标识: 'm2', 'm3', 'm4', 'm5', 'm6'
 * @param {string} brand - 品牌名称
 * @param {string|null} level - 级别标识: 'ht' (高温级), 'lt' (低温级), null (单级或其他)
 * @returns {string[]} 过滤后的系列名称数组
 */
export function getFilteredSeriesByBrand(mode, brand, level = null) {
    const allSeries = getSeriesByBrand(brand);
    
    if (brand === '前川(MYCOM)') {
        if (mode === 'm5') {
            // Mode 5 (单机双级模式): 前川只保留 LSC、MS、SS 系列
            return allSeries.filter(series => 
                series === 'LSC两级系列' || 
                series === 'MS系列' || 
                series === 'SS系列'
            );
        } else {
            // Mode 2, 3, 4, 6: 前川只保留 N 系列
            return allSeries.filter(series => series === 'N系列');
        }
    }
    
    if (brand === '汉钟') {
        if (mode === 'm5') {
            // Mode 5 (单机双级模式): 汉钟只保留 LT-S系列
            return allSeries.filter(series => series === 'LT-S系列');
        } else {
            // Mode 2, 3, 4, 6: 汉钟保留 RC2-G系列、RC2-T系列 和 RC2-B系列
            return allSeries.filter(series => 
                series === 'RC2-G系列' || 
                series === 'RC2-T系列' ||
                series === 'RC2-B系列'
            );
        }
    }
    
    if (brand === '开利') {
        if (level === 'ht') {
            // 高温级: 只显示高温热泵系列
            return allSeries.filter(series => series === '06TU-G系列');
        } else {
            // 单级或低温级: 只显示常规系列
            return allSeries.filter(series => 
                series === '06TS系列' ||
                series === '06TT系列' ||
                series === '06TU系列' ||
                series === '06TV系列' ||
                series === '06TX系列'
            );
        }
    }
    
    // 其他品牌: 保留所有系列
    return allSeries;
}

