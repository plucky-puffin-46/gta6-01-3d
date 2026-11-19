// Puffin Vice 3D — builds the whole of Vice Palms: sunset sky, the street
// grid, pastel buildings with lit windows, palms, lamps, the beach and the
// animated sea. Also owns the static collision data (building footprints)
// and the helpers the moving things use to stay out of the walls.

import { STREETS, ROAD_HALF, CITY_MIN, CITY_MAX, BEACH_X, WATER_X, PALETTE } from './config.js';
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

// A pastel facade with a grid of windows; the matching emissive map lights a
// random subset of those windows so the city glows at sunset.
function buildingTextures(rng, base, trim) {
  const lit = [];
  const map = canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    g.fillStyle = trim;
    g.fillRect(0, 0, w, 10);
    g.fillRect(0, h - 12, w, 12);
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 5; x++) {
        const on = rng.chance(0.42);
        lit.push(on);
        g.fillStyle = on ? '#ffd98a' : 'rgba(20,24,48,0.55)';
        g.fillRect(10 + x * 23, 22 + y * 25, 14, 15);
      }
    }
  });
  const emissiveMap = canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    let i = 0;
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 5; x++) {
        if (lit[i++]) {
          g.fillStyle = '#ffbe78';
          g.fillRect(10 + x * 23, 22 + y * 25, 14, 15);
        }
      }
    }
  });
  return { map, emissiveMap };
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

// --- The city ----------------------------------------------------------------

export class City {
  constructor(scene, rng) {
    this.scene = scene;
    this.colliders = [];   // { minX, maxX, minZ, maxZ } for buildings
    this.group = new THREE.Group();
    scene.add(this.group);
    this.buildSky(scene);
    this.buildLights(scene);
    this.buildGround();
    this.buildRoads();
    this.buildBuildings(rng);
    this.buildPalmsAndLamps(rng);
    this.buildBeachAndSea();
  }

