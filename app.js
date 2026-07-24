/**
 * UTM Campus Explorer — Main Application Entry Point
 * Ties all modules together: scene, roads, buildings, traffic, NPC, settings.
 *
 * COORDINATE SYSTEM (Z-Up):
 *   X = East/West (longitude)
 *   Y = North/South (latitude)
 *   Z = Altitude / Height
 */
import * as THREE from 'three';
import { createScene } from './scene-setup.js';
import { initMinimap, updateMinimap } from './minimap.js';
import { loadRoads } from './road-loader.js';
import { loadBuildings, collidableMeshes } from './building-loader.js';
import { initTraffic, updateTraffic, setRoadCurves } from './traffic.js';
import { loadNPC, updateNPC, interactionState, openDialogue, closeDialogue, toggle360Mode, init360Controls, activeWayfindingTarget, clearWayfinding, openWaypointDialogue } from './npc-system.js';
import { initSettings } from './settings-ui.js';

// ═══════════════════════════════════════════
// 1. SCENE SETUP
// ═══════════════════════════════════════════
const { scene, renderer, camera, player, graphicsEngine } = createScene();
window.player = player;

// ═══════════════════════════════════════════
// WAYFINDING HUD & WAYPOINT PIN SETUP (Z-Up)
// ═══════════════════════════════════════════
// Create Wayfinding HUD overlay programmatically
let wayfindingHud = document.getElementById('wayfinding-hud');
if (!wayfindingHud) {
    wayfindingHud = document.createElement('div');
    wayfindingHud.id = 'wayfinding-hud';
    wayfindingHud.style.display = 'none'; // Controlled dynamically by JS, other styles in CSS
    document.body.appendChild(wayfindingHud);
}

