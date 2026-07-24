/**
 * Traffic — Car model preloading, spawning, and animation
 */
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

const carModels = {};
const cars = [];
let carCounter = 0;
let safeCurvesForCars = [];
let _roadCurves = null; // explicit reference; falls back to window.globalRoadCurves

// Reusable scratch vectors — hoisted to avoid per-car per-frame allocations
const _trafficUp = new THREE.Vector3(0, 0, 1);
const _trafficRight = new THREE.Vector3();
const _lookRight = new THREE.Vector3();
const _lookTangent = new THREE.Vector3();
const _lookAtPos = new THREE.Vector3();

/**
 * Preload car OBJ models, then spawn traffic.
 * @param {THREE.Scene} scene
 */
export async function initTraffic(scene) {
    const models = [
        { id: 1, path: 'Data UTM/Vehicles/Car 1' },
        { id: 2, path: 'Data UTM/Vehicles/Car 2' },
        { id: 3, path: 'Data UTM/Vehicles/Car 3' }
    ];

    await Promise.all(models.map(m => loadCarModel(scene, m)));
    updateSafeCurves();
    spawnCars(scene, 25);
    
    // Spawn extra traffic specifically on Jalan Insaf
    spawnJalanInsafTraffic(scene, 12);

    console.log(`Traffic initialized: ${cars.length} cars`);
}

/**
 * Explicitly set the road curves array (preferred over window.globalRoadCurves).
 * @param {THREE.CatmullRomCurve3[]} curves
 */
export function setRoadCurves(curves) {
    _roadCurves = curves;
}

/**
 * Update all cars. Call from the animation loop.
 */
export function updateTraffic(deltaSeconds) {
    const roadCurves = _roadCurves || window.globalRoadCurves;
    if (!roadCurves || roadCurves.length === 0) return;

    const carLength = 4.4, safetyGap = 2.0;
    const totalGap = carLength + safetyGap;

    // Group cars by curve for collision checks
    const carsByCurve = {};
    roadCurves.forEach((_, idx) => { carsByCurve[idx] = []; });
    cars.forEach(car => {
        if (car.curveIndex === -1) car.curveIndex = car.assignedCurve;
        if (carsByCurve[car.curveIndex]) carsByCurve[car.curveIndex].push(car);
    });

    cars.forEach(car => {
        const curve = roadCurves[car.curveIndex];
        if (!curve) return;

        const carsOnCurve = carsByCurve[car.curveIndex] || [];
        let adjustedSpeed = car.speed;
        const curveLength = curve.getLength();
        const minProgressGap = totalGap / curveLength;
        let shouldChangeLane = false;

        // Collision avoidance
        carsOnCurve.forEach(other => {
            if (other === car || other.laneOffset !== car.laneOffset) return;
            let distance = other.progress - car.progress;
            if (distance < 0) distance += 1;
            if (distance < minProgressGap) {
                const brakeFactor = Math.max(0, (distance - minProgressGap * 0.3) / (minProgressGap * 0.7));
                adjustedSpeed *= Math.max(0.1, brakeFactor);
                shouldChangeLane = true;
            }
        });

        if (shouldChangeLane && Math.random() > 0.7) {
            car.laneOffset = car.laneOffset === 3.5 ? -1.5 : 3.5;
        }

        // Advance position
        car.progress += adjustedSpeed * deltaSeconds * 2;
        if (car.progress > 1) car.progress -= 1;
        else if (car.progress < 0) car.progress += 1;

        const pos = curve.getPointAt(car.progress);
        const tangent = curve.getTangentAt(car.progress).normalize();
        _trafficRight.crossVectors(tangent, _trafficUp).normalize();

        const currentOffset = (curve.name && curve.name.toLowerCase().includes('insaf')) ? 0 : car.laneOffset;
        car.mesh.position.copy(pos).addScaledVector(_trafficRight, currentOffset);
        car.mesh.position.z += 0.05 + Math.sin(Date.now() * 0.005 + car.bounceOffset) * 0.02;

        // Orientation
        const lookOffset = car.speed > 0 ? 0.01 : -0.01;
        let targetProg = car.progress + lookOffset;
        if (targetProg > 1) targetProg %= 1;
        if (targetProg < 0) targetProg = 1 + targetProg;

        _lookAtPos.copy(curve.getPointAt(targetProg));
        _lookTangent.copy(curve.getTangentAt(targetProg)).normalize();
        _lookRight.crossVectors(_lookTangent, _trafficUp).normalize();
        _lookAtPos.addScaledVector(_lookRight, currentOffset);
        _lookAtPos.z = car.mesh.position.z;
        car.mesh.lookAt(_lookAtPos);

        // Wheel spin
        if (car.speed > 0) {
            car.wheelRotation += car.speed * deltaSeconds * 20;
            car.mesh.traverse(child => {
                if (child.isMesh && (child.name.toLowerCase().includes('wheel') || child.name.toLowerCase().includes('tire'))) {
                    child.rotation.x = car.wheelRotation;
                }
            });
        }
    });
}

