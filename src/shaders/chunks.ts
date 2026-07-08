import type { SceneUniforms } from "../uniforms";

/**
 * Ashima/webgl-noise simplex 3D — used in fragment shaders for procedural
 * surface detail (grass speckle, rock striation, water ripples, foam).
 */
export const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

/**
 * The lighting vocabulary shared by every material. The three palette
 * colors are uniforms so each "day" can bring a different sunset:
 *
 *   duskRamp(ndl) — sky/atmosphere color for a given sun elevation:
 *     night blue -> twilight violet -> horizon blaze -> gold -> day blue
 *   sunTint(ndl) — color of direct sunlight: blaze red at the horizon,
 *     warm white overhead.
 */
export const LIGHT_GLSL = /* glsl */ `
uniform vec3 uBlaze;
uniform vec3 uGold;
uniform vec3 uDusk;

vec3 duskRamp(float ndl) {
  vec3 night = vec3(0.030, 0.040, 0.130);
  vec3 day   = vec3(0.400, 0.680, 0.980);

  vec3 c = night;
  c = mix(c, uDusk,         smoothstep(-0.42, -0.15, ndl));
  c = mix(c, uBlaze,        smoothstep(-0.15, -0.005, ndl));
  c = mix(c, uGold,         smoothstep(-0.005, 0.20, ndl));
  c = mix(c, day,           smoothstep(0.20, 0.58, ndl));
  return c;
}

vec3 sunTint(float ndl) {
  vec3 high = vec3(1.0, 0.96, 0.88);
  vec3 mid = mix(uGold, vec3(1.0, 0.80, 0.55), 0.35);
  vec3 low = mix(uBlaze, uGold, 0.3);
  vec3 c = mix(low, mid, smoothstep(-0.04, 0.22, ndl));
  return mix(c, high, smoothstep(0.22, 0.60, ndl));
}
`;

/** Uniform bindings that must accompany LIGHT_GLSL in every material. */
export function paletteUniforms(u: SceneUniforms) {
  return {
    uBlaze: u.uBlaze,
    uGold: u.uGold,
    uDusk: u.uDusk,
  };
}