function createWaypointPin() {
    // Sleek 3D diamond geometric shape (Octahedron scaled to be a tall pin)
    const geometry = new THREE.OctahedronGeometry(0.25, 0);
    geometry.scale(1, 1, 1.8);

    // Basic material visible through walls
    const material = new THREE.MeshBasicMaterial({
        color: 0x00e5ff, // neon cyan
        depthTest: false,
        transparent: true,
        opacity: 0.95
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 999; // Ensure drawn on top of all geometries
    mesh.visible = false;

    return mesh;
}

const waypointPin = createWaypointPin();
scene.add(waypointPin);

// ═══════════════════════════════════════════
// 2. MINIMAP
// ═══════════════════════════════════════════
const { map } = initMinimap();

// ═══════════════════════════════════════════
// 3. SETTINGS UI
// ═══════════════════════════════════════════
const settings = initSettings({ graphicsEngine });

// ═══════════════════════════════════════════
// 4. LOAD WORLD (await everything before allowing entry)
// ═══════════════════════════════════════════
const loadingText = document.getElementById('loading-text');
const startBtn = document.getElementById('start-btn');
const progressBarFill = document.getElementById('progress-bar-fill');
const loadingPercentage = document.getElementById('loading-percentage');
const loadingContainer = document.getElementById('loading-container');

// Progress tracking helper
let loadingProgress = 10;
function updateProgress(percent, statusText) {
    loadingProgress = percent;
    if (progressBarFill) progressBarFill.style.width = `${percent}%`;
    if (loadingPercentage) loadingPercentage.textContent = `${percent}%`;
    if (loadingText) loadingText.textContent = statusText;
}

// Lock start button until assets are ready
updateProgress(10, 'Initializing scene components...');
startBtn.disabled = true;
startBtn.style.pointerEvents = 'none';

init360Controls();

// NPC loads in parallel with the road→building→traffic chain
const npcReady = loadNPC(scene).then(() => {
    updateProgress(Math.min(90, loadingProgress + 15), 'Guide NPC initialized...');
});

const worldReady = loadRoads(scene, renderer, map).then(async (roadCurves) => {
    setRoadCurves(roadCurves);
    updateProgress(45, 'Loading campus buildings...');
    
    const buildingBounds = await loadBuildings(scene, map);
    
    // Register loaded 3D buildings into CAMPUS_ZONES dynamically
    buildingBounds.forEach(b => {
        if (b.name) {
            CAMPUS_ZONES.push({
                name: b.name,
                minX: b.minX,
                maxX: b.maxX,
                minY: b.minY,
                maxY: b.maxY
            });
        }
    });

    updateProgress(75, 'Spawning campus traffic...');
    await initTraffic(scene);
    updateProgress(90, 'Optimizing shaders & graphics...');
});

// Wait for everything, pre-compile shaders, then unlock start
Promise.all([npcReady, worldReady]).then(() => {
    updateProgress(95, 'Pre-compiling shaders...');

    // Pre-compile every shader program in the scene (eliminates first-render stutter)
    renderer.compile(scene, camera);

    // Warm-up render: forces texture uploads to GPU behind the intro screen
    graphicsEngine.render();

    updateProgress(100, 'Ready!');
    console.log('✓ All assets loaded & shaders pre-compiled — ready to explore');

    // Smooth transition from Progress Bar to Start Button
    setTimeout(() => {
        if (loadingContainer) {
            loadingContainer.style.transition = 'opacity 0.4s ease';
            loadingContainer.style.opacity = '0';
            setTimeout(() => {
                loadingContainer.style.display = 'none';
                
                // Show and animate start button
                startBtn.style.display = 'inline-block';
                startBtn.style.opacity = '0';
                startBtn.style.transform = 'scale(0.9)';
                // Force reflow
                startBtn.offsetHeight;
                startBtn.style.transition = 'all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
                startBtn.style.opacity = '1';
                startBtn.style.transform = 'scale(1)';
                startBtn.disabled = false;
                startBtn.style.pointerEvents = 'auto';
            }, 400);
        } else {
            startBtn.style.display = 'inline-block';
            startBtn.disabled = false;
            startBtn.style.pointerEvents = 'auto';
        }
    }, 600);
}).catch(err => {
    console.error('World loading error:', err);
    // Still allow entry even if loading partially failed
    updateProgress(100, 'Ready (minor loading errors)');
    if (loadingContainer) loadingContainer.style.display = 'none';
    startBtn.style.display = 'inline-block';
    startBtn.disabled = false;
    startBtn.style.pointerEvents = 'auto';
});

// ═══════════════════════════════════════════
// 7. INTRO SCREEN
// ═══════════════════════════════════════════
startBtn.addEventListener('click', () => {
    if (startBtn.disabled) return; // guard: can't enter while loading
    document.getElementById('intro-screen').classList.add('hidden');
    setTimeout(() => document.body.requestPointerLock(), 400);
});

// ═══════════════════════════════════════════
// 5. INPUT CONTROLS (Z-Up: Space=ascend, Ctrl=descend)
// ═══════════════════════════════════════════
// Wayfinding waypoint proximity states
let isNearWaypoint = false;
let wasNearWaypoint = false;

const keys = { w: false, a: false, s: false, d: false, space: false, c: false };

let isNavigationMenuOpen = false;
const globalNavigationPanel = document.getElementById('global-navigation-panel');

function toggleGlobalNavigationMenu(forceState) {
    const show = forceState !== undefined ? forceState : !isNavigationMenuOpen;
    if (show) {
        // Reset movement keys defensively to prevent player drift
        keys.w = false;
        keys.a = false;
        keys.s = false;
        keys.d = false;
        keys.space = false;
        keys.c = false;

        // Close dialogue and settings overlay panels if open
        if (interactionState.isInteracting) {
            closeDialogue();
        }
        if (interactionState.is360Active) {
            toggle360Mode(false);
        }
        if (settings.isSettingsOpen) {
            settings.isSettingsOpen = false;
            const settingsEl = document.getElementById('settings-panel');
            if (settingsEl) settingsEl.style.display = 'none';
        }

        if (globalNavigationPanel) globalNavigationPanel.style.display = 'flex';
        const overlay = document.getElementById('modal-overlay');
        if (overlay) overlay.style.display = 'block';
        
        isNavigationMenuOpen = true;
        document.exitPointerLock();
    } else {
        if (globalNavigationPanel) globalNavigationPanel.style.display = 'none';
        const overlay = document.getElementById('modal-overlay');
        if (overlay) overlay.style.display = 'none';
        
        isNavigationMenuOpen = false;

        // Re-request pointer lock only if no other screen overlays are active
        if (!interactionState.isInteracting && !interactionState.is360Active && !settings.isSettingsOpen) {
            document.body.requestPointerLock();
        }
    }
}
window.toggleGlobalNavigationMenu = toggleGlobalNavigationMenu;

// Jump / gravity state (Z-Up: velocity and position on Z axis)
let velocityZ = 0;
let isGrounded = true;
const GRAVITY = 20;       // m/s² downward acceleration along -Z
const JUMP_FORCE = 7;     // m/s upward velocity on jump along +Z

// Camera pitch state (in radians, where 0 is looking horizontally)
let pitch = 0;

// Click canvas to lock pointer
renderer.domElement.addEventListener('click', () => {
    if (!interactionState.isInteracting && !interactionState.is360Active && !settings.isSettingsOpen && !isNavigationMenuOpen) {
        document.body.requestPointerLock();
    }
});

// Mouse look (Z-Up: yaw = rotation.z, pitch = camera.rotation.x)
document.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement === document.body) {
        player.rotation.z -= event.movementX * settings.mouseSensitivity;
        pitch -= event.movementY * settings.mouseSensitivity;
        // Clamp pitch to prevent flipping (approx. -85 to 85 degrees)
        pitch = Math.max(-Math.PI * 0.47, Math.min(Math.PI * 0.47, pitch));
        camera.rotation.x = Math.PI / 2 + pitch;
    }
});

