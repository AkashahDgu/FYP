/**
 * NPC System — NPC loading, interaction, dialogue tree, 360° viewer
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { ORIGIN_LAT, ORIGIN_LNG } from './minimap.js';

export const loadedNPCs = [];
let nearNPC = null;
let modalRenderer = null, modalScene, modalCamera, modalSphere;
let isDragging = false, onPointerDownX = 0, onPointerDownY = 0, onPointerDownLon = 0, onPointerDownLat = 0;
let lon = 0, lat = 0;

// Reusable scratch vector for 360° viewer camera target (avoids per-frame allocation)
const _360Target = new THREE.Vector3();

// Shared interaction state (exported for other modules)
export const interactionState = {
    isNear: false,
    isInteracting: false,
    is360Active: false
};

// Telemetry-mapped room coordinates using local project formula
export const roomCoordinates = {
    "C06 Dewan Kuliah 1 (DK 1) Level 3": {
        name: "C06 Dewan Kuliah 1 (DK 1) Level 3",
        x: (103.635833 - ORIGIN_LNG) * 111280 + 0.2588,
        y: (1.560428 - ORIGIN_LAT) * 111320 + 0.9659,
        z: 5.5
    },
    "C06 Dewan Kuliah 2 (DK 2) Level 2": {
        name: "C06 Dewan Kuliah 2 (DK 2) Level 2",
        x: (103.635835 - ORIGIN_LNG) * 111280 + 0.2588,
        y: (1.560432 - ORIGIN_LAT) * 111320 + 0.9659,
        z: 2.5
    },
    "C02 Bilik Kuliah 3 (BK 3) Level 3": {
        name: "C02 Bilik Kuliah 3 (BK 3) Level 3",
        x: (103.635740 - ORIGIN_LNG) * 111280 + 0.2588,
        y: (1.560157 - ORIGIN_LAT) * 111320 + 0.9659,
        z: 8.5
    },
    "C02 Bilik Kuliah 2 (BK 2) Level 3": {
        name: "C02 Bilik Kuliah 2 (BK 2) Level 3",
        x: (103.635556 - ORIGIN_LNG) * 111280 + 0.2588,
        y: (1.560223 - ORIGIN_LAT) * 111320 + 0.9659,
        z: 8.5
    },
    "C02 Bilik Kuliah 1 (BK 1) Level 3": {
        name: "C02 Bilik Kuliah 1 (BK 1) Level 3",
        x: (103.635469 - ORIGIN_LNG) * 111280 + 0.2588,
        y: (1.560261 - ORIGIN_LAT) * 111320 + 0.9659,
        z: 8.5
    },
    "C03 Bilik Kuliah 4 (BK 4) Level 4": {
        name: "C03 Bilik Kuliah 4 (BK 4) Level 4",
        x: (103.636013 - ORIGIN_LNG) * 111280 + 0.2588,
        y: (1.560077 - ORIGIN_LAT) * 111320 + 0.9659,
        z: 8.5
    },
    "C04 Bilik Kuliah 5 (BK 5) Level 4": {
        name: "C04 Bilik Kuliah 5 (BK 5) Level 4",
        x: (103.636643 - ORIGIN_LNG) * 111280 + 0.2588,
        y: (1.560072 - ORIGIN_LAT) * 111320 + 0.9659,
        z: 12.0
    },
    "C04 Bilik Kuliah 6 (BK 6) Level 2": {
        name: "C04 Bilik Kuliah 6 (BK 6) Level 2",
        x: (103.636564 - ORIGIN_LNG) * 111280 + 0.2588,
        y: (1.560445 - ORIGIN_LAT) * 111320 + 0.9659,
        z: 6.0
    },
    "C05 Bilik Kuliah 7 (BK 7) Level 4": {
        name: "C05 Bilik Kuliah 7 (BK 7) Level 4",
        x: (103.637046 - ORIGIN_LNG) * 111280 + 0.2588,
        y: (1.560177 - ORIGIN_LAT) * 111320 + 0.9659,
        z: 12.0
    },
    "C05 Bilik Kuliah 8 (BK 8) Level 4": {
        name: "C05 Bilik Kuliah 8 (BK 8) Level 4",
        x: (103.637168 - ORIGIN_LNG) * 111280 + 0.2588,
        y: (1.560228 - ORIGIN_LAT) * 111320 + 0.9659,
        z: 12.0
    },
    "INM-STAIR1 (Level 1)": {
        name: "INM-STAIR1 (Level 1)",
        x: (103.636341 - ORIGIN_LNG) * 111280 + 0.2588,
        y: (1.559984 - ORIGIN_LAT) * 111320 + 0.9659,
        z: 0.00
    },
    "INM-STAIR2 (Level 2)": {
        name: "INM-STAIR2 (Level 2)",
        x: (103.636341 - ORIGIN_LNG) * 111280 + 0.2588,
        y: (1.559984 - ORIGIN_LAT) * 111320 + 0.9659,
        z: 3.00
    },
    "INM-STAIR3 (Level 3)": {
        name: "INM-STAIR3 (Level 3)",
        x: (103.636341 - ORIGIN_LNG) * 111280 + 0.2588,
        y: (1.559984 - ORIGIN_LAT) * 111320 + 0.9659,
        z: 6.00
    },
    "INM-STAIR4 (Level 4)": {
        name: "INM-STAIR4 (Level 4)",
        x: (103.636341 - ORIGIN_LNG) * 111280 + 0.2588,
        y: (1.559984 - ORIGIN_LAT) * 111320 + 0.9659,
        z: 9.00
    },
    "INM-STAIR5 (Level 5)": {
        name: "INM-STAIR5 (Level 5)",
        x: (103.636341 - ORIGIN_LNG) * 111280 + 0.2588,
        y: (1.559984 - ORIGIN_LAT) * 111320 + 0.9659,
        z: 12.00
    }
};

// Active target for wayfinding navigation (initially null)
export let activeWayfindingTarget = null;

/**
 * Helper to spawn an NPC instance (using GLTF model if loaded, otherwise fallback capsule).
 */
