import { Object3D, Quaternion, Vector3 } from "three";

/** Deterministic PRNG so the planet looks the same on every visit. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Random unit vector within `maxAngle` radians of +Y (a polar cap). */
export function pointOnCap(rng: () => number, maxAngle: number): Vector3 {
  const cosMax = Math.cos(maxAngle);
  const y = cosMax + (1 - cosMax) * rng();
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const phi = rng() * Math.PI * 2;
  return new Vector3(r * Math.cos(phi), y, r * Math.sin(phi));
}

const UP = new Vector3(0, 1, 0);
const q = new Quaternion();

/** Rotate an object so its local +Y points along `dir`. */
export function alignToDir(obj: Object3D, dir: Vector3): void {
  q.setFromUnitVectors(UP, dir.clone().normalize());
  obj.quaternion.copy(q);
}