// Keyboard
window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();

    // Toggle global navigation menu on 'N' key press
    if (k === 'n') {
        const intro = document.getElementById('intro-screen');
        if (intro && !intro.classList.contains('hidden')) {
            return;
        }
        toggleGlobalNavigationMenu();
        e.preventDefault();
        return;
    }

    // Dismiss navigation menu on Escape key press
    if (e.key === 'Escape' && isNavigationMenuOpen) {
        toggleGlobalNavigationMenu(false);
        e.preventDefault();
        return;
    }

    // Interaction override
    if (interactionState.isInteracting || interactionState.is360Active) {
        if (e.key === 'Escape') {
            if (interactionState.is360Active) toggle360Mode(false);
            else closeDialogue();
        }
        return;
    }

    // Close settings panel on Escape
    if (e.key === 'Escape' && settings.isSettingsOpen) {
        settings.isSettingsOpen = false;
        document.getElementById('settings-panel').style.display = 'none';
        return;
    }

    if (k === 'w') keys.w = true;
    if (k === 'a') keys.a = true;
    if (k === 's') keys.s = true;
    if (k === 'd') keys.d = true;
    if (k === 'f') {
        if (interactionState.isNear) {
            openDialogue();
        } else if (isNearWaypoint && activeWayfindingTarget) {
            openWaypointDialogue(activeWayfindingTarget.name);
        }
    }

    if (e.key === ' ') {
        if (settings.flyMode) {
            keys.space = true;
        } else if (isGrounded) {
            velocityZ = JUMP_FORCE;
            isGrounded = false;
        }
    }
    if (k === 'c') {
        keys.c = true;
    }
});

window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'w') keys.w = false;
    if (k === 'a') keys.a = false;
    if (k === 's') keys.s = false;
    if (k === 'd') keys.d = false;
    if (e.key === ' ') keys.space = false;
    if (k === 'c') keys.c = false;
});

