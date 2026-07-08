import { MathUtils, PerspectiveCamera, Spherical, Vector3 } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/**
 * OrbitControls pinned to the top of the planet, with an auto tour that
 * drifts the camera when the user is idle. The instant the user grabs the
 * scene the tour lets go (blend drops to 0); after `idleDelay` seconds of
 * stillness it eases back in from wherever the camera was left, so there
 * is never a jump.
 */
export class CameraRig {
  readonly controls: OrbitControls;
  idleDelay = 9;

  private readonly camera: PerspectiveCamera;
  private readonly target: Vector3;
  private readonly sph = new Spherical();
  private readonly offset = new Vector3();
  private holding = false;
  private lastInteraction = -Infinity;
  private blend = 0;

  constructor(camera: PerspectiveCamera, dom: HTMLElement, target: Vector3) {
    this.camera = camera;
    this.target = target.clone();

    const controls = new OrbitControls(camera, dom);
    controls.target.copy(target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 3.2;
    controls.maxDistance = 30;
    controls.minPolarAngle = 0.12;
    controls.maxPolarAngle = 1.62;
    this.controls = controls;

    controls.addEventListener("start", () => {
      this.holding = true;
      this.blend = 0;
    });
    controls.addEventListener("end", () => {
      this.holding = false;
      this.lastInteraction = performance.now() / 1000;
    });
  }

  get touring(): boolean {
    return (
      !this.holding &&
      performance.now() / 1000 - this.lastInteraction > this.idleDelay
    );
  }

  update(dt: number, elapsed: number): void {
    this.controls.update();

    if (this.touring) {
      this.blend = Math.min(1, this.blend + dt / 3);
    }
    const w = this.blend * this.blend * (3 - 2 * this.blend);
    if (w <= 0) return;

    this.offset.copy(this.camera.position).sub(this.target);
    this.sph.setFromVector3(this.offset);

    // Steady drift around the planet; breathe in polar angle and distance.
    this.sph.theta += 0.05 * dt * w;
    const wantPhi = 1.02 + Math.sin(elapsed * 0.1) * 0.34;
    const wantRadius = 8.5 + Math.sin(elapsed * 0.067 + 1.7) * 3.5;
    const k = 1 - Math.exp(-dt * 0.25 * w);
    this.sph.phi += (wantPhi - this.sph.phi) * k;
    this.sph.radius += (wantRadius - this.sph.radius) * k;
    this.sph.phi = MathUtils.clamp(this.sph.phi, 0.3, 1.5);
    this.sph.makeSafe();

    this.offset.setFromSpherical(this.sph);
    this.camera.position.copy(this.target).add(this.offset);
    this.camera.lookAt(this.target);
  }
}
