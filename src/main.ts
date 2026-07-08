import {
  ACESFilmicToneMapping,
  Clock,
  Color,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

import { createSceneUniforms } from "./uniforms";
import { createPlanet, heightAt, PLANET_RADIUS } from "./scene/planet";
import { createWater } from "./scene/water";
import { createAtmosphere } from "./scene/atmosphere";
import { createClouds } from "./scene/clouds";
import { createSun, DAY_LENGTH } from "./scene/sun";
import { createStars } from "./scene/stars";
import { createSky } from "./scene/sky";
import { CameraRig } from "./controls/cameraRig";
import { mulberry32 } from "./utils";

const uniforms = createSceneUniforms();

const scene = new Scene();
const camera = new PerspectiveCamera(
  42,
  window.innerWidth / window.innerHeight,
  0.1,
  400,
);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

// --- build the world ---
scene.add(createSky(uniforms));
scene.add(createStars(uniforms));
scene.add(createPlanet(uniforms));
scene.add(createWater(uniforms));
scene.add(createAtmosphere(uniforms));

const clouds = createClouds(uniforms);
scene.add(clouds.group);

const sun = createSun();
scene.add(sun.group);
sun.update(0, 0, uniforms.uSunDir.value);

// --- camera: always centered on the top of the world ---
const topRadius = PLANET_RADIUS * (1 + heightAt(new Vector3(0, 1, 0)));
const lookAt = new Vector3(0, topRadius + 0.25, 0);
camera.position
  .set(0.25, 0.55, 0.9)
  .normalize()
  .multiplyScalar(7.8)
  .add(lookAt);
camera.lookAt(lookAt);
const rig = new CameraRig(camera, renderer.domElement, lookAt);

// --- postprocessing: bloom for the sun and glow, gentle vignette ---
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(
  new UnrealBloomPass(
    new Vector2(window.innerWidth, window.innerHeight),
    0.35,
    0.5,
    0.85,
  ),
);
composer.addPass(
  new ShaderPass({
    name: "VignetteShader",
    uniforms: { tDiffuse: { value: null } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        float d = length(vUv - 0.5);
        c.rgb *= mix(1.0, 0.62, smoothstep(0.44, 0.9, d));
        gl_FragColor = c;
      }
    `,
  }),
);
composer.addPass(new OutputPass());

// --- hint overlay ---
const hint = document.getElementById("hint")!;
setTimeout(() => hint.classList.add("visible"), 2500);
rig.controls.addEventListener("start", () => {
  setTimeout(() => hint.classList.remove("visible"), 2500);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// --- a different sunset every day ---
// Each palette is (blaze, gold, dusk): the horizon fire, the high warm
// light, and the twilight band. A new one is drawn after every lap of
// the sun and eased into over a few seconds.
const PALETTES: Array<[string, string, string]> = [
  ["#ff6a2a", "#ffc46b", "#7a3a86"], // classic orange
  ["#e83a2c", "#ff9d4d", "#6b2a5e"], // deep red
  ["#ff4d7e", "#ffb36b", "#8a4a9e"], // magenta
  ["#ff9b52", "#ffd9a0", "#9a5a7e"], // soft peach
  ["#d94f1e", "#f0a03c", "#5a2a50"], // burnt ember
  ["#f2637f", "#ffc9a0", "#7e3a70"], // rose
  ["#ff7f3f", "#ffe0a0", "#4a3a8e"], // gold over indigo
];
const paletteTarget = {
  blaze: new Color(PALETTES[0][0]).convertSRGBToLinear(),
  gold: new Color(PALETTES[0][1]).convertSRGBToLinear(),
  dusk: new Color(PALETTES[0][2]).convertSRGBToLinear(),
};
let currentDay = 0;

function onNewDay(day: number) {
  const pick = Math.floor(mulberry32(day * 7919 + 17)() * PALETTES.length);
  const [blaze, gold, dusk] = PALETTES[pick];
  paletteTarget.blaze.set(blaze).convertSRGBToLinear();
  paletteTarget.gold.set(gold).convertSRGBToLinear();
  paletteTarget.dusk.set(dusk).convertSRGBToLinear();
}

// --- main loop ---
const clock = new Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const elapsed = clock.elapsedTime;

  uniforms.uTime.value = elapsed;
  sun.update(dt, elapsed, uniforms.uSunDir.value);
  clouds.update(dt, elapsed);
  rig.update(dt, elapsed);

  const day = Math.floor(elapsed / DAY_LENGTH);
  if (day !== currentDay) {
    currentDay = day;
    onNewDay(day);
  }
  const paletteEase = 1 - Math.exp(-dt * 0.4);
  uniforms.uBlaze.value.lerp(paletteTarget.blaze, paletteEase);
  uniforms.uGold.value.lerp(paletteTarget.gold, paletteEase);
  uniforms.uDusk.value.lerp(paletteTarget.dusk, paletteEase);

  composer.render();
});
