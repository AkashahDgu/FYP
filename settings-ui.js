/**
 * Settings UI — Tab switching, graphics/audio/gameplay controls
 */

/**
 * Initialize all settings panel controls.
 * @param {object} deps - Dependencies: { graphicsEngine, renderer, camera, player }
 * @returns {{ walkSpeed, mouseSensitivity, flyMode, isSettingsOpen }} - Reactive state refs
 */
export function initSettings(deps) {
    const { graphicsEngine } = deps;
    const panel = document.getElementById('settings-panel');

    // Mutable state (returned for external reads)
    const state = {
        walkSpeed: 5,
        mouseSensitivity: 0.002,
        flyMode: false,
        isSettingsOpen: false
    };

    // Sync initial checkbox state
    const flyToggle = document.getElementById('toggle-fly');
    if (flyToggle) flyToggle.checked = state.flyMode;

    // ── Tab switching ──
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
        });
    });

    // ── Open / Close ──
    document.getElementById('settings-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        state.isSettingsOpen = true;
        panel.style.display = 'block';
        document.exitPointerLock();
    });

    document.getElementById('close-settings').addEventListener('click', () => {
        state.isSettingsOpen = false;
        panel.style.display = 'none';
    });

    // ── Graphics Tab ──
    bindSlider('res-slider', 'res-val', (v) => {
        graphicsEngine.setResolutionScale(v / 100);
        return v + '%';
    });

    bindToggle('toggle-ssao', (checked) => graphicsEngine.togglePass('ssao', checked));
    bindToggle('toggle-bloom', (checked) => graphicsEngine.togglePass('bloom', checked));
    bindToggle('toggle-fxaa', (checked) => graphicsEngine.togglePass('fxaa', checked));
    bindToggle('toggle-smaa', (checked) => graphicsEngine.togglePass('smaa', checked));

    const todLabels = ['Sunrise', 'Morning', 'Golden Hr', 'Noon', 'Afternoon', 'Golden Hr', 'Sunset'];
    bindSlider('tod-slider', 'tod-val', (v) => {
        const t = v / 100;
        graphicsEngine.setTimeOfDay(t);
        const idx = Math.min(todLabels.length - 1, Math.floor(t * (todLabels.length - 1) + 0.5));
        return todLabels[idx];
    });



    // ── Gameplay Tab ──
    bindSlider('speed-slider', 'speed-val', (v) => {
        state.walkSpeed = parseFloat(v);
        return v;
    });

    bindSlider('sens-slider', 'sens-val', (v) => {
        const val = parseFloat(v) / 10;
        state.mouseSensitivity = val / 1000;
        return val.toFixed(1);
    });

    bindToggle('toggle-minimap', (checked) => {
        document.getElementById('minimap').style.display = checked ? 'block' : 'none';
    });

    bindToggle('toggle-fly', (checked) => { state.flyMode = checked; });


    return state;
}

// ── Helpers ──

function bindSlider(sliderId, valId, onChange) {
    const slider = document.getElementById(sliderId);
    const valEl = document.getElementById(valId);
    if (!slider || !valEl) return;
    slider.addEventListener('input', (e) => {
        const result = onChange(parseInt(e.target.value));
        if (result !== undefined) valEl.innerText = result;
    });
}

function bindToggle(toggleId, onChange) {
    const el = document.getElementById(toggleId);
    if (!el) return;
    el.addEventListener('change', (e) => onChange(e.target.checked));
}