  buildSky(scene) {
    const grad = canvasTexture(16, 512, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#2e1a5e');
      gr.addColorStop(0.42, '#7a2d6d');
      gr.addColorStop(0.68, '#d6566f');
      gr.addColorStop(0.86, '#ff9e5e');
      gr.addColorStop(1, '#ffc46b');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    });
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1500, 24, 16),
      new THREE.MeshBasicMaterial({ map: grad, side: THREE.BackSide, fog: false }),
    );
    scene.add(sky);
    // A low, fat sun disc sitting over the sea.
    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(90, 32),
      new THREE.MeshBasicMaterial({ color: 0xffdf9e, fog: false }),
    );
    sun.position.set(1150, 120, -260);
    sun.lookAt(0, 60, 0);
    scene.add(sun);
    scene.fog = new THREE.Fog(PALETTE.fog, 150, 1150);
  }

  buildLights(scene) {
    const hemi = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 0.85);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(PALETTE.sun, 1.25);
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
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(760, 560),
      new THREE.MeshLambertMaterial({ color: PALETTE.grass }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(30, 0, 0);
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  buildRoads() {
    // One asphalt texture per orientation, so the centre dashes always run
    // along the road: for X-roads the dash is horizontal and repeats along U;
    // for Z-roads it is vertical and repeats along V.
    const drawAsphalt = (horizontal) => (g, w, h) => {
      g.fillStyle = '#23242e';
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.05)';
      for (let i = 0; i < 260; i++) g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      g.fillStyle = '#ffd166';
      if (horizontal) {
        g.fillRect(8, h / 2 - 2, 44, 4);
        g.fillRect(76, h / 2 - 2, 44, 4);
      } else {
        g.fillRect(w / 2 - 2, 8, 4, 44);
        g.fillRect(w / 2 - 2, 76, 4, 44);
      }
    };
    const roadMatX = new THREE.MeshLambertMaterial({
      map: canvasTexture(128, 64, drawAsphalt(true), 44, 1),
    });
    const roadMatZ = new THREE.MeshLambertMaterial({
      map: canvasTexture(64, 128, drawAsphalt(false), 1, 44),
    });
    const walkMat = new THREE.MeshLambertMaterial({ color: PALETTE.sidewalk });
    const span = CITY_MAX - CITY_MIN + ROAD_HALF * 2;
    for (const s of STREETS) {
      // Sidewalk slabs sit a touch wider and lower than the asphalt.
      for (const [w, d, x, z] of [
        [ROAD_HALF * 2 + 7, span, s, 0],
        [span, ROAD_HALF * 2 + 7, 0, s],
      ]) {
        const walk = new THREE.Mesh(new THREE.PlaneGeometry(w, d), walkMat);
        walk.rotation.x = -Math.PI / 2;
        walk.position.set(x, 0.02, z);
        walk.receiveShadow = true;
        this.group.add(walk);
      }
      const alongZ = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, span), roadMatZ);
      alongZ.rotation.x = -Math.PI / 2;
      alongZ.position.set(s, 0.04, 0);
      alongZ.receiveShadow = true;
      this.group.add(alongZ);
      const alongX = new THREE.Mesh(new THREE.PlaneGeometry(span, ROAD_HALF * 2), roadMatX);
      alongX.rotation.x = -Math.PI / 2;
      alongX.position.set(0, 0.04, s);
      alongX.receiveShadow = true;
      this.group.add(alongX);
    }
  }

  buildBuildings(rng) {
    const styles = [
      ['#f7c8d8', '#e0218a'], ['#cdeffd', '#12808f'], ['#ffe8c9', '#e07b39'],
      ['#e6dcff', '#6c4fd8'], ['#ffd9b0', '#c94f2e'], ['#d8f3e3', '#2e8e6e'],
    ].map(([base, trim]) => {
      const { map, emissiveMap } = buildingTextures(rng, base, trim);
      const side = new THREE.MeshLambertMaterial({
        map, emissiveMap, emissive: 0xffc98a, emissiveIntensity: 0.9,
      });
      const roof = new THREE.MeshLambertMaterial({ color: 0x4a3b47 });
      return [side, side, roof, roof, side, side];
    });
    const edges = [CITY_MIN - ROAD_HALF, ...STREETS, CITY_MAX + ROAD_HALF];
    const landmarkAt = [[-114, -114], [-114, 114], [114, 114], [114, -114]];
    for (let bi = 0; bi < STREETS.length + 1; bi++) {
      for (let bj = 0; bj < STREETS.length + 1; bj++) {
        const x0 = edges[bi] + ROAD_HALF + 2.5;
        const x1 = edges[bi + 1] - ROAD_HALF - 2.5;
        const z0 = edges[bj] + ROAD_HALF + 2.5;
        const z1 = edges[bj + 1] - ROAD_HALF - 2.5;
        if (x1 - x0 < 15 || z1 - z0 < 15) continue;
        // One tower per block, sometimes split into two smaller ones.
        const plots = rng.chance(0.45)
          ? [[x0, z0, (x0 + x1) / 2 - 2, z1], [(x0 + x1) / 2 + 2, z0, x1, z1]]
          : [[x0, z0, x1, z1]];
        for (const [px0, pz0, px1, pz1] of plots) {
          if (rng.chance(0.1)) continue; // the odd empty lot
          const w = (px1 - px0) * rng.range(0.72, 0.92);
          const d = (pz1 - pz0) * rng.range(0.72, 0.92);
          const cx = (px0 + px1) / 2 + rng.range(-2, 2);
          const cz = (pz0 + pz1) / 2 + rng.range(-2, 2);
          // Keep the named landmark buildings clear of generated towers.
          if (landmarkAt.some(([lx, lz]) => Math.abs(cx - lx) < 32 && Math.abs(cz - lz) < 30)) continue;
          const centrePull = 1 - Math.min(1, Math.hypot(cx, cz) / 260);
          const h = rng.range(13, 26) + centrePull * rng.range(8, 30);
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rng.pick(styles));
          mesh.position.set(cx, h / 2, cz);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.group.add(mesh);
          this.colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
        }
      }
    }
    this.buildLandmarks();
  }

  // Named buildings the story leans on, with big readable signs.
  buildLandmarks() {
    const addBlock = (cx, cz, w, d, h, color, sign, signColor, signBg) => {
      const mat = new THREE.MeshLambertMaterial({ color });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(cx, h / 2, cz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
      const signMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 0.92, 4.6),
        new THREE.MeshBasicMaterial({ map: signTexture(sign, signBg, signColor) }),
      );
      signMesh.position.set(cx, h - 3.4, cz + d / 2 + 0.06);
      this.group.add(signMesh);
    };
    addBlock(-114, -114, 34, 30, 16, 0xdfe9f5, 'POLICE', '#ffffff', '#1c4fd8');
    addBlock(-114, 114, 34, 30, 15, 0xf5f2ee, 'HOSPITAL', '#e0213a', '#ffffff');
    addBlock(114, 114, 36, 30, 13, 0x3a3f4a, 'CHOP SHOP', '#ffb36b', '#22242c');
    addBlock(114, -114, 34, 30, 17, 0xf7c8d8, 'CAFE VICE', '#e0218a', '#fff3fa');
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

    const addPalm = (x, z) => {
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
      const lamp = new THREE.Group();
      const pole = new THREE.Mesh(poleGeo, lampPoleMat);
      pole.position.y = 3.5;
      lamp.add(pole);
      const bulb = new THREE.Mesh(bulbGeo, lampGlowMat);
      bulb.position.y = 7.05;
      lamp.add(bulb);
      lamp.position.set(x, 0, z);
      this.group.add(lamp);
    };

    // Palms line the block sidewalks; lamps stand at the corners.
    for (const sx of STREETS) {
      for (const sz of STREETS) {
        addLamp(sx + ROAD_HALF + 1.6, sz + ROAD_HALF + 1.6);
        addLamp(sx - ROAD_HALF - 1.6, sz - ROAD_HALF - 1.6);
        for (const t of [-46, -24, 24, 46]) {
          if (rng.chance(0.8)) addPalm(sx + ROAD_HALF + 1.8, sz + t + rng.range(-3, 3));
          if (rng.chance(0.8)) addPalm(sx + t + rng.range(-3, 3), sz - ROAD_HALF - 1.8);
        }
      }
    }
    // A row of palms along the promenade.
    for (let z = -170; z <= 170; z += 17) {
      if (rng.chance(0.85)) addPalm(BEACH_X - 4 + rng.range(-1.5, 1.5), z + rng.range(-3, 3));
    }
  }

  buildBeachAndSea() {
    const sand = new THREE.Mesh(
      new THREE.PlaneGeometry(WATER_X - BEACH_X + 30, 620),
      new THREE.MeshLambertMaterial({ color: PALETTE.sand }),
    );
    sand.rotation.x = -Math.PI / 2;
    sand.position.set((BEACH_X + WATER_X) / 2 + 6, 0.015, 0);
    sand.receiveShadow = true;
    this.group.add(sand);

    const stripes = canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = '#1595a8';
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.13)';
      for (let i = 0; i < 7; i++) g.fillRect(0, i * 19, w, 4);
      g.fillStyle = 'rgba(0,60,80,0.15)';
      for (let i = 0; i < 5; i++) g.fillRect(0, 9 + i * 26, w, 6);
    }, 26, 26);
    this.waterTex = stripes;
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(760, 900),
      new THREE.MeshPhongMaterial({
        map: stripes, color: 0xbfeef2, shininess: 140,
        specular: 0xffc98a, transparent: true, opacity: 0.94,
      }),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(WATER_X + 370, 0.06, 0);
    this.group.add(sea);
    this.sea = sea;
  }

  update(dt, t) {
    // The sea scrolls its foam stripes slowly toward the shore.
    this.waterTex.offset.x = (t * 0.014) % 1;
    this.waterTex.offset.y = Math.sin(t * 0.22) * 0.012;
    this.sea.position.y = 0.06 + Math.sin(t * 0.7) * 0.05;
  }

  // --- Shared spatial helpers ------------------------------------------------

  // Push a circle (x, z, radius) out of every building footprint; mutates pos.
  collideCircle(pos, radius) {
    for (const c of this.colliders) {
      const nx = clamp(pos.x, c.minX, c.maxX);
      const nz = clamp(pos.z, c.minZ, c.maxZ);
      const dx = pos.x - nx;
      const dz = pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 > radius * radius) continue;
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        pos.x = nx + (dx / d) * radius;
        pos.z = nz + (dz / d) * radius;
      } else {
        // Centre inside the box: leave by the nearest face.
        const left = pos.x - c.minX;
        const right = c.maxX - pos.x;
        const top = pos.z - c.minZ;
        const bottom = c.maxZ - pos.z;
        const m = Math.min(left, right, top, bottom);
        if (m === left) pos.x = c.minX - radius;
        else if (m === right) pos.x = c.maxX + radius;
        else if (m === top) pos.z = c.minZ - radius;
        else pos.z = c.maxZ + radius;
      }
    }
    pos.x = clamp(pos.x, CITY_MIN - 14, 292);
    pos.z = clamp(pos.z, CITY_MIN - 8, CITY_MAX + 8);
  }

  isOnRoad(x, z) {
    for (const s of STREETS) {
      if (Math.abs(x - s) <= ROAD_HALF || Math.abs(z - s) <= ROAD_HALF) return true;
    }
    return false;
  }
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
