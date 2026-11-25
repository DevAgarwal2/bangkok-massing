import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Pt, Poly } from './geom';
import { centroid, inset, isHealthy, scaled, grow } from './geom';
import type { Scheme, Tier } from './massing';

type Bld = { id: string; kind: string; name?: string; h: number; p: Pt[] };
type Road = { id: string; kind: string; name?: string; p: Pt[] };

export type SceneOpts = {
  onPick?: (p: Pt) => void;
  onRoad?: (id: string | null) => void;
  onHover?: (p: Pt | null, road: string | null) => void;
  onView?: (metresPerPixel: number) => void;
  onPin?: (x: number, y: number, visible: boolean) => void;
};

const BRAND = 0xb23a2b;
const SOLID = new THREE.Color(0xe3d9c4);
const GHOST = new THREE.Color(0xded2bc);

/* ---------- materials: a small, shared palette ---------- */
const MAT_VERGE = new THREE.MeshStandardMaterial({ color: 0xdad4c4, roughness: 1, metalness: 0 });
const MAT_KERB = new THREE.LineBasicMaterial({ color: 0xb4ab98, transparent: true, opacity: 0.8 });
const MAT_MARK = new THREE.MeshBasicMaterial({ color: 0xf2ecdd });

const M = {
  glass: new THREE.MeshStandardMaterial({ color: 0xc3cabb, metalness: 0.22, roughness: 0.26 }),
  glassPale: new THREE.MeshStandardMaterial({ color: 0xbcc2b3, metalness: 0.2, roughness: 0.25 }),
  slab: new THREE.MeshStandardMaterial({ color: 0xf8f2e4, roughness: 0.86, metalness: 0.03 }),
  stone: new THREE.MeshStandardMaterial({ color: 0xefe6d5, roughness: 0.9, metalness: 0.02 }),
  bronze: new THREE.MeshStandardMaterial({ color: 0xa98a56, roughness: 0.42, metalness: 0.6 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x8a8072, roughness: 0.5, metalness: 0.4 }),
  rail: new THREE.MeshStandardMaterial({
    color: 0xd9e3e0, metalness: 0.15, roughness: 0.1, transparent: true, opacity: 0.45,
  }),
  ground: new THREE.MeshStandardMaterial({ color: 0xcfc3ae, roughness: 0.95, metalness: 0 }),
  green: new THREE.MeshStandardMaterial({ color: 0x4a5c3f, roughness: 0.95, metalness: 0 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x53663f, roughness: 0.9, metalness: 0 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x4a3f33, roughness: 0.95 }),
  water: new THREE.MeshStandardMaterial({ color: 0x5c8f96, roughness: 0.08, metalness: 0.3 }),
};

