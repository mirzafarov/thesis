// The cinematic 3D office: an employee at a laptop seen over the shoulder, the Safe Zone welcome screen on the
// display, chrome liquid shapes, and the camera move + liquid morph into the login page.
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Float, Lightformer, MeshDistortMaterial, RoundedBox, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import gsap from 'gsap';
import Person from './Person';
import ScreenUI from './ScreenUI';
import type { AuthTarget } from './ScreenUI';
import LiquidOverlay from './LiquidOverlay';
import { quadToCss } from './projectQuad';

type Pt = { x: number; y: number };
import type { OverlayState } from './LiquidOverlay';
import {
  CAMERA_INTRO_START, CAMERA_REST, DESK_TOP_Y, HINGE, SCREEN, SCREEN_PX, fovFor, makeSkylineTexture, screenFrame,
} from './office';

interface SceneProps {
  target: AuthTarget | null;
  onChoose: (target: AuthTarget) => void;
  onTransitionDone: (target: AuthTarget) => void;
  reducedMotion: boolean;
}

// ---------- Environment ----------

/** A spotlight aimed at a point (its target object is part of the scene, so the direction updates). */
function AimedSpot({ target, ...props }: { position: [number, number, number]; target: [number, number, number]; angle: number; penumbra: number; intensity: number; color: string }) {
  const aim = useMemo(() => { const o = new THREE.Object3D(); o.position.set(...target); return o; }, [target]);
  return (
    <>
      <primitive object={aim} />
      <spotLight {...props} target={aim} />
    </>
  );
}