function spawnNPC(scene, x, y, z, name, gltfData = null) {
    let npcGroup;
    let mixer = null;

    if (gltfData) {
        // Clone the scene hierarchy using SkeletonUtils to ensure skeleton binds copy correctly
        const modelClone = SkeletonUtils.clone(gltfData.scene);
        
        npcGroup = new THREE.Group();
        npcGroup.add(modelClone);

        // Auto-scale to 170cm using mesh bounding box
        let meshMinY = Infinity, meshMaxY = -Infinity;
        modelClone.traverse(child => {
            if (child.isMesh && child.geometry) {
                child.geometry.computeBoundingBox();
                meshMinY = Math.min(meshMinY, child.geometry.boundingBox.min.y);
                meshMaxY = Math.max(meshMaxY, child.geometry.boundingBox.max.y);
            }
        });
        const currentHeight = (meshMaxY - meshMinY) || 1;
        const scaleFactor = 1.7 / currentHeight;
        modelClone.scale.set(scaleFactor, scaleFactor, scaleFactor);
        modelClone.position.set(0, 0, 0);
        modelClone.rotation.x = Math.PI / 2; // Corrective rotation for Z-up upright posture

        // Disable shadows on NPC
        modelClone.traverse(child => {
            if (child.isMesh) {
                child.castShadow = false;
                child.receiveShadow = false;
            }
        });

        npcGroup.position.set(x, y, z - (meshMinY * scaleFactor));
        scene.add(npcGroup);

        // Instanced mixers so each NPC runs its animation timer independently
        if (gltfData.animations && gltfData.animations.length > 0) {
            mixer = new THREE.AnimationMixer(modelClone);
            const idleClip = THREE.AnimationClip.findByName(gltfData.animations, 'idle')
                || THREE.AnimationClip.findByName(gltfData.animations, 'Idle')
                || gltfData.animations[0];
            mixer.clipAction(idleClip).play();
        }
    } else {
        // Fallback Capsule NPC
        npcGroup = new THREE.Group();
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.3, metalness: 0.8 });
        const headMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.2, metalness: 0.5 });
        const eyeMat = new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00e5ff, emissiveIntensity: 2 });

        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.5, 4, 16), bodyMat);
        body.position.z = 0.45;
        npcGroup.add(body);

        const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), headMat);
        head.position.z = 0.9;
        npcGroup.add(head);

        const visor = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.05, 0.1), eyeMat);
        visor.position.set(0, 0.12, 0.95);
        npcGroup.add(visor);

        npcGroup.position.set(x, y, z);
        scene.add(npcGroup);
    }

    return { group: npcGroup, mixer, name };
}

/**
 * Load the NPC models (Guide NPC and staircase NPCs).
 * @returns {Promise<void>} Resolves when all NPCs (or fallbacks) are spawned
 */