// ═══════════════════════════════════════════
// 6. WINDOW RESIZE
// ═══════════════════════════════════════════
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    graphicsEngine.onWindowResize();
});

// ═══════════════════════════════════════════
// COLLISION DETECTION SYSTEM (Z-Up, Two-Tier Raycasting + BVH)
// ═══════════════════════════════════════════
/**
 * Two-tier collision system using actual building mesh geometry,
 * accelerated by three-mesh-bvh (Bounding Volume Hierarchy).
 *
 * BVH is applied in building-loader.js via monkey-patching:
 *   - THREE.BufferGeometry.prototype.computeBoundsTree  (builds the BVH)
 *   - THREE.Mesh.prototype.raycast = acceleratedRaycast (uses the BVH)
 * Every mesh pushed into collidableMeshes has its geometry.boundsTree
 * pre-computed at load time, so raycasts here are O(log n) instead of O(n).
 *
 * TIER 1 — FLOOR/STAIR SNAPPING (Downward Raycast)
 *   Casts a ray straight down (-Z) from well above the player.
 *   If a floor/stair surface is hit, the player's Z is snapped to it,
 *   allowing natural traversal of multi-storey buildings and staircases.
 *   Uses firstHitOnly = false because we need sorted hits to find the
 *   correct floor (the highest surface below the player).
 *
 * TIER 2 — WALL BLOCKING (Horizontal Raycasts)
 *   Casts short rays in the XY movement direction at three heights
 *   (ankle, waist, chest). If a wall mesh is hit within a threshold,
 *   movement in that direction is blocked (but the perpendicular axis
 *   remains free, enabling wall-sliding).
 *   Uses firstHitOnly = true for maximum speed — we only need the
 *   nearest wall hit, and BVH can short-circuit on the first intersection.
 */

// Wall raycaster: firstHitOnly = true for maximum BVH early-exit speed
const _collisionRay = new THREE.Raycaster();
_collisionRay.firstHitOnly = true;

// Floor raycaster: firstHitOnly = false because we need all hits sorted
// by distance to find the correct floor surface
const _floorRay = new THREE.Raycaster();
_floorRay.firstHitOnly = false;

// Tuning constants
const PLAYER_HEIGHT = 1.8;            // Eye height (must match POV_HEIGHT)
const WALL_BUFFER = 0.5;             // How close the player can get to a wall (metres)
const FLOOR_RAY_ORIGIN_OFFSET = 50;  // Start the downward ray this far above the player
const STEP_HEIGHT = 0.6;             // Max height the player can step up in one frame (stairs)
const GROUND_SNAP_THRESHOLD = 2.0;   // Max distance below player to still snap (prevents teleporting through floors)

// Wall-ray heights along Z (ankle, waist, chest)
const WALL_RAY_HEIGHTS = [0.3, 0.9, 1.5];

// Downward direction (constant)
const _downDir = new THREE.Vector3(0, 0, -1);

/**
 * TIER 1: Floor/stair snap — determine the ground height at (x, y).
 * Returns the Z coordinate of the nearest surface below the player,
 * or null if no surface is found (player is outdoors on flat grass).
 * @param {number} x
 * @param {number} y
 * @param {number} currentZ - Player's current Z for reference
 * @returns {number|null}
 */
function getFloorHeight(x, y, currentZ) {
    if (collidableMeshes.length === 0) return null;

    // Cast from well above the player straight down
    const origin = new THREE.Vector3(x, y, currentZ + FLOOR_RAY_ORIGIN_OFFSET);
    _floorRay.set(origin, _downDir);
    _floorRay.far = FLOOR_RAY_ORIGIN_OFFSET + GROUND_SNAP_THRESHOLD;
    _floorRay.near = 0;

    const hits = _floorRay.intersectObjects(collidableMeshes, false);
    if (hits.length > 0) {
        // Find the highest surface that is at or below the player + step tolerance
        // (so we always land on the topmost floor, not a floor below us)
        for (let i = 0; i < hits.length; i++) {
            const hitZ = hits[i].point.z;
            // Accept surfaces that are within step-height above, or up to snap-threshold below
            if (hitZ <= currentZ + STEP_HEIGHT) {
                return hitZ;
            }
        }
    }
    return null;
}

