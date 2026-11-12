// Maps a flat W×H element onto any four points on screen with a CSS matrix3d (a projective transform).
// Used to place the real DOM interface exactly onto the laptop display in the 3D scene.

type Pt = { x: number; y: number };

/** Solves the 8×8 system for the homography that maps the rectangle (0,0)-(w,h) to the four corners. */
function homography(w: number, h: number, [tl, tr, br, bl]: [Pt, Pt, Pt, Pt]): number[] | null {
  const src: Pt[] = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const dst = [tl, tr, br, bl];
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]!;
    const { x: u, y: v } = dst[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // Gaussian elimination with partial pivoting
  const n = 8;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r]![col]!) > Math.abs(A[pivot]![col]!)) pivot = r;
    if (Math.abs(A[pivot]![col]!) < 1e-12) return null;
    [A[col], A[pivot]] = [A[pivot]!, A[col]!];
    [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    for (let r = col + 1; r < n; r++) {
      const f = A[r]![col]! / A[col]![col]!;
      for (let c = col; c < n; c++) A[r]![c]! -= f * A[col]![c]!;
      b[r]! -= f * b[col]!;
    }
  }
  const hv = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r]!;
    for (let c = r + 1; c < n; c++) sum -= A[r]![c]! * hv[c]!;
    hv[r] = sum / A[r]![r]!;
  }
  return hv; // h11 h12 h13 h21 h22 h23 h31 h32 (h33 = 1)
}

/** CSS transform that maps an element of size w×h (transform-origin 0 0) onto the four screen points. */
export function quadToCss(w: number, h: number, corners: [Pt, Pt, Pt, Pt]): string | null {
  const hm = homography(w, h, corners);
  if (!hm) return null;
  const [h11, h12, h13, h21, h22, h23, h31, h32] = hm as [number, number, number, number, number, number, number, number];
  // matrix3d is column-major: x' = m11·x + m21·y + m41, w' = m14·x + m24·y + m44
  const m = [h11, h21, 0, h31, h12, h22, 0, h32, 0, 0, 1, 0, h13, h23, 0, 1];
  return `matrix3d(${m.map(v => (Math.abs(v) < 1e-12 ? 0 : v)).join(',')})`;
}