export function loadNPC(scene) {
    return new Promise((resolve) => {
        const gltfLoader = new GLTFLoader();

        // Guide NPC Spawn Position
        const guideX = (103.635777 - ORIGIN_LNG) * 111280;
        const guideY = (1.560139 - ORIGIN_LAT) * 111320;
        const guideZ = 0.00;

        // Staircase level coordinates
        const stairs = [
            roomCoordinates["INM-STAIR1 (Level 1)"],
            roomCoordinates["INM-STAIR2 (Level 2)"],
            roomCoordinates["INM-STAIR3 (Level 3)"],
            roomCoordinates["INM-STAIR4 (Level 4)"],
            roomCoordinates["INM-STAIR5 (Level 5)"]
        ];

        gltfLoader.load('Data UTM/NPC/NPC.glb', (gltf) => {
            // Spawn guide NPC
            const guide = spawnNPC(scene, guideX, guideY, guideZ, "Guide NPC", gltf);
            loadedNPCs.push(guide);

            // Spawn staircase NPCs
            stairs.forEach(stair => {
                const sNpc = spawnNPC(scene, stair.x, stair.y, stair.z, stair.name, gltf);
                loadedNPCs.push(sNpc);
            });

            console.log('Guide and staircase NPCs loaded successfully.');
            resolve();
        }, undefined, (err) => {
            console.error('NPC load failed, spawning fallback capsules.', err);
            
            // Spawn fallback guide NPC
            const guide = spawnNPC(scene, guideX, guideY, guideZ, "Guide NPC", null);
            loadedNPCs.push(guide);

            // Spawn fallback staircase NPCs
            stairs.forEach(stair => {
                const sNpc = spawnNPC(scene, stair.x, stair.y, stair.z, stair.name, null);
                loadedNPCs.push(sNpc);
            });

            resolve();
        });
    });
}

/**
 * Update all NPCs (animations, player facing rotation, proximity detection).
 */
export function updateNPC(player, deltaSeconds) {
    // 1. Update mixers for all NPCs
    loadedNPCs.forEach(npcObj => {
        if (npcObj.mixer) npcObj.mixer.update(deltaSeconds);
    });

    // 2. Rotate NPCs towards player & calculate nearest active NPC (in 3D space)
    let closestNPC = null;
    let minDistance = Infinity;

    loadedNPCs.forEach(npcObj => {
        const npcGroup = npcObj.group;
        if (!npcGroup) return;

        const dx = player.position.x - npcGroup.position.x;
        const dy = player.position.y - npcGroup.position.y;
        const dz = player.position.z - npcGroup.position.z;
        const dist3D = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // Face the player always
        npcGroup.rotation.z = Math.atan2(dy, dx) + Math.PI / 2;

        // Proximity detection: within 3 meters in 3D space
        if (dist3D < 3.0) {
            if (dist3D < minDistance) {
                minDistance = dist3D;
                closestNPC = npcObj;
            }
        }
    });

    // 3. Update interaction HUD prompt
    const prompt = document.getElementById('interaction-prompt');
    if (closestNPC && !interactionState.isInteracting && !interactionState.is360Active) {
        interactionState.isNear = true;
        nearNPC = closestNPC;
        if (prompt) {
            if (closestNPC.name === "Guide NPC") {
                prompt.innerHTML = 'Press <span style="color: #00e5ff; background: rgba(0,229,255,0.1); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(0,229,255,0.3);">F</span> to Talk';
            } else {
                prompt.innerHTML = `Press <span style="color: #00e5ff; background: rgba(0,229,255,0.1); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(0,229,255,0.3);">F</span> to Inspect ${closestNPC.name.replace("INM-STAIR", "Staircase ")}`;
            }
            prompt.style.display = 'block';
        }
    } else {
        interactionState.isNear = false;
        nearNPC = null;
        if (prompt) prompt.style.display = 'none';
    }
}

// ═══════════════════════════════════════════
// DIALOGUE SYSTEM
// ═══════════════════════════════════════════

const dialogueData = {
    start: {
        text: "Hello explorer! I'm the UTM Campus Guide. How can I help you navigate the campus today?",
        options: [
            { text: "Open Global Navigation Map", action: () => { if (window.toggleGlobalNavigationMenu) window.toggleGlobalNavigationMenu(true); } },
            { text: "View 360° Panorama", next: "show_360" },
            { text: "Maybe later", next: "later" }
        ]
    },
    show_360: {
        text: "Excellent choice! Initiating 360-degree projection now. You can look around using your mouse.",
        options: [
            { text: "Launch 360 Mode", action: () => toggle360Mode(true) },
            { text: "Back", next: "start" }
        ]
    },
    later: {
        text: "No problem! I'll be here if you change your mind. Safe travels around the campus!",
        options: [{ text: "Goodbye", action: closeDialogue }]
    }
};

