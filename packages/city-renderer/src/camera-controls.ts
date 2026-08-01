import { Euler, MathUtils, PerspectiveCamera, Spherical, Vector2, Vector3 } from 'three';

export type CameraMode = 'orbit' | 'fly';

const EPS = 1e-4;
const _euler = new Euler();
const _dir = new Vector3();
const _right = new Vector3();
const _move = new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * One rig, two modes.
 *
 * Orbit: LMB drag rotates around `target`, RMB/2-finger pans it, wheel dollies.
 * Fly: pointer-lock mouse look with WASD/QE, shift to sprint. Both modes share
 * the same camera and hand over the pose on toggle, so switching never jumps.
 */
export class CameraRig {
  mode: CameraMode = 'orbit';
  readonly target = new Vector3();

  minDistance = 2;
  maxDistance = 4000;
  orbitSpeed = 0.0045;
  panSpeed = 1;
  zoomSpeed = 0.9;
  flySpeed = 40;
  lookSpeed = 0.0022;
  damping = 0.12;

  private readonly camera: PerspectiveCamera;
  private readonly dom: HTMLElement;
  private readonly spherical = new Spherical();
  private readonly sphericalDelta = new Spherical(0, 0, 0);
  private readonly panOffset = new Vector3();
  private readonly pointers = new Map<number, Vector2>();
  private readonly keys = new Set<string>();
  private readonly euler = { yaw: 0, pitch: 0 };
  private readonly velocity = new Vector3();
  private dollyScale = 1;
  private dragButton = -1;
  private pointerLocked = false;
  private enabled = true;
  private disposed = false;