export class Site3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private ctxGroup = new THREE.Group();
  private siteGroup = new THREE.Group();
  private plotGroup = new THREE.Group();
  private envGroup = new THREE.Group();
  private massGroup = new THREE.Group();
  private ctxMeshes: { mesh: THREE.Mesh; cx: number; cz: number; h: number; op: number; target: number }[] = [];
  private roadMeshes: THREE.Mesh[] = [];
  private roadMat = new THREE.MeshStandardMaterial({ color: 0x96908a, roughness: 1, metalness: 0 });
  private hoverRoad: THREE.Mesh | null = null;
  private siteCentre = new THREE.Vector2();
  private xray = true;
  private xrayTick = 0;
  private anim = 0;
  private raf = 0;
  private opts: SceneOpts;
  private canvas: HTMLCanvasElement;
  private clock = new THREE.Clock();
  private downAt = { x: 0, y: 0, t: 0 };
  private camTween: { from: THREE.Vector3; to: THREE.Vector3; targetFrom: THREE.Vector3; targetTo: THREE.Vector3; t: number } | null = null;
  private scheme: Scheme | null = null;
  private pinPoint: THREE.Vector3 | null = null;
  private treeMesh: THREE.InstancedMesh | null = null;
  private sun: THREE.DirectionalLight | null = null;

  constructor(canvas: HTMLCanvasElement, opts: SceneOpts = {}) {
    this.canvas = canvas;
    this.opts = opts;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 4000);
    this.camera.position.set(120, 150, 190);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.maxPolarAngle = Math.PI * 0.487;
    this.controls.minDistance = 25;
    this.controls.maxDistance = 700;
    this.controls.screenSpacePanning = false;
    this.controls.zoomSpeed = 0.9;
    this.controls.rotateSpeed = 0.75;

    this.scene.add(this.ctxGroup, this.siteGroup, this.plotGroup, this.envGroup, this.massGroup);
    this.scene.add(new THREE.AmbientLight(0xd8cbb4, 0.42));
    this.scene.fog = new THREE.Fog(0xe9e5d8, 300, 900);
    this.buildLights();
    this.buildGround();
    this.bindEvents();
    this.resize();
    this.loop();
  }

  private buildLights() {
    const hemi = new THREE.HemisphereLight(0xfff7e9, 0x9c8f7a, 1.55);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff0d6, 2.9);
    sun.position.set(150, 215, 140);
    this.sun = sun;
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 130;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 20;
    sun.shadow.camera.far = 800;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.35;
    this.scene.add(sun);
    this.scene.add(sun.target);

    const rim = new THREE.DirectionalLight(0xc8d4d2, 0.55);
    rim.position.set(170, 110, -170);
    this.scene.add(rim);
  }

  private buildGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 1400),
      new THREE.MeshStandardMaterial({ color: 0xd6d6c4, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(480, 48, 0xd6cab6, 0xdfd5c4);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.3;
    grid.position.y = 0.02;
    this.scene.add(grid);
  }

  loadSite(buildings: Bld[], roads: Road[]) {
    const roofLines: number[] = [];
    for (const b of buildings) {
      if (b.p.length < 3) continue;
      const geo = extrude(b.p, b.h, 0.35);
      const tint = 0.5 + ((parseInt(b.id, 10) % 7) / 7) * 0.5;
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0xdfd4bd).lerp(new THREE.Color(0xcfc2a9), tint * 0.55),
        roughness: 0.95,
        metalness: 0.02,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = false;
      this.ctxGroup.add(mesh);
      const [cx, cz] = centroid(b.p);
      this.ctxMeshes.push({ mesh, cx, cz, h: b.h, op: 1, target: 1 });
      const top = b.p.map(([x, z]) => new THREE.Vector3(x, b.h + 0.35, z));
      for (let i = 0; i < top.length; i++) {
        const a = top[i];
        const c = top[(i + 1) % top.length];
        roofLines.push(a.x, a.y, a.z, c.x, c.y, c.z);
      }
    }
    if (roofLines.length) {
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(roofLines, 3));
      this.ctxGroup.add(
        new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xa89a83, transparent: true, opacity: 0.35 })),
      );
    }

    this.scatterTrees(buildings, roads);

    for (const r of roads) {
      const w = widthOf(r.kind);
      if (w < 3) continue;

      // verge / footway under the carriageway
      const verge = ribbon(r.p, w + 5, 0.04);
      if (verge) {
        const m = new THREE.Mesh(verge, MAT_VERGE);
        m.receiveShadow = true;
        this.ctxGroup.add(m);
      }

      const g = ribbon(r.p, w, 0.062);
      if (!g) continue;
      const m = new THREE.Mesh(g, this.roadMat);
      m.receiveShadow = true;
      m.userData.road = r;
      this.roadMeshes.push(m);
      this.ctxGroup.add(m);

      // kerbs on both sides
      if (w >= 8) {
        for (const side of [-1, 1]) {
          const line = offsetPts(r.p, (side * w) / 2);
          const lg = new THREE.BufferGeometry().setFromPoints(line.map(([x, z]) => new THREE.Vector3(x, 0.075, z)));
          this.ctxGroup.add(new THREE.Line(lg, MAT_KERB));
        }
      }

      // centre dashes on the wider roads
      if (w >= 11) {
        const dg = dashes(r.p, 3.2, 3.6, 0.11);
        if (dg) {
          const dm = new THREE.Mesh(dg, MAT_MARK);
          this.ctxGroup.add(dm);
        }
      }
    }
  }

  /** A stand of low-poly trees over the block, skipping footprints and roads. */
  private scatterTrees(buildings: Bld[], roads: Road[]) {
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.2, 5);
    trunkGeo.translate(0, 1.1, 0);
    const crownGeo = new THREE.IcosahedronGeometry(1, 0);
    crownGeo.scale(1.5, 1.15, 1.5);
    crownGeo.translate(0, 3.4, 0);
    const [cx, cz] = [this.siteCentre.x, this.siteCentre.y];
    const pts: { x: number; z: number; s: number }[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

    for (let x = -260; x <= 260; x += 9) {
      for (let z = -240; z <= 240; z += 9) {
        const px = cx + x + (rnd() - 0.5) * 6;
        const pz = cz + z + (rnd() - 0.5) * 6;
        if (rnd() > 0.42) continue;
        if (Math.hypot(px - cx, pz - cz) < 34) continue;
        let blocked = false;
        for (const b of buildings) {
          if (b.p.length < 3) continue;
          let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
          for (const [bx, bz] of b.p) {
            minX = Math.min(minX, bx); maxX = Math.max(maxX, bx);
            minZ = Math.min(minZ, bz); maxZ = Math.max(maxZ, bz);
          }
          if (px > minX - 1.5 && px < maxX + 1.5 && pz > minZ - 1.5 && pz < maxZ + 1.5) { blocked = true; break; }
        }
        if (!blocked) {
          for (const r of roads) {
            for (let i = 0; i < r.p.length - 1; i++) {
              if (distPointSeg(px, pz, r.p[i], r.p[i + 1]) < widthOf(r.kind) * 0.6 + 2.4) { blocked = true; break; }
            }
            if (blocked) break;
          }
        }
        if (!blocked) pts.push({ x: px, z: pz, s: 0.75 + rnd() * 0.9 });
      }
    }

    const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x6b5a45, roughness: 0.95 }), pts.length);
    const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x6d8256, roughness: 0.92, flatShading: true }), pts.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    pts.forEach((p, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i * 1.7) % 6.28);
      m.compose(new THREE.Vector3(p.x, 0, p.z), q, new THREE.Vector3(p.s, p.s * (0.85 + ((i * 13) % 5) * 0.06), p.s));
      trunk.setMatrixAt(i, m);
      crown.setMatrixAt(i, m);
      crown.setColorAt(i, col.setHSL(0.235 + ((i * 37) % 9) * 0.004, 0.22 + ((i * 11) % 7) * 0.012, 0.27 + ((i * 17) % 6) * 0.014));
    });
    crown.instanceColor!.needsUpdate = true;
    trunk.castShadow = true;
    crown.castShadow = true;
    crown.receiveShadow = true;
    this.treeMesh = crown;
    this.ctxGroup.add(trunk, crown);
  }

  setXray(on: boolean) {
    this.xray = on;
    for (const c of this.ctxMeshes) c.target = 1;
    this.updateXray(true);
  }

  private updateXray(force = false) {
    const cam = this.camera.position;
    const sx = this.siteCentre.x;
    const sz = this.siteCentre.y;
    const dx = sx - cam.x;
    const dz = sz - cam.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    for (const c of this.ctxMeshes) {
      let occl = false;
      if (this.xray) {
        const vx = c.cx - cam.x;
        const vz = c.cz - cam.z;
        const t = vx * ux + vz * uz;
        const perp = Math.abs(vx * uz - vz * ux);
        occl = t > 0 && t < len + 6 && perp < 26 && c.h > 6;
        if (Math.hypot(c.cx - sx, c.cz - sz) < 14) occl = true;
      }
      c.target = this.xray ? (occl ? 0.08 : 0.5) : 1;
      if (force) c.op = c.target;
    }
  }

  /** Ground pad, hedges and planting: the plot as a piece of land, not a decal. */
  setSite(plot: Poly) {
    clear(this.siteGroup);
    if (plot.length < 3) return;
    const pad = new THREE.Mesh(extrude(plot, 0.22, 0), M.ground);
    pad.receiveShadow = true;
    this.siteGroup.add(pad);

    // hedge along each edge, set in from the boundary
    const inner = inset(plot, 1.1);
    if (isHealthy(inner)) {
      for (let i = 0; i < inner.length; i++) {
        const a = inner[i];
        const b = inner[(i + 1) % inner.length];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const L = Math.hypot(dx, dz);
        if (L < 3) continue;
        const box = new THREE.Mesh(new THREE.BoxGeometry(L - 0.4, 0.85, 0.7), M.green);
        box.position.set((a[0] + b[0]) / 2, 0.65, (a[1] + b[1]) / 2);
        box.rotation.y = -Math.atan2(dz, dx);
        box.castShadow = true;
        box.receiveShadow = true;
        this.siteGroup.add(box);
      }
    }

    // trees in the setback band
    const band = inset(plot, 2.6);
    if (isHealthy(band)) {
      for (let i = 0; i < band.length; i++) {
        const a = band[i];
        const b = band[(i + 1) % band.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.max(1, Math.floor(L / 9));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          const x = a[0] + (b[0] - a[0]) * t;
          const z = a[1] + (b[1] - a[1]) * t;
          this.siteGroup.add(tree(x, z, 0.22 + ((i * 7 + k * 3) % 5) * 0.03));
        }
      }
    }
  }

  setPlot(poly: Poly) {
    if (poly.length) {
      const [cx, cz] = centroid(poly);
      this.siteCentre.set(cx, cz);
    }
    clear(this.plotGroup);
    if (poly.length < 3) {
      if (poly.length > 1) {
        this.plotGroup.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(poly.map(([x, z]) => new THREE.Vector3(x, 0.45, z))),
            new THREE.LineBasicMaterial({ color: BRAND }),
          ),
        );
      }
      poly.forEach(([x, z]) => this.plotGroup.add(this.vertex(x, z)));
      return;
    }

    const fill = new THREE.Mesh(
      new THREE.ShapeGeometry(shapeOf(poly)),
      new THREE.MeshStandardMaterial({
        color: BRAND, transparent: true, opacity: 0.07, roughness: 0.6,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    fill.rotation.x = -Math.PI / 2;
    fill.position.y = 0.26;
    this.plotGroup.add(fill);

    const ring = poly.map(([x, z]) => new THREE.Vector3(x, 0.48, z));
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ring),
      new THREE.LineBasicMaterial({ color: BRAND, transparent: true, opacity: 0.95 }),
    );
    this.plotGroup.add(line);
    const line2 = line.clone();
    line2.position.y = -0.06;
    (line2.material as THREE.LineBasicMaterial).opacity = 0.28;
    this.plotGroup.add(line2);

    for (const [x, z] of poly) this.plotGroup.add(this.vertex(x, z));
  }

  private vertex(x: number, z: number) {
    const g = new THREE.Group();
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.45, 2.0, 8),
      new THREE.MeshStandardMaterial({ color: 0xb23a2b, roughness: 0.5 }),
    );
    post.position.set(x, 1.0, z);
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xd25743, emissive: 0x5a150c, emissiveIntensity: 0.5, roughness: 0.4 }),
    );
    cap.position.set(x, 2.2, z);
    g.add(post, cap);
    return g;
  }

  setEnvelope(env: Poly | null, height: number) {
    clear(this.envGroup);
    if (!env || env.length < 3) return;
    const ghost = new THREE.Mesh(
      extrude(env, height, 0),
      new THREE.MeshStandardMaterial({
        color: 0xb23a2b, transparent: true, opacity: 0.022, roughness: 0.9, metalness: 0,
        depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    this.envGroup.add(ghost);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(extrude(env, height, 0)),
      new THREE.LineBasicMaterial({ color: 0xb23a2b, transparent: true, opacity: 0.5 }),
    );
    this.envGroup.add(edges);
  }

  setScheme(scheme: Scheme, animate = true) {
    clear(this.massGroup);
    this.scheme = scheme;
    const tall = scheme.tiers[scheme.tiers.length - 1];
    if (tall) {
      const [px, pz] = centroid(tall.poly);
      this.pinPoint = new THREE.Vector3(px, scheme.height + 3, pz);
    }
    const fh = scheme.floors ? scheme.height / scheme.floors : 3.2;

    scheme.tiers.forEach((t, idx) => {
      const g = buildTier(t, fh, idx === 0, idx === scheme.tiers.length - 1);
      g.position.y = t.base;
      this.massGroup.add(g);
      if (animate) g.scale.y = 0.001;
    });

    if (animate) this.anim = 0;
  }

  focus(poly: Poly, height = 40, immediate = false) {
    const [cx, cz] = centroid(poly);
    if (this.sun) {
      this.sun.position.set(cx + 150, 215, cz + 140);
      this.sun.target.position.set(cx + 10, 20, cz + 6);
      this.sun.target.updateMatrixWorld();
    }
    const rect = this.canvas.getBoundingClientRect();
    const minSide = Math.min(rect.width || 900, rect.height || 700);
    const fit = minSide < 380 ? 0.86 : minSide < 520 ? 0.9 : minSide < 700 ? 0.95 : 0.92;
    const span = Math.max(190, Math.min(560, 150 + height * 2.9)) * fit;
    const target = new THREE.Vector3(cx, height * 0.38, cz);
    const dir = new THREE.Vector3(0.6, 1.35, 0.95).normalize();
    const to = target.clone().add(dir.multiplyScalar(span));
    this.controls.target.copy(target);
    if (immediate) {
      this.camera.position.copy(to);
      this.controls.update();
      return;
    }
    this.camTween = {
      from: this.camera.position.clone(),
      to,
      targetFrom: new THREE.Vector3(cx, 6, cz),
      targetTo: target,
      t: 0,
    };
  }

  private bindEvents() {
    const el = this.canvas;
    el.addEventListener('pointerdown', (e) => {
      this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    el.addEventListener('pointerup', (e) => {
      const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
      const quick = performance.now() - this.downAt.t < 600;
      if (moved > 6 || !quick) return;
      const hit = this.pickGround(e);
      if (!hit) return;
      const road = this.pickRoad(e);
      this.opts.onRoad?.(road ? (road.userData.road as Road).id : null);
      this.opts.onPick?.([hit.x, hit.z]);
    });
    el.addEventListener('pointermove', (e) => {
      const hit = this.pickGround(e);
      const road = this.pickRoad(e);
      this.opts.onHover?.(
        hit ? [hit.x, hit.z] : null,
        road ? ((road.userData.road as Road).name ?? (road.userData.road as Road).kind) : null,
      );
      const mesh = road ? (road as THREE.Mesh) : null;
      if (mesh !== this.hoverRoad) {
        if (this.hoverRoad) this.hoverRoad.material = this.roadMat;
        this.hoverRoad = mesh;
        if (mesh) mesh.material = new THREE.MeshStandardMaterial({ color: 0x8f8880, roughness: 1 });
      }
    });
    el.addEventListener('pointerleave', () => {
      if (this.hoverRoad) {
        this.hoverRoad.material = this.roadMat;
        this.hoverRoad = null;
      }
      this.opts.onHover?.(null, null);
    });
    window.addEventListener('resize', this.resize);
  }

  private pickGround(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, p) ? p : null;
  }

  private pickRoad(e: PointerEvent) {
    if (!this.roadMeshes.length) return null;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.roadMeshes, false);
    return hits[0]?.object as THREE.Mesh | null;
  }

  resize = () => {
    const rect = this.canvas.parentElement!.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.anim < 1) {
      this.anim = Math.min(1, this.anim + dt * 1.2);
      const e = 1 - Math.pow(1 - this.anim, 3);
      for (const o of this.massGroup.children) o.scale.y = Math.max(0.001, e);
    }

    if (this.camTween) {
      this.camTween.t = Math.min(1, this.camTween.t + dt * 1.6);
      const t = easeInOut(this.camTween.t);
      this.camera.position.lerpVectors(this.camTween.from, this.camTween.to, t);
      this.controls.target.lerpVectors(this.camTween.targetFrom, this.camTween.targetTo, t);
      if (this.camTween.t >= 1) this.camTween = null;
    }

    this.controls.update();

    if (++this.xrayTick % 10 === 0) {
      this.updateXray();
      const d = this.camera.position.distanceTo(this.controls.target);
      const worldH = 2 * d * Math.tan((this.camera.fov * Math.PI) / 360);
      this.opts.onView?.(worldH / Math.max(1, this.canvas.clientHeight));
      if (this.pinPoint) {
        const v = this.pinPoint.clone().project(this.camera);
        const r = this.canvas.getBoundingClientRect();
        this.opts.onPin?.((v.x * 0.5 + 0.5) * r.width, (-v.y * 0.5 + 0.5) * r.height, v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2);
      }
    }
    for (const c of this.ctxMeshes) {
      if (Math.abs(c.op - c.target) < 0.005) continue;
      c.op += (c.target - c.op) * Math.min(1, dt * 5);
      const m = c.mesh.material as THREE.MeshStandardMaterial;
      m.opacity = c.op;
      m.color.copy(SOLID).lerp(GHOST, Math.min(1, Math.max(0, (1 - c.target) / 0.66)));
      const wantT = c.op < 0.985;
      if (m.transparent !== wantT) {
        m.transparent = wantT;
        m.depthWrite = !wantT;
        m.needsUpdate = true;
      }
    }

    this.renderer.render(this.scene, this.camera);
  };

  capture() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    this.renderer.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Architecture: one tier built out of slabs, fins, balconies and roof */
/* ------------------------------------------------------------------ */

const buildTier = (t: Tier, fh: number, isBase: boolean, isTop: boolean): THREE.Group => {
  const g = new THREE.Group();
  const body = new THREE.Mesh(extrude(t.poly, t.floors * fh, 0), isBase ? M.glassPale : M.glass);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  const plate = grow(t.poly, 0.16);
  const balcony = grow(t.poly, 0.9);

  // floor slabs: the horizontal banding that makes it a building
  for (let f = 0; f <= t.floors; f++) {
    const y = f * fh;
    const slab = new THREE.Mesh(extrude(f === t.floors ? grow(t.poly, 0.3) : plate, 0.22, 0), M.slab);
    slab.position.y = y - 0.14;
    slab.castShadow = true;
    slab.receiveShadow = true;
    g.add(slab);
  }

  // balconies on alternating floors, with frameless glass
  if (!isBase) {
    for (let f = 2; f < t.floors - 1; f += 2) {
      const y = f * fh;
      const deck = new THREE.Mesh(extrude(balcony, 0.16, 0), M.slab);
      deck.position.y = y + 0.1;
      deck.castShadow = true;
      g.add(deck);
      const rail = new THREE.Mesh(extrude(balcony, 1.05, 0), M.rail);
      rail.position.y = y + 0.26;
      g.add(rail);
      const top = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(balcony.map(([x, z]) => new THREE.Vector3(x, y + 1.32, z))),
        new THREE.LineBasicMaterial({ color: 0xdce8ee, transparent: true, opacity: 0.5 }),
      );
      g.add(top);
    }
  }

  // vertical fins, one every ~3 m around the perimeter
  const fins = finPositions(t.poly, 3.1);
  if (fins.length) {
    const geom = new THREE.BoxGeometry(0.1, t.floors * fh, 0.34);
    const inst = new THREE.InstancedMesh(geom, M.metal, fins.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    fins.forEach((f, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -f.angle);
      m.compose(new THREE.Vector3(f.x, (t.floors * fh) / 2, f.z), q, s);
      inst.setMatrixAt(i, m);
    });
    inst.castShadow = true;
    g.add(inst);
  }

  // parapet + roof plant, only on the top tier
  if (isTop) {
    const parapet = new THREE.Mesh(extrude(grow(t.poly, 0.24), 1.1, 0), M.stone);
    parapet.position.y = t.floors * fh - 0.2;
    parapet.castShadow = true;
    g.add(parapet);

    const plant = new THREE.Mesh(extrude(scaled(t.poly, 0.34), 3.0, 0), M.stone);
    plant.position.y = t.floors * fh + 0.9;
    plant.castShadow = true;
    g.add(plant);

    const [mx, mz] = centroid(t.poly);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 7, 6), M.metal);
    mast.position.set(mx, t.floors * fh + 7.5, mz);
    g.add(mast);
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xff6b4a, emissive: 0xff3a1a, emissiveIntensity: 1.2 }),
    );
    beacon.position.set(mx, t.floors * fh + 11.1, mz);
    g.add(beacon);

    const crown = new THREE.Mesh(extrude(grow(t.poly, 0.5), 0.7, 0), M.bronze);
    crown.position.y = t.floors * fh - 0.9;
    g.add(crown);
  }

  // podium: a glazed ground floor and an entrance canopy
  if (isBase) {
    const shopfront = new THREE.Mesh(extrude(grow(t.poly, 0.06), 4.4, 0), M.glass);
    shopfront.position.y = 0.22;
    g.add(shopfront);

    const canopy = new THREE.Mesh(extrude(grow(t.poly, 1.5), 0.3, 0), M.stone);
    canopy.position.y = 4.7;
    canopy.castShadow = true;
    g.add(canopy);

    const steps = new THREE.Mesh(new THREE.BoxGeometry(9, 0.22, 3.2), M.stone);
    const [cx, cz] = centroid(t.poly);
    steps.position.set(cx, 0.11, cz + 0.9);
    g.add(steps);

    // roof pool on the podium, set to one side of the plate
    const pool = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.3, 4.2), M.water);
    pool.position.set(cx - 2.6, 5.05, cz - 2.2);
    g.add(pool);
  }

  return g;
};

