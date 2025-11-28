// =====================================================================
// ui.js: UI 交互逻辑 (v3.0 Cockpit Layout 适配版)
// 职责: 处理 Tab 切换、移动端底部抽屉(Bottom Sheet)交互、输入框状态反馈。
// =====================================================================

export function initUI() {

    // --- 1. Tab Navigation & Mobile Sheet Linkage ---
    const activeTabClasses = ['bg-white', 'text-gray-900', 'shadow-sm', 'ring-1', 'ring-black/5'];
    const inactiveTabClasses = ['text-gray-500', 'hover:text-gray-900', 'hover:bg-white/50'];

    const tabs = [
        { 
            btnId: 'tab-btn-m2', 
            contentId: 'tab-content-m2', 
            sheetId: 'mobile-sheet-m2' // 关联的移动端抽屉
        },
        { 
            btnId: 'tab-btn-m3', 
            contentId: 'tab-content-m3', 
            sheetId: 'mobile-sheet-m3'
        }
    ];

    function switchTab(targetIndex) {
        tabs.forEach((tab, index) => {
            const btn = document.getElementById(tab.btnId);
            const content = document.getElementById(tab.contentId);
            const sheet = document.getElementById(tab.sheetId);

            if (index === targetIndex) {
                // Activate
                if(btn) {
                    btn.classList.remove(...inactiveTabClasses);
                    btn.classList.add(...activeTabClasses);
                }
                if(content) {
                    content.classList.remove('hidden');
                    // 简单的淡入动画
                    content.classList.remove('opacity-0');
                    content.classList.add('opacity-100');
                }
                // 显示对应的底部抽屉 (保持折叠状态)
                if(sheet) {
                    sheet.classList.remove('hidden');
                }
            } else {
                // Deactivate
                if(btn) {
                    btn.classList.remove(...activeTabClasses);
                    btn.classList.add(...inactiveTabClasses);
                }
                if(content) {
                    content.classList.add('hidden');
                    content.classList.remove('opacity-100');
                    content.classList.add('opacity-0');
                }
                // 彻底隐藏非当前模式的抽屉
                if(sheet) {
                    sheet.classList.add('hidden');
                }
            }
        });
    }

    // 绑定 Tab 点击事件
    tabs.forEach((tab, index) => {
        const btn = document.getElementById(tab.btnId);
        if (btn) {
            btn.addEventListener('click', () => switchTab(index));
        }
    });

    // --- 2. Mobile Bottom Sheet Logic (底部抽屉交互) ---
    function setupBottomSheet(sheetId, handleId, closeBtnId) {
        const sheet = document.getElementById(sheetId);
        const handle = document.getElementById(handleId);
        const closeBtn = document.getElementById(closeBtnId);

        if (!sheet || !handle) return;

        // 定义展开和收起的状态类
        // 收起: translate-y-[calc(100%-80px)] (只露出 80px 把手)
        // 展开: translate-y-0
        const collapsedClass = 'translate-y-[calc(100%-80px)]';
        const expandedClass = 'translate-y-0';

        let isExpanded = false;

        const toggleSheet = (forceState = null) => {
            if (forceState !== null) isExpanded = forceState;
            else isExpanded = !isExpanded;

            if (isExpanded) {
                sheet.classList.remove(collapsedClass);
                sheet.classList.add(expandedClass);
                // 展开时增加阴影深度
                sheet.classList.add('shadow-2xl');
            } else {
                sheet.classList.remove(expandedClass);
                sheet.classList.add(collapsedClass);
                sheet.classList.remove('shadow-2xl');
            }
        };

        // 点击把手 -> 切换
        handle.addEventListener('click', () => toggleSheet());
        
        // 点击关闭按钮 -> 收起
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // 防止冒泡触发 handle 点击
                toggleSheet(false);
            });
        }
    }

    // 初始化两个模式的抽屉
    setupBottomSheet('mobile-sheet-m2', 'sheet-handle-m2', 'mobile-close-m2');
    setupBottomSheet('mobile-sheet-m3', 'sheet-handle-m3', 'mobile-close-m3');


    // --- 3. Segmented Control & Input Logic (通用) ---
    
    function setupRadioToggle(radioName, onToggle) {
        const radios = document.querySelectorAll(`input[name="${radioName}"]`);
        if (!radios.length) return;
        
        radios.forEach(radio => {
            radio.addEventListener('change', () => {
                if(radio.checked) onToggle(radio.value);
            });
        });
        
        // Init
        const checkedRadio = document.querySelector(`input[name="${radioName}"]:checked`);
        if (checkedRadio) onToggle(checkedRadio.value);
    }

    // --- Mode 2 Logic ---
    setupRadioToggle('flow_mode_m2', (value) => {
        const rpmInputs = document.getElementById('rpm-inputs-m2');
        const volInputs = document.getElementById('vol-inputs-m2');
        if (rpmInputs && volInputs) {
            rpmInputs.style.display = (value === 'rpm') ? 'grid' : 'none';
            volInputs.style.display = (value === 'vol') ? 'block' : 'none';
            rpmInputs.querySelectorAll('input').forEach(i => i.required = (value === 'rpm'));
            volInputs.querySelectorAll('input').forEach(i => i.required = (value === 'vol'));
        }
    });

    // ECO Toggle
    const ecoCheckbox = document.getElementById('enable_eco_m2');
    const ecoSettings = document.getElementById('eco-settings-m2');
    const ecoPlaceholder = document.getElementById('eco-placeholder-m2');

    if (ecoCheckbox && ecoSettings && ecoPlaceholder) {
        ecoCheckbox.addEventListener('change', () => {
            if (ecoCheckbox.checked) {
                ecoSettings.classList.remove('hidden');
                ecoPlaceholder.classList.add('hidden');
            } else {
                ecoSettings.classList.add('hidden');
                ecoPlaceholder.classList.remove('hidden');
            }
        });
        ecoCheckbox.dispatchEvent(new Event('change'));
    }

    // ECO Type
    setupRadioToggle('eco_type_m2', (value) => {
        const subcoolerInputs = document.getElementById('eco-subcooler-inputs-m2');
        if (subcoolerInputs) {
            subcoolerInputs.classList.toggle('hidden', value !== 'subcooler');
        }
    });

    // ECO Press Mode (Visual Update)
    setupRadioToggle('eco_press_mode_m2', (value) => {
        const tempInput = document.getElementById('temp_eco_sat_m2');
        if (!tempInput) return;

        if (value === 'auto') {
            tempInput.disabled = true;
            tempInput.placeholder = "Auto";
            tempInput.value = "";
            tempInput.classList.add('opacity-50', 'cursor-not-allowed', 'bg-gray-100/50');
            tempInput.classList.remove('bg-white');
        } else {
            tempInput.disabled = false;
            tempInput.placeholder = "e.g. 35.0";
            if(tempInput.value === "") tempInput.value = "35";
            tempInput.classList.remove('opacity-50', 'cursor-not-allowed', 'bg-gray-100/50');
            tempInput.classList.add('bg-white');
        }
    });

    // Eff Mode
    setupRadioToggle('eff_mode_m2', (value) => {
        const motorGroup = document.getElementById('motor-eff-group-m2');
        if(motorGroup) motorGroup.style.display = (value === 'input') ? 'block' : 'none';
        
        const label = document.getElementById('eta_s_label_m2');
        if(label) label.textContent = (value === 'input') ? '总等熵效率 (η_total)' : '等熵效率 (η_s)';
    });

    // Auto Eff Lock
    function setupAutoEfficiencyCheckbox(checkboxId, inputIds) {
        const checkbox = document.getElementById(checkboxId);
        const inputs = inputIds.map(id => document.getElementById(id));

        if (!checkbox || inputs.some(i => !i)) return;

        const handleChange = () => {
            const isAuto = checkbox.checked;
            inputs.forEach(input => {
                input.disabled = isAuto;
                if (isAuto) {
                    // Apple Style Disabled: 降低透明度 + 禁止手势
                    input.classList.add('opacity-50', 'cursor-not-allowed');
                } else {
                    input.classList.remove('opacity-50', 'cursor-not-allowed');
                }
            });
        };
        checkbox.addEventListener('change', handleChange);
        handleChange();
    }

    setupAutoEfficiencyCheckbox('auto-eff-m2', ['eta_s_m2', 'eta_v_m2']);

    // --- Mode 3 Logic (Placeholder matches M2) ---
    setupRadioToggle('flow_mode_m3', (value) => {
        const rpm = document.getElementById('rpm-inputs-m3');
        const vol = document.getElementById('vol-inputs-m3');
        if(rpm && vol) {
            rpm.style.display = (value === 'rpm') ? 'grid' : 'none';
            vol.style.display = (value === 'vol') ? 'block' : 'none';
        }
    });
    
    // Auto Eff M3
    setupAutoEfficiencyCheckbox('auto-eff-m3', ['eta_iso_m3', 'eta_v_m3']);

    // --- 4. Global Animations ---
    // Button Press Haptic
    document.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('mousedown', () => btn.classList.add('scale-[0.98]'));
        btn.addEventListener('mouseup', () => btn.classList.remove('scale-[0.98]'));
        btn.addEventListener('mouseleave', () => btn.classList.remove('scale-[0.98]'));
    });

    console.log("UI v3.0 (Cockpit) initialized.");
}