import { BackSide, Mesh, ShaderMaterial, SphereGeometry } from "three";
import { paletteUniforms } from "../shaders/chunks";
import type { SceneUniforms } from "../uniforms";

/**
 * Deep-space backdrop: a vertical dusk gradient plus a wide, soft halo
 * around wherever the sun currently is.
 */
export function createSky(uniforms: SceneUniforms): Mesh {
  const material = new ShaderMaterial({
    uniforms: { uSunDir: uniforms.uSunDir, ...paletteUniforms(uniforms) },
    side: BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform vec3 uBlaze;
      uniform vec3 uGold;
      uniform vec3 uDusk;
      varying vec3 vDir;

      void main() {
        vec3 dir = normalize(vDir);
        float h = dir.y * 0.5 + 0.5;

        vec3 bottom = vec3(0.085, 0.045, 0.105);
        vec3 mid    = vec3(0.035, 0.030, 0.095);
        vec3 top    = vec3(0.012, 0.014, 0.055);
        vec3 col = mix(bottom, mid, smoothstep(0.0, 0.45, h));
        col = mix(col, top, smoothstep(0.45, 1.0, h));

        // Distant warmth around the sun, in today's palette.
        float toSun = max(dot(dir, normalize(uSunDir)), 0.0);
        col += uBlaze * pow(toSun, 9.0) * 0.4;
        col += uDusk * pow(toSun, 2.5) * 0.08;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  return new Mesh(new SphereGeometry(150, 32, 24), material);
}
