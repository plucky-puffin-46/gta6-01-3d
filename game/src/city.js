// Puffin Vice 3D — builds the whole of Vice Palms on the non-grid road
// network from roads.js: sunset sky, ribbon roads with sidewalks and
// crosswalks, a paved plaza with a fountain, district-styled buildings
// with neon signs and rooftop clutter, palms, glowing lamps, roundabouts,
// and the curved beach with its animated sea. Also owns the static
// collision data (oriented building footprints) and the helpers the
// moving things use to stay out of the walls.

import { ROAD_HALF, PLAZA_R, LANDMARKS, WORLD, PALETTE, shoreX, boulevardX } from './config.js';
import { NETWORK, pointAt, distanceToRoad } from './roads.js';
import { clamp } from './random.js';

// --- Canvas textures ---------------------------------------------------------

function canvasTexture(w, h, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

// A facade with a grid of windows; the matching emissive map lights a
// random subset so the city glows at sunset. Window density and the lit
// ratio vary per district style.
function buildingTextures(rng, base, trim, cols, rows, litRatio) {
  const lit = [];
  const draw = (emissive) => (g, w, h) => {
    if (!emissive) {
      g.fillStyle = base;
      g.fillRect(0, 0, w, h);
      g.fillStyle = trim;
      g.fillRect(0, 0, w, 8);
      g.fillRect(0, h - 10, w, 10);
    } else {
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
    }
    const cw = w / cols;
    const ch = (h - 34) / rows;
    let i = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!emissive) lit.push(rng.chance(litRatio));
        const on = lit[i++];
        if (emissive && !on) continue;
        g.fillStyle = emissive ? '#ffbe78' : on ? '#ffd98a' : 'rgba(18,22,44,0.6)';
        g.fillRect(4 + x * cw, 16 + y * ch, cw - 8, ch - 7);
      }
    }
  };
  return { map: canvasTexture(160, 256, draw(false)), emissiveMap: canvasTexture(160, 256, draw(true)) };
}

function signTexture(text, bg, fg) {
  return canvasTexture(256, 64, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.font = '900 34px Trebuchet MS, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);
  });
}

// A neon tube sign: dark board, glowing letters.
function neonTexture(text, color) {
  return canvasTexture(256, 64, (g, w, h) => {
    g.fillStyle = '#150722';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.globalAlpha = 0.65;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.globalAlpha = 1;
    g.font = '900 36px Trebuchet MS, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    g.shadowBlur = 16;
    g.fillStyle = color;
    g.fillText(text, w / 2, h / 2 + 2);
    g.fillText(text, w / 2, h / 2 + 2);
  });
}

const NEON_SIGNS = [
  ['HOTEL', '#ff2e88'], ['VICE', '#19e3e3'], ['CAFE', '#ffd166'], ['BAR 88', '#ff5d3a'],
  ['PALMS', '#53ff9a'], ['MOTEL', '#ff9de2'], ['DISCO', '#b78bff'], ['CASINO', '#ffd60a'],
  ['DINER', '#7df9ff'], ['CLUB 54', '#ff2e88'],
];

// --- Geometry helpers ----------------------------------------------------------