export function openDialogue() {
    interactionState.isInteracting = true;
    interactionState.isNear = false;
    document.exitPointerLock();

    if (nearNPC && nearNPC.name !== "Guide NPC") {
        openWaypointDialogue(nearNPC.name);
    } else {
        showDialogueStep('start');
        document.getElementById('dialogue-container').style.display = 'block';
        document.getElementById('interaction-prompt').style.display = 'none';
    }
}

function showDialogueStep(stepKey) {
    const step = dialogueData[stepKey];
    const textEl = document.getElementById('dialogue-text');
    const optionsEl = document.getElementById('dialogue-options');
    textEl.innerText = step.text;
    optionsEl.innerHTML = '';
    step.options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'dialogue-btn';
        btn.innerText = opt.text;
        btn.onclick = () => {
            if (opt.action) opt.action();
            else if (opt.next) showDialogueStep(opt.next);
        };
        optionsEl.appendChild(btn);
    });
}

export function closeDialogue() {
    interactionState.isInteracting = false;
    document.getElementById('dialogue-container').style.display = 'none';
}

/**
 * Starts the wayfinding navigation to the selected room.
 * @param {string} roomKey
 */
export function startNavigation(roomKey) {
    activeWayfindingTarget = roomCoordinates[roomKey];
    closeDialogue();

    // Trigger building notification immediately
    const notifEl = document.getElementById('zone-notification');
    if (notifEl) {
        let buildingContext = "";
        if (roomKey.includes("C03") || roomKey.includes("BK 4")) {
            buildingContext = "Navigating to C03 Block";
        } else if (roomKey.includes("C04") || roomKey.includes("BK 5") || roomKey.includes("BK 6")) {
            buildingContext = "Navigating to C04 Block";
        } else if (roomKey.includes("C05") || roomKey.includes("BK 7") || roomKey.includes("BK 8")) {
            buildingContext = "Navigating to C05 Block";
        } else if (roomKey.includes("C02") || roomKey.includes("BK 1") || roomKey.includes("BK 2") || roomKey.includes("BK 3")) {
            buildingContext = "Navigating to Fakulti Alam Bina & Ukur (C02)";
        } else if (roomKey.includes("C06") || roomKey.includes("DK")) {
            buildingContext = "Navigating to C06 Block";
        } else {
            buildingContext = `Navigating to ${roomKey}`;
        }
        notifEl.innerHTML = `<span class="zone-icon">📍</span><span class="zone-name">${buildingContext}</span>`;
        notifEl.classList.add('visible');

        if (window._zoneNotifTimer) clearTimeout(window._zoneNotifTimer);
        window._zoneNotifTimer = setTimeout(() => {
            notifEl.classList.remove('visible');
        }, 3000);
    }
}

/**
 * Clears the active wayfinding target.
 */
export function clearWayfinding() {
    activeWayfindingTarget = null;
}

/**
 * Triggers interactive pop-up dialogue panel showing the room's custom details upon arrival.
 * @param {string} roomKey
 */
