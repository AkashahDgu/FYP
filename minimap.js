/**
 * Minimap — Leaflet 2D map synced with 3D player position
 */

// Geographic origin (UTM Campus center)
export const ORIGIN_LAT = 1.560044;
export const ORIGIN_LNG = 103.635711;

let map, playerMarker;

/**
 * Initialize the Leaflet minimap.
 * @returns {{ map, playerMarker }} references for external use
 */
export function initMinimap() {
    map = L.map('minimap', {
        zoomControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        keyboard: false
    }).setView([ORIGIN_LAT, ORIGIN_LNG], 18);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    }).addTo(map);

    const playerIcon = L.divIcon({
        className: 'custom-div-icon',
        html: '<div class="player-arrow-wrapper"><div class="player-arrow" id="minimap-arrow"></div></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });

    playerMarker = L.marker([ORIGIN_LAT, ORIGIN_LNG], {
        icon: playerIcon,
        zIndexOffset: 1000
    }).addTo(map);

    return { map, playerMarker };
}

/**
 * Sync the minimap marker with the 3D player position.
 */
export function updateMinimap(player) {
    if (!map || !playerMarker) return;
    const currentLat = ORIGIN_LAT + (player.position.y / 111320);
    const currentLng = ORIGIN_LNG + (player.position.x / 111280);
    playerMarker.setLatLng([currentLat, currentLng]);
    map.panTo([currentLat, currentLng], { animate: false });

    const arrow = document.getElementById('minimap-arrow');
    if (arrow) {
        const headingDegrees = player.rotation.z * (180 / Math.PI);
        arrow.style.transform = `rotate(${headingDegrees * -1}deg)`;
    }
}

/**
 * Get the Leaflet map instance.
 */
export function getMap() {
    return map;
}
