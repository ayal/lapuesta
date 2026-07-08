import {
  BufferAttribute,
  IcosahedronGeometry,
  Mesh,
  RepeatWrapping,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
} from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { createNoise3D } from "simplex-noise";
import { mulberry32 } from "../utils";
import { LIGHT_GLSL, NOISE_GLSL, paletteUniforms } from "../shaders/chunks";
import type { SceneUniforms } from "../uniforms";

export const PLANET_RADIUS = 2;

const rng = mulberry32(20260708);
const noise3D = createNoise3D(rng);

function fbm(x: number, y: number, z: number, octaves: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let max = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise3D(x * freq, y * freq, z * freq);
    max += amp;
    amp *= 0.5;
    freq *= 2.13;
  }
  return sum / max;
}

function ridged(x: number, y: number, z: number, octaves: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let max = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(noise3D(x * freq, y * freq, z * freq));
    sum += n * n * amp;
    max += amp;
    amp *= 0.5;
    freq *= 2.08;
  }
  return sum / max;
}

/**
 * Terrain height for a unit direction, as a signed fraction of the planet
 * radius above sea level. Small-scale archipelago world: many islands,
 * ridged mountain chains, shallow seas between them.
 */
export function heightAt(dir: Vector3): number {
  const w =
    fbm(dir.x * 1.9 + 9.2, dir.y * 1.9 + 9.2, dir.z * 1.9 + 9.2, 3) * 0.35;

  // Smooth continents: only two octaves, the warp supplies coast detail.
  const c = fbm(dir.x * 1.6 + w, dir.y * 1.6 + w, dir.z * 1.6 + w, 2);
  let h = c * 0.38 - 0.02;

  const land = Math.min(1, Math.max(0, (c - 0.03) / 0.19));

  // Gentle rolling hills on the plains.
  h += fbm(dir.x * 3.2 + 17.3, dir.y * 3.2 + 17.3, dir.z * 3.2 + 17.3, 2) *
    0.05 * land;

  // Broad mountain ranges in some regions of the continents only.
  const mm = fbm(dir.x * 1.2 + 31.7, dir.y * 1.2 + 31.7, dir.z * 1.2 + 31.7, 2);
  const ranges = Math.min(1, Math.max(0, (mm - 0.05) / 0.4));
  const r = ridged(dir.x * 2.2, dir.y * 2.2, dir.z * 2.2, 2);
  h += Math.pow(r, 1.8) * ranges * land * 0.65;

  return h * 0.14;
}