  constructor(camera: PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera;
    this.dom = dom;
    dom.style.touchAction = 'none';
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('pointercancel', this.onPointerUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.syncFromCamera();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.keys.clear();
      this.pointers.clear();
      this.velocity.set(0, 0, 0);
      if (this.pointerLocked) document.exitPointerLock();
    }
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'fly') {
      this.camera.getWorldDirection(_dir);
      this.euler.yaw = Math.atan2(-_dir.x, -_dir.z);
      this.euler.pitch = Math.asin(MathUtils.clamp(_dir.y, -1, 1));
      this.velocity.set(0, 0, 0);
    } else {
      // Re-anchor the orbit target in front of wherever we flew to.
      this.camera.getWorldDirection(_dir);
      const distance = Math.min(this.maxDistance, Math.max(this.minDistance, 60));
      this.target.copy(this.camera.position).addScaledVector(_dir, distance);
      this.syncFromCamera();
    }
  }

  toggleMode(): CameraMode {
    this.setMode(this.mode === 'orbit' ? 'fly' : 'orbit');
    return this.mode;
  }

  /** Places the camera at `position` looking at `target` (orbit mode). */
  setView(position: Vector3, target: Vector3): void {
    this.camera.position.copy(position);
    this.target.copy(target);
    this.camera.lookAt(this.target);
    this.syncFromCamera();
  }

  private syncFromCamera(): void {
    _dir.copy(this.camera.position).sub(this.target);
    this.spherical.setFromVector3(_dir);
    this.sphericalDelta.set(0, 0, 0);
    this.panOffset.set(0, 0, 0);
    this.dollyScale = 1;
  }

  update(dt: number): void {
    if (this.mode === 'orbit') this.updateOrbit(dt);
    else this.updateFly(dt);
  }

  private updateOrbit(_dt: number): void {
    this.spherical.theta += this.sphericalDelta.theta;
    this.spherical.phi += this.sphericalDelta.phi;
    this.spherical.phi = MathUtils.clamp(this.spherical.phi, EPS, Math.PI / 2 - 0.02);
    this.spherical.radius = MathUtils.clamp(
      this.spherical.radius * this.dollyScale,
      this.minDistance,
      this.maxDistance,
    );
    this.target.add(this.panOffset);
    this.camera.position.setFromSpherical(this.spherical).add(this.target);
    this.camera.lookAt(this.target);

    const decay = 1 - this.damping;
    this.sphericalDelta.theta *= decay;
    this.sphericalDelta.phi *= decay;
    this.panOffset.multiplyScalar(decay);
    this.dollyScale = 1;
  }

  private updateFly(dt: number): void {
    _euler.set(this.euler.pitch, this.euler.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(_euler);

    const keys = this.keys;
    const fx = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const fz = (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0);
    const fy =
      (keys.has('KeyE') || keys.has('Space') ? 1 : 0) -
      (keys.has('KeyQ') || keys.has('ControlLeft') ? 1 : 0);
    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4 : 1;

    _dir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    _right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    _move.set(0, 0, 0).addScaledVector(_dir, -fz).addScaledVector(_right, fx).addScaledVector(UP, fy);
    if (_move.lengthSq() > 0) _move.normalize().multiplyScalar(this.flySpeed * sprint);

    // Critically-ish damped approach so key taps do not snap the camera.
    const blend = 1 - Math.exp(-dt * 12);
    this.velocity.lerp(_move, blend);
    this.camera.position.addScaledVector(this.velocity, dt);
  }

  private onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled) return;
    this.dom.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, new Vector2(event.clientX, event.clientY));
    this.dragButton = event.button;
    if (this.mode === 'fly' && !this.pointerLocked) void this.dom.requestPointerLock();
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.enabled) return;
    if (this.mode === 'fly') {
      if (!this.pointerLocked) return;
      this.euler.yaw -= event.movementX * this.lookSpeed;
      this.euler.pitch = MathUtils.clamp(
        this.euler.pitch - event.movementY * this.lookSpeed,
        -Math.PI / 2 + 0.01,
        Math.PI / 2 - 0.01,
      );
      return;
    }
    const previous = this.pointers.get(event.pointerId);
    if (!previous) return;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    previous.set(event.clientX, event.clientY);
    if (this.pointers.size >= 2) {
      this.pan(dx, dy);
    } else if (this.dragButton === 0 && !event.shiftKey) {
      this.sphericalDelta.theta -= dx * this.orbitSpeed;
      this.sphericalDelta.phi -= dy * this.orbitSpeed;
    } else {
      this.pan(dx, dy);
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size === 0) this.dragButton = -1;
    if (this.dom.hasPointerCapture(event.pointerId)) this.dom.releasePointerCapture(event.pointerId);
  };

  private pan(dx: number, dy: number): void {
    const height = this.dom.clientHeight || 1;
    const scale =
      (2 * this.spherical.radius * Math.tan(MathUtils.degToRad(this.camera.fov * 0.5))) / height;
    this.camera.getWorldDirection(_dir);
    _right.crossVectors(_dir, UP).normalize();
    _move.copy(_right).multiplyScalar(-dx * scale * this.panSpeed);
    const forward = _dir.clone().setY(0).normalize();
    _move.addScaledVector(forward, -dy * scale * this.panSpeed);
    this.panOffset.add(_move);
  }

  private onWheel = (event: WheelEvent): void => {
    if (!this.enabled) return;
    event.preventDefault();
    const factor = Math.pow(0.95, this.zoomSpeed);
    if (this.mode === 'orbit') {
      this.dollyScale *= event.deltaY > 0 ? 1 / factor : factor;
    } else {
      this.flySpeed = MathUtils.clamp(this.flySpeed * (event.deltaY > 0 ? 0.9 : 1.1), 1, 800);
    }
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled) return;
    this.keys.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.dom;
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dom.removeEventListener('pointerdown', this.onPointerDown);
    this.dom.removeEventListener('pointermove', this.onPointerMove);
    this.dom.removeEventListener('pointerup', this.onPointerUp);
    this.dom.removeEventListener('pointercancel', this.onPointerUp);
    this.dom.removeEventListener('wheel', this.onWheel);
    this.dom.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    if (this.pointerLocked) document.exitPointerLock();
  }
}
