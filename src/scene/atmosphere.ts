import {
  AdditiveBlending,
  BackSide,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
} from "three";
import { LIGHT_GLSL, paletteUniforms } from "../shaders/chunks";
import { PLANET_RADIUS } from "./planet";
import type { SceneUniforms } from "../uniforms";

/**
 * The halo that sells the whole scene: a back-side shell whose glow color
 * follows the dusk ramp, so the ring around the planet runs night-blue ->
 * violet -> blazing orange -> daylight as it crosses the terminator.
 */
export function createAtmosphere(uniforms: SceneUniforms): Mesh {
  const geometry = new SphereGeometry(PLANET_RADIUS * 1.45, 64, 48);

  const material = new ShaderMaterial({
    uniforms: {
      uSunDir: uniforms.uSunDir,
      ...paletteUniforms(uniforms),
    },
    side: BackSide,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;

      void main() {
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;

      ${LIGHT_GLSL}

      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 E = normalize(vWorldPos - cameraPosition);

        // Back side: E and N align behind the planet's limb, fade to zero
        // at the shell's own silhouette -> a glow hugging the planet.
        float rim = clamp(dot(N, E), 0.0, 1.0);
        float intensity = pow(rim, 5.0) * 0.6;

        float ndl = dot(N, normalize(uSunDir));
        vec3 col = duskRamp(ndl);

        // The sunset ring burns brighter than day or night.
        float blaze = exp(-pow(ndl / 0.24, 2.0));
        intensity *= 1.0 + blaze * 0.9;

        gl_FragColor = vec4(col * intensity, 1.0);
      }
    `,
  });

  return new Mesh(geometry, material);
}