const finPositions = (poly: Poly, step: number) => {
  const out: { x: number; z: number; angle: number }[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const L = Math.hypot(dx, dz);
    if (L < 2) continue;
    const n = Math.max(1, Math.round(L / step));
    const ang = Math.atan2(dz, dx);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      out.push({ x: a[0] + dx * t, z: a[1] + dz * t, angle: ang });
    }
  }
  return out;
};

const tree = (x: number, z: number, s: number) => {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s * 4, 0.16 * s * 4, 2.2 * s * 4, 6), M.trunk);
  trunk.position.y = 1.1 * s * 4;
  g.add(trunk);
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5 * s * 4, 0), M.leaf);
  crown.position.y = 3.1 * s * 4;
  crown.scale.set(1, 0.85, 1);
  crown.castShadow = true;
  g.add(crown);
  g.position.set(x, 0.18, z);
  return g;
};

const distPointSeg = (px: number, pz: number, a: Pt, b: Pt) => {
  const vx = b[0] - a[0];
  const vz = b[1] - a[1];
  const L2 = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (pz - a[1]) * vz) / L2));
  return Math.hypot(px - (a[0] + vx * t), pz - (a[1] + vz * t));
};

const offsetPts = (pts: Pt[], d: number): Pt[] =>
  pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const L = Math.hypot(dx, dz) || 1;
    return [p[0] - (dz / L) * d, p[1] + (dx / L) * d] as Pt;
  });

