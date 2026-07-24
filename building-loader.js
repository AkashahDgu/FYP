/**
 * Building Loader — Load buildings from GeoJSON and 3D models
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { ORIGIN_LAT, ORIGIN_LNG } from './minimap.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// ── BVH Extension ─────────────────────────────────────────────
// Monkey-patch Three.js prototypes so every BufferGeometry gains
// computeBoundsTree() and every Raycaster uses the BVH fast-path.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/**
 * Collidable meshes for building collision — populated with actual
 * building mesh parts whose geometries have pre-computed BVH trees.
 * @type {THREE.Mesh[]}
 */
export const collidableMeshes = [];

/**
 * Load all buildings into the scene and minimap.
 * @param {THREE.Scene} scene
 * @param {L.Map} map - Leaflet map instance
 * @returns {Promise<Array<{name,minX,maxX,minY,maxY}>>} Building bounds for tree avoidance
 */
export async function loadBuildings(scene, map) {
    const gltfLoader = new GLTFLoader();
    const buildingBounds = [];
    const loadedIds = new Set();
    const modelPromises = []; // track async GLB/OBJ loads so we can await them
    let c02Loaded = false; // Guard to prevent duplicate C02-C06 loads

    const buildingFiles = ['Data UTM/fabu_buildings.json', 'Data UTM/bc_buildings.json'];

    await Promise.all(buildingFiles.map(async (file) => {
        try {
            const res = await fetch(file);
            const data = await res.json();

            data.elements.forEach(el => {
                if (el.type !== 'building' || !el.geometry) return;
                if (loadedIds.has(el.id)) return;
                loadedIds.add(el.id);

                // Plot on Leaflet map
                const latlngs = el.geometry.map(p => [p.lat, p.lon]);
                L.polygon(latlngs, {
                    color: '#ef4444', weight: 2, fillColor: '#fca5a5', fillOpacity: 0.5
                }).addTo(map);

                // Compute building bounds for tree avoidance & geofencing
                let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                el.geometry.forEach(p => {
                    const y = (p.lat - ORIGIN_LAT) * 111320; // Positive Y is North
                    const x = (p.lon - ORIGIN_LNG) * 111280; // Positive X is East
                    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
                });

                // Clean name for geofencing/display
                const displayName = el.name ? el.name.trim() : null;
                if (displayName) {
                    buildingBounds.push({
                        name: displayName === 'C02' ? 'Fakulti Alam Bina & Ukur (C02)' : displayName,
                        minX, maxX, minY, maxY
                    });
                }

                // ONLY load 3D GLB models for C02 building footprint (represents the entire geolocated C02-C06 complex)
                if (el.name && el.name.includes('C02') && !c02Loaded) {
                    c02Loaded = true;

                    const combinedGroup = new THREE.Group();
                    combinedGroup.rotation.x = Math.PI / 2;
                    scene.add(combinedGroup);

                    const filesToLoad = [
                        'Data UTM/LOD 3/GLB/C02-C03&C06.glb',
                        'Data UTM/LOD 3/GLB/C04&C05.glb'
                    ];

                    const c02Promises = filesToLoad.map(filePath => {
                        return new Promise((resolveModel) => {
                            gltfLoader.load(filePath, (gltf) => {
                                const model = gltf.scene;

                                // Z-Up: Keep model.rotation.x at 0. Since Node 0 in the GLB already has 
                                // a built-in +90° X rotation, this keeps the net rotation at +90° around X,
                                // ensuring the buildings are right-side up and not mirrored.
                                model.rotation.set(0, 0, 0);

                                model.traverse(child => {
                                    if (child.isMesh) {
                                        child.castShadow = true;
                                        child.receiveShadow = true;

                                        // Subtle emissive fill so interior corridors aren't pitch black
                                        if (child.material) {
                                            child.material.emissive = new THREE.Color(0xffffff);
                                            child.material.emissiveIntensity = 0.03;

                                            // Handle glass/translucent materials
                                            if (child.material.opacity < 1.0) {
                                                child.material.transparent = true;
                                                child.material.depthWrite = false; // prevent z-fighting on glass
                                                child.material.roughness = 0.1;
                                                child.material.metalness = 0.2;
                                            }

                                            // Ensure textures are in correct color space
                                            if (child.material.map) {
                                                child.material.map.colorSpace = THREE.SRGBColorSpace;
                                            }
                                        }

                                        // Build BVH acceleration structure for this mesh's geometry
                                        child.geometry.computeBoundsTree();
                                        collidableMeshes.push(child);
                                    }
                                });

                                combinedGroup.add(model);
                                console.log(`✓ Loaded: ${filePath}`);
                                resolveModel();
                            }, undefined, (err) => {
                                console.warn(`Failed to load ${filePath}, falling back to C02 OBJ...`, err);
                                // Fallback: load OBJ+MTL if GLB is missing
                                loadC02OBJ(scene).then(resolveModel);
                            });
                        });
                    });

                    // Track the combined alignment promise in the main modelPromises array
                    modelPromises.push(Promise.all(c02Promises).then(() => {
                        // Position combinedGroup using its combined bounding box center:
                        combinedGroup.updateMatrixWorld(true);
                        const box = new THREE.Box3().setFromObject(combinedGroup);
                        const center = box.getCenter(new THREE.Vector3());

                        const combinedFootprintCenterX = 63.535;
                        const combinedFootprintCenterY = 22.748;

                        combinedGroup.position.set(
                            combinedFootprintCenterX - center.x,
                            combinedFootprintCenterY - center.y,
                            -box.min.z
                        );
                        combinedGroup.updateMatrixWorld(true);
                        console.log(`✓ C02 split models aligned: center=(${center.x.toFixed(3)}, ${center.y.toFixed(3)}), minZ=${box.min.z.toFixed(3)}`);
                    }));
                }
            });
        } catch (err) {
            console.error('Error loading buildings ' + file + ':', err);
        }
    }));

    // Load Masjid Sultan Ismail (manual placement)
    modelPromises.push(loadMasjid(scene, buildingBounds));

    // Wait for ALL 3D models to finish loading before returning
    await Promise.all(modelPromises);

    // Build simple, invisible colliders over building boundaries for optimized collision detection
    // DISABLED: Player requested to walk through all buildings, so no colliders are generated.
    /*
    buildingBounds.forEach(b => {
        // Only build colliders for buildings with physical 3D models in the scene to prevent invisible walls
        const hasModel = b.name && (
            b.name === 'C03' ||
            b.name === 'C04' ||
            b.name === 'C05' ||
            b.name === 'C06' ||
            b.name.includes('C02') ||
            b.name.includes('Masjid Sultan Ismail')
        );
        if (!hasModel) return;

        const width = b.maxX - b.minX;
        const depth = b.maxY - b.minY;
        const height = 25; // Height of the collision volume box
        
        const geometry = new THREE.BoxGeometry(width, depth, height);
        // MeshBasicMaterial with visible: false is invisible but remains interactable by THREE.Raycaster
        const material = new THREE.MeshBasicMaterial({ visible: false });
        const collider = new THREE.Mesh(geometry, material);
        
        const centerX = b.minX + width / 2;
        const centerY = b.minY + depth / 2;
        collider.position.set(centerX, centerY, height / 2);
        
        scene.add(collider);
        collidableMeshes.push(collider);
    });
    */

    console.log(`✓ Colliders initialized: ${collidableMeshes.length} building mesh parts registered for per-triangle collision.`);
    return buildingBounds;
}

