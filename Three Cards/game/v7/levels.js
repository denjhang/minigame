/**
 * Three Cards — 图标 / 主题映射
 * 核心逻辑用抽象 type（T0..Tn），这里把 type 映射成可见的 emoji 图标。
 * 图标数量应 >= 最大关卡的 types 数（levelOpts 里最高 12 种）。
 */
(function (global) {
    'use strict';

    const ICONS = [
        '🐑', '🍃', '🥕', '🌽', '🍎', '🍇',
        '🐟', '🦆', '🐶', '🐱', '🍄', '🌸',
        '⭐', '🔥', '💎', '🍀'
    ];

    const TYPE_TO_ICON = (function () {
        const map = {};
        ICONS.forEach((icon, i) => { map['T' + i] = icon; });
        return map;
    })();

    const API = {
        ICONS,
        TYPE_TO_ICON,
        iconFor: function (type) {
            return TYPE_TO_ICON[type] || '🎴';
        }
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = API;
    } else {
        global.ThreeCardsLevels = API;
    }
})(typeof window !== 'undefined' ? window : globalThis);