function loadTexture(loader: TextureLoader, url: string): Texture {
  const tex = loader.load(url);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export function createPlanet(uniforms: SceneUniforms): Mesh {
  let geometry: ReturnType<typeof mergeVertices> = new IcosahedronGeometry(
    PLANET_RADIUS,
    96,
  );
  geometry.deleteAttribute("uv");
  geometry.deleteAttribute("normal");
  geometry = mergeVertices(geometry, 1e-4);

  const pos = geometry.attributes.position as BufferAttribute;
  const count = pos.count;

  const heights = new Float32Array(count);
  const dir = new Vector3();
  const v = new Vector3();

  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(pos, i);
    dir.copy(v).normalize();
    const hn = heightAt(dir);
    heights[i] = hn;
    const radius = PLANET_RADIUS * (1 + hn);
    pos.setXYZ(i, dir.x * radius, dir.y * radius, dir.z * radius);
  }

  geometry.setAttribute("aHeight", new BufferAttribute(heights, 1));
  geometry.computeVertexNormals();

  const normals = geometry.attributes.normal as BufferAttribute;
  const slopes = new Float32Array(count);
  const n = new Vector3();
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    n.fromBufferAttribute(normals, i);
    slopes[i] = 1 - v.dot(n);
  }
  geometry.setAttribute("aSlope", new BufferAttribute(slopes, 1));

  const loader = new TextureLoader();
  const base = import.meta.env.BASE_URL + "textures/";

  const material = new ShaderMaterial({
    uniforms: {
      uSunDir: uniforms.uSunDir,
      ...paletteUniforms(uniforms),
      tGrass: { value: loadTexture(loader, base + "aerial_grass_rock_diff_1k.jpg") },
      tRock: { value: loadTexture(loader, base + "rock_boulder_cracked_diff_1k.jpg") },
      tSand: { value: loadTexture(loader, base + "aerial_beach_01_diff_1k.jpg") },
      tSnow: { value: loadTexture(loader, base + "snow_02_diff_1k.jpg") },
    },
    vertexShader: /* glsl */ `
      attribute float aHeight;
      attribute float aSlope;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      varying vec3 vDir;
      varying float vHeight;
      varying float vSlope;

      void main() {
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vDir = normalize(position);
        vHeight = aHeight;
        vSlope = aSlope;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform sampler2D tGrass;
      uniform sampler2D tRock;
      uniform sampler2D tSand;
      uniform sampler2D tSnow;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      varying vec3 vDir;
      varying float vHeight;
      varying float vSlope;

      ${NOISE_GLSL}
      ${LIGHT_GLSL}

      // Triplanar sample: project along the three axes, weight by the
      // geometric normal, so a sphere gets seam- and stretch-free texture.
      vec3 triplanar(sampler2D tex, vec3 p, vec3 blend) {
        vec3 cx = texture2D(tex, p.yz).rgb;
        vec3 cy = texture2D(tex, p.xz).rgb;
        vec3 cz = texture2D(tex, p.xy).rgb;
        return cx * blend.x + cy * blend.y + cz * blend.z;
      }

      // High-frequency height detail, re-evaluated per fragment for bump
      // shading far beyond the mesh resolution (dgreenheck's technique).
      float detailHeight(vec3 p, float rockiness) {
        return snoise(p * 12.0) * 0.65 + snoise(p * 30.0) * 0.35 * rockiness;
      }

      void main() {
        float hn = vHeight;
        float slope = vSlope;

        vec3 N0 = normalize(vWorldNormal);
        vec3 blend = pow(abs(N0), vec3(4.0));
        blend /= (blend.x + blend.y + blend.z);

        // --- material masks ---
        float beach = smoothstep(-0.003, 0.002, hn) * (1.0 - smoothstep(0.004, 0.009, hn));
        float rocky = max(
          smoothstep(0.055, 0.09, hn),
          smoothstep(0.075, 0.19, slope)
        );
        float snowy = smoothstep(0.095, 0.115, hn) * smoothstep(0.16, 0.05, slope);
        float underwater = 1.0 - smoothstep(-0.002, 0.001, hn);

        // --- bump detail normal ---
        float rockiness = clamp(rocky + beach * 0.3, 0.0, 1.0);
        vec3 T = normalize(cross(N0, abs(N0.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
        vec3 B = normalize(cross(N0, T));
        float e = 0.012;
        float amp = mix(0.02, 0.07, rockiness) * (1.0 - underwater * 0.7);
        float h0 = detailHeight(vDir, rockiness);
        float hx = detailHeight(vDir + T * e, rockiness);
        float hy = detailHeight(vDir + B * e, rockiness);
        vec3 N = normalize(N0 - T * (hx - h0) * amp / e * 0.02 - B * (hy - h0) * amp / e * 0.02);

        // --- albedo from textures ---
        vec3 grassCol = triplanar(tGrass, vWorldPos * 1.1, blend) * vec3(0.82, 1.02, 0.72);
        vec3 rockCol  = triplanar(tRock,  vWorldPos * 0.8, blend);
        vec3 sandCol  = triplanar(tSand,  vWorldPos * 1.6, blend);
        vec3 snowCol  = triplanar(tSnow,  vWorldPos * 1.0, blend);

        // Large-scale tonal variation so tiling never reads.
        float macro = 0.82 + 0.36 * (0.5 + 0.5 * snoise(vDir * 3.3 + 4.7));
        grassCol *= macro;
        rockCol *= 0.9 + 0.2 * snoise(vDir * 7.1);
        rockCol = mix(rockCol, vec3(dot(rockCol, vec3(0.333))), 0.22);

        vec3 col = grassCol;
        col = mix(col, rockCol, rocky);
        col = mix(col, sandCol, beach);
        col = mix(col, snowCol, snowy);

        // Seabed: sand tinted by increasingly deep water.
        vec3 seabed = sandCol * mix(vec3(0.55, 0.75, 0.75), vec3(0.06, 0.16, 0.22),
                                    smoothstep(0.0, -0.03, hn));
        col = mix(col, seabed, underwater);

        // --- lighting ---
        vec3 L = normalize(uSunDir);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float ndl = dot(N, L);
        float ndl0 = dot(N0, L);

        float wrap = clamp((ndl + 0.18) / 1.18, 0.0, 1.0);
        float vis = smoothstep(-0.02, 0.10, ndl0);
        vec3 sunlight = sunTint(ndl0) * pow(wrap, 1.7) * 1.3 * vis;
        vec3 ambient = vec3(0.045, 0.055, 0.14);
        vec3 lit = col * (ambient + sunlight);

        // Terminator blaze on the ground.
        float band = exp(-pow(ndl0 / 0.15, 2.0));
        lit += col * uBlaze * band * 0.15;

        // Horizon haze grades the rim toward the sky behind it.
        float fres = pow(1.0 - clamp(dot(N0, V), 0.0, 1.0), 3.0);
        lit = mix(lit, duskRamp(ndl0) * 0.8, fres * 0.35);

        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });

  return new Mesh(geometry, material);
}