function Office() {
  const skyline = useMemo(() => makeSkylineTexture(), []);
  useEffect(() => () => skyline.dispose(), [skyline]);

  return (
    <group>
      {/* Polished dark floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[14, 14]} />
        <meshStandardMaterial color="#0a0d1c" roughness={0.38} metalness={0.4} />
      </mesh>
      {/* Back wall with a large window over the night city */}
      <mesh position={[0, 2, -3.2]}>
        <planeGeometry args={[14, 4]} />
        <meshStandardMaterial color="#0c1024" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.65, -3.18]}>
        <planeGeometry args={[6.4, 2.4]} />
        <meshBasicMaterial map={skyline} toneMapped={false} color="#c9d2ff" />
      </mesh>
      {/* Window mullions */}
      {[-3.2, -1.07, 1.07, 3.2].map(x => (
        <mesh key={x} position={[x, 1.65, -3.16]}>
          <boxGeometry args={[0.06, 2.45, 0.05]} />
          <meshStandardMaterial color="#05060d" roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, 0.45, -3.16]}>
        <boxGeometry args={[6.5, 0.06, 0.05]} />
        <meshStandardMaterial color="#05060d" />
      </mesh>
      {/* Side wall with a vertical neon accent */}
      <mesh position={[-3.2, 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[8, 4]} />
        <meshStandardMaterial color="#0b0e20" roughness={0.85} />
      </mesh>
      <mesh position={[-3.18, 1.6, -1.2]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[0.05, 2.4]} />
        <meshBasicMaterial color="#7c5cff" toneMapped={false} />
      </mesh>
      {/* Ceiling light strips */}
      {[-1.4, 0, 1.4].map(x => (
        <mesh key={x} position={[x, 3.1, -1]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.08, 2.2]} />
          <meshBasicMaterial color="#9fb6ff" toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function Desk() {
  return (
    <group>
      <RoundedBox args={[1.7, 0.04, 0.82]} radius={0.012} position={[0, DESK_TOP_Y - 0.02, -0.56]} castShadow receiveShadow>
        <meshStandardMaterial color="#2a1d17" roughness={0.42} metalness={0.05} />
      </RoundedBox>
      {[-0.78, 0.78].map(x => (
        <mesh key={x} position={[x, (DESK_TOP_Y - 0.04) / 2, -0.56]} castShadow>
          <boxGeometry args={[0.04, DESK_TOP_Y - 0.04, 0.7]} />
          <meshStandardMaterial color="#1a1c24" metalness={0.8} roughness={0.35} />
        </mesh>
      ))}
      {/* Coffee mug */}
      <group position={[0.5, DESK_TOP_Y, -0.82]}>
        <mesh position={[0, 0.045, 0]} castShadow>
          <cylinderGeometry args={[0.038, 0.034, 0.09, 32]} />
          <meshStandardMaterial color="#e9ecf5" roughness={0.3} />
        </mesh>
        <mesh position={[0.045, 0.05, 0]} rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[0.022, 0.006, 8, 20]} />
          <meshStandardMaterial color="#e9ecf5" roughness={0.3} />
        </mesh>
      </group>
      {/* Notebook and pen */}
      <group position={[-0.47, DESK_TOP_Y + 0.006, -0.4]} rotation={[0, 0.25, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.16, 0.012, 0.22]} />
          <meshStandardMaterial color="#1f2a52" roughness={0.6} />
        </mesh>
        <mesh position={[0.03, 0.009, 0]} rotation={[0, 0.4, Math.PI / 2]}>
          <cylinderGeometry args={[0.004, 0.004, 0.14, 8]} />
          <meshStandardMaterial color="#c0c6d8" metalness={0.9} roughness={0.2} />
        </mesh>
      </group>
      {/* Small plant */}
      <group position={[-0.68, DESK_TOP_Y, -0.78]}>
        <mesh position={[0, 0.06, 0]} castShadow>
          <cylinderGeometry args={[0.055, 0.045, 0.12, 24]} />
          <meshStandardMaterial color="#d9d6cf" roughness={0.8} />
        </mesh>
        {[0, 1, 2, 3, 4, 5, 6].map(i => (
          <mesh key={i} position={[Math.cos(i * 0.9) * 0.035, 0.17 + (i % 3) * 0.03, Math.sin(i * 0.9) * 0.035]} rotation={[Math.cos(i) * 0.6, i, Math.sin(i) * 0.6]} scale={[0.5, 1.4, 0.15]}>
            <sphereGeometry args={[0.045, 12, 8]} />
            <meshStandardMaterial color="#2f6b4a" roughness={0.7} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Chair() {
  return (
    <group position={[0, 0, 0.24]}>
      {/* Mesh backrest, partly hidden by the person */}
      <RoundedBox args={[0.5, 0.6, 0.05]} radius={0.04} position={[0, 0.86, 0.04]} rotation={[0.12, 0, 0]} castShadow>
        <meshStandardMaterial color="#14161f" roughness={0.85} />
      </RoundedBox>
      <RoundedBox args={[0.5, 0.07, 0.5]} radius={0.03} position={[0, 0.47, -0.18]} castShadow>
        <meshStandardMaterial color="#14161f" roughness={0.85} />
      </RoundedBox>
      <mesh position={[0, 0.24, -0.15]}>
        <cylinderGeometry args={[0.025, 0.025, 0.42, 16]} />
        <meshStandardMaterial color="#2b2f3c" metalness={0.9} roughness={0.25} />
      </mesh>
      {[0, 1, 2, 3, 4].map(i => (
        <mesh key={i} position={[Math.cos((i / 5) * Math.PI * 2) * 0.16, 0.05, -0.15 + Math.sin((i / 5) * Math.PI * 2) * 0.16]} rotation={[0, -(i / 5) * Math.PI * 2, Math.PI / 2]}>
          <capsuleGeometry args={[0.014, 0.3, 4, 8]} />
          <meshStandardMaterial color="#2b2f3c" metalness={0.9} roughness={0.25} />
        </mesh>
      ))}
    </group>
  );
}

function Laptop() {
  const aluminium = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#9aa3b5', metalness: 0.9, roughness: 0.28, clearcoat: 0.3 }), []);
  return (
    <group>
      {/* Base with keyboard area and trackpad */}
      <RoundedBox args={[0.4, 0.016, 0.28]} radius={0.006} position={[0, DESK_TOP_Y + 0.008, -0.47]} material={aluminium} castShadow receiveShadow />
      <mesh position={[0, DESK_TOP_Y + 0.0165, -0.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.35, 0.12]} />
        <meshStandardMaterial color="#141722" roughness={0.6} />
      </mesh>
      <mesh position={[0, DESK_TOP_Y + 0.0166, -0.39]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.13, 0.08]} />
        <meshStandardMaterial color="#8a93a6" roughness={0.35} metalness={0.6} />
      </mesh>
      {/* Lid, hinged at the back and tilted back ~15° */}
      <group position={HINGE} rotation={[SCREEN.tilt, 0, 0]}>
        <RoundedBox args={[SCREEN.width + 0.012, SCREEN.height + 0.03, 0.008]} radius={0.004} position={[0, SCREEN.height / 2 + 0.01, -0.002]} material={aluminium} castShadow />
        {/* Glowing panel behind the interface */}
        <mesh position={[0, SCREEN.height / 2 + 0.01, 0.0025]}>
          <planeGeometry args={[SCREEN.width, SCREEN.height]} />
          <meshBasicMaterial color="#0d1433" toneMapped={false} />
        </mesh>
      </group>
      {/* Light cast by the display onto the hands, keyboard and person */}
      <pointLight position={[0, 0.9, -0.5]} intensity={1.6} distance={1.3} decay={2} color="#9ec5ff" />
    </group>
  );
}

// ---------- Liquid chrome shapes ----------

const BLOBS = [
  { home: [-0.34, 0.97, -0.86], size: 0.07, color: '#8fb3ff', speed: 1.6 },
  { home: [0.31, 0.8, -0.62], size: 0.05, color: '#b69cff', speed: 2.1 },
  { home: [0.24, 1.13, -0.98], size: 0.045, color: '#9fd0ff', speed: 1.8 },
  { home: [-1.5, 1.95, -2.7], size: 0.2, color: '#6d4dff', speed: 0.9 },
] as const;

function LiquidBlobs({ groups, reducedMotion }: { groups: React.RefObject<(THREE.Group | null)[]>; reducedMotion: boolean }) {
  return (
    <>
      {BLOBS.map((b, i) => (
        <group key={i} ref={el => { groups.current![i] = el; }} position={b.home as unknown as THREE.Vector3Tuple}>
          <Float speed={reducedMotion ? 0 : 1.2} rotationIntensity={0.4} floatIntensity={0.6} floatingRange={[-0.02, 0.02]}>
            <mesh castShadow={i < 3}>
              <icosahedronGeometry args={[b.size, 24]} />
              <MeshDistortMaterial
                color={b.color}
                metalness={0.85}
                roughness={i === 3 ? 0.3 : 0.08}
                emissive={b.color}
                emissiveIntensity={i === 3 ? 0.35 : 0.18}
                clearcoat={1}
                clearcoatRoughness={0.05}
                distort={reducedMotion ? 0.15 : 0.42}
                speed={reducedMotion ? 0 : b.speed}
                envMapIntensity={2.2}
                transparent={i === 3}
                opacity={i === 3 ? 0.55 : 1}
              />
            </mesh>
          </Float>
        </group>
      ))}
    </>
  );
}

// ---------- Camera, intro and the transition ----------

function Director({ target, onTransitionDone, reducedMotion, overlay, blobs, screenLayer }: {
  target: AuthTarget | null;
  onTransitionDone: (t: AuthTarget) => void;
  reducedMotion: boolean;
  overlay: OverlayState;
  blobs: React.RefObject<(THREE.Group | null)[]>;
  screenLayer: React.RefObject<HTMLDivElement | null>;
}) {
  const camera = useThree(s => s.camera) as THREE.PerspectiveCamera;
  const size = useThree(s => s.size);
  const pointer = useThree(s => s.pointer);
  const frame = useMemo(() => screenFrame(), []);
  const look = useRef(frame.center.clone().add(new THREE.Vector3(0, 0.02, 0)));
  const rig = useRef({ base: (reducedMotion ? CAMERA_REST : CAMERA_INTRO_START).clone(), parallax: !reducedMotion, transitioning: false });
  const corners = useMemo(() => {
    const lid = new THREE.Object3D();
    lid.position.copy(HINGE);
    lid.rotation.x = SCREEN.tilt;
    lid.updateMatrixWorld();
    const w = SCREEN.width / 2, y0 = 0.01, y1 = SCREEN.height + 0.01;
    // top-left, top-right, bottom-right, bottom-left of the display
    return [[-w, y1], [w, y1], [w, y0], [-w, y0]].map(([x, y]) => new THREE.Vector3(x, y, 0.004).applyMatrix4(lid.matrixWorld));
  }, []);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  // Framing for the screen shape (wider view on tall phone screens)
  useLayoutEffect(() => {
    camera.fov = fovFor(size.width / size.height);
    camera.updateProjectionMatrix();
  }, [camera, size]);

  // Intro: the viewer approaches the employee from behind
  useEffect(() => {
    if (reducedMotion) return;
    const tween = gsap.to(rig.current.base, { x: CAMERA_REST.x, y: CAMERA_REST.y, z: CAMERA_REST.z, duration: 3.2, ease: 'power2.out', delay: 0.2 });
    return () => { tween.kill(); };
  }, [reducedMotion]);

  // Sign In / Create Account: fly into the screen while liquid flows out of it, then hand over to the real page
  useEffect(() => {
    if (!target) return;
    rig.current.transitioning = true;
    rig.current.parallax = false;
    gsap.killTweensOf(rig.current.base);

    if (reducedMotion) {
      gsap.to(overlay, { progress: 1, duration: 0.45, ease: 'power1.inOut', onComplete: () => onTransitionDone(target) });
      return;
    }

    // End position: straight in front of the display, close enough that it fills the view
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const fill = (SCREEN.height / 2) / Math.tan(fov / 2);
    const end = frame.center.clone().addScaledVector(frame.normal, fill * 0.62);
    // Curved path: rise slightly over the right shoulder, then glide down in front of the display
    const start = rig.current.base.clone();
    const control = new THREE.Vector3(0.35, 1.45, 0.05);
    const path = new THREE.QuadraticBezierCurve3(start, control, end);
    const along = { t: 0 };
    const tl = gsap.timeline({ onComplete: () => onTransitionDone(target) });
    tl.to(along, { t: 1, duration: 1.8, ease: 'power3.inOut', onUpdate: () => { rig.current.base.copy(path.getPoint(along.t)); } }, 0)
      .to(look.current, { x: frame.center.x, y: frame.center.y, z: frame.center.z, duration: 1.2, ease: 'power2.inOut' }, 0);
    // Liquid shapes are drawn to the corners of the display
    corners.forEach((c, i) => {
      const g = blobs.current?.[i];
      if (!g || i > 2) return;
      tl.to(g.position, { x: c.x * 1.05, y: c.y, z: c.z + 0.02, duration: 1.1, ease: 'power2.inOut' }, 0.15)
        .to(g.scale, { x: 1.5, y: 1.5, z: 1.5, duration: 1.1, ease: 'power2.inOut' }, 0.15);
    });
    tl.to(overlay, { progress: 0.32, duration: 0.7, ease: 'sine.inOut' }, 0.55)
      .to(overlay, { progress: 1, duration: 1.0, ease: 'power2.in' }, 1.15);
    return () => { tl.kill(); };
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps -- runs once per chosen target

  useFrame(() => {
    const r = rig.current;
    // Gentle parallax following the mouse (not during transitions)
    const px = r.parallax ? pointer.x * 0.06 : 0;
    const py = r.parallax ? pointer.y * 0.03 : 0;
    camera.position.lerp(tmp.set(r.base.x + px, r.base.y + py, r.base.z), r.transitioning ? 1 : 0.06);
    camera.lookAt(look.current);

    // Where the display is on the view: for the liquid overlay, and to place the real interface onto it
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    const pts: { x: number; y: number }[] = [];
    for (const c of corners) {
      tmp.copy(c).project(camera);
      const x = (tmp.x + 1) / 2, y = (tmp.y + 1) / 2;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      pts.push({ x: x * size.width, y: (1 - y) * size.height });
    }
    overlay.rect.set(minX, minY, maxX, maxY);
    const el = screenLayer.current;
    if (el) {
      const css = quadToCss(SCREEN_PX.width, SCREEN_PX.height, pts as [Pt, Pt, Pt, Pt]);
      if (css) el.style.transform = css;
      el.style.visibility = css ? 'visible' : 'hidden';
    }
  });

  return null;
}

export default function Scene({ target, onChoose, onTransitionDone, reducedMotion }: SceneProps) {
  const overlay = useMemo<OverlayState>(() => ({ progress: 0, rect: new THREE.Vector4(0.4, 0.4, 0.6, 0.6) }), []);
  // Development only: lets the liquid overlay be frozen at a stage for visual checks (window.__szOverlay.progress = 0.3)
  if (import.meta.env.DEV) (window as unknown as { __szOverlay?: OverlayState }).__szOverlay = overlay;
  const blobs = useRef<(THREE.Group | null)[]>([]);
  const leavingRef = useRef<AuthTarget | null>(null);
  const screenLayer = useRef<HTMLDivElement>(null);
  const choose = (t: AuthTarget) => {
    if (leavingRef.current) return;
    leavingRef.current = t;
    onChoose(t);
  };

  return (
    <>
    <Canvas
      className="sz-canvas"
      shadows="percentage"
      dpr={[1, 1.75]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: 26, near: 0.05, far: 60, position: (reducedMotion ? CAMERA_REST : CAMERA_INTRO_START).toArray() }}
      onCreated={({ gl }) => { gl.toneMappingExposure = 1.05; }}
    >
      <color attach="background" args={['#05060f']} />
      <fog attach="fog" args={['#05060f', 4, 12]} />

      {/* Cinematic lighting: cool key from the window, violet fill, blue rim on the shoulders */}
      <ambientLight intensity={0.18} color="#6a74ff" />
      <hemisphereLight args={['#4c6dff', '#2a0f4f', 0.35]} />
      <spotLight position={[-1.6, 2.8, 0.8]} angle={0.55} penumbra={0.9} intensity={9} color="#9b7bff" castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} />
      {/* Rim light from the window side: outlines hair and shoulders against the dark room */}
      <AimedSpot position={[0.35, 1.95, -1.1]} target={[0, 1.1, 0.05]} angle={0.45} penumbra={0.7} intensity={14} color="#8fb8ff" />
      <AimedSpot position={[-0.5, 1.7, -1.0]} target={[0, 1.05, 0.05]} angle={0.5} penumbra={0.8} intensity={6} color="#b18cff" />
      <directionalLight position={[0.6, 2.2, -3]} intensity={1.4} color="#6aa8ff" />
      <pointLight position={[1.4, 1.4, 0.6]} intensity={3} distance={4} color="#3b82f6" />

      <Suspense fallback={null}>
        {/* Offline reflection environment (no downloaded HDRs): soft blue and violet light panels */}
        <Environment resolution={128} frames={1}>
          <Lightformer form="rect" intensity={2.2} color="#5b8cff" position={[0, 2.5, -3]} scale={[6, 1.2, 1]} />
          <Lightformer form="rect" intensity={1.6} color="#8b5cf6" position={[-3, 1.5, 0]} rotation={[0, Math.PI / 2, 0]} scale={[4, 1, 1]} />
          <Lightformer form="ring" intensity={2} color="#ffffff" position={[2, 2, 2]} scale={1.2} />
        </Environment>

        <Office />
        <Desk />
        <Chair />
        <Person animate={!reducedMotion} />
        <Laptop />
        <LiquidBlobs groups={blobs} reducedMotion={reducedMotion} />
        <ContactShadows position={[0, DESK_TOP_Y + 0.001, -0.56]} scale={[1.6, 0.8]} opacity={0.55} blur={2.4} far={0.5} resolution={512} color="#000010" />
        {!reducedMotion && <Sparkles count={70} scale={[5, 2.6, 4]} position={[0, 1.4, -1.2]} size={2.2} speed={0.25} opacity={0.5} color="#9db8ff" />}
      </Suspense>

      <Director
        target={target}
        onTransitionDone={onTransitionDone}
        reducedMotion={reducedMotion}
        overlay={overlay}
        blobs={blobs}
        screenLayer={screenLayer}
      />
      <LiquidOverlay state={overlay} />
    </Canvas>
    {/* The real Safe Zone interface, mapped onto the laptop display every frame */}
    <div ref={screenLayer} className="sz-screen-layer" style={{ width: SCREEN_PX.width, height: SCREEN_PX.height, visibility: 'hidden' }}>
      <ScreenUI onChoose={choose} leaving={target} reducedMotion={reducedMotion} />
    </div>
    </>
  );
}