/**
 * Fallback: Load C02 as OBJ+MTL if GLB is unavailable.
 */
function loadC02OBJ(scene) {
    return new Promise((resolve) => {
        const mtlLoader = new MTLLoader();
        mtlLoader.setPath('Data UTM/LOD 3/Skp/');
        mtlLoader.load('New C02-C06.mtl', (materials) => {
            materials.preload();
            const objLoader = new OBJLoader();
            objLoader.setMaterials(materials);
            objLoader.setPath('Data UTM/LOD 3/Skp/');
            objLoader.load('New C02-C06.obj', (object) => {
                // Compute bounding box of unrotated model
                const box = new THREE.Box3().setFromObject(object);
                const center = box.getCenter(new THREE.Vector3());

                // OBJ is Y-up, so we rotate it by 90 degrees around X to make it Z-up
                object.rotation.x = Math.PI / 2;
                object.updateMatrixWorld(true);

                // Position the fallback C02 OBJ model centered on C02-C06 combined footprint centroid
                const targetX = 63.535;
                const targetY = 22.748;
                object.position.set(
                    targetX - center.x,
                    targetY - (-center.z),
                    -box.min.y
                );
                object.traverse(child => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        child.material.emissive = new THREE.Color(0xffffff);
                        child.material.emissiveIntensity = 0.03;

                        if (child.material.opacity < 1.0) {
                            child.material.transparent = true;
                            child.material.depthWrite = false;
                            child.material.roughness = 0.1;
                            child.material.metalness = 0.2;
                        }

                        if (child.material.map) {
                            child.material.map.colorSpace = THREE.SRGBColorSpace;
                        }

                        // Build BVH and register for per-triangle collision
                        child.geometry.computeBoundsTree();
                        collidableMeshes.push(child);
                    }
                });
                scene.add(object);
                console.log(`C02 OBJ fallback loaded at datum origin.`);
                resolve();
            }, undefined, (err) => {
                console.warn('C02 OBJ load failed:', err);
                resolve();
            });
        }, undefined, (err) => {
            console.warn('C02 MTL load failed:', err);
            resolve();
        });
    });
}

