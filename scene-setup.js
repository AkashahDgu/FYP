/**
 * Scene Setup — Renderer, camera, player, floor, trees
 */
import * as THREE from 'three';
import { GraphicsEngine } from './graphics-engine.js';
import { ORIGIN_LAT, ORIGIN_LNG } from './minimap.js';

// Z-Up: Override the global default up vector for the entire scene graph
THREE.Object3D.DEFAULT_UP = new THREE.Vector3(0, 0, 1);

// Player eye height
const POV_HEIGHT = 1.8;

/**
 * Create the Three.js scene, renderer, camera, player, and environment.
 * @returns {{ scene, renderer, camera, player, graphicsEngine }}
 */
export function createScene() {
    const scene = new THREE.Scene();

    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
        logarithmicDepthBuffer: true
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(
        75, window.innerWidth / window.innerHeight, 0.1, 1000
    );

    // Graphics engine (HDRI, golden hour, post-processing)
    const graphicsEngine = new GraphicsEngine(scene, camera, renderer);

    // NOTE: Ambient light is handled by graphics-engine.js (AmbientLight + HemisphereLight)
    // Removed duplicate ambient light that was washing out the scene

    // Grass floor
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(2000, 2000),
        new THREE.MeshStandardMaterial({ color: 0x426829, roughness: 1.0 })
    );
    // Z-up: PlaneGeometry lies on XY by default — no rotation needed
    floor.receiveShadow = true;
    scene.add(floor);

    // Player (first-person controller)
    const player = new THREE.Object3D();
    player.position.set(
        (103.635726 - ORIGIN_LNG) * 111280,
        (1.559998 - ORIGIN_LAT) * 111320,
        0.00
    );
    scene.add(player);
    camera.position.set(0, 0, POV_HEIGHT);
    camera.rotation.set(Math.PI / 2, 0, 0); // Z-Up: Horizontal orientation base
    player.add(camera);

    return { scene, renderer, camera, player, graphicsEngine };
}

/**
 * Generate instanced trees that avoid roads and buildings.
 * @param {THREE.Scene} scene
 * @param {THREE.CatmullRomCurve3[]} roadCurves
 * @param {Array<{minX,maxX,minY,maxY}>} buildingBounds
 */
export function generateTrees(scene, roadCurves, buildingBounds = []) {
    const TREE_COUNT = 500;
    const MIN_DIST = 9.0;
    const BUILDING_BUFFER = 15.0;
    const MAX_ATTEMPTS = TREE_COUNT * 5;

    const trunkGeo = new THREE.CylinderGeometry(0.4, 0.8, 4, 5);
    const leavesGeo = new THREE.DodecahedronGeometry(3, 1);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 1.0 });
    const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2d4c1e, roughness: 0.9 });

    const instancedTrunks = new THREE.InstancedMesh(trunkGeo, trunkMat, TREE_COUNT);
    const instancedLeaves = new THREE.InstancedMesh(leavesGeo, leavesMat, TREE_COUNT);
    const dummyTrunk = new THREE.Object3D();
    const dummyLeaves = new THREE.Object3D();

    // Pre-sample road curves for fast distance checks
    const sampledCurves = roadCurves.map(c =>
        c.getSpacedPoints(Math.max(10, Math.ceil(c.getLength() / 5)))
    );

    const isTooCloseToBuilding = (x, y) => {
        return buildingBounds.some(b =>
            x >= (b.minX - BUILDING_BUFFER) && x <= (b.maxX + BUILDING_BUFFER) &&
            y >= (b.minY - BUILDING_BUFFER) && y <= (b.maxY + BUILDING_BUFFER)
        );
    };

    const _treePt = new THREE.Vector3(); // scratch vector reused across attempts
    let placed = 0, attempts = 0;
    while (placed < TREE_COUNT && attempts < MAX_ATTEMPTS) {
        attempts++;
        const x = (Math.random() - 0.5) * 1800;
        const y = (Math.random() - 0.5) * 1800;

        if (isTooCloseToBuilding(x, y)) continue;

        _treePt.set(x, y, 0);
        let tooClose = false;
        for (const cPts of sampledCurves) {
            for (const pLoc of cPts) {
                if (pLoc.distanceTo(_treePt) < MIN_DIST) { tooClose = true; break; }
            }
            if (tooClose) break;
        }
        if (tooClose) continue;

        const scale = 0.8 + Math.random() * 0.8;

        dummyTrunk.position.set(x, y, 2 * scale);
        dummyTrunk.rotation.y = Math.random() * Math.PI;
        dummyTrunk.scale.set(scale, scale, scale);
        dummyTrunk.updateMatrix();
        instancedTrunks.setMatrixAt(placed, dummyTrunk.matrix);

        dummyLeaves.position.set(x, y, (4 + 1.5) * scale);
        dummyLeaves.rotation.y = Math.random() * Math.PI;
        dummyLeaves.rotation.x = Math.random() * Math.PI * 0.2;
        dummyLeaves.scale.set(scale, scale, scale);
        dummyLeaves.updateMatrix();
        instancedLeaves.setMatrixAt(placed, dummyLeaves.matrix);

        placed++;
    }

    instancedTrunks.count = placed;
    instancedLeaves.count = placed;
    instancedTrunks.instanceMatrix.needsUpdate = true;
    instancedLeaves.instanceMatrix.needsUpdate = true;
    instancedTrunks.castShadow = true;
    instancedLeaves.castShadow = true;
    scene.add(instancedTrunks);
    scene.add(instancedLeaves);
}
