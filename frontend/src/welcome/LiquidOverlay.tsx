// Full-screen liquid morph used for the transition: blue/purple fluid that first flows around the edges of the
// laptop display, then grows out of it until it fills the whole view (matching the login page background).
import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export interface OverlayState {
  progress: number; // 0 = invisible, 1 = fills the view
  rect: THREE.Vector4; // laptop screen on the view, in 0..1 (minX, minY, maxX, maxY)
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uProgress;
  uniform float uAspect;
  uniform vec4 uRect;

  // Value noise + fbm for organic liquid motion
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return v;
  }
  float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }

  void main() {
    vec2 uv = vUv;
    vec2 asp = vec2(uAspect, 1.0);
    vec2 center = (uRect.xy + uRect.zw) * 0.5;
    vec2 halfSize = max((uRect.zw - uRect.xy) * 0.5, vec2(0.001));

    // Distance (aspect-corrected) from the laptop screen's edge, rounded corners
    float d = sdBox((uv - center) * asp, halfSize * asp - 0.012) - 0.012;

    // Domain-warped flow field: the liquid swirls instead of simply expanding
    float t = uTime * 0.25;
    vec2 p = uv * asp;
    vec2 q = vec2(fbm(p * 1.6 + t), fbm(p * 1.6 - t + 5.2));
    float flow = fbm(p * 1.8 + q * 1.4 + t * 0.5);

    // Glossy liquid surface: a normal from the flow's slope gives specular highlights and a Fresnel sheen
    float e = 0.004;
    float hx = fbm((p + vec2(e, 0.0)) * 1.8 + q * 1.4 + t * 0.5) - flow;
    float hy = fbm((p + vec2(0.0, e)) * 1.8 + q * 1.4 + t * 0.5) - flow;
    vec3 n = normalize(vec3(-hx * 38.0, -hy * 38.0, 1.0));
    vec3 l = normalize(vec3(-0.45, 0.6, 0.65));
    float spec = pow(max(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
    float fres = pow(1.0 - n.z, 1.6);

    vec3 navy = vec3(0.027, 0.043, 0.102);
    vec3 blue = vec3(0.16, 0.42, 0.98);
    vec3 violet = vec3(0.52, 0.25, 0.97);
    vec3 cyan = vec3(0.45, 0.8, 1.0);
    vec3 tint = mix(blue, violet, smoothstep(0.3, 0.75, flow + (uv.x - 0.5) * 0.35));
    vec3 col = mix(navy, tint, 0.38 + 0.42 * smoothstep(0.25, 0.8, flow));
    col += spec * vec3(0.9, 0.94, 1.0) * 0.85 + fres * mix(cyan, violet, flow) * 0.45;

    // The fluid front grows from the screen edge outward (gently wavy, not blotchy)
    float reach = mix(-0.015, 1.9, smoothstep(0.0, 1.0, uProgress));
    float front = d - reach + (flow - 0.5) * 0.1 * (0.6 + uProgress);
    float body = smoothstep(0.012, -0.012, front);

    // Bright liquid edge travelling ahead of the fluid
    vec3 edgeCol = mix(cyan, violet, smoothstep(0.3, 0.7, flow));
    float edge = exp(-abs(front) * 42.0) * (1.0 - smoothstep(0.8, 1.0, uProgress));

    // Fully covered: settle into the calm gradient of the login page
    vec3 settled = mix(navy, mix(blue, violet, uv.x), 0.16 * (1.0 - uv.y));
    col = mix(col, settled, smoothstep(0.72, 1.0, uProgress));

    float alpha = clamp(max(body, edge * 0.9), 0.0, 1.0);
    vec3 outCol = mix(edgeCol, col, body) + edgeCol * edge * 0.35 * body;
    gl_FragColor = vec4(outCol, alpha);
  }
`;

export default function LiquidOverlay({ state }: { state: OverlayState }) {
  const size = useThree(s => s.size);
  const material = useMemo(
    () => new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uAspect: { value: 1 },
        uRect: { value: new THREE.Vector4(0.4, 0.4, 0.6, 0.6) },
      },
    }),
    []
  );

  const mesh = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    const u = material.uniforms;
    u.uTime!.value += delta;
    u.uProgress!.value = state.progress;
    u.uAspect!.value = size.width / size.height;
    (u.uRect!.value as THREE.Vector4).copy(state.rect);
    // `state` is mutated by GSAP outside React, so visibility is updated every frame here.
    if (mesh.current) mesh.current.visible = state.progress > 0.001;
  });

  return (
    <mesh ref={mesh} frustumCulled={false} renderOrder={1000} material={material} visible={false}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}
