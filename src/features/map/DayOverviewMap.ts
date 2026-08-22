import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

type Coordinates = { lat?: number; lng?: number };
type Stop = { id: string; title: string; location?: string | ({ name?: string } & Coordinates); startsAt?: string; time?: string } & Coordinates;
type Transit = { type: 'transit'; fromStopId: string; toStopId: string };
type View = { center: [number, number]; zoom: number };

const coordinates = (stop: Stop) => ({ lat: stop.lat ?? (typeof stop.location === 'object' ? stop.location.lat : undefined), lng: stop.lng ?? (typeof stop.location === 'object' ? stop.location.lng : undefined) });
const valid = (stop: Stop) => { const point = coordinates(stop); return Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat!) <= 90 && Math.abs(point.lng!) <= 180; };
const locationName = (stop: Stop) => typeof stop.location === 'string' ? stop.location : stop.location?.name || 'location unavailable';
const time = (stop: Stop) => stop.startsAt?.match(/T(\d\d:\d\d)/)?.[1] ?? stop.time ?? 'Any time';

function savedView(key?: string): View | undefined {
  if (!key) return undefined;
  try { const value = JSON.parse(sessionStorage.getItem(key) || ''); return Array.isArray(value?.center) && Number.isFinite(value.center[0]) && Number.isFinite(value.center[1]) && Number.isFinite(value.zoom) ? value : undefined; } catch { return undefined; }
}
function saveView(key: string | undefined, map: L.Map) {
  if (!key) return;
  const center = map.getCenter();
  try { sessionStorage.setItem(key, JSON.stringify({ center: [center.lat, center.lng], zoom: map.getZoom() })); } catch { /* In-memory map remains usable when storage is unavailable. */ }
}

/** Lazy-loaded Leaflet + OpenStreetMap basemap. No geocoding or itinerary mutation occurs here. */
export function mountDayOverviewMap(host: HTMLElement, items: Array<Stop | Transit>, onSelect: (id: string) => void, { viewKey }: { viewKey?: string } = {}) {
  const stops = items.filter((item): item is Stop => (item as Transit).type !== 'transit');
  const pins = stops.filter(valid);
  if (!pins.length) { host.innerHTML = '<p class="map-unavailable" role="status">No stops have valid coordinates. The timetable and ordered list remain available.</p>'; return () => {}; }
  host.innerHTML = '<div class="leaflet-day-map" data-map-canvas aria-label="Interactive OpenStreetMap day map"></div><p class="map-tile-status" data-map-tile-status hidden role="status">Map tiles are unavailable. The timetable and ordered stop list remain available.</p>';
  const canvas = host.querySelector<HTMLElement>('[data-map-canvas]')!;
  const bounds = L.latLngBounds(pins.map((stop) => { const point = coordinates(stop); return [point.lat!, point.lng!] as L.LatLngExpression; }));
  const stored = savedView(viewKey);
  const map = L.map(canvas, { zoomControl: true, attributionControl: true, keyboard: true, scrollWheelZoom: true, preferCanvas: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: true, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' }).addTo(map);
  if (stored) map.setView(stored.center, stored.zoom); else if (pins.length === 1) map.setView(bounds.getCenter(), 14); else map.fitBounds(bounds.pad(0.22), { maxZoom: 15 });
  const status = host.querySelector<HTMLElement>('[data-map-tile-status]')!;
  const showTileFallback = () => { status.hidden = false; canvas.classList.add('tiles-unavailable'); };
  if (!navigator.onLine) showTileFallback();
  map.eachLayer((layer) => { if (layer instanceof L.TileLayer) layer.on('tileerror', showTileFallback); });
  const byId = new Map(pins.map((stop) => [stop.id, stop]));
  for (const transit of items.filter((item): item is Transit => (item as Transit).type === 'transit')) {
    const from = byId.get(transit.fromStopId); const to = byId.get(transit.toStopId);
    if (from && to) { const a = coordinates(from); const b = coordinates(to); L.polyline([[a.lat!, a.lng!], [b.lat!, b.lng!]], { color: '#126b56', weight: 4, dashArray: '7 7', opacity: 0.8, interactive: false }).addTo(map); }
  }
  for (const stop of pins) {
    const point = coordinates(stop); const order = stops.indexOf(stop) + 1;
    const icon = L.divIcon({ className: 'day-map-marker-shell', html: `<button type="button" class="day-map-marker" data-day-map-pin="${stop.id}" aria-label="Stop ${order}: ${stop.title}, ${locationName(stop)}, ${time(stop)}">${order}</button>`, iconSize: [44, 44], iconAnchor: [22, 22] });
    const marker = L.marker([point.lat!, point.lng!], { icon, keyboard: true, title: stop.title, alt: `Stop ${order}: ${stop.title}` }).addTo(map);
    marker.bindPopup(`<strong>${stop.title}</strong><br>${locationName(stop)}<br>${time(stop)}`);
    marker.on('click keypress', () => onSelect(stop.id));
  }
  map.on('moveend', () => saveView(viewKey, map));
  requestAnimationFrame(() => map.invalidateSize());
  return () => map.remove();
}