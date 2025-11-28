// =====================================================================
// ui.js: UI 界面交互逻辑 - (v2.8 ECO Auto-Opt 适配版)
// 职责: 处理所有 DOM 元素的显示/隐藏、选项卡切换、开关联动及自动模式锁定。
// =====================================================================

export function initUI() {

    // --- 主选项卡切换 ---
    const tabBtnM2 = document.getElementById('tab-btn-m2');
    const tabBtnM3 = document.getElementById('tab-btn-m3');
    const contentM2 = document.getElementById('tab-content-m2');
    const contentM3 = document.getElementById('tab-content-m3');
    const tabs = [{ btn: tabBtnM2, content: contentM2 }, { btn: tabBtnM3, content: contentM3 }];

    tabs.forEach(tab => {
        if (tab.btn && tab.content) {
            tab.btn.addEventListener('click', () => {
                tabs.forEach(t => {
                    t.btn.classList.remove('active', 'bg-white', 'shadow-sm');
                    t.content.classList.remove('active');
                    t.content.classList.add('hidden');
                });
                tab.btn.classList.add('active', 'bg-white', 'shadow-sm');
                tab.content.classList.add('active');
                tab.content.classList.remove('hidden');
            });
        }
    });

    // --- 通用设置函数 (用于 Radio 单选框切换) ---
    function setupRadioToggle(radioName, onToggle) {
        const radios = document.querySelectorAll(`input[name="${radioName}"]`);
        if (!radios.length) return;
        
        radios.forEach(radio => {
            radio.addEventListener('change', () => {
                if(radio.checked) onToggle(radio.value);
            });
        });
        
        // 初始化：找到当前被选中的 radio 并触发一次回调
        const checkedRadio = document.querySelector(`input[name="${radioName}"]:checked`);
        if (checkedRadio) onToggle(checkedRadio.value);
    }

    // --- [原有] 流量模式切换 ---
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
    
    setupRadioToggle('flow_mode_m3', (value) => {
        const rpmInputs = document.getElementById('rpm-inputs-m3');
        const volInputs = document.getElementById('vol-inputs-m3');
        if (rpmInputs && volInputs) {
            rpmInputs.style.display = (value === 'rpm') ? 'grid' : 'none';
            volInputs.style.display = (value === 'vol') ? 'block' : 'none';
            rpmInputs.querySelectorAll('input').forEach(i => i.required = (value === 'rpm'));
            volInputs.querySelectorAll('input').forEach(i => i.required = (value === 'vol'));
        }
    });

    // --- [ECO] 经济器交互逻辑 ---
    const ecoCheckbox = document.getElementById('enable_eco_m2');
    const ecoSettings = document.getElementById('eco-settings-m2');
    const ecoPlaceholder = document.getElementById('eco-placeholder-m2');

    if (ecoCheckbox && ecoSettings && ecoPlaceholder) {
        // 1. 监听总开关
        ecoCheckbox.addEventListener('change', () => {
            if (ecoCheckbox.checked) {
                ecoSettings.classList.remove('hidden');
                ecoPlaceholder.classList.add('hidden');
            } else {
                ecoSettings.classList.add('hidden');
                ecoPlaceholder.classList.remove('hidden');
            }
        });
        // 初始化状态
        ecoCheckbox.dispatchEvent(new Event('change'));
    }

    // 2. ECO 类型切换 (闪发罐 vs 过冷器)
    setupRadioToggle('eco_type_m2', (value) => {
        const subcoolerInputs = document.getElementById('eco-subcooler-inputs-m2');
        if (subcoolerInputs) {
            if (value === 'subcooler') {
                subcoolerInputs.classList.remove('hidden');
            } else {
                subcoolerInputs.classList.add('hidden');
            }
        }
    });

    // 3. [新增] ECO 压力设定模式切换 (自动 vs 手动)
    setupRadioToggle('eco_press_mode_m2', (value) => {
        const tempInput = document.getElementById('temp_eco_sat_m2');
        if (!tempInput) return;

        if (value === 'auto') {
            // 自动模式：禁用输入框，变灰
            tempInput.disabled = true;
            tempInput.placeholder = "自动计算 (Auto)";
            tempInput.value = ""; // 清空，表明由系统接管
            tempInput.classList.add('bg-gray-100', 'text-gray-500', 'cursor-not-allowed');
            tempInput.classList.remove('bg-white', 'text-gray-900', 'focus:ring-teal-500');
        } else {
            // 手动模式：启用输入框，变白
            tempInput.disabled = false;
            tempInput.placeholder = "输入温度 (例如 35)";
            if (tempInput.value === "") tempInput.value = "35"; // 给个默认值方便输入
            tempInput.classList.remove('bg-gray-100', 'text-gray-500', 'cursor-not-allowed');
            tempInput.classList.add('bg-white', 'text-gray-900', 'focus:ring-teal-500');
        }
    });

    // --- [原有] 功率/效率基准切换 ---
    setupRadioToggle('eff_mode_m2', (value) => {
        const motorGroup = document.getElementById('motor-eff-group-m2');
        if (motorGroup) motorGroup.style.display = (value === 'input') ? 'block' : 'none';
        
        const label = document.getElementById('eta_s_label_m2');
        if (label && label.firstChild) {
            label.firstChild.textContent = (value === 'input') ? '总等熵效率 (η_total) ' : '等熵效率 (η_s) ';
        }
    });
    
    setupRadioToggle('eff_mode_m3', (value) => {
        const motorGroup = document.getElementById('motor-eff-group-m3');
        if(motorGroup) motorGroup.style.display = (value === 'input') ? 'block' : 'none';
    });
    
    // --- [原有] 气体压缩模式效率类型切换 ---
    const effTypeRadiosM3 = document.querySelectorAll('input[name="eff_type_m3"]');
    if (effTypeRadiosM3.length) {
        const toggleM3EfficiencyLabel = () => {
            const modeRadio = document.querySelector('input[name="eff_mode_m3"]:checked');
            const typeRadio = document.querySelector('input[name="eff_type_m3"]:checked');
            const effLabelM3 = document.getElementById('eta_label_m3');
            
            if(!modeRadio || !typeRadio || !effLabelM3) return;

            const isInputMode = modeRadio.value === 'input';
            const effType = typeRadio.value;
            let labelText = '';
            
            if (effType === 'isothermal') {
                labelText = isInputMode ? '总等温效率 (η_iso_total) ' : '等温效率 (η_iso) ';
            } else {
                labelText = isInputMode ? '总等熵效率 (η_s_total) ' : '等熵效率 (η_s) ';
            }
            if (effLabelM3.firstChild) effLabelM3.firstChild.textContent = labelText;
        };
        
        document.querySelectorAll('input[name="eff_type_m3"], input[name="eff_mode_m3"]')
            .forEach(r => r.addEventListener('change', toggleM3EfficiencyLabel));
        toggleM3EfficiencyLabel();
    }

    // --- [原有] 智能效率模式UI控制 ---
    function setupAutoEfficiencyCheckbox(checkboxId, inputIds) {
        const checkbox = document.getElementById(checkboxId);
        const inputs = inputIds.map(id => document.getElementById(id));

        if (!checkbox || inputs.some(i => !i)) return;

        const handleChange = () => {
            const isAuto = checkbox.checked;
            inputs.forEach(input => {
                input.disabled = isAuto;
                if (isAuto) {
                    input.classList.add('bg-gray-100', 'text-gray-500', 'cursor-not-allowed');
                    input.classList.remove('bg-white');
                } else {
                    input.classList.remove('bg-gray-100', 'text-gray-500', 'cursor-not-allowed');
                    input.classList.add('bg-white');
                }
            });
        };

        checkbox.addEventListener('change', handleChange);
        handleChange();
    }

    setupAutoEfficiencyCheckbox('auto-eff-m2', ['eta_s_m2', 'eta_v_m2']);
    setupAutoEfficiencyCheckbox('auto-eff-m3', ['eta_iso_m3', 'eta_v_m3']);

    console.log("UI v2.8 (ECO Auto-Opt) 已初始化。");
}