// An office professional seen from behind: light-blue formal shirt, short dark hair, seated, typing on the laptop.
// Built from smooth procedural shapes (no downloaded models). The camera sees the back of the head, the
// shoulders and the upper back, so the silhouette, the shirt and the lighting carry the realism.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { limbBetween } from './office';

const SKIN = '#c58f74';
const HAIR = '#2b1d15';
const SHIRT = '#bcd2ee';

const Limb = ({ a, b, radius, material }: { a: THREE.Vector3; b: THREE.Vector3; radius: number; material: THREE.Material }) => {
  const { position, quaternion, length } = useMemo(() => limbBetween(a, b), [a, b]);
  return (
    <mesh position={position} quaternion={quaternion} material={material} castShadow>
      <capsuleGeometry args={[radius, Math.max(0.001, length - radius * 2), 8, 20]} />
    </mesh>
  );
};

/** The upper body as a turned (lathe) profile: narrow waist, wider ribcage, broad shoulders, then the neck opening. */
function torsoGeometry() {
  const profile = [
    [0.0, 0.0], [0.13, 0.0], [0.135, 0.06], [0.14, 0.14], [0.152, 0.22], [0.165, 0.3],
    [0.172, 0.36], [0.17, 0.41], [0.155, 0.45], [0.12, 0.48], [0.075, 0.5], [0.055, 0.505], [0.0, 0.505],
  ].map(([r, y]) => new THREE.Vector2(r!, y!));
  const g = new THREE.LatheGeometry(profile, 48);
  g.computeVertexNormals();
  return g;
}