/**
 * Load the Masjid Sultan Ismail OBJ model.
 * @returns {Promise<void>} Resolves when the model is in the scene
 */
function loadMasjid(scene, buildingBounds) {
    return new Promise((resolve) => {
        const mtlLoader = new MTLLoader();
        mtlLoader.setPath('Data UTM/Masjid/');
        mtlLoader.load('Masjid.mtl', (materials) => {
            materials.preload();
            const objLoader = new OBJLoader();
            objLoader.setMaterials(materials);
            objLoader.setPath('Data UTM/Masjid/');
            objLoader.load('Masjid.obj', (object) => {
                const mLat = 1.5591027, mLng = 103.6372246;
                const mY = (mLat - ORIGIN_LAT) * 111320; // Positive Y is North
                const mX = (mLng - ORIGIN_LNG) * 111280; // Positive X is East

                // Compute bounding box of unrotated model
                const box = new THREE.Box3().setFromObject(object);

                // Rotate model to Z-up orientation
                object.rotation.x = Math.PI / 2;
                object.updateMatrixWorld(true);

                // Position vertically aligned
                object.position.set(mX, mY, -box.min.y + 0.05);
                object.scale.set(1.5, 1.5, 1.5);
                object.traverse(child => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        if (child.material) {
                            child.material.emissive = new THREE.Color(0xffffff);
                            child.material.emissiveIntensity = 0.05;
                            if (child.material.map) {
                                child.material.map.colorSpace = THREE.SRGBColorSpace;
                            }
                        }

                        // Build BVH and register for per-triangle collision
                        child.geometry.computeBoundsTree();
                        collidableMeshes.push(child);
                    }
                });
                scene.add(object);

                // Push Masjid bounds for tree avoidance and geofencing
                const finalBox = new THREE.Box3().setFromObject(object);
                if (buildingBounds) {
                    buildingBounds.push({
                        name: 'Masjid Sultan Ismail',
                        minX: finalBox.min.x,
                        maxX: finalBox.max.x,
                        minY: finalBox.min.y,
                        maxY: finalBox.max.y
                    });
                }

                console.log('Masjid Sultan Ismail loaded.');
                resolve();
            }, undefined, (err) => {
                console.warn('Masjid OBJ load failed:', err);
                resolve();
            });
        }, undefined, (err) => {
            console.warn('Masjid MTL load failed:', err);
            resolve();
        });
    });
}
