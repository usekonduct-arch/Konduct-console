/** Map pins and trip estimates. The estimate mirrors konduct-backend/functions/src/domain/landmarks.ts. */

export type Point = { lat: number; lng: number };

/**
 * A map pin from "7.7712, 4.5567" or a Google Maps link (…/@7.7712,4.5567,17z or ?q=7.7712,4.5567).
 * Undefined when the field is empty, null when it can't be read.
 */
export function parsePin(raw: string): Point | null | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  const m =
    s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ??
    s.match(/[?&](?:q|query|ll|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i) ??
    s.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Math.round(Number(m[1]) * 1e6) / 1e6;
  const lng = Math.round(Number(m[2]) * 1e6) / 1e6;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

export const mapLink = (p: Point) => `https://www.google.com/maps?q=${p.lat},${p.lng}`;

/** Backend RULES: road factor, bus speed, stop time, shortest trip. */
const ROAD_FACTOR = 1.35;
const BUS_KMH = 20;
const STOP_MIN = 2;
const MIN_TRIP_MIN = 3;

function distanceKm(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** About how far by road (km, one decimal) and how long by bus (minutes) between two pins. */
export function estimate(a: Point, b: Point): { km: number; minutes: number } {
  const km = distanceKm(a, b) * ROAD_FACTOR;
  return { km: Math.round(km * 10) / 10, minutes: Math.max(MIN_TRIP_MIN, Math.ceil((km / BUS_KMH) * 60 + STOP_MIN)) };
}
