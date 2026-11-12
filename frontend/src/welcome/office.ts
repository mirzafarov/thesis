// Shared dimensions of the 3D office (metres) and helpers used by the scene.
import * as THREE from 'three';

export const DESK_TOP_Y = 0.74;

// Laptop: a 16:10 screen 0.40 m wide, hinge at the back of the base, lid tilted back ~15°.
export const SCREEN = { width: 0.4, height: 0.25, tilt: -0.26 };
export const HINGE = new THREE.Vector3(0, DESK_TOP_Y + 0.016, -0.61);

// Resolution of the HTML interface shown on the laptop (CSS pixels, 16:10).
export const SCREEN_PX = { width: 640, height: 400 };

/** Centre and outward normal of the laptop screen in world space. */
export function screenFrame() {
  const lid = new THREE.Object3D();
  lid.position.copy(HINGE);
  lid.rotation.x = SCREEN.tilt;
  lid.updateMatrixWorld();
  const center = new THREE.Vector3(0, SCREEN.height / 2 + 0.01, 0.006).applyMatrix4(lid.matrixWorld);
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(lid.quaternion).normalize();
  return { center, normal, quaternion: lid.quaternion.clone() };
}

// Camera resting position: about 1.1 m behind the person, above the right shoulder, looking at the screen.
export const CAMERA_REST = new THREE.Vector3(0.62, 1.68, 1.05);
export const CAMERA_INTRO_START = new THREE.Vector3(1.0, 1.95, 3.1);

/** Vertical field of view that keeps the laptop well framed on any screen shape (wide desktop or tall phone). */
export function fovFor(aspect: number) {
  if (aspect >= 1.2) return 30;
  // Narrow screens: widen the view so the laptop screen still fits the width (~78% of it).
  const dist = CAMERA_REST.distanceTo(screenFrame().center);
  const visibleWidth = SCREEN.width / 0.78;
  const fovRad = 2 * Math.atan(visibleWidth / aspect / (2 * dist));
  return Math.min(62, Math.max(30, THREE.MathUtils.radToDeg(fovRad)));
}

/** A capsule mesh transform spanning two points (for arms, legs …). */
export function limbBetween(a: THREE.Vector3, b: THREE.Vector3) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const length = dir.length();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  const position = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  return { position, quaternion, length };
}

/** A night city skyline painted on a canvas (seen through the office window, slightly out of focus). */
export function makeSkylineTexture() {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 768;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, c.height);
  sky.addColorStop(0, '#05060f');
  sky.addColorStop(0.55, '#141a3d');
  sky.addColorStop(1, '#2a1b4d');
  g.fillStyle = sky;
  g.fillRect(0, 0, c.width, c.height);

  // Deterministic pseudo-random numbers, so the skyline looks the same on every load.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  for (let layer = 0; layer < 3; layer++) {
    const shade = ['#0b0f24', '#080b1c', '#05070f'][layer]!;
    let x = -20;
    while (x < c.width) {
      const w = 50 + rand() * 120;
      const h = (0.25 + rand() * 0.45) * c.height * (1 - layer * 0.12);
      const top = c.height - h;
      g.fillStyle = shade;
      g.fillRect(x, top, w, h);
      // Lit windows
      for (let wy = top + 10; wy < c.height - 8; wy += 14) {
        for (let wx = x + 6; wx < x + w - 6; wx += 11) {
          if (rand() < 0.28 - layer * 0.06) {
            const warm = rand() < 0.35;
            g.fillStyle = warm ? `rgba(255,${190 + rand() * 40},${120 + rand() * 40},${0.5 + rand() * 0.4})` : `rgba(${120 + rand() * 60},${160 + rand() * 60},255,${0.45 + rand() * 0.45})`;
            g.fillRect(wx, wy, 5, 7);
          }
        }
      }
      x += w + 4 + rand() * 18;
    }
  }
  // Soft haze over the city
  const haze = g.createLinearGradient(0, c.height * 0.45, 0, c.height);
  haze.addColorStop(0, 'rgba(90,70,200,0)');
  haze.addColorStop(1, 'rgba(90,70,200,0.25)');
  g.fillStyle = haze;
  g.fillRect(0, 0, c.width, c.height);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
