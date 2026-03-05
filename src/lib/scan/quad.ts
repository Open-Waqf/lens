export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point]; // tl, tr, br, bl

export type DetectedQuad = {
    quad: Quad | null;
    confidence: number; // 0..1
    width: number;
    height: number;
};

export function orderQuad(points: Point[]): Quad | null {
    if (points.length < 4) return null;

    // choose 4 extremes by (x+y) and (x-y)
    const tl = points.reduce((a, b) => (a.x + a.y < b.x + b.y ? a : b));
    const br = points.reduce((a, b) => (a.x + a.y > b.x + b.y ? a : b));
    const tr = points.reduce((a, b) => (a.x - a.y > b.x - b.y ? a : b));
    const bl = points.reduce((a, b) => (a.x - a.y < b.x - b.y ? a : b));

    // de-dup if corners collapse
    const uniq = new Set([key(tl), key(tr), key(br), key(bl)]);
    if (uniq.size < 4) return null;

    return [tl, tr, br, bl];

    function key(p: Point) {
        return `${Math.round(p.x)}:${Math.round(p.y)}`;
    }
}

export function quadArea(q: Quad): number {
    // polygon area
    const [a, b, c, d] = q;
    return Math.abs(
        (a.x * b.y - a.y * b.x) +
        (b.x * c.y - b.y * c.x) +
        (c.x * d.y - c.y * d.x) +
        (d.x * a.y - d.y * a.x)
    ) / 2;
}

export function lerpQuad(a: Quad, b: Quad, t: number): Quad {
    const mix = (p: Point, q: Point) => ({x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t});
    return [mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2]), mix(a[3], b[3])];
}

export function isQuadConvex(q: Quad): boolean {
    const crossProduct = (a: Point, b: Point, c: Point) => {
        return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    };

    const cp1 = crossProduct(q[0], q[1], q[2]);
    const cp2 = crossProduct(q[1], q[2], q[3]);
    const cp3 = crossProduct(q[2], q[3], q[0]);
    const cp4 = crossProduct(q[3], q[0], q[1]);

    // All cross products must have the same sign
    const positive = cp1 > 0 && cp2 > 0 && cp3 > 0 && cp4 > 0;
    const negative = cp1 < 0 && cp2 < 0 && cp3 < 0 && cp4 < 0;

    if (!(positive || negative)) return false;

    // Also ensure it's not too thin or collapsed
    if (quadArea(q) < 500) return false;

    return true;
}
