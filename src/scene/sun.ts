import {
  AdditiveBlending,
  CanvasTexture,
  Euler,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import { mulberry32 } from "../utils";

export const SUN_DISTANCE = 9.5;
export const SUN_RADIUS = 0.55;
/** Seconds for one full day/night lap around the planet. */
export const DAY_LENGTH = 60;

function makeGlowTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2,
  );
  g.addColorStop(0, "rgba(255, 214, 150, 1.0)");
  g.addColorStop(0.25, "rgba(255, 170, 100, 0.55)");
  g.addColorStop(0.55, "rgba(255, 120, 70, 0.16)");
  g.addColorStop(1, "rgba(255, 90, 60, 0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

export interface Sun {
  group: Group;
  /** Advances the orbit and writes the sun direction into `out`. */
  update(dt: number, elapsed: number, out: Vector3): void;
}

export function createSun(): Sun {
  const group = new Group();

  const core = new Mesh(
    new SphereGeometry(SUN_RADIUS, 32, 20),
    new MeshBasicMaterial({ color: "#fff3d6" }),
  );
  group.add(core);

  const glow = new Sprite(
    new SpriteMaterial({
      map: makeGlowTexture(),
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  glow.scale.setScalar(SUN_RADIUS * 6);
  group.add(glow);

  // Each day the orbit plane leans a different way, so sunsets climb and
  // dive along new paths around the planet.
  const orbit = new Quaternion();
  const targetOrbit = new Quaternion();
  const euler = new Euler();
  const pos = new Vector3();
  let currentDay = -1;

  const precess = new Quaternion();
  const Y_AXIS = new Vector3(0, 1, 0);

  function pickOrbit(day: number, q: Quaternion) {
    const rng = mulberry32(day * 5077 + 3);
    // Mostly vertical orbits (51°–80°), so the sun regularly climbs over
    // the top of the world where the camera lives.
    const tilt = (0.9 + rng() * 0.5) * (rng() > 0.5 ? 1 : -1);
    const yaw = rng() * Math.PI * 2;
    euler.set(tilt * Math.cos(yaw), 0, tilt * Math.sin(yaw));
    q.setFromEuler(euler);
  }

  return {
    group,
    update(dt: number, elapsed: number, out: Vector3) {
      const day = Math.floor(elapsed / DAY_LENGTH);
      if (day !== currentDay) {
        const firstCall = currentDay === -1;
        currentDay = day;
        pickOrbit(day, targetOrbit);
        if (firstCall) orbit.copy(targetOrbit);
      }
      orbit.slerp(targetOrbit, 1 - Math.exp(-dt * 0.5));

      // The orbit plane also precesses continuously, so within a single
      // day the sun's path visibly wanders around the planet.
      precess.setFromAxisAngle(Y_AXIS, dt * 0.12);
      orbit.premultiply(precess);
      targetOrbit.premultiply(precess);

      const angle = elapsed * ((Math.PI * 2) / DAY_LENGTH);
      pos
        .set(Math.cos(angle) * SUN_DISTANCE, 0, Math.sin(angle) * SUN_DISTANCE)
        .applyQuaternion(orbit);
      group.position.copy(pos);
      out.copy(pos).normalize();
    },
  };
}