/**
 * TIER 2: Wall check — test if a horizontal movement direction is blocked.
 * Casts rays at ankle, waist, and chest heights in the movement direction.
 * @param {THREE.Vector3} direction - Normalized XY movement direction
 * @param {number} distance - Movement distance this frame
 * @returns {boolean} true if blocked
 */
function checkWallCollision(direction, distance) {
    if (collidableMeshes.length === 0) return false;

    const playerPos = player.position;
    const checkDist = distance + WALL_BUFFER;

    for (let i = 0; i < WALL_RAY_HEIGHTS.length; i++) {
        _collisionRay.set(
            new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z + WALL_RAY_HEIGHTS[i]),
            direction
        );
        _collisionRay.far = checkDist;
        _collisionRay.near = 0;

        const hits = _collisionRay.intersectObjects(collidableMeshes, false);
        if (hits.length > 0) {
            // Check the face normal to distinguish walls from floors/ceilings.
            // A surface whose normal has a large Z component is a floor or ceiling,
            // not a wall — don't block horizontal movement for those.
            const normal = hits[0].face ? hits[0].face.normal.clone() : null;
            if (normal) {
                // Transform normal from object-local to world space
                normal.transformDirection(hits[0].object.matrixWorld);
                // If the surface is mostly vertical (normal nearly horizontal),
                // it's a wall → block. Threshold: |normal.z| < 0.5
                if (Math.abs(normal.z) < 0.5) {
                    return true; // Wall — block movement
                }
                // Otherwise it's a floor/ceiling/ramp — don't block horizontal movement
            } else {
                // No face normal data available — conservatively treat as wall
                return true;
            }
        }
    }
    return false; // Clear
}

// Scratch vectors for movement calculation (avoid per-frame allocations)
const _moveDir = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();

// ═══════════════════════════════════════════
// TELEMETRY HUD
// ═══════════════════════════════════════════
const _hudLat = document.getElementById('hud-lat');
const _hudLng = document.getElementById('hud-lng');
const _hudZ = document.getElementById('hud-z');
const _hudZone = document.getElementById('hud-zone');
let _hudUpdateCounter = 0;

// ═══════════════════════════════════════════
// GEOFENCE TRIGGER VOLUMES
// ═══════════════════════════════════════════
/**
 * Campus zone bounding boxes on XY plane (Z-up: X=east/west, Y=north/south).
 * Boundaries will be populated dynamically from building bounds after load,
 * plus hardcoded zones for areas without 3D models.
 */
const CAMPUS_ZONES = [
    // C03 zone (hardcoded approximate GIS-derived bounds)
    { name: 'Dewan Kuliah (C03)',     minX: -80,  maxX: -20, minY: 40,  maxY: 120 }
];

// Track current zone for entry/exit detection
let _currentZone = null;
window._zoneNotifTimer = null;
const _zoneNotifEl = document.getElementById('zone-notification');

/**
 * Check which zone the player is standing in (XY plane only, ignores altitude).
 * @param {number} px - Player X position
 * @param {number} py - Player Y position
 * @returns {string|null} Zone name or null
 */
function getPlayerZone(px, py) {
    for (let i = 0; i < CAMPUS_ZONES.length; i++) {
        const z = CAMPUS_ZONES[i];
        if (px >= z.minX && px <= z.maxX && py >= z.minY && py <= z.maxY) {
            return z.name;
        }
    }
    return null;
}

/**
 * Show a floating zone notification with slide-up animation.
 */
