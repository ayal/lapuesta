import {
  BufferAttribute,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { LIGHT_GLSL, NOISE_GLSL, paletteUniforms } from "../shaders/chunks";
import { heightAt, PLANET_RADIUS } from "./planet";
import type { SceneUniforms } from "../uniforms";

/**
 * The ocean: a sphere at sea level over the terrain. Each vertex bakes the
 * terrain height beneath it ("shore"), giving depth-based color and a foam
 * line along the coasts. Ripples and glints are done in the fragment shader.
 */
export function createWater(uniforms: SceneUniforms): Mesh {
  const geometry = new SphereGeometry(PLANET_RADIUS, 180, 130);

  const pos = geometry.attributes.position as BufferAttribute;
  const shore = new Float32Array(pos.count);
  const dir = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    dir.fromBufferAttribute(pos, i).normalize();
    shore[i] = heightAt(dir); // negative = depth below this point
  }
  geometry.setAttribute("aShore", new BufferAttribute(shore, 1));

  const material = new ShaderMaterial({
    uniforms: {
      uSunDir: uniforms.uSunDir,
      uTime: uniforms.uTime,
      ...paletteUniforms(uniforms),
    },
    transparent: true,
    vertexShader: /* glsl */ `
      attribute float aShore;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      varying vec3 vDir;
      varying float vShore;

      void main() {
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vDir = normalize(position);
        vShore = aShore;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform float uTime;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      varying vec3 vDir;
      varying float vShore;

      ${NOISE_GLSL}
      ${LIGHT_GLSL}

      vec3 rotateY(vec3 p, float a) {
        float c = cos(a);
        float s = sin(a);
        return vec3(c * p.x + s * p.z, p.y, c * p.z - s * p.x);
      }

      void main() {
        vec3 L = normalize(uSunDir);
        vec3 V = normalize(cameraPosition - vWorldPos);

        // The whole sea streams slowly around the planet, with faster
        // ripples riding on a broad swell.
        float t = uTime;
        vec3 pd = rotateY(vDir, t * 0.014);
        vec3 ripple = vec3(
          snoise(pd * 34.0 + vec3(t * 0.09, 0.0, t * 0.06)),
          snoise(pd * 34.0 + vec3(7.3, t * 0.10, -t * 0.08)),
          snoise(pd * 34.0 + vec3(-t * 0.07, 3.1, t * 0.11))
        );
        vec3 swell = vec3(
          snoise(pd * 7.0 + vec3(t * 0.05, 1.7, 0.0)),
          snoise(pd * 7.0 + vec3(0.0, t * 0.04, 9.4)),
          snoise(pd * 7.0 + vec3(4.2, 0.0, t * 0.06))
        );
        vec3 N = normalize(normalize(vWorldNormal) + ripple * 0.06 + swell * 0.035);

        float ndl = dot(normalize(vWorldNormal), L);
        float band = exp(-pow(ndl / 0.16, 2.0));

        // Depth color: bright shallows at the coast, dark blue open sea.
        float depth = -vShore;
        vec3 shallow = vec3(0.030, 0.19, 0.22);
        vec3 deep = vec3(0.003, 0.030, 0.075);
        vec3 col = mix(shallow, deep, smoothstep(0.002, 0.040, depth));

        // Night-side water goes nearly black with a blue memory.
        float dayness = smoothstep(-0.3, 0.15, ndl);
        col *= mix(0.08, 1.0, dayness);

        // The sky mirrored at grazing angles — this is where the sunset
        // pours onto the sea.
        float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
        col = mix(col, duskRamp(ndl) * 0.85, fres * 0.75);

        // Sun glint, huge and molten when the sun sits on the horizon.
        vec3 R = reflect(-L, N);
        float spec = pow(max(dot(R, V), 0.0), 130.0);
        float vis = smoothstep(-0.03, 0.08, ndl);
        col += sunTint(ndl) * spec * (1.2 + band * 4.0) * vis;

        // Warm sheen across the terminator.
        col += uBlaze * band * 0.10;

        // Foam along the shoreline, broken up and slowly seething.
        float foamZone = smoothstep(-0.007, -0.0006, vShore);
        float seethe = snoise(pd * 95.0 + vec3(0.0, t * 0.3, 0.0));
        float foam = foamZone * smoothstep(0.15, 0.75, 0.5 + 0.5 * seethe + foamZone * 0.35);
        col = mix(col, vec3(0.75, 0.78, 0.80) * (0.25 + dayness), foam * 0.85 * (0.15 + 0.85 * dayness));

        float alpha = 0.94 + fres * 0.05;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  return new Mesh(geometry, material);
}
