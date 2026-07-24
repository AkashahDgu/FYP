/**
 * Road Loader — Fetch, stitch, and render road geometry from GeoJSON
 */
import * as THREE from 'three';
import { ORIGIN_LAT, ORIGIN_LNG } from './minimap.js';

// Shared coordinate-comparison helper (used by loadRoads + stitchWays)
const coordsMatch = (a, b) => Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7;

/**
 * Load and render all roads into the scene.
 * @param {THREE.Scene} scene
 * @param {THREE.WebGLRenderer} renderer
 * @param {L.Map} map - Leaflet map instance
 * @returns {Promise<THREE.CatmullRomCurve3[]>} Array of road center-line curves
 */
export async function loadRoads(scene, renderer, map) {
    const textureLoader = new THREE.TextureLoader();

    // --- Textures ---
    const asphaltTex = textureLoader.load('Data UTM/Road/3D road/Blacktop_Old_01.jpg');
    asphaltTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    asphaltTex.generateMipmaps = true;
    asphaltTex.minFilter = THREE.LinearMipmapLinearFilter;
    asphaltTex.magFilter = THREE.LinearFilter;
    asphaltTex.wrapS = asphaltTex.wrapT = THREE.RepeatWrapping;

    const curbTex = textureLoader.load('Data UTM/Road/3D road/_Concrete_Aggregate_Smoke_1.jpg');
    curbTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    curbTex.generateMipmaps = true;
    curbTex.minFilter = THREE.LinearMipmapLinearFilter;
    curbTex.magFilter = THREE.LinearFilter;
    curbTex.wrapS = curbTex.wrapT = THREE.RepeatWrapping;

    // --- Materials ---
    const asphaltMat = new THREE.MeshStandardMaterial({
        map: asphaltTex, color: 0x333333, roughness: 0.9, metalness: 0.1, side: THREE.DoubleSide
    });
    const laneMat = new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2.0, polygonOffsetUnits: -4.0
    });
    const curbMat = new THREE.MeshStandardMaterial({
        map: curbTex, roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide
    });

    // --- Fetch road data ---
    const roadFiles = ['Data UTM/extra_roads.json'];
    const results = await Promise.all(roadFiles.map(f => fetch(f).then(r => r.json())));

    // --- Collect renderable ways ---
    const allWays = [];
    results.forEach(data => {
        data.elements.forEach(el => {
            if (el.type === 'way' && el.geometry) {
                const isCycleway = el.tags && el.tags.highway && el.tags.highway.includes('cycle');
                const isMainRoad = el.tags && ['tertiary', 'secondary', 'residential'].includes(el.tags.highway);
                if (isMainRoad && !isCycleway) {
                    allWays.push(el);
                    const latlngs = el.geometry.map(p => [p.lat, p.lon]);
                    L.polyline(latlngs, { color: '#fbbf24', weight: 4, opacity: 0.8 }).addTo(map);
                }
            }
        });
    });

    // --- Stitch ways into continuous paths ---
    const { paths, pathNodes, pathNames } = stitchWays(allWays);

    // --- Build road geometry ---
    const roadCurves = [];

    paths.forEach((geomPoints, pIdx) => {
        const points = geomPoints.map(p => {
            const y = (p.lat - ORIGIN_LAT) * 111320;
            const x = (p.lon - ORIGIN_LNG) * 111280;
            return new THREE.Vector3(x, y, 0);
        });

        if (points.length < 2) return;

        try {
            const sNode = pathNodes[pIdx][0];
            const eNode = pathNodes[pIdx][pathNodes[pIdx].length - 1];
            const isLoop = (sNode === eNode) || coordsMatch(geomPoints[0], geomPoints[geomPoints.length - 1]);
            if (isLoop && points.length > 2) points.pop();

            const curve = new THREE.CatmullRomCurve3(points, isLoop, 'catmullrom', 0.1);
            const roadName = pathNames[pIdx];
            curve.name = roadName;
            roadCurves.push(curve);

            buildRoadMesh(scene, curve, asphaltMat, curbMat, roadName);
            buildLaneMarkings(scene, curve, laneMat, roadName);
        } catch (e) {
            console.warn('Could not draw road segment:', e);
        }
    });

    window.globalRoadCurves = roadCurves;
    return roadCurves;
}