const dashes = (pts: Pt[], dash: number, gap: number, y: number): THREE.BufferGeometry | null => {
  const verts: number[] = [];
  const half = 0.16;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[i + 1];
    const L = Math.hypot(x2 - x1, z2 - z1);
    if (L < 1) continue;
    const ux = (x2 - x1) / L;
    const uz = (z2 - z1) / L;
    const nx = -uz * half;
    const nz = ux * half;
    for (let d = 0; d < L; d += dash + gap) {
      const e = Math.min(L, d + dash);
      const ax = x1 + ux * d;
      const az = z1 + uz * d;
      const bx = x1 + ux * e;
      const bz = z1 + uz * e;
      verts.push(ax + nx, y, az + nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz);
      verts.push(ax + nx, y, az + nz, bx - nx, y, bz - nz, ax - nx, y, az - nz);
    }
  }
  if (!verts.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  return g;
};

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const clear = (g: THREE.Group) => {
  for (const c of [...g.children]) {
    g.remove(c);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
};

const shapeOf = (poly: Poly) => new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));

const extrude = (poly: Poly, h: number, bevel: number) =>
  new THREE.ExtrudeGeometry(shapeOf(poly), {
    depth: h,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 1,
    steps: 1,
  }).rotateX(-Math.PI / 2);

const ribbon = (pts: Pt[], w: number, y: number): THREE.BufferGeometry | null => {
  const verts: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[i + 1];
    const dx = x2 - x1;
    const dz = z2 - z1;
    const L = Math.hypot(dx, dz) || 1;
    const nx = (-dz / L) * (w / 2);
    const nz = (dx / L) * (w / 2);
    const a = [x1 + nx, z1 + nz];
    const b = [x2 + nx, z2 + nz];
    const c = [x2 - nx, z2 - nz];
    const d = [x1 - nx, z1 - nz];
    verts.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]);
    verts.push(a[0], y, a[1], c[0], y, c[1], d[0], y, d[1]);
  }
  if (!verts.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.computeVertexNormals();
  return g;
};

const widthOf = (kind: string) => {
  switch (kind) {
    case 'primary': return 20;
    case 'secondary': return 14;
    case 'tertiary': return 11;
    case 'residential': return 8;
    case 'service': return 6;
    case 'footway':
    case 'path':
    case 'steps': return 3;
    default: return 6;
  }
};