export default function Person({ animate }: { animate: boolean }) {
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const leftHand = useRef<THREE.Mesh>(null);
  const rightHand = useRef<THREE.Mesh>(null);

  const torsoGeo = useMemo(() => torsoGeometry(), []);
  // Cotton shirt: soft sheen catches the screen light and the rim light
  const shirt = useMemo(() => new THREE.MeshPhysicalMaterial({ color: SHIRT, roughness: 0.72, sheen: 0.35, sheenRoughness: 0.5, sheenColor: new THREE.Color('#dfe9ff') }), []);
  const seam = useMemo(() => new THREE.MeshStandardMaterial({ color: '#b3c6de', roughness: 0.8 }), []);
  const collar = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#eef4fb', roughness: 0.55, sheen: 0.4 }), []);
  const skin = useMemo(() => new THREE.MeshPhysicalMaterial({ color: SKIN, roughness: 0.5, sheen: 0.35, sheenColor: new THREE.Color('#ffb59a') }), []);
  const hair = useMemo(() => new THREE.MeshPhysicalMaterial({ color: HAIR, roughness: 0.5, sheen: 1, sheenRoughness: 0.32, sheenColor: new THREE.Color('#a58670') }), []);

  // Pose (metres): seated, shoulders ~1.0 m above the floor, forearms resting towards the keyboard.
  const p = useMemo(() => {
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    return {
      lShoulder: v(-0.175, 0.99, 0.035), rShoulder: v(0.175, 0.99, 0.035),
      lElbow: v(-0.215, 0.83, -0.09), rElbow: v(0.215, 0.83, -0.09),
      lWrist: v(-0.11, 0.775, -0.355), rWrist: v(0.12, 0.775, -0.35),
    };
  }, []);

  useFrame(({ clock }) => {
    if (!animate) return;
    const t = clock.getElapsedTime();
    // Breathing and small, natural head movements while reading the screen
    if (torso.current) torso.current.scale.set(1.28 + Math.sin(t * 1.6) * 0.006, 1 + Math.sin(t * 1.6) * 0.006, 0.78);
    if (head.current) {
      head.current.rotation.y = Math.sin(t * 0.35) * 0.06;
      head.current.rotation.x = 0.16 + Math.sin(t * 0.5) * 0.02;
    }
    // Typing: small alternating hand taps
    if (leftHand.current) leftHand.current.position.y = 0.767 + Math.max(0, Math.sin(t * 9.5)) * 0.004;
    if (rightHand.current) rightHand.current.position.y = 0.767 + Math.max(0, Math.sin(t * 8.3 + 1.4)) * 0.004;
  });

  return (
    <group>
      {/* Upper body, leaning slightly towards the laptop */}
      <group position={[0, 0.52, 0.09]} rotation={[-0.13, 0, 0]}>
        <group ref={torso} scale={[1.28, 1, 0.78]}>
          <mesh geometry={torsoGeo} material={shirt} castShadow receiveShadow />
        </group>
        {/* Shoulder muscles under the shirt */}
        {[-1, 1].map(side => (
          <mesh key={side} material={shirt} position={[side * 0.165, 0.435, -0.008]} scale={[1, 0.72, 0.88]} castShadow>
            <sphereGeometry args={[0.058, 32, 24]} />
          </mesh>
        ))}
        {/* Back yoke seam, centre box pleat and side folds: details that make it read as a formal shirt */}
        <mesh material={seam} position={[0, 0.405, 0.128]} rotation={[0.35, 0, 0]} scale={[0.3, 0.003, 0.006]}>
          <boxGeometry />
        </mesh>
        <mesh material={seam} position={[0, 0.25, 0.134]} scale={[0.004, 0.3, 0.004]}>
          <boxGeometry />
        </mesh>
        {[-0.07, 0.07].map(x => (
          <mesh key={x} material={seam} position={[x, 0.16, 0.128]} rotation={[0, 0, x > 0 ? -0.12 : 0.12]} scale={[0.003, 0.18, 0.003]}>
            <boxGeometry />
          </mesh>
        ))}
        {/* Collar around the neck */}
        <mesh material={collar} position={[0, 0.512, 0.005]} rotation={[Math.PI / 2 - 0.15, 0, 0]}>
          <torusGeometry args={[0.056, 0.016, 14, 40]} />
        </mesh>
      </group>

      {/* Arms (sleeves), cuffs and hands */}
      <Limb a={p.lShoulder} b={p.lElbow} radius={0.044} material={shirt} />
      <Limb a={p.rShoulder} b={p.rElbow} radius={0.044} material={shirt} />
      <Limb a={p.lElbow} b={p.lWrist} radius={0.037} material={shirt} />
      <Limb a={p.rElbow} b={p.rWrist} radius={0.037} material={shirt} />
      <Limb a={p.lWrist.clone().lerp(p.lElbow, 0.09)} b={p.lWrist} radius={0.04} material={collar} />
      <Limb a={p.rWrist.clone().lerp(p.rElbow, 0.09)} b={p.rWrist} radius={0.04} material={collar} />
      <mesh ref={leftHand} material={skin} position={[-0.1, 0.767, -0.39]} rotation={[0, 0.25, 0]} scale={[1, 0.42, 1.25]} castShadow>
        <sphereGeometry args={[0.041, 24, 16]} />
      </mesh>
      <mesh ref={rightHand} material={skin} position={[0.106, 0.767, -0.385]} rotation={[0, -0.25, 0]} scale={[1, 0.42, 1.25]} castShadow>
        <sphereGeometry args={[0.041, 24, 16]} />
      </mesh>

      {/* Neck */}
      <mesh material={skin} position={[0, 1.06, 0.028]} rotation={[-0.22, 0, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.052, 0.085, 32]} />
      </mesh>

      {/* Head with short, neat hair following the skull; ears and nape stay visible */}
      <group ref={head} position={[0, 1.165, 0.0]} rotation={[0.16, 0, 0]}>
        <mesh material={skin} scale={[0.86, 1.06, 1]} castShadow>
          <sphereGeometry args={[0.1, 64, 48]} />
        </mesh>
        {[-1, 1].map(side => (
          <mesh key={side} material={skin} position={[side * 0.083, -0.012, 0.012]} rotation={[0, side * 0.35, 0]} scale={[0.32, 0.6, 0.48]}>
            <sphereGeometry args={[0.04, 20, 14]} />
          </mesh>
        ))}
        {/* Hair: a cap over the top and back of the skull, tilted so it ends above the ears and at the nape */}
        <mesh material={hair} position={[0, 0.008, 0.004]} rotation={[-0.62, 0, 0]} scale={[0.905, 1.1, 1.06]} castShadow>
          <sphereGeometry args={[0.1, 64, 48, 0, Math.PI * 2, 0, Math.PI * 0.54]} />
        </mesh>
        {/* Slight volume on the crown */}
        <mesh material={hair} position={[0, 0.06, 0.015]} scale={[0.82, 0.42, 0.9]}>
          <sphereGeometry args={[0.1, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        </mesh>
      </group>
    </group>
  );
}