// ── Stitch ways that share endpoints ──
function stitchWays(allWays) {
    const paths = [], pathNodes = [], pathNames = [];
    const usedWays = new Set();

    allWays.forEach(startWay => {
        if (usedWays.has(startWay.id)) return;
        let curPts = [...startWay.geometry];
        let curNodes = startWay.nodes ? [...startWay.nodes] : startWay.geometry.map((_, i) => `${startWay.id}_${i}`);
        usedWays.add(startWay.id);

        let added = true;
        while (added) {
            added = false;
            for (const way of allWays) {
                if (usedWays.has(way.id)) continue;
                const wayNodes = way.nodes || way.geometry.map((_, i) => `${way.id}_${i}`);
                const fN = wayNodes[0], lN = wayNodes[wayNodes.length - 1];
                const sN = curNodes[0], eN = curNodes[curNodes.length - 1];
                const fC = way.geometry[0], lC = way.geometry[way.geometry.length - 1];
                const sC = curPts[0], eC = curPts[curPts.length - 1];

                if (eN === fN || coordsMatch(eC, fC)) {
                    curPts.push(...way.geometry.slice(1));
                    curNodes.push(...wayNodes.slice(1));
                } else if (sN === lN || coordsMatch(sC, lC)) {
                    curPts.unshift(...way.geometry.slice(0, -1));
                    curNodes.unshift(...wayNodes.slice(0, -1));
                } else if (eN === lN || coordsMatch(eC, lC)) {
                    curPts.push(...[...way.geometry].reverse().slice(1));
                    curNodes.push(...[...wayNodes].reverse().slice(1));
                } else if (sN === fN || coordsMatch(sC, fC)) {
                    curPts.unshift(...[...way.geometry].reverse().slice(0, -1));
                    curNodes.unshift(...[...wayNodes].reverse().slice(0, -1));
                } else continue;

                usedWays.add(way.id);
                added = true;
                break;
            }
        }
        paths.push(curPts);
        pathNodes.push(curNodes);
        pathNames.push(startWay.tags && startWay.tags.name ? startWay.tags.name : "");
    });

    return { paths, pathNodes, pathNames };
}

// ── Build road surface + curb geometry ──
// Reusable scratch vectors hoisted outside the loop to avoid per-step GC pressure
const _roadTangent = new THREE.Vector3();
const _roadRight = new THREE.Vector3();
const _pLi = new THREE.Vector3();
const _pRi = new THREE.Vector3();
const _pLo = new THREE.Vector3();
const _pRo = new THREE.Vector3();

function buildRoadMesh(scene, curve, asphaltMat, curbMat, name) {
    const isJalanInsaf = name && name.toLowerCase().includes('insaf');
    const roadWidth = isJalanInsaf ? 1.8 : 5.0;
    const curbWidth = 0.5, zOffset = 0.05;
    const length = curve.getLength();
    const steps = Math.max(80, Math.ceil(length * 3));

    const roadPts = [], roadUVs = [], roadIdx = [];
    const curbPts = [], curbUVs = [], curbIdx = [];

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const pos = curve.getPointAt(t);
        _roadTangent.copy(curve.getTangentAt(t)).normalize();
        _roadRight.crossVectors(_roadTangent, THREE.Object3D.DEFAULT_UP).normalize();

        _pLi.copy(pos).addScaledVector(_roadRight, -roadWidth);
        _pRi.copy(pos).addScaledVector(_roadRight, roadWidth);
        _pLo.copy(pos).addScaledVector(_roadRight, -roadWidth - curbWidth);
        _pRo.copy(pos).addScaledVector(_roadRight, roadWidth + curbWidth);

        // Road vertices
        roadPts.push(_pLi.x, _pLi.y, pos.z + zOffset);
        roadPts.push(_pRi.x, _pRi.y, pos.z + zOffset);
        roadUVs.push(0, (length * t) / 4);
        roadUVs.push(1, (length * t) / 4);

        // Curb vertices
        curbPts.push(_pLo.x, _pLo.y, pos.z + zOffset + 0.01);
        curbPts.push(_pLi.x, _pLi.y, pos.z + zOffset + 0.01);
        curbPts.push(_pRi.x, _pRi.y, pos.z + zOffset + 0.01);
        curbPts.push(_pRo.x, _pRo.y, pos.z + zOffset + 0.01);
        curbUVs.push(0, (length * t) / 2, 1, (length * t) / 2);
        curbUVs.push(0, (length * t) / 2, 1, (length * t) / 2);

        if (i < steps) {
            const b = i * 2;
            roadIdx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
            const cb = i * 4;
            curbIdx.push(cb, cb + 4, cb + 1, cb + 1, cb + 4, cb + 5);
            curbIdx.push(cb + 2, cb + 6, cb + 3, cb + 3, cb + 6, cb + 7);
        }
    }

    const roadGeom = new THREE.BufferGeometry();
    roadGeom.setAttribute('position', new THREE.Float32BufferAttribute(roadPts, 3));
    roadGeom.setAttribute('uv', new THREE.Float32BufferAttribute(roadUVs, 2));
    roadGeom.setIndex(roadIdx);
    roadGeom.computeVertexNormals();
    const roadMesh = new THREE.Mesh(roadGeom, asphaltMat);
    roadMesh.receiveShadow = true;
    scene.add(roadMesh);

    const curbGeom = new THREE.BufferGeometry();
    curbGeom.setAttribute('position', new THREE.Float32BufferAttribute(curbPts, 3));
    curbGeom.setAttribute('uv', new THREE.Float32BufferAttribute(curbUVs, 2));
    curbGeom.setIndex(curbIdx);
    curbGeom.computeVertexNormals();
    const curbMesh = new THREE.Mesh(curbGeom, curbMat);
    curbMesh.receiveShadow = true;
    scene.add(curbMesh);
}