// ── Internal helpers ──

function loadCarModel(scene, m) {
    return new Promise(resolve => {
        const mtlLoader = new MTLLoader();
        mtlLoader.load(m.path + '.mtl', (materials) => {
            materials.preload();
            const objLoader = new OBJLoader();
            objLoader.setMaterials(materials);
            objLoader.load(m.path + '.obj', (object) => {
                processModel(object, m);
                resolve();
            });
        }, undefined, () => {
            createFallback(m);
            resolve();
        });
    });
}

function processModel(object, m) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const sf = 5.4 / Math.max(size.x, size.y, size.z);
    object.scale.set(sf, sf, sf);

    box.setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    object.position.x -= center.x;
    object.position.z -= center.z;
    object.position.z -= box.min.z;

    object.traverse(child => {
        if (child.isMesh) {
            const name = child.name.toLowerCase();
            if (name.includes('wheel') || name.includes('tire')) {
                child.geometry.computeBoundingBox();
                const wc = new THREE.Vector3();
                child.geometry.boundingBox.getCenter(wc);
                child.geometry.center();
                child.position.add(wc);
            }
            child.castShadow = true;
            child.receiveShadow = true;
            if (!child.material || child.material.wireframe) {
                const color = m.id === 1 ? 0x1a1a2e : m.id === 2 ? 0xff4444 : 0xcc0000;
                child.material = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.3 });
            }
        }
    });

    object.rotation.z = 0;
    const parent = new THREE.Group();
    parent.add(object);
    carModels[m.id] = parent;
}

function createFallback(m) {
    const group = new THREE.Group();
    const color = m.id === 1 ? 0x1a1a2e : m.id === 2 ? 0xff4444 : 0xcc0000;
    const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.8, 1.2, 4.5),
        new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.4 })
    );
    body.position.z = 0.6;
    body.castShadow = true;
    group.add(body);
    carModels[m.id] = group;
}

function updateSafeCurves() {
    safeCurvesForCars = [];
    if (!window.globalRoadCurves || window.globalRoadCurves.length === 0) return;

    const spawn = new THREE.Vector3(0, 0, 0);
    window.globalRoadCurves.forEach((curve, idx) => {
        for (let i = 0; i <= 20; i++) {
            if (curve.getPointAt(i / 20).distanceTo(spawn) > 60) {
                safeCurvesForCars.push(idx);
                break;
            }
        }
    });
}

function spawnCars(scene, count) {
    if (safeCurvesForCars.length === 0) return;

    for (let i = 0; i < count; i++) {
        const modelId = Math.random() < 0.33 ? 1 : Math.random() < 0.5 ? 2 : 3;
        const base = carModels[modelId] || carModels[1];
        if (!base) continue;

        const mesh = base.clone();
        scene.add(mesh);

        const curveIdx = safeCurvesForCars[carCounter % safeCurvesForCars.length];
        const progress = Math.random();
        carCounter++;

        cars.push({
            mesh,
            curveIndex: -1,
            assignedCurve: curveIdx,
            progress,
            lastProgress: progress,
            laneOffset: Math.random() > 0.5 ? 3.5 : -1.5,
            speed: 0.0025 + Math.random() * 0.005,
            bounceOffset: Math.random() * 100,
            wheelRotation: 0
        });
    }
}

function spawnJalanInsafTraffic(scene, count) {
    const roadCurves = _roadCurves || window.globalRoadCurves;
    if (!roadCurves || roadCurves.length === 0) return;

    // Find indices of curves named "Jalan Insaf"
    const insafCurveIndices = [];
    roadCurves.forEach((curve, idx) => {
        if (curve.name && curve.name.toLowerCase().includes('insaf')) {
            insafCurveIndices.push(idx);
        }
    });

    if (insafCurveIndices.length === 0) {
        console.warn("No curves found for Jalan Insaf, cannot spawn extra traffic there.");
        return;
    }

    console.log(`Spawning ${count} extra cars on Jalan Insaf (Curves: ${insafCurveIndices.join(', ')})`);

    for (let i = 0; i < count; i++) {
        const modelId = Math.random() < 0.33 ? 1 : Math.random() < 0.5 ? 2 : 3;
        const base = carModels[modelId] || carModels[1];
        if (!base) continue;

        const mesh = base.clone();
        scene.add(mesh);

        // Select a curve index from the Jalan Insaf curves
        const curveIdx = insafCurveIndices[i % insafCurveIndices.length];
        const progress = Math.random();

        cars.push({
            mesh,
            curveIndex: -1,
            assignedCurve: curveIdx,
            progress,
            lastProgress: progress,
            laneOffset: 0, // Centered on Jalan Insaf narrow road
            speed: 0.0025 + Math.random() * 0.005,
            bounceOffset: Math.random() * 100,
            wheelRotation: 0
        });
    }
}
