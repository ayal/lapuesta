import { Color, Vector3 } from "three";

/**
 * Uniforms shared by every material in the scene. The objects are passed by
 * reference into each ShaderMaterial, so updating them once per frame in the
 * main loop updates every shader.
 *
 * uBlaze/uGold/uDusk are the sunset palette of the current "day"; main.ts
 * eases them toward a new randomly chosen palette after every lap of the sun.
 */
export interface SceneUniforms {
  uTime: { value: number };
  uSunDir: { value: Vector3 };
  uBlaze: { value: Color };
  uGold: { value: Color };
  uDusk: { value: Color };
}

export function createSceneUniforms(): SceneUniforms {
  return {
    uTime: { value: 0 },
    uSunDir: { value: new Vector3(1, 0, 0) },
    uBlaze: { value: new Color("#ff6a2a").convertSRGBToLinear() },
    uGold: { value: new Color("#ffc46b").convertSRGBToLinear() },
    uDusk: { value: new Color("#7a3a86").convertSRGBToLinear() },
  };
}