function showZoneNotification(zoneName) {
    if (!_zoneNotifEl) return;
    _zoneNotifEl.innerHTML = `<span class="zone-icon">📍</span><span class="zone-name">${zoneName}</span>`;
    _zoneNotifEl.classList.add('visible');

    // Clear existing timer
    if (window._zoneNotifTimer) clearTimeout(window._zoneNotifTimer);
    window._zoneNotifTimer = setTimeout(() => {
        _zoneNotifEl.classList.remove('visible');
    }, 3000);
}

// ═══════════════════════════════════════════
// 8. WAYFINDING NAVIGATION HELPERS
// ═══════════════════════════════════════════

/**
 * Calculates and updates the real-time horizontal vector direction badge.
 * Z-Up Coordinate System:
 * - Flat ground plane is XY (X=East/West, Y=North/South)
 * - Altitude/height is Z
 * - Camera forward vector flat ground components are X and Y (Z flattened to 0)
 * - Target vector pointing from player to waypoint is calculated on XY plane (Z flattened to 0)
 * - Cross product yields a Z component, where:
 *   - cross.z < 0 indicates target is to the Right
 *   - cross.z > 0 indicates target is to the Left
 */
function updateHorizontalDirection(nextWaypointPos, camera, player, badgeEl) {
    const playerDirection = new THREE.Vector3();
    camera.getWorldDirection(playerDirection);
    playerDirection.z = 0; // Flatten to XY ground plane
    playerDirection.normalize();

    const targetVector = new THREE.Vector3().subVectors(nextWaypointPos, player.position);
    targetVector.z = 0; // Flatten to XY ground plane
    targetVector.normalize();

    const dot = playerDirection.dot(targetVector); // Cosine of horizontal angle difference
    const cross = playerDirection.clone().cross(targetVector); // Cross product (Z-up yields Z component)

    let text = "";
    let icon = "";
    let className = "";

    if (dot > 0.85) {
        text = "Straight";
        icon = "⬆️";
        className = "dir-straight";
    } else if (cross.z < 0) {
        text = "Turn Right";
        icon = "➡️";
        className = "dir-right";
    } else {
        text = "Turn Left";
        icon = "⬅️";
        className = "dir-left";
    }

    if (badgeEl) {
        badgeEl.className = `hud-badge direction-indicator-badge ${className}`;
        badgeEl.innerHTML = `<span class="dir-icon">${icon}</span> <span class="dir-text">${text}</span>`;
    }
}

/**
 * Updates the vertical level badge based on altitude difference.
 */
function updateVerticalLevel(nextWaypointPos, player, badgeEl) {
    if (!badgeEl) return;
    
    const heightDifference = nextWaypointPos.z - player.position.z;
    
    if (heightDifference > 0.5) {
        badgeEl.className = "hud-badge vertical-upstairs";
        badgeEl.innerHTML = "🔼 Upstairs";
    } else if (heightDifference < -0.5) {
        badgeEl.className = "hud-badge vertical-downstairs";
        badgeEl.innerHTML = "🔽 Downstairs";
    } else {
        badgeEl.className = "hud-badge vertical-levelground";
        badgeEl.innerHTML = "📍 Level Ground";
    }
}

// ═══════════════════════════════════════════
// 9. ANIMATION LOOP
// ═══════════════════════════════════════════
let lastTime = performance.now();