// A flat ribbon along a polyline: two vertices per point, offset by the
// point's normal. v runs along arc length / vScale so road markings flow
// around curves and rings.
function ribbonGeometry(pts, halfW, vScale) {
  const positions = [];
  const uvs = [];
  const indices = [];
  let cum = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const pn = pts[Math.min(i + 1, pts.length - 1)];
    const pp = pts[Math.max(i - 1, 0)];
    let tx = pn.x - pp.x;
    let tz = pn.z - pp.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    if (i > 0) cum += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    const nx = -tz;
    const nz = tx;
    positions.push(p.x + nx * halfW, 0, p.z + nz * halfW, p.x - nx * halfW, 0, p.z - nz * halfW);
    uvs.push(0, cum / vScale, 1, cum / vScale);
    if (i > 0) {
      const a = (i - 1) * 2;
      // Wound so the face normal points up (+Y) — visible from above.
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const normals = new Float32Array((positions.length / 3) * 3);
  for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

// Does a circle at (x, z) touch this oriented box (with padding)?
function obbNear(obb, x, z, pad) {
  const rx = x - obb.cx;
  const rz = z - obb.cz;
  const lx = Math.abs(rx * obb.cos - rz * obb.sin);
  const lz = Math.abs(rx * obb.sin + rz * obb.cos);
  return lx < obb.hw + pad && lz < obb.hd + pad;
}

// Do two oriented boxes overlap (separating-axis test, with a gap pad)?
function obbOverlap(a, b, pad) {
  const axes = [
    [a.cos, -a.sin], [a.sin, a.cos],
    [b.cos, -b.sin], [b.sin, b.cos],
  ];
  const corners = (o) => [
    [o.cx + o.hw * o.cos + o.hd * o.sin, o.cz - o.hw * o.sin + o.hd * o.cos],
    [o.cx + o.hw * o.cos - o.hd * o.sin, o.cz - o.hw * o.sin - o.hd * o.cos],
    [o.cx - o.hw * o.cos + o.hd * o.sin, o.cz + o.hw * o.sin + o.hd * o.cos],
    [o.cx - o.hw * o.cos - o.hd * o.sin, o.cz + o.hw * o.sin - o.hd * o.cos],
  ];
  const ca = corners(a);
  const cb = corners(b);
  for (const [ax, az] of axes) {
    let mnA = Infinity, mxA = -Infinity, mnB = Infinity, mxB = -Infinity;
    for (const [x, z] of ca) { const v = x * ax + z * az; if (v < mnA) mnA = v; if (v > mxA) mxA = v; }
    for (const [x, z] of cb) { const v = x * ax + z * az; if (v < mnB) mnB = v; if (v > mxB) mxB = v; }
    if (mxA + pad < mnB || mxB + pad < mnA) return false;
  }
  return true;
}

// --- The city ----------------------------------------------------------------

export class City {
  constructor(scene, rng) {
    this.scene = scene;
    this.colliders = [];   // oriented boxes { cx, cz, hw, hd, cos, sin }
    this.group = new THREE.Group();
    scene.add(this.group);
    this.buildSky(scene);
    this.buildLights(scene);
    this.buildGround();
    this.buildPlaza(rng);
    this.buildRoads();
    this.buildLandmarks(rng);
    this.buildBuildings(rng);
    this.buildPalmsAndLamps(rng);
    this.buildBeachAndSea(rng);
  }

  buildSky(scene) {
    const grad = canvasTexture(16, 512, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#2e1a5e');
      gr.addColorStop(0.4, '#8a2f6e');
      gr.addColorStop(0.64, '#e0526b');
      gr.addColorStop(0.84, '#ff9e5e');
      gr.addColorStop(1, '#ffc46b');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    });
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1500, 24, 16),
      new THREE.MeshBasicMaterial({ map: grad, side: THREE.BackSide, fog: false }),
    );
    scene.add(sky);
    // A low, fat sun disc over the sea, wrapped in a soft glow sprite.
    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(90, 32),
      new THREE.MeshBasicMaterial({ color: 0xffdf9e, fog: false }),
    );
    sun.position.set(1150, 120, -260);
    sun.lookAt(0, 60, 0);
    scene.add(sun);
    const glowTex = canvasTexture(128, 128, (g, w, h) => {
      const rg = g.createRadialGradient(64, 64, 4, 64, 64, 64);
      rg.addColorStop(0, 'rgba(255,255,255,0.9)');
      rg.addColorStop(0.35, 'rgba(255,255,255,0.32)');
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, w, h);
    });
    this.glowTex = glowTex;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xff9e5e, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    glow.position.set(1150, 120, -260);
    glow.scale.setScalar(560);
    scene.add(glow);
    scene.fog = new THREE.Fog(PALETTE.fog, 160, 1050);
  }

  buildLights(scene) {
    const hemi = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 0.95);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffab5e, 1.35);
    sun.position.set(420, 300, -160);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -150;
    sun.shadow.camera.right = 150;
    sun.shadow.camera.top = 150;
    sun.shadow.camera.bottom = -150;
    sun.shadow.camera.far = 1200;
    sun.shadow.bias = -0.0006;
    scene.add(sun);
    scene.add(sun.target);
    this.sunLight = sun;
    const fill = new THREE.DirectionalLight(0x7fb4ff, 0.28);
    fill.position.set(-260, 200, 240);
    scene.add(fill);
  }

  // Keep the shadow camera centred on the action.
  followShadows(x, z) {
    this.sunLight.position.set(x + 420, 300, z - 160);
    this.sunLight.target.position.set(x, 0, z);
  }

  buildGround() {
    const grassTex = canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = '#2f6b4f';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        g.fillStyle = Math.random() < 0.5 ? 'rgba(0,40,20,0.16)' : 'rgba(140,255,180,0.07)';
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
    }, 110, 80);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1150, 820),
      new THREE.MeshLambertMaterial({ map: grassTex }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(60, -0.02, 0);
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  // The paved heart of the city: patterned disc, fountain, golden gem.
  buildPlaza(rng) {
    const paveTex = canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#c9a189';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(120,70,60,0.55)';
      g.lineWidth = 3;
      for (let r = 22; r < 190; r += 24) {
        g.beginPath();
        g.arc(w / 2, h / 2, r, 0, Math.PI * 2);
        g.stroke();
      }
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.beginPath();
        g.moveTo(w / 2 + Math.cos(a) * 20, h / 2 + Math.sin(a) * 20);
        g.lineTo(w / 2 + Math.cos(a) * 190, h / 2 + Math.sin(a) * 190);
        g.stroke();
      }
      g.fillStyle = 'rgba(255,220,190,0.25)';
      g.beginPath();
      g.arc(w / 2, h / 2, 20, 0, Math.PI * 2);
      g.fill();
    });
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(PLAZA_R, 40),
      new THREE.MeshLambertMaterial({ map: paveTex }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.05;
    disc.receiveShadow = true;
    this.group.add(disc);
    const curb = new THREE.Mesh(
      new THREE.RingGeometry(PLAZA_R, PLAZA_R + 1.8, 40),
      new THREE.MeshLambertMaterial({ color: 0xffe8c9 }),
    );
    curb.rotation.x = -Math.PI / 2;
    curb.position.y = 0.055;
    this.group.add(curb);

    // Fountain: stone basin, animated water, a column and a golden gem.
    const fountain = new THREE.Group();
    const basin = new THREE.Mesh(
      new THREE.CylinderGeometry(6.0, 6.5, 1.15, 22),
      new THREE.MeshLambertMaterial({ color: 0xb9a08e }),
    );
    basin.position.y = 0.57;
    basin.castShadow = true;
    fountain.add(basin);
    const waterTex = canvasTexture(64, 64, (g, w, h) => {
      g.fillStyle = '#1fb6c9';
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i < 6; i++) g.fillRect(0, i * 11, w, 3);
    }, 3, 3);
    waterTex.center.set(0.5, 0.5);
    this.fountainTex = waterTex;
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(5.3, 22),
      new THREE.MeshPhongMaterial({ map: waterTex, shininess: 120, specular: 0xffc98a }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = 1.05;
    fountain.add(water);
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.8, 3.4, 10),
      new THREE.MeshLambertMaterial({ color: 0xd8c6ae }),
    );
    column.position.y = 2.6;
    column.castShadow = true;
    fountain.add(column);
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.05),
      new THREE.MeshBasicMaterial({ color: 0xffd166 }),
    );
    gem.position.y = 5.1;
    fountain.add(gem);
    this.fountainGem = gem;
    this.group.add(fountain);
    this.colliders.push({ cx: 0, cz: 0, hw: 6.4, hd: 6.4, cos: 1, sin: 0 });
  }

  buildRoads() {
    const asphaltTex = canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = '#23242e';
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.05)';
      for (let i = 0; i < 340; i++) g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      for (let i = 0; i < 130; i++) g.fillRect(Math.random() * w, Math.random() * h, 3, 2);
      // Solid edge lines and one centre dash per repeat (16 world units).
      g.fillStyle = '#cfd4dc';
      g.fillRect(3, 0, 3, h);
      g.fillRect(w - 6, 0, 3, h);
      g.fillStyle = '#ffd166';
      g.fillRect(w / 2 - 2, 10, 4, 52);
    });
    const walkTex = canvasTexture(64, 64, (g, w, h) => {
      g.fillStyle = '#8f9299';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(40,42,52,0.4)';
      g.lineWidth = 2;
      g.strokeRect(1, 1, w - 2, h - 2);
      g.fillStyle = 'rgba(255,255,255,0.05)';
      for (let i = 0; i < 60; i++) g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    });
    const asphaltMat = new THREE.MeshLambertMaterial({ map: asphaltTex });
    const plainAsphaltMat = new THREE.MeshLambertMaterial({ color: PALETTE.asphalt });
    const walkMat = new THREE.MeshLambertMaterial({ map: walkTex });

    for (const seg of NETWORK.segments) {
      // A hair of per-segment height jitter keeps overlapping ribbons at
      // junctions from z-fighting.
      const lift = (seg.id % 5) * 0.0012;
      const walk = new THREE.Mesh(ribbonGeometry(seg.pts, ROAD_HALF + 3.4, 8), walkMat);
      walk.position.y = 0.02 + lift;
      walk.receiveShadow = true;
      this.group.add(walk);
      const road = new THREE.Mesh(ribbonGeometry(seg.pts, ROAD_HALF, 16), asphaltMat);
      road.position.y = 0.045 + lift;
      road.receiveShadow = true;
      this.group.add(road);
    }

    // Roundabouts closing the dead ends: asphalt disc + planted island.
    this.roundaboutCenters = [];
    for (const node of NETWORK.deadEnds) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(12.8, 24), plainAsphaltMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(node.x, 0.042, node.z);
      disc.receiveShadow = true;
      this.group.add(disc);
      const island = new THREE.Mesh(
        new THREE.CircleGeometry(4.6, 20),
        new THREE.MeshLambertMaterial({ color: 0xc9a189 }),
      );
      island.rotation.x = -Math.PI / 2;
      island.position.set(node.x, 0.06, node.z);
      this.group.add(island);
      this.roundaboutCenters.push({ x: node.x, z: node.z });
    }

    this.buildCrosswalks();
  }

  // Zebra crossings just before every junction, merged into one mesh.
  buildCrosswalks() {
    const zebraTex = canvasTexture(64, 64, (g, w, h) => {
      g.fillStyle = 'rgba(35,36,46,0.9)';
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(240,244,248,0.92)';
      for (let x = 4; x < w; x += 16) g.fillRect(x, 6, 8, h - 12);
    });
    const positions = [];
    const uvs = [];
    const indices = [];
    let vi = 0;
    const seen = new Set();
    for (const node of NETWORK.nodes) {
      if (node.links.length < 3) continue;
      for (const { seg, end } of node.links) {
        const key = seg.id + ':' + end;
        if (seen.has(key)) continue;
        seen.add(key);
        const s = end === 0 ? ROAD_HALF + 4.6 : seg.len - ROAD_HALF - 4.6;
        if (s < 2 || s > seg.len - 2) continue;
        const p = pointAt(seg, s);
        const nx = -p.tz;
        const nz = p.tx;
        const hw = ROAD_HALF - 1.2;
        const hl = 1.7;
        const corners = [
          [p.x + nx * hw - p.tx * hl, p.z + nz * hw - p.tz * hl],
          [p.x - nx * hw - p.tx * hl, p.z - nz * hw - p.tz * hl],
          [p.x + nx * hw + p.tx * hl, p.z + nz * hw + p.tz * hl],
          [p.x - nx * hw + p.tx * hl, p.z - nz * hw + p.tz * hl],
        ];
        for (const [x, z] of corners) { positions.push(x, 0, z); }
        uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
        indices.push(vi, vi + 2, vi + 1, vi + 1, vi + 2, vi + 3);
        vi += 4;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    const normals = new Float32Array((positions.length / 3) * 3);
    for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setIndex(indices);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: zebraTex, transparent: true }));
    mesh.position.y = 0.062;
    this.group.add(mesh);
  }

  // One building group: body, ground-floor band, optional parapet / roof
  // clutter / awning / neon sign. Registers the OBB collider and returns it.
  placeBuilding({ cx, cz, w, d, h, rot, mats, bandColor, rng, sign = null, awning = false }) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.34, 2.8, d + 0.34),
      new THREE.MeshLambertMaterial({ color: bandColor }),
    );
    band.position.y = 1.4;
    group.add(band);
    if (rng.chance(0.55)) {
      const parapet = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.55, 0.5, d + 0.55),
        new THREE.MeshLambertMaterial({ color: 0x4a3b47 }),
      );
      parapet.position.y = h + 0.18;
      group.add(parapet);
    }
    if (rng.chance(0.5)) {
      const ac = new THREE.Mesh(this.acGeo, this.acMat);
      ac.position.set(rng.range(-w / 4, w / 4), h + 0.55, rng.range(-d / 4, d / 4));
      ac.castShadow = true;
      group.add(ac);
    }
    if (h > 25 && rng.chance(0.34)) {
      const tower = this.waterTower.clone();
      tower.position.set(rng.range(-w / 5, w / 5), h, rng.range(-d / 5, d / 5));
      group.add(tower);
    }
    group.position.set(cx, 0, cz);
    group.rotation.y = rot;
    this.group.add(group);
    const obb = { cx, cz, hw: w / 2, hd: d / 2, cos: Math.cos(rot), sin: Math.sin(rot) };
    this.colliders.push(obb);

    // Sign / awning go on whichever face looks at the nearest road.
    if (sign || awning) {
      const localX = { x: Math.cos(rot), z: -Math.sin(rot) };
      const localZ = { x: Math.sin(rot), z: Math.cos(rot) };
      const faces = [
        { n: localX, off: w / 2, width: d },
        { n: { x: -localX.x, z: -localX.z }, off: w / 2, width: d },
        { n: localZ, off: d / 2, width: w },
        { n: { x: -localZ.x, z: -localZ.z }, off: d / 2, width: w },
      ];
      let best = null;
      for (const f of faces) {
        const px = cx + f.n.x * (f.off + 1.5);
        const pz = cz + f.n.z * (f.off + 1.5);
        const dd = distanceToRoad(px, pz).dist;
        if (!best || dd < best.dd) best = { ...f, dd };
      }
      if (sign && best) {
        const sw = Math.min(best.width * 0.82, 13);
        const signMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(sw, 2.3),
          new THREE.MeshBasicMaterial({ map: neonTexture(sign[0], sign[1]) }),
        );
        signMesh.position.set(
          cx + best.n.x * (best.off + 0.1), Math.min(h - 2.2, 9.2), cz + best.n.z * (best.off + 0.1),
        );
        signMesh.rotation.y = Math.atan2(best.n.x, best.n.z);
        this.group.add(signMesh);
        const glow = new THREE.Mesh(
          new THREE.PlaneGeometry(sw * 1.25, 3.4),
          new THREE.MeshBasicMaterial({
            map: this.glowTex, color: new THREE.Color(sign[1]), transparent: true,
            opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false,
          }),
        );
        glow.position.set(
          cx + best.n.x * (best.off + 0.16), Math.min(h - 2.2, 9.2), cz + best.n.z * (best.off + 0.16),
        );
        glow.rotation.y = signMesh.rotation.y;
        this.group.add(glow);
      }
      if (awning && best) {
        const awn = new THREE.Mesh(
          new THREE.BoxGeometry(Math.min(best.width * 0.7, 10), 0.16, 2.7),
          new THREE.MeshLambertMaterial({ color: rng.pick([0xff2e88, 0x19c2c2, 0xffc21c, 0xff5d3a]) }),
        );
        awn.position.set(
          cx + best.n.x * (best.off + 1.25), 3.1, cz + best.n.z * (best.off + 1.25),
        );
        awn.rotation.y = Math.atan2(best.n.x, best.n.z);
        awn.rotateX(0.42);
        this.group.add(awn);
      }
    }
    return obb;
  }

  // Named buildings the story leans on, with big readable signs.
  buildLandmarks(rng) {
    this.acGeo = new THREE.BoxGeometry(2.3, 1.1, 1.9);
    this.acMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a8 });
    this.waterTower = (() => {
      const t = new THREE.Group();
      const legs = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.3, 1.9),
        new THREE.MeshLambertMaterial({ color: 0x5a4632 }));
      legs.position.y = 1.15;
      t.add(legs);
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.7, 10),
        new THREE.MeshLambertMaterial({ color: 0x8a6b48 }));
      tank.position.y = 3.6;
      tank.castShadow = true;
      t.add(tank);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.95, 1.1, 10),
        new THREE.MeshLambertMaterial({ color: 0x503a2c }));
      roof.position.y = 5.5;
      t.add(roof);
      return t;
    })();

    for (const lm of LANDMARKS) {
      const a = (lm.angle * Math.PI) / 180;
      const base = { x: lm.r * Math.cos(a), z: lm.r * Math.sin(a) };
      const perp = { x: -Math.sin(a), z: Math.cos(a) };
      const off = ROAD_HALF + 2.2 + lm.d / 2;
      const cx = base.x + perp.x * lm.side * off;
      const cz = base.z + perp.z * lm.side * off;
      const rot = dirAngleOf(lm.angle);
      // Landmarks get a real windowed facade in their signature colour —
      // a blank wall is the backdrop of every conversation with Rico.
      const baseCss = '#' + lm.color.toString(16).padStart(6, '0');
      const { map, emissiveMap } = buildingTextures(rng, baseCss, '#5a4a52', 6, 4, 0.38);
      const sideMat = new THREE.MeshLambertMaterial({
        map, emissiveMap, emissive: 0xffc98a, emissiveIntensity: 0.9,
      });
      const roofMat = new THREE.MeshLambertMaterial({ color: 0x4a3b47 });
      const mats = [sideMat, sideMat, roofMat, roofMat, sideMat, sideMat];
      const body = new THREE.Mesh(new THREE.BoxGeometry(lm.w, lm.h, lm.d), mats);
      body.position.set(cx, lm.h / 2, cz);
      body.rotation.y = rot;
      body.castShadow = true;
      body.receiveShadow = true;
      this.group.add(body);
      const obb = { cx, cz, hw: lm.w / 2, hd: lm.d / 2, cos: Math.cos(rot), sin: Math.sin(rot) };
      this.colliders.push(obb);
      this.landmarkObbs = this.landmarkObbs || [];
      this.landmarkObbs.push(obb);
      // The sign faces the avenue: the road lies along -side * perp, which
      // in the building's local frame is the ±X face (local X = -perp when
      // rot = dirAngle(angle)).
      const localX = { x: Math.cos(rot), z: -Math.sin(rot) };
      const n = { x: localX.x * lm.side, z: localX.z * lm.side };
      const signMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.min(lm.d * 0.92, 17), 4.6),
        new THREE.MeshBasicMaterial({ map: signTexture(lm.sign, lm.signBg, lm.signColor) }),
      );
      signMesh.position.set(cx + n.x * (lm.w / 2 + 0.07), lm.h - 3.4, cz + n.z * (lm.w / 2 + 0.07));
      signMesh.rotation.y = Math.atan2(n.x, n.z);
      this.group.add(signMesh);
      // A pale forecourt slab in front of the sign face.
      const fore = new THREE.Mesh(
        new THREE.BoxGeometry(7, 0.08, lm.d),
        new THREE.MeshLambertMaterial({ color: 0xa8adb5 }),
      );
      fore.rotation.y = rot;
      fore.position.set(cx + n.x * (lm.w / 2 + 3.5), 0.04, cz + n.z * (lm.w / 2 + 3.5));
      fore.receiveShadow = true;
      this.group.add(fore);
    }
  }

  buildBuildings(rng) {
    // District styles: [base, trim, cols, rows, litRatio].
    const styles = {
      glass: ['#33526e', '#19c2c2', 7, 12, 0.55],
      glassWarm: ['#4a3a5e', '#ff9e5e', 7, 11, 0.5],
      pink: ['#f7c8d8', '#e0218a', 5, 9, 0.42],
      cream: ['#ffe8c9', '#e07b39', 5, 9, 0.45],
      lavender: ['#e6dcff', '#6c4fd8', 6, 10, 0.4],
      mint: ['#d8f3e3', '#2e8e6e', 5, 8, 0.38],
      coral: ['#ffd9b0', '#c94f2e', 6, 9, 0.5],
      deco: ['#f5f2ee', '#12808f', 5, 10, 0.35],
      sand: ['#f2d5a0', '#b3541e', 4, 8, 0.42],
    };
    const matCache = {};
    const matsFor = (name) => {
      if (!matCache[name]) {
        const [base, trim, cols, rows, lit] = styles[name];
        const { map, emissiveMap } = buildingTextures(rng, base, trim, cols, rows, lit);
        const side = new THREE.MeshLambertMaterial({
          map, emissiveMap, emissive: 0xffc98a, emissiveIntensity: 0.95,
        });
        const roof = new THREE.MeshLambertMaterial({ color: 0x4a3b47 });
        matCache[name] = { mats: [side, side, roof, roof, side, side], band: new THREE.Color(trim).multiplyScalar(0.55).getHex() };
      }
      return matCache[name];
    };
    const downtown = ['glass', 'glassWarm', 'lavender', 'pink'];
    const midtown = ['pink', 'cream', 'lavender', 'mint', 'coral', 'deco', 'sand'];
    const beachfront = ['deco', 'cream', 'coral', 'sand', 'mint'];

    const placed = [...(this.landmarkObbs || [])];
    let made = 0;
    for (let attempt = 0; attempt < 1100 && made < 108; attempt++) {
      const r = 43 + Math.pow(rng.next(), 0.82) * 141;
      const theta = rng.range(0, Math.PI * 2);
      const cx = Math.cos(theta) * r;
      const cz = Math.sin(theta) * r;
      if (cx > shoreX(cz) - 54) continue;                    // keep off the beach
      const downtownLot = r < 88;
      const w = downtownLot ? rng.range(16, 29) : rng.range(12.5, 24);
      const d = downtownLot ? rng.range(15, 25) : rng.range(12, 22);
      const near = distanceToRoad(cx, cz);
      if (near.dist < ROAD_HALF + 2) continue;
      let rot = near.angle;
      if (rng.chance(0.3)) rot += Math.PI / 2;
      const obb = { cx, cz, hw: w / 2, hd: d / 2, cos: Math.cos(rot), sin: Math.sin(rot) };
      // Every corner must clear the asphalt (plus a kerb margin).
      const corners = [
        [cx + obb.hw * obb.cos + obb.hd * obb.sin, cz - obb.hw * obb.sin + obb.hd * obb.cos],
        [cx + obb.hw * obb.cos - obb.hd * obb.sin, cz - obb.hw * obb.sin - obb.hd * obb.cos],
        [cx - obb.hw * obb.cos + obb.hd * obb.sin, cz + obb.hw * obb.sin + obb.hd * obb.cos],
        [cx - obb.hw * obb.cos - obb.hd * obb.sin, cz + obb.hw * obb.sin - obb.hd * obb.cos],
      ];
      let clear = true;
      for (const [px, pz] of corners) {
        if (distanceToRoad(px, pz).dist < ROAD_HALF + 1.1) { clear = false; break; }
      }
      if (!clear) continue;
      let overlaps = false;
      for (const other of placed) {
        if (obbOverlap(obb, other, 3.2)) { overlaps = true; break; }
      }
      if (overlaps) continue;
      const styleName = downtownLot ? rng.pick(downtown)
        : (cx > shoreX(cz) - 105 ? rng.pick(beachfront) : rng.pick(midtown));
      const { mats, band } = matsFor(styleName);
      const centrePull = 1 - Math.min(1, r / 240);
      const h = downtownLot
        ? rng.range(21, 34) + centrePull * rng.range(6, 15)
        : rng.range(9.5, 19) + centrePull * rng.range(3, 11);
      const sign = rng.chance(downtownLot ? 0.42 : 0.24) ? rng.pick(NEON_SIGNS) : null;
      const obbPlaced = this.placeBuilding({
        cx, cz, w, d, h, rot, mats, bandColor: band, rng,
        sign, awning: r < 100 && rng.chance(0.4),
      });
      placed.push(obbPlaced);
      made++;
    }
  }

  buildPalmsAndLamps(rng) {
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6b48 });
    const frondMat = new THREE.MeshLambertMaterial({ color: 0x2e9e5b, side: THREE.DoubleSide });
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 6.4, 6);
    const frondGeo = new THREE.PlaneGeometry(4.6, 1.1);
    frondGeo.translate(2.1, 0, 0);
    const lampPoleMat = new THREE.MeshLambertMaterial({ color: 0x2c2f36 });
    const lampGlowMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7, 6);
    const bulbGeo = new THREE.SphereGeometry(0.42, 8, 6);
    const lampGlowMaterial = new THREE.SpriteMaterial({
      map: this.glowTex, color: 0xffc98a, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    const addPalm = (x, z) => {
      if (this.colliders.some((c) => obbNear(c, x, z, 1.2))) return;
      const palm = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 3.2;
      trunk.rotation.z = rng.range(-0.09, 0.09);
      trunk.castShadow = true;
      palm.add(trunk);
      for (let i = 0; i < 6; i++) {
        const frond = new THREE.Mesh(frondGeo, frondMat);
        frond.position.y = 6.4;
        frond.rotation.y = (i / 6) * Math.PI * 2 + rng.range(-0.3, 0.3);
        frond.rotation.z = rng.range(-0.5, -0.15);
        frond.castShadow = true;
        palm.add(frond);
      }
      palm.position.set(x, 0, z);
      this.group.add(palm);
    };
    const addLamp = (x, z) => {
      if (this.colliders.some((c) => obbNear(c, x, z, 0.8))) return;
      const lamp = new THREE.Group();
      const pole = new THREE.Mesh(poleGeo, lampPoleMat);
      pole.position.y = 3.5;
      lamp.add(pole);
      const bulb = new THREE.Mesh(bulbGeo, lampGlowMat);
      bulb.position.y = 7.05;
      lamp.add(bulb);
      const glow = new THREE.Sprite(lampGlowMaterial);
      glow.position.y = 7.05;
      glow.scale.setScalar(5.2);
      lamp.add(glow);
      lamp.position.set(x, 0, z);
      this.group.add(lamp);
    };
    this.addPalm = addPalm;

    // Palms and lamps follow the road edges, alternating sides.
    for (const seg of NETWORK.segments) {
      let side = rng.chance(0.5) ? 1 : -1;
      for (let s = 10; s < seg.len - 8; s += rng.range(17, 24)) {
        side = -side;
        const p = pointAt(seg, s);
        const x = p.x + -p.tz * side * (ROAD_HALF + 2.3);
        const z = p.z + p.tx * side * (ROAD_HALF + 2.3);
        if (Math.hypot(x, z) < PLAZA_R + 6) continue;
        if (x > boulevardX(z) + 7) continue;   // not in the sea
        if (rng.chance(0.72)) addPalm(x, z);
      }
      let lside = rng.chance(0.5) ? 1 : -1;
      for (let s = 16; s < seg.len - 10; s += rng.range(27, 34)) {
        lside = -lside;
        const p = pointAt(seg, s);
        const x = p.x + -p.tz * lside * (ROAD_HALF + 1.5);
        const z = p.z + p.tx * lside * (ROAD_HALF + 1.5);
        if (Math.hypot(x, z) < PLAZA_R + 5) continue;
        if (x > boulevardX(z) + 7) continue;
        addLamp(x, z);
      }
    }
    // Palms ringing the plaza and crowning each roundabout island.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      addPalm(Math.cos(a) * (PLAZA_R + 24), Math.sin(a) * (PLAZA_R + 24));
    }
    for (const c of this.roundaboutCenters || []) addPalm(c.x, c.z);
    // The promenade row along the sand.
    for (let z = -185; z <= 185; z += 16) {
      if (rng.chance(0.8)) addPalm(shoreX(z) - 21 + rng.range(-2, 2), z + rng.range(-3, 3));
    }
  }

  buildBeachAndSea(rng) {
    const strip = (west, east, vScale) => {
      const pts = [];
      for (let z = -330; z <= 330; z += 10) pts.push({ x: 0, z, w: west(z), e: east(z) });
      const positions = [];
      const uvs = [];
      const indices = [];
      pts.forEach((p, i) => {
        positions.push(p.w, 0, p.z, p.e, 0, p.z);
        uvs.push(0, p.z / vScale, (p.e - p.w) / vScale, p.z / vScale);
        if (i > 0) {
          const a = (i - 1) * 2;
          indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      const normals = new Float32Array((positions.length / 3) * 3);
      for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1;
      geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geo.setIndex(indices);
      return geo;
    };

    const sandTex = canvasTexture(64, 64, (g, w, h) => {
      g.fillStyle = '#ecc987';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 240; i++) {
        g.fillStyle = Math.random() < 0.5 ? 'rgba(160,120,60,0.18)' : 'rgba(255,250,230,0.2)';
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
    }, 1, 1);
    const sand = new THREE.Mesh(
      strip((z) => shoreX(z) - 38, (z) => shoreX(z) + 3, 18),
      new THREE.MeshLambertMaterial({ map: sandTex }),
    );
    sand.position.y = 0.015;
    sand.receiveShadow = true;
    this.group.add(sand);

    const stripes = canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = '#1595a8';
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.13)';
      for (let i = 0; i < 7; i++) g.fillRect(0, i * 19, w, 4);
      g.fillStyle = 'rgba(0,60,80,0.15)';
      for (let i = 0; i < 5; i++) g.fillRect(0, 9 + i * 26, w, 6);
    }, 1, 1);
    this.waterTex = stripes;
    const sea = new THREE.Mesh(
      strip((z) => shoreX(z) - 3, (z) => shoreX(z) + 430, 16),
      new THREE.MeshPhongMaterial({
        map: stripes, color: 0xbfeef2, shininess: 140,
        specular: 0xffc98a, transparent: true, opacity: 0.94,
      }),
    );
    sea.position.y = 0.06;
    this.group.add(sea);
    this.sea = sea;

    // A breathing foam line where the sea meets the sand.
    const foamTex = canvasTexture(64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < 26; i++) {
        g.beginPath();
        g.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 5, 0, Math.PI * 2);
        g.fill();
      }
    }, 1, 1);
    this.foamTex = foamTex;
    const foam = new THREE.Mesh(
      strip((z) => shoreX(z) - 3.4, (z) => shoreX(z) + 1.2, 9),
      new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    foam.position.y = 0.085;
    this.group.add(foam);
    this.foam = foam;

    // Beach umbrellas and balls scattered on the sand.
    const umbrellaMats = [0xff2e88, 0x19c2c2, 0xffc21c, 0xff5d3a, 0xf2f2f2].map(
      (c) => new THREE.MeshLambertMaterial({ color: c }),
    );
    const poleMat = new THREE.MeshLambertMaterial({ color: 0xd8d8d8 });
    for (let z = -190; z <= 195; z += rng.range(20, 30)) {
      if (!rng.chance(0.62)) continue;
      const ux = shoreX(z) - rng.range(13, 24);
      const umb = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6), poleMat);
      pole.position.y = 1.3;
      umb.add(pole);
      const top = new THREE.Mesh(new THREE.ConeGeometry(2.3, 0.75, 9), rng.pick(umbrellaMats));
      top.position.y = 2.65;
      top.castShadow = true;
      umb.add(top);
      umb.position.set(ux, 0, z + rng.range(-4, 4));
      this.group.add(umb);
      if (rng.chance(0.5)) {
        const ball = new THREE.Mesh(
          new THREE.SphereGeometry(0.5, 10, 8),
          rng.pick(umbrellaMats),
        );
        ball.position.set(ux + rng.range(-2.5, 2.5), 0.5, z + rng.range(-3, 3));
        ball.castShadow = true;
        this.group.add(ball);
      }
    }
  }

  update(dt, t) {
    // The sea scrolls its foam stripes slowly toward the shore, the foam
    // line breathes, and the fountain's water turns under its gem.
    this.waterTex.offset.x = (t * 0.014) % 1;
    this.waterTex.offset.y = Math.sin(t * 0.22) * 0.012;
    this.foamTex.offset.y = (t * 0.03) % 1;
    this.foam.material.opacity = 0.45 + Math.sin(t * 0.85) * 0.2;
    this.fountainTex.rotation = t * 0.07;
    this.fountainGem.rotation.y = t * 1.4;
    this.fountainGem.position.y = 5.1 + Math.sin(t * 1.8) * 0.18;
  }

  // --- Shared spatial helpers ------------------------------------------------

  // Push a circle (x, z, radius) out of every building footprint; mutates pos.
  collideCircle(pos, radius) {
    for (const c of this.colliders) {
      const rx = pos.x - c.cx;
      const rz = pos.z - c.cz;
      const lx = rx * c.cos - rz * c.sin;
      const lz = rx * c.sin + rz * c.cos;
      const qx = clamp(lx, -c.hw, c.hw);
      const qz = clamp(lz, -c.hd, c.hd);
      if (qx === lx && qz === lz) {
        // Centre inside the box: leave by the nearest face.
        const dxl = c.hw - Math.abs(lx);
        const dzl = c.hd - Math.abs(lz);
        let ox = lx;
        let oz = lz;
        if (dxl < dzl) ox = (lx >= 0 ? 1 : -1) * (c.hw + radius);
        else oz = (lz >= 0 ? 1 : -1) * (c.hd + radius);
        pos.x = c.cx + ox * c.cos + oz * c.sin;
        pos.z = c.cz - ox * c.sin + oz * c.cos;
        continue;
      }
      const wx = c.cx + qx * c.cos + qz * c.sin;
      const wz = c.cz - qx * c.sin + qz * c.cos;
      const dx = pos.x - wx;
      const dz = pos.z - wz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        pos.x = wx + (dx / d) * radius;
        pos.z = wz + (dz / d) * radius;
      } else {
        // Exactly on the boundary line: push along the local axis.
        const ox = qx === c.hw || qx === -c.hw ? qx + Math.sign(qx || 1) * radius : lx;
        const oz = qz === c.hd || qz === -c.hd ? qz + Math.sign(qz || 1) * radius : lz;
        pos.x = c.cx + ox * c.cos + oz * c.sin;
        pos.z = c.cz - ox * c.sin + oz * c.cos;
      }
    }
    pos.x = clamp(pos.x, WORLD.minX, Math.min(WORLD.maxX, shoreX(pos.z) + 42));
    pos.z = clamp(pos.z, WORLD.minZ, WORLD.maxZ);
  }

  isOnRoad(x, z) {
    return distanceToRoad(x, z).dist <= ROAD_HALF + 1.5;
  }
}

// The facing angle whose forward (sin θ, cos θ) runs along an avenue.
function dirAngleOf(deg) {
  const a = (deg * Math.PI) / 180;
  return Math.atan2(Math.cos(a), Math.sin(a));
}

// A tall glowing beacon + floating diamond that marks the current objective.
export function makeBeacon(color = 0xffd166) {
  const group = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 2.4, 46, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.3, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  beam.position.y = 23;
  group.add(beam);
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.15),
    new THREE.MeshBasicMaterial({ color }),
  );
  gem.position.y = 5.4;
  group.add(gem);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.2, 3, 28),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.12;
  group.add(ring);
  group.userData.spin = (t) => {
    gem.rotation.y = t * 2.2;
    gem.position.y = 5.4 + Math.sin(t * 2.6) * 0.5;
    ring.scale.setScalar(1 + Math.sin(t * 3.2) * 0.1);
  };
  return group;
}
