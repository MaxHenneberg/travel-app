type Stop = { id: string; title: string; location?: string | { name?: string; lat?: number; lng?: number }; startsAt?: string; time?: string; lat?: number; lng?: number };
type Transit = { type: 'transit'; fromStopId: string; toStopId: string };
const coordinates = (stop: Stop) => ({ lat: stop.lat ?? (typeof stop.location === 'object' ? stop.location.lat : undefined), lng: stop.lng ?? (typeof stop.location === 'object' ? stop.location.lng : undefined) });
const valid = (stop: Stop) => { const point = coordinates(stop); return Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat!) <= 90 && Math.abs(point.lng!) <= 180; };
const time = (stop: Stop) => stop.startsAt?.match(/T(\d\d:\d\d)/)?.[1] ?? 'Any time';

/** Lightweight offline-safe SVG overview; intentionally no tile provider or geocoding dependency. */
export function mountDayOverviewMap(host: HTMLElement, items: Array<Stop | Transit>, onSelect: (id: string) => void) {
  const stops = items.filter((item): item is Stop => (item as Transit).type !== 'transit');
  const pins = stops.filter(valid);
  if (!pins.length) { host.innerHTML = '<p class="map-unavailable" role="status">No stops have valid coordinates. The timetable and ordered list remain available.</p>'; return; }
  const lats = pins.map((s) => coordinates(s).lat!); const lngs = pins.map((s) => coordinates(s).lng!);
  const minLat = Math.min(...lats); const maxLat = Math.max(...lats); const minLng = Math.min(...lngs); const maxLng = Math.max(...lngs);
  const project = (stop: Stop) => { const point = coordinates(stop); return { x: 12 + ((point.lng! - minLng) / (maxLng - minLng || 1)) * 76, y: 88 - ((point.lat! - minLat) / (maxLat - minLat || 1)) * 76 }; };
  const byId = new Map(pins.map((s) => [s.id, s]));
  const edges = items.filter((item): item is Transit => (item as Transit).type === 'transit').map((transit) => [byId.get(transit.fromStopId), byId.get(transit.toStopId)]).filter((edge): edge is [Stop, Stop] => Boolean(edge[0] && edge[1]));
  host.innerHTML = `<svg class="day-overview-map" viewBox="0 0 100 100" role="img" aria-label="Map with ${pins.length} ordered stops">${edges.map(([a,b]) => { const pa=project(a); const pb=project(b); return `<line class="map-edge" x1="${pa.x}" y1="${pa.y}" x2="${pb.x}" y2="${pb.y}" />`; }).join('')}${pins.map((stop) => { const p=project(stop); const order=stops.indexOf(stop)+1; return `<g class="map-pin" tabindex="0" role="button" data-day-map-pin="${stop.id}" aria-label="Stop ${order}: ${stop.title}, ${stop.location || 'location unavailable'}, ${time(stop)}"><circle cx="${p.x}" cy="${p.y}" r="6"/><text x="${p.x}" y="${p.y + 1.5}">${order}</text><text class="map-pin-label" x="${p.x}" y="${p.y - 8}">${stop.title}</text></g>`; }).join('')}</svg>`;
  host.querySelectorAll<HTMLElement>('[data-day-map-pin]').forEach((pin) => { const select = () => onSelect(pin.dataset.dayMapPin!); pin.addEventListener('click', select); pin.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } }); });
}