// ── Lane markings for a proper 2-lane road ──
// Reusable scratch vectors for lane marking generation
const _laneTangent = new THREE.Vector3();
const _laneRight = new THREE.Vector3();
const _lanePL = new THREE.Vector3();
const _lanePR = new THREE.Vector3();
const _edgePL = new THREE.Vector3();
const _edgePR = new THREE.Vector3();

function buildLaneMarkings(scene, curve, laneMat, name) {
    const isJalanInsaf = name && name.toLowerCase().includes('insaf');
    const roadHalfWidth = isJalanInsaf ? 1.8 : 5.0;
    const length = curve.getLength(), zOffset = 0.05;
    const lineWidth = 0.20, dashLength = 2.0, gapLength = 2.0;
    const totalDashStep = dashLength + gapLength;
    const lineSteps = Math.max(100, Math.ceil(length * 5));

    // --- Dashed yellow center divider ---
    const centerMat = new THREE.MeshStandardMaterial({
        color: 0xf5c518, roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2.0, polygonOffsetUnits: -4.0
    });
    const cPts = [], cIdx = [];

    // Only construct center divider if it is a 2-lane road (not Jalan Insaf)
    if (!isJalanInsaf) {

    for (let i = 0; i <= lineSteps; i++) {
        const t = i / lineSteps;
        const dist = length * t;

        if ((dist % totalDashStep) < dashLength) {
            const pos = curve.getPointAt(t);
            _laneTangent.copy(curve.getTangentAt(t)).normalize();
            _laneRight.crossVectors(_laneTangent, THREE.Object3D.DEFAULT_UP).normalize();
            _lanePL.copy(pos).addScaledVector(_laneRight, -lineWidth / 2);
            _lanePR.copy(pos).addScaledVector(_laneRight, lineWidth / 2);
            const z = pos.z + zOffset + 0.02;

            cPts.push(_lanePL.x, _lanePL.y, z);
            cPts.push(_lanePR.x, _lanePR.y, z);

            if (i < lineSteps) {
                const nextDist = length * ((i + 1) / lineSteps);
                if ((nextDist % totalDashStep) < dashLength) {
                    const b = cPts.length / 3 - 2;
                    cIdx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
                }
            }
        }
    }

    if (cPts.length > 0) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(cPts, 3));
        geom.setIndex(cIdx);
        geom.computeVertexNormals();
        scene.add(new THREE.Mesh(geom, centerMat));
    }
    }

    // --- Solid white edge lines (left and right) ---
    const edgeLineWidth = 0.15;
    const edgeInset = 0.3; // inset from curb edge
    const edgeSteps = Math.max(80, Math.ceil(length * 3));

    for (const side of [-1, 1]) {
        const ePts = [], eIdx = [];
        const edgeOffset = side * (roadHalfWidth - edgeInset);

        for (let i = 0; i <= edgeSteps; i++) {
            const t = i / edgeSteps;
            const pos = curve.getPointAt(t);
            _laneTangent.copy(curve.getTangentAt(t)).normalize();
            _laneRight.crossVectors(_laneTangent, THREE.Object3D.DEFAULT_UP).normalize();

            _edgePL.copy(pos).addScaledVector(_laneRight, edgeOffset - edgeLineWidth / 2);
            _edgePR.copy(pos).addScaledVector(_laneRight, edgeOffset + edgeLineWidth / 2);
            const z = pos.z + zOffset + 0.02;

            ePts.push(_edgePL.x, _edgePL.y, z);
            ePts.push(_edgePR.x, _edgePR.y, z);

            if (i < edgeSteps) {
                const b = i * 2;
                eIdx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
            }
        }

        if (ePts.length > 0) {
            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.Float32BufferAttribute(ePts, 3));
            geom.setIndex(eIdx);
            geom.computeVertexNormals();
            scene.add(new THREE.Mesh(geom, laneMat));
        }
    }
}
