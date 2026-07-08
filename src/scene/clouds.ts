import {
  BackSide,
  BoxGeometry,
  Data3DTexture,
  GLSL3,
  Group,
  LinearFilter,
  Mesh,
  Object3D,
  RedFormat,
  ShaderMaterial,
} from "three";
import { ImprovedNoise } from "three/addons/math/ImprovedNoise.js";
import { LIGHT_GLSL, paletteUniforms } from "../shaders/chunks";
import { mulberry32, randRange } from "../utils";
import { PLANET_RADIUS } from "./planet";
import type { SceneUniforms } from "../uniforms";

const rng = mulberry32(7101988);

/**
 * A cumulus density field: a cluster of overlapping soft spheres
 * (metaballs) gives the cauliflower lobes real clouds have, and fbm
 * noise modulates them into billows. Each cloud raymarches this.
 */
function makeCloudTexture(seed: number): Data3DTexture {
  const size = 88;
  const data = new Uint8Array(size * size * size);
  const perlin = new ImprovedNoise();
  const rngT = mulberry32(Math.floor(seed * 1000) + 11);
  const s = 0.075;

  // Puff cluster: one fat base lobe, smaller lobes piled on and around.
  interface Puff { x: number; y: number; z: number; r: number }
  const puffs: Puff[] = [{ x: 0, y: -0.08, z: 0, r: 0.5 }];
  const puffCount = 12;
  for (let p = 0; p < puffCount; p++) {
    const up = rngT(); // higher lobes are smaller
    puffs.push({
      x: (rngT() * 2 - 1) * 0.55,
      y: -0.2 + up * 0.62,
      z: (rngT() * 2 - 1) * 0.42,
      r: (0.34 - up * 0.14) * (0.7 + rngT() * 0.6),
    });
  }

  const half = size / 2;
  let i = 0;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const px = (x - half) / half;
        const py = (y - half) / half;
        const pz = (z - half) / half;

        // Soft union of the lobes.
        let cover = 1;
        for (const p of puffs) {
          const dx = px - p.x;
          const dy = py - p.y;
          const dz = pz - p.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / p.r;
          const c = d >= 1 ? 0 : d <= 0.45 ? 1 : 1 - (d - 0.45) / 0.55;
          cover *= 1 - c * c * (3 - 2 * c);
        }
        let density = 1 - cover;

        // Billow modulation + flattened base.
        const n =
          perlin.noise(x * s + seed, y * s * 1.3, z * s) +
          0.5 * perlin.noise(x * s * 2.3, y * s * 2.3 + seed, z * s * 2.3) +
          0.25 * perlin.noise(x * s * 4.8 + seed, y * s * 4.8, z * s * 4.8);
        density *= 0.72 + 0.5 * n;
        if (py < -0.45) density *= Math.max(0, 1 - (-0.45 - py) * 2.4);

        data[i] = Math.min(255, Math.max(0, density * 285));
        i++;
      }
    }
  }

  const texture = new Data3DTexture(data, size, size, size);
  texture.format = RedFormat;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