export function openWaypointDialogue(roomKey) {
    interactionState.isInteracting = true;
    document.exitPointerLock();

    const textEl = document.getElementById('dialogue-text');
    const optionsEl = document.getElementById('dialogue-options');

    let roomDetails = "";
    if (roomKey.includes("Dewan Kuliah 1")) {
        roomDetails = "C06 Dewan Kuliah 1 (DK 1) Level 3";
    } else if (roomKey.includes("Dewan Kuliah 2")) {
        roomDetails = "C06 Dewan Kuliah 2 (DK 2) Level 2";
    } else if (roomKey.includes("Bilik Kuliah 1")) {
        roomDetails = "C02 Bilik Kuliah 1 (BK 1) Level 3";
    } else if (roomKey.includes("Bilik Kuliah 2")) {
        roomDetails = "C02 Bilik Kuliah 2 (BK 2) Level 3";
    } else if (roomKey.includes("Bilik Kuliah 3")) {
        roomDetails = "C02 Bilik Kuliah 3 (BK 3) Level 3";
    } else if (roomKey.includes("Bilik Kuliah 4")) {
        roomDetails = "C03 Bilik Kuliah 4 (BK 4) Level 4";
    } else if (roomKey.includes("Bilik Kuliah 5")) {
        roomDetails = "C04 Bilik Kuliah 5 (BK 5) Level 4";
    } else if (roomKey.includes("Bilik Kuliah 6")) {
        roomDetails = "C04 Bilik Kuliah 6 (BK 6) Level 2";
    } else if (roomKey.includes("Bilik Kuliah 7")) {
        roomDetails = "C05 Bilik Kuliah 7 (BK 7) Level 4";
    } else if (roomKey.includes("Bilik Kuliah 8")) {
        roomDetails = "C05 Bilik Kuliah 8 (BK 8) Level 4";
    } else {
        roomDetails = roomKey;
    }

    textEl.innerText = `You have arrived at your destination:\n${roomDetails}`;
    optionsEl.innerHTML = '';

    // Check if target has an associated panorama file
    let panoramaFile = null;
    if (roomKey.includes("INM-STAIR1")) {
        panoramaFile = "PXL_2.jpg";
    } else if (roomKey.includes("INM-STAIR2")) {
        panoramaFile = "PXL_3.jpg";
    } else if (roomKey.includes("INM-STAIR3")) {
        panoramaFile = "PXL_4.jpg";
    } else if (roomKey.includes("INM-STAIR4")) {
        panoramaFile = "PXL_5.jpg";
    } else if (roomKey.includes("INM-STAIR5")) {
        panoramaFile = "PXL_6.jpg";
    }

    // Add "Open Global Navigation Map" button to INM dialogue
    const navBtn = document.createElement('button');
    navBtn.className = 'dialogue-btn';
    navBtn.innerText = 'Open Global Navigation Map';
    navBtn.style.border = '1px solid #00e5ff';
    navBtn.style.color = '#00e5ff';
    navBtn.style.background = 'rgba(0, 229, 255, 0.15)';
    navBtn.style.boxShadow = '0 0 10px rgba(0, 229, 255, 0.3)';
    navBtn.onclick = () => {
        if (window.toggleGlobalNavigationMenu) {
            window.toggleGlobalNavigationMenu(true);
        }
    };
    optionsEl.appendChild(navBtn);

    if (panoramaFile) {
        const viewBtn = document.createElement('button');
        viewBtn.className = 'dialogue-btn';
        viewBtn.innerText = 'View 360° Panorama';
        viewBtn.onclick = () => {
            toggle360Mode(true, panoramaFile);
            clearWayfinding();
        };
        optionsEl.appendChild(viewBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'dialogue-btn';
    closeBtn.innerText = 'OK';
    closeBtn.onclick = () => {
        closeDialogue();
        clearWayfinding();
    };
    optionsEl.appendChild(closeBtn);

    document.getElementById('dialogue-container').style.display = 'block';
    const prompt = document.getElementById('interaction-prompt');
    if (prompt) prompt.style.display = 'none';
}

// ═══════════════════════════════════════════
// 360° VIEWER
// ═══════════════════════════════════════════

export function toggle360Mode(active, imageFile = 'PXL_1.jpg') {
    interactionState.is360Active = active;
    const modal = document.getElementById('three60-modal');
    const overlay = document.getElementById('modal-overlay');

    if (active) {
        closeDialogue();
        modal.style.display = 'block';
        overlay.style.display = 'block';
        if (!modalRenderer) {
            init360Modal(imageFile);
        } else {
            update360Texture(imageFile);
            
            const container = document.getElementById('three60-canvas-container');
            modalRenderer.setSize(container.clientWidth, container.clientHeight);
            modalCamera.aspect = container.clientWidth / container.clientHeight;
            modalCamera.updateProjectionMatrix();
            runAnimate360();
        }
        document.exitPointerLock();
    } else {
        modal.style.display = 'none';
        overlay.style.display = 'none';
    }
}

function update360Texture(imageFile) {
    if (!modalSphere || !modalSphere.material) return;
    const textureLoader = new THREE.TextureLoader();
    const newTex = textureLoader.load(`Data UTM/360 Images/${imageFile}`, (loadedTex) => {
        loadedTex.needsUpdate = true;
        if (modalSphere && modalSphere.material) {
            modalSphere.material.needsUpdate = true;
        }
    });
    newTex.colorSpace = THREE.SRGBColorSpace;
    newTex.minFilter = THREE.LinearFilter;
    newTex.magFilter = THREE.LinearFilter;
    newTex.generateMipmaps = false;
    newTex.wrapS = THREE.RepeatWrapping;
    newTex.anisotropy = modalRenderer.capabilities.getMaxAnisotropy();
    
    // Dispose of previous map to prevent memory leaks
    if (modalSphere.material.map) {
        modalSphere.material.map.dispose();
    }
    
    modalSphere.material.map = newTex;
    modalSphere.material.needsUpdate = true;
}

function init360Modal(imageFile = 'PXL_1.jpg') {
    const container = document.getElementById('three60-canvas-container');
    const textureLoader = new THREE.TextureLoader();

    // Load 360 texture
    const three60Tex = textureLoader.load(`Data UTM/360 Images/${imageFile}`);
    three60Tex.colorSpace = THREE.SRGBColorSpace;
    three60Tex.minFilter = THREE.LinearFilter;
    three60Tex.magFilter = THREE.LinearFilter;
    three60Tex.generateMipmaps = false;
    three60Tex.wrapS = THREE.RepeatWrapping;

    modalScene = new THREE.Scene();
    
    // Zoom slider default FOV initialization
    const zoomSlider = document.getElementById('three60-zoom');
    const defaultFov = zoomSlider ? parseFloat(zoomSlider.value) : 75;
    modalCamera = new THREE.PerspectiveCamera(defaultFov, container.clientWidth / container.clientHeight, 0.1, 1000);
    modalCamera.up.set(0, 1, 0); // Override default Z-up global vector to prevent diagonal rolling/twisting distortion

    modalRenderer = new THREE.WebGLRenderer({ antialias: true });
    modalRenderer.setPixelRatio(window.devicePixelRatio);
    modalRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    modalRenderer.toneMappingExposure = 1.2;
    modalRenderer.outputColorSpace = THREE.SRGBColorSpace;
    modalRenderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(modalRenderer.domElement);

    three60Tex.anisotropy = modalRenderer.capabilities.getMaxAnisotropy();
    three60Tex.needsUpdate = true;

    const sphereGeo = new THREE.SphereGeometry(500, 60, 40);
    const sphereMat = new THREE.MeshBasicMaterial({ map: three60Tex, side: THREE.BackSide });
    modalSphere = new THREE.Mesh(sphereGeo, sphereMat);
    modalSphere.scale.set(-1, 1, 1); // Invert sphere on X-axis so texture maps correctly on the inside
    modalScene.add(modalSphere);

    // Mouse drag
    container.addEventListener('mousedown', (e) => {
        isDragging = true;
        onPointerDownX = e.clientX;
        onPointerDownY = e.clientY;
        onPointerDownLon = lon;
        onPointerDownLat = lat;
    });
    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        lon = (onPointerDownX - e.clientX) * 0.1 + onPointerDownLon;
        lat = (e.clientY - onPointerDownY) * 0.1 + onPointerDownLat;
        lat = Math.max(-85, Math.min(85, lat));
    });
    window.addEventListener('mouseup', () => { isDragging = false; });

    // Zoom slider
    const zoomSliderEl = document.getElementById('three60-zoom');
    const zoomVal = document.getElementById('zoom-val');
    zoomSliderEl.oninput = (e) => {
        const val = parseFloat(e.target.value);
        modalCamera.fov = val;
        modalCamera.updateProjectionMatrix();
        zoomVal.innerText = val;
    };

    runAnimate360();
}

function runAnimate360() {
    if (!interactionState.is360Active) return;
    requestAnimationFrame(runAnimate360);
    const phi = THREE.MathUtils.degToRad(90 - lat);
    const theta = THREE.MathUtils.degToRad(lon);
    _360Target.setFromSphericalCoords(1, phi, theta);
    modalCamera.lookAt(_360Target);
    modalRenderer.render(modalScene, modalCamera);
}

/**
 * Wire up 360 close button and overlay click.
 */
export function init360Controls() {
    document.getElementById('three60-close').onclick = () => toggle360Mode(false);
    document.getElementById('modal-overlay').onclick = () => {
        if (interactionState.is360Active) {
            toggle360Mode(false);
        } else if (window.toggleGlobalNavigationMenu) {
            window.toggleGlobalNavigationMenu(false);
        }
    };
}

// Expose dialogue/viewer functions to window for testing & programmatic access
window.openDialogue = openDialogue;
window.closeDialogue = closeDialogue;
window.startNavigation = startNavigation;
window.openWaypointDialogue = openWaypointDialogue;
window.toggle360Mode = toggle360Mode;
window.ORIGIN_LAT = ORIGIN_LAT;
window.ORIGIN_LNG = ORIGIN_LNG;

