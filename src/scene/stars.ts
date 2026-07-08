import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
} from "three";
import { mulberry32, randRange } from "../utils";
import type { SceneUniforms } from "../uniforms";

/** Twinkling stars on a far shell, animated entirely on the GPU. */
export function createStars(uniforms: SceneUniforms, count = 1400): Points {
  const rng = mulberry32(505);

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const speeds = new Float32Array(count);
  const sizes = new Float32Array(count);

  const c = new Color();
  for (let i = 0; i < count; i++) {
    // Uniform point on a sphere shell.
    const u = rng() * 2 - 1;
    const theta = rng() * Math.PI * 2;
    const r = randRange(rng, 55, 105);
    const s = Math.sqrt(1 - u * u);
    positions[i * 3] = r * s * Math.cos(theta);
    positions[i * 3 + 1] = r * u;
    positions[i * 3 + 2] = r * s * Math.sin(theta);

    // Mostly cool white, occasionally warm.
    const warm = rng() > 0.82;
    c.setHSL(warm ? 0.09 : 0.62, warm ? 0.55 : 0.25, randRange(rng, 0.55, 0.9));
    c.convertSRGBToLinear();
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;

    phases[i] = rng() * Math.PI * 2;
    speeds[i] = randRange(rng, 0.3, 1.6);
    sizes[i] = randRange(rng, 0.8, 2.4);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setAttribute("aPhase", new BufferAttribute(phases, 1));
  geometry.setAttribute("aSpeed", new BufferAttribute(speeds, 1));
  geometry.setAttribute("aSize", new BufferAttribute(sizes, 1));

  const material = new ShaderMaterial({
    uniforms: { uTime: uniforms.uTime },
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aPhase;
      attribute float aSpeed;
      attribute float aSize;
      uniform float uTime;
      varying vec3 vColor;
      varying float vTwinkle;

      void main() {
        vColor = color;
        vTwinkle = 0.62 + 0.38 * sin(uTime * aSpeed + aPhase);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * vTwinkle * (260.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vTwinkle;

      void main() {
        float d = length(gl_PointCoord - 0.5);
        float alpha = smoothstep(0.5, 0.12, d) * vTwinkle;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
  });

  return new Points(geometry, material);
}