function makeCloudMaterial(
  uniforms: SceneUniforms,
  texture: Data3DTexture,
  threshold: number,
): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    uniforms: {
      uMap: { value: texture },
      uSunDir: uniforms.uSunDir,
      uTime: uniforms.uTime,
      ...paletteUniforms(uniforms),
      uThreshold: { value: threshold },
      uRange: { value: 0.2 },
      uOpacity: { value: 22.0 },
      uLife: { value: 1.0 },
    },
    transparent: true,
    side: BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      out vec3 vOrigin;
      out vec3 vDirection;
      out vec3 vLocalSun;
      out float vNdl;

      uniform vec3 uSunDir;

      void main() {
        // Camera and sun in the cloud's local (unit box) space.
        mat4 invModel = inverse(modelMatrix);
        vOrigin = (invModel * vec4(cameraPosition, 1.0)).xyz;
        vDirection = position - vOrigin;
        vLocalSun = normalize(mat3(invModel) * uSunDir);

        // Where this cloud stands relative to the terminator.
        vec3 worldCenter = modelMatrix[3].xyz;
        vNdl = dot(normalize(worldCenter), normalize(uSunDir));

        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      precision highp sampler3D;

      in vec3 vOrigin;
      in vec3 vDirection;
      in vec3 vLocalSun;
      in float vNdl;
      out vec4 outColor;

      uniform sampler3D uMap;
      uniform float uThreshold;
      uniform float uRange;
      uniform float uOpacity;
      uniform float uLife;
      uniform float uTime;
      uniform mat4 modelMatrix;
      uniform vec3 uSunDir;

      ${LIGHT_GLSL}

      vec2 hitBox(vec3 orig, vec3 dir) {
        const vec3 box_min = vec3(-0.5);
        const vec3 box_max = vec3(0.5);
        vec3 inv_dir = 1.0 / dir;
        vec3 tmin_tmp = (box_min - orig) * inv_dir;
        vec3 tmax_tmp = (box_max - orig) * inv_dir;
        vec3 tmin = min(tmin_tmp, tmax_tmp);
        vec3 tmax = max(tmin_tmp, tmax_tmp);
        float t0 = max(tmin.x, max(tmin.y, tmin.z));
        float t1 = min(tmax.x, min(tmax.y, tmax.z));
        return vec2(t0, t1);
      }

      float sampleDensity(vec3 p) {
        float raw = texture(uMap, p + 0.5).r;
        // Erode the fringe with finer noise that slowly drifts, so the
        // feathery edges seethe and morph continuously.
        float wisp = texture(uMap, p * 3.3 + 0.5 + uTime * 0.006).r;
        raw -= wisp * 0.13 * (1.0 - smoothstep(uThreshold, uThreshold + 0.25, raw));
        // Life cycle: mostly a gentle density fade with a slight
        // threshold drift, so forming/dissolving is soft, not choppy.
        float th = uThreshold + (1.0 - uLife) * 0.10;
        float env = uLife * uLife * (3.0 - 2.0 * uLife);
        return smoothstep(th, th + uRange, raw) * env;
      }

      void main() {
        vec3 rayDir = normalize(vDirection);
        vec2 bounds = hitBox(vOrigin, rayDir);
        if (bounds.x > bounds.y) discard;
        bounds.x = max(bounds.x, 0.0);

        const int STEPS = 48;
        float stepSize = (bounds.y - bounds.x) / float(STEPS);
        vec3 p = vOrigin + bounds.x * rayDir;

        // Forward scattering: looking toward the sun through the cloud
        // makes its lit fringe glow.
        float phase = 1.0 + 2.2 * pow(max(dot(rayDir, vLocalSun), 0.0), 6.0);

        vec4 ac = vec4(0.0);
        for (int i = 0; i < STEPS; i++) {
          float d = sampleDensity(p);
          if (d > 0.001) {
            // Three shadow taps toward the sun: self-shadowing.
            float sh = sampleDensity(p + vLocalSun * 0.08)
                     + sampleDensity(p + vLocalSun * 0.18) * 0.7
                     + sampleDensity(p + vLocalSun * 0.34) * 0.4;
            // Beer-Lambert extinction sculpts the lobes; the powder term
            // darkens the crevices between them, which is what makes
            // cumulus read as fluffy cauliflower.
            float beer = exp(-sh * 4.2);
            float powder = 1.0 - exp(-(sh + d) * 2.6);

            // Sun angle at this exact sample, so one cloud can run from
            // fire-lit to dusk-grey across its own length.
            vec3 worldP = (modelMatrix * vec4(p, 1.0)).xyz;
            float ndl = dot(normalize(worldP), normalize(uSunDir));
            // Behind the terminator the planet shadows the cloud.
            float vis = smoothstep(-0.08, 0.06, ndl);
            vec3 sunCol = sunTint(ndl) * vis;
            vec3 skyAmb = duskRamp(ndl) * 0.4 + vec3(0.015, 0.018, 0.05);

            vec3 c = skyAmb * (0.55 + 0.45 * powder)
                   + sunCol * beer * powder * 1.45 * phase;

            float a = d * uOpacity * stepSize;
            a = 1.0 - exp(-a);
            ac.rgb += (1.0 - ac.a) * a * c;
            ac.a += (1.0 - ac.a) * a;
            if (ac.a >= 0.97) break;
          }
          p += rayDir * stepSize;
        }

        if (ac.a < 0.004) discard;
        outColor = vec4(ac.rgb / max(ac.a, 1e-4), ac.a);
      }
    `,
  });
}

export interface CloudBank {
  group: Group;
  update(dt: number, elapsed: number): void;
}

export function createClouds(uniforms: SceneUniforms, count = 42): CloudBank {
  const group = new Group();

  const textures = [
    makeCloudTexture(0),
    makeCloudTexture(37.4),
    makeCloudTexture(81.2),
  ];
  const geometry = new BoxGeometry(1, 1, 1);

  interface Drift {
    pivot: Object3D;
    mesh: Mesh;
    material: ShaderMaterial;
    speed: number;
    spin: number;
    lifetime: number;
    birth: number;
  }
  const drifts: Drift[] = [];

  function placeCloud(mesh: Mesh) {
    mesh.scale.set(
      randRange(rng, 1.4, 3.2),
      randRange(rng, 0.8, 1.4),
      randRange(rng, 1.0, 2.2),
    );
    const lat = randRange(rng, -1.15, 1.15);
    const radius = PLANET_RADIUS * randRange(rng, 1.34, 1.6);
    mesh.position.set(Math.cos(lat) * radius, Math.sin(lat) * radius, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.lookAt(0, 0, 0);
    mesh.rotateX(-Math.PI / 2);
    mesh.rotateY(rng() * Math.PI * 2);
  }

  for (let i = 0; i < count; i++) {
    const material = makeCloudMaterial(
      uniforms,
      textures[i % textures.length],
      randRange(rng, 0.29, 0.38),
    );
    const mesh = new Mesh(geometry, material);
    placeCloud(mesh);

    const pivot = new Object3D();
    pivot.rotation.y = rng() * Math.PI * 2;
    pivot.add(mesh);
    group.add(pivot);

    drifts.push({
      pivot,
      mesh,
      material,
      speed: randRange(rng, 0.018, 0.055) * (rng() > 0.65 ? -1 : 1),
      spin: randRange(rng, -0.025, 0.025),
      lifetime: randRange(rng, 60, 140),
      // Stagger births so the sky starts partly formed.
      birth: -randRange(rng, 0, 140),
    });
  }

  return {
    group,
    update(dt: number, elapsed: number) {
      for (const d of drifts) {
        // Wind: drift around the planet, tumble slowly so shapes evolve.
        d.pivot.rotation.y += d.speed * dt;
        d.mesh.rotateY(d.spin * dt);

        // Life cycle: condense, live, dissolve, respawn somewhere new.
        const age = elapsed - d.birth;
        if (age > d.lifetime) {
          d.birth = elapsed;
          d.lifetime = randRange(rng, 60, 140);
          d.speed = randRange(rng, 0.018, 0.055) * (rng() > 0.65 ? -1 : 1);
          placeCloud(d.mesh);
          d.pivot.rotation.y = rng() * Math.PI * 2;
        }
        const t = Math.max(0, age) / d.lifetime;
        const env =
          Math.min(1, t / 0.3) * (1 - Math.max(0, (t - 0.7) / 0.3));
        d.material.uniforms.uLife.value = env;
        d.mesh.visible = env > 0.015;
      }
    },
  };
}