function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const delta = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    // Player movement (only when pointer locked and not in UI)
    if (document.pointerLockElement === document.body && !interactionState.isInteracting && !interactionState.is360Active) {
        const speed = settings.walkSpeed * delta;

        // Calculate world-space forward and right directions from player rotation
        // Z-Up: forward is (0, 1, 0) in local space (looking along +Y), rotated by player quaternion
        // Then flatten onto XY plane by zeroing Z
        _forward.set(0, 1, 0).applyQuaternion(player.quaternion);
        _forward.z = 0;
        _forward.normalize();

        _right.set(1, 0, 0).applyQuaternion(player.quaternion);
        _right.z = 0;
        _right.normalize();

        // TIER 2: Try forward/backward movement (wall-blocked)
        if (keys.w || keys.s) {
            _moveDir.copy(_forward).multiplyScalar(keys.w ? 1 : -1);
            if (!checkWallCollision(_moveDir, speed)) {
                player.position.addScaledVector(_moveDir, speed);
            }
        }

        // TIER 2: Try left/right movement (independent axis — enables wall sliding)
        if (keys.a || keys.d) {
            _moveDir.copy(_right).multiplyScalar(keys.d ? 1 : -1);
            if (!checkWallCollision(_moveDir, speed)) {
                player.position.addScaledVector(_moveDir, speed);
            }
        }

        // TIER 1 + Gravity: Floor snapping and vertical physics
        if (!settings.flyMode) {
            // Apply gravity
            velocityZ -= GRAVITY * delta;
            player.position.z += velocityZ * delta;

            // Downward raycast: find the floor/stair surface beneath the player
            const floorZ = getFloorHeight(player.position.x, player.position.y, player.position.z);

            if (floorZ !== null && player.position.z <= floorZ + 0.05) {
                // Smooth stair navigation via height lerping
                // targetZ is floorZ (player.position.z represents the feet height)
                const lerpFactor = Math.min(1.0, 0.15 * delta * 60);
                player.position.z += (floorZ - player.position.z) * lerpFactor;
                velocityZ = 0;
                isGrounded = true;
            } else if (player.position.z <= 0) {
                // No building surface found — fall to grass ground plane
                player.position.z = 0;
                velocityZ = 0;
                isGrounded = true;
            }
        } else {
            // Fly mode vertical movement: Space to ascend (+Z), Ctrl to descend (-Z)
            const flySpeed = settings.walkSpeed * delta;
            if (keys.space) {
                player.position.z += flySpeed;
            }
            if (keys.c) {
                player.position.z -= flySpeed;
                if (player.position.z < 0) {
                    player.position.z = 0;
                }
            }
        }
        updateMinimap(player);
    }

    // ── Telemetry HUD (update every 3 frames for performance) ──
    _hudUpdateCounter++;
    if (_hudUpdateCounter >= 3) {
        _hudUpdateCounter = 0;
        // Geographic coordinate conversion from meters to WGS 84 Lat/Lng
        const lat = 1.560044 + (player.position.y / 111320);
        const lng = 103.635711 + (player.position.x / 111280);
        if (_hudLat) _hudLat.textContent = lat.toFixed(6);
        if (_hudLng) _hudLng.textContent = lng.toFixed(6);
        if (_hudZ) _hudZ.textContent = player.position.z.toFixed(2);

        // ── Geofence zone check ──
        const zoneName = getPlayerZone(player.position.x, player.position.y);
        if (zoneName !== _currentZone) {
            _currentZone = zoneName;
            if (_hudZone) _hudZone.textContent = zoneName || '—';
            if (zoneName) {
                showZoneNotification(zoneName);
            }
        }
    }

    // Update systems
    updateTraffic(delta);
    updateNPC(player, delta);

    // Update 3D wayfinding waypoint pin
    if (activeWayfindingTarget) {
        waypointPin.visible = true;

        // Position directly at active target (z + 1.5) with a subtle bobbing motion
        const bobbing = Math.sin(now * 0.005) * 0.15;
        waypointPin.position.set(
            activeWayfindingTarget.x,
            activeWayfindingTarget.y,
            activeWayfindingTarget.z + 1.5 + bobbing
        );
        // Spin the pin for premium animation
        waypointPin.rotation.z = now * 0.002;
        const dx = player.position.x - activeWayfindingTarget.x;
        const dy = player.position.y - activeWayfindingTarget.y;
        const horizontalDistance = Math.sqrt(dx * dx + dy * dy);
        const heightDifference = Math.abs(player.position.z - activeWayfindingTarget.z);

        // Arrival Interaction Trigger (within 3.0 meters horizontally, +- 1.5 meters vertically)
        if (horizontalDistance <= 3.0 && heightDifference <= 1.5) {
            isNearWaypoint = true;
            wasNearWaypoint = true;

            const prompt = document.getElementById('interaction-prompt');
            if (prompt && !interactionState.isInteracting && !interactionState.is360Active) {
                prompt.innerHTML = 'Press <span style="color: #00e5ff; background: rgba(0,229,255,0.1); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(0,229,255,0.3);">F</span> to Inspect';
                prompt.style.display = 'block';
            }
        } else {
            isNearWaypoint = false;
            // Restore NPC prompt if near NPC, otherwise hide prompt
            const prompt = document.getElementById('interaction-prompt');
            if (prompt) {
                if (interactionState.isNear) {
                    prompt.innerHTML = 'Press <span style="color: #00e5ff; background: rgba(0,229,255,0.1); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(0,229,255,0.3);">F</span> to Talk';
                } else {
                    prompt.style.display = 'none';
                }
            }
            // If the player walks away after arriving, clear wayfinding
            if (wasNearWaypoint) {
                clearWayfinding();
            }
        }

        // Wayfinding HUD Banner & Badges Update
        if (wayfindingHud) {
            wayfindingHud.style.display = 'block';

            // Only rebuild the basic HTML container structure if the active destination has changed
            // This avoids heavy DOM parsing on every frame
            if (wayfindingHud.dataset.destination !== activeWayfindingTarget.name) {
                wayfindingHud.dataset.destination = activeWayfindingTarget.name;
                wayfindingHud.innerHTML = `
                    <div class="hud-wayfinding-main">
                        <div class="hud-wayfinding-info">
                            <span class="hud-wayfinding-label">Active Destination</span>
                            <span class="hud-wayfinding-name">${activeWayfindingTarget.name}</span>
                        </div>
                        <div class="hud-wayfinding-badges">
                            <span id="vertical-level-badge" class="hud-badge"></span>
                            <span id="direction-indicator-badge" class="hud-badge"></span>
                        </div>
                    </div>
                `;
            }

            const nextWaypointPos = new THREE.Vector3(activeWayfindingTarget.x, activeWayfindingTarget.y, activeWayfindingTarget.z);
            const verticalBadge = document.getElementById('vertical-level-badge');
            const directionBadge = document.getElementById('direction-indicator-badge');

            updateVerticalLevel(nextWaypointPos, player, verticalBadge);
            updateHorizontalDirection(nextWaypointPos, camera, player, directionBadge);
        }
    } else {
        waypointPin.visible = false;
        isNearWaypoint = false;
        wasNearWaypoint = false;
        if (wayfindingHud) {
            wayfindingHud.style.display = 'none';
            delete wayfindingHud.dataset.destination;
        }
        // Restore NPC prompt if near NPC, otherwise hide
        const prompt = document.getElementById('interaction-prompt');
        if (prompt) {
            if (interactionState.isNear) {
                prompt.innerHTML = 'Press <span style="color: #00e5ff; background: rgba(0,229,255,0.1); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(0,229,255,0.3);">F</span> to Talk';
                prompt.style.display = 'block';
            } else {
                prompt.style.display = 'none';
            }
        }
    }

    // Render
    graphicsEngine.render();
}

animate();

// ═══════════════════════════════════════════
// GLOBAL NAVIGATION PANEL CONTROL WIRING
// ═══════════════════════════════════════════
const closeNavBtn = document.getElementById('close-navigation');
if (closeNavBtn) {
    closeNavBtn.addEventListener('click', () => {
        toggleGlobalNavigationMenu(false);
    });
}

document.querySelectorAll('.nav-item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const dest = btn.getAttribute('data-destination');
        if (dest && window.startNavigation) {
            window.startNavigation(dest);
            toggleGlobalNavigationMenu(false);
        }
    });
});
