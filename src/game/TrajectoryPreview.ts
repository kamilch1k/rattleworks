import * as THREE from 'three';

const ARC_SEGMENTS = 56;
const GUIDE_COLOR = 0xffd84f;

/**
 * Pooled aim guide: the predicted ballistic arc (or a straight firearm ray)
 * plus a landing marker. Geometry, materials and buffers are created once and
 * only overwritten afterwards, so pointer-move aiming never allocates.
 */
export class TrajectoryPreview {
  private readonly line: THREE.Line;
  private readonly points: THREE.Points;
  private readonly lineAttribute: THREE.BufferAttribute;
  private readonly lineGeometry: THREE.BufferGeometry;
  private readonly positions: Float32Array;
  private readonly marker: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    this.positions = new Float32Array(ARC_SEGMENTS * 3);
    this.lineAttribute = new THREE.BufferAttribute(this.positions, 3);
    this.lineAttribute.setUsage(THREE.DynamicDrawUsage);
    this.lineGeometry = new THREE.BufferGeometry();
    this.lineGeometry.setAttribute('position', this.lineAttribute);
    this.lineGeometry.setDrawRange(0, 0);
    this.line = new THREE.Line(
      this.lineGeometry,
      new THREE.LineBasicMaterial({
        color: GUIDE_COLOR,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.line.renderOrder = 999;
    this.line.userData.renderOnly = true;
    this.line.userData.ignorePick = true;
    scene.add(this.line);

    // Fixed-size dots carry the guide on every platform: a one-pixel line can
    // vanish against busy pixel art, while these stay readable at any distance.
    this.points = new THREE.Points(
      this.lineGeometry,
      new THREE.PointsMaterial({
        color: GUIDE_COLOR,
        size: 6,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.renderOrder = 1000;
    this.points.userData.renderOnly = true;
    this.points.userData.ignorePick = true;
    scene.add(this.points);

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.32, 20),
      new THREE.MeshBasicMaterial({
        color: GUIDE_COLOR,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        fog: false,
      }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.marker.renderOrder = 1000;
    this.marker.userData.renderOnly = true;
    this.marker.userData.ignorePick = true;
    scene.add(this.marker);
  }

  /** Exact parabola p(t) = origin + velocity*t + 0.5*gravity*t^2, ends on `end`. */
  showArc(origin: THREE.Vector3, velocity: THREE.Vector3, gravityY: number, flightTime: number, end: THREE.Vector3): void {
    const time = Number.isFinite(flightTime) && flightTime > 0.05 ? flightTime : 0.7;
    const steps = Math.min(ARC_SEGMENTS - 1, Math.max(8, Math.ceil(time * 60)));
    const dt = time / steps;
    for (let i = 0; i <= steps; i++) {
      const t = i * dt;
      const index = i * 3;
      this.positions[index] = origin.x + velocity.x * t;
      this.positions[index + 1] = origin.y + velocity.y * t + 0.5 * gravityY * t * t;
      this.positions[index + 2] = origin.z + velocity.z * t;
    }
    this.lineGeometry.setDrawRange(0, steps + 1);
    this.lineAttribute.needsUpdate = true;
    this.line.visible = true;
    this.points.visible = true;
    this.showMarker(end);
  }

  /** Straight guide for hitscan firearms: muzzle to the clicked point. */
  showRay(start: THREE.Vector3, end: THREE.Vector3): void {
    this.positions[0] = start.x;
    this.positions[1] = start.y;
    this.positions[2] = start.z;
    this.positions[3] = end.x;
    this.positions[4] = end.y;
    this.positions[5] = end.z;
    this.lineGeometry.setDrawRange(0, 2);
    this.lineAttribute.needsUpdate = true;
    this.line.visible = true;
    this.points.visible = true;
    this.showMarker(end);
  }

  hide(): void {
    if (!this.line.visible && !this.marker.visible) return;
    this.line.visible = false;
    this.points.visible = false;
    this.marker.visible = false;
    this.lineGeometry.setDrawRange(0, 0);
  }

  private showMarker(point: THREE.Vector3): void {
    this.marker.position.set(point.x, point.y + 0.03, point.z);
    this.marker.visible = true;
  }
}
