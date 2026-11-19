// Puffin Vice 3D — people: a low-poly character built from boxes with
// swinging arms and legs, the sidewalk crowd that walks, flees and falls,
// and Rico, the fixer who hands out the story missions.

import { STREETS, ROAD_HALF, CITY_MIN, CITY_MAX, SPOTS, TUNE } from './config.js';
import { clamp, angleLerp } from './random.js';

const SKIN = [0xf2c79b, 0xc68863, 0x8a5a3b, 0xffe0bd];
const SHIRTS = [0xff5d7a, 0x19c2c2, 0xffc21c, 0xf2f2f2, 0x7a5cff, 0xff8c42, 0x53d769, 0x2e6fd8];
const PANTS = [0x2c3550, 0x503a2c, 0x243028, 0x5a2c44, 0x36454f];

const matCache = new Map();
function mat(color) {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return matCache.get(color);
}

// One character. Limbs pivot at the shoulder/hip so the walk cycle can swing
// them; parts are returned for animation.
export function makePersonMesh({ shirt, pants, skin, hair = 0x2a1c14 }) {
  const g = new THREE.Group();
  const parts = {};
  const legGeo = new THREE.BoxGeometry(0.17, 0.92, 0.19);
  legGeo.translate(0, -0.46, 0);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, mat(pants));
    leg.position.set(side * 0.13, 0.94, 0);
    leg.castShadow = true;
    g.add(leg);
    parts[side < 0 ? 'legL' : 'legR'] = leg;
  }
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.66, 0.3), mat(shirt));
  torso.position.y = 1.28;
  torso.castShadow = true;
  g.add(torso);
  parts.torso = torso;
  const armGeo = new THREE.BoxGeometry(0.13, 0.78, 0.15);
  armGeo.translate(0, -0.33, 0);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, mat(shirt));
    arm.position.set(side * 0.34, 1.58, 0);
    arm.castShadow = true;
    g.add(arm);
    parts[side < 0 ? 'armL' : 'armR'] = arm;
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), mat(skin));
  head.position.y = 1.79;
  head.castShadow = true;
  g.add(head);
  const hairMesh = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.32), mat(hair));
  hairMesh.position.y = 1.97;
  g.add(hairMesh);
  parts.head = head;
  g.userData.parts = parts;
  return g;
}

// The walk/run cycle: swing limbs by phase, scaled by how fast they're going.
export function animatePerson(parts, phase, amount) {
  const s = Math.sin(phase) * 0.6 * amount;
  parts.legL.rotation.x = s;
  parts.legR.rotation.x = -s;
  parts.armL.rotation.x = -s * 0.75;
  parts.armR.rotation.x = s * 0.75;
}

export function layDown(mesh) {
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.28;
}

export function standUp(mesh) {
  mesh.rotation.x = 0;
  mesh.position.y = 0;
}

// --- The crowd -----------------------------------------------------------------

export class Pedestrians {
  constructor(scene, rng, city) {
    this.scene = scene;
    this.city = city;
    this.peds = [];
    for (let i = 0; i < TUNE.pedCount; i++) {
      const mesh = makePersonMesh({
        shirt: rng.pick(SHIRTS), pants: rng.pick(PANTS), skin: rng.pick(SKIN),
        hair: rng.pick([0x2a1c14, 0x59452a, 0x111111, 0xb8b0a4]),
      });
      scene.add(mesh);
      const axis = rng.chance(0.5) ? 'x' : 'z';
      const street = rng.pick(STREETS);
      const side = rng.chance(0.5) ? 1 : -1;
      const ped = {
        mesh, parts: mesh.userData.parts,
        axis, street, side,
        dir: rng.chance(0.5) ? 1 : -1,
        u: rng.range(CITY_MIN + 12, CITY_MAX - 12),
        speed: rng.range(1.6, 2.6),
        phase: rng.range(0, 6),
        state: 'walk',
        hp: 100,
        fleeTime: 0, threatX: 0, threatZ: 0,
        downTime: 0,
        turnCooldown: rng.range(1, 6),
        rng,
      };
      this.place(ped);
      this.peds.push(ped);
    }
  }

  place(ped) {
    const off = ped.side * (ROAD_HALF + 2.1);
    if (ped.axis === 'z') {
      ped.mesh.position.set(ped.street + off, 0, ped.u);
      ped.mesh.rotation.y = ped.dir > 0 ? 0 : Math.PI;
    } else {
      ped.mesh.position.set(ped.u, 0, ped.street + off);
      ped.mesh.rotation.y = ped.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
  }

  // Something scary happened at (x, z): everyone close runs from it.
  scare(x, z, radius = 17) {
    for (const ped of this.peds) {
      if (ped.state === 'down' || ped.state === 'dead') continue;
      const d = Math.hypot(ped.mesh.position.x - x, ped.mesh.position.z - z);
      if (d < radius) {
        ped.state = 'flee';
        ped.fleeTime = ped.rng.range(2, 3.6);
        ped.threatX = x;
        ped.threatZ = z;
      }
    }
  }

  knockDown(ped, lethal) {
    if (ped.state === 'dead') return;
    ped.hp -= lethal ? 200 : 45;
    ped.state = ped.hp <= 0 ? 'dead' : 'down';
    ped.downTime = ped.hp <= 0 ? 9999 : ped.rng.range(2.5, 4.5);
    layDown(ped.mesh);
  }

  update(dt) {
    for (const ped of this.peds) {
      const pos = ped.mesh.position;
      if (ped.state === 'dead') continue;
      if (ped.state === 'down') {
        ped.downTime -= dt;
        if (ped.downTime <= 0) {
          ped.state = 'walk';
          standUp(ped.mesh);
        }
        continue;
      }
      if (ped.state === 'flee') {
        ped.fleeTime -= dt;
        const away = Math.atan2(pos.x - ped.threatX, pos.z - ped.threatZ);
        ped.mesh.rotation.y = angleLerp(ped.mesh.rotation.y, away, 1 - Math.exp(-dt * 8));
        pos.x += Math.sin(ped.mesh.rotation.y) * 8.2 * dt;
        pos.z += Math.cos(ped.mesh.rotation.y) * 8.2 * dt;
        this.city.collideCircle(pos, 0.7);
        ped.phase += dt * 13;
        animatePerson(ped.parts, ped.phase, 1);
        if (ped.fleeTime <= 0) ped.state = 'walk';
        continue;
      }
      // Sidewalk walking: stroll along one street, maybe turn at a corner.
      ped.turnCooldown -= dt;
      ped.u += ped.dir * ped.speed * dt;
      if (ped.u < CITY_MIN - 4) { ped.u = CITY_MIN - 4; ped.dir = 1; }
      if (ped.u > CITY_MAX + 4) { ped.u = CITY_MAX + 4; ped.dir = -1; }
      if (ped.turnCooldown <= 0) {
        for (const cross of STREETS) {
          if (Math.abs(ped.u - cross) < 1.1 && ped.rng.chance(0.35)) {
            const along = ped.street + ped.side * (ROAD_HALF + 2.1);
            ped.axis = ped.axis === 'x' ? 'z' : 'x';
            ped.street = cross;
            ped.u = along;
            ped.dir = ped.rng.chance(0.5) ? 1 : -1;
            ped.turnCooldown = ped.rng.range(3, 8);
            break;
          }
        }
      }
      this.place(ped);
      ped.phase += dt * ped.speed * 2.6;
      animatePerson(ped.parts, ped.phase, 0.8);
    }
  }
}

// Rico the fixer: a distinctive figure in a loud pink shirt who waits by the
// cafe and idles in place, turning to face whoever is near.
export function makeRico(scene) {
  const mesh = makePersonMesh({ shirt: 0xff2e88, pants: 0xf2f2f2, skin: 0xc68863, hair: 0x111111 });
  mesh.position.set(SPOTS.rico.x, 0, SPOTS.rico.z);
  mesh.rotation.y = Math.PI * 0.8;
  scene.add(mesh);
  const marker = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.42),
    new THREE.MeshBasicMaterial({ color: 0xffd166 }),
  );
  marker.position.set(SPOTS.rico.x, 2.9, SPOTS.rico.z);
  scene.add(marker);
  return {
    mesh, marker,
    update(t, playerPos) {
      marker.rotation.y = t * 2.4;
      marker.position.y = 2.9 + Math.sin(t * 2.8) * 0.16;
      const parts = mesh.userData.parts;
      parts.armL.rotation.x = Math.sin(t * 1.4) * 0.06;
      parts.armR.rotation.x = Math.cos(t * 1.1) * 0.06;
      if (playerPos && Math.hypot(playerPos.x - SPOTS.rico.x, playerPos.z - SPOTS.rico.z) < 9) {
        const face = Math.atan2(playerPos.x - SPOTS.rico.x, playerPos.z - SPOTS.rico.z);
        mesh.rotation.y = angleLerp(mesh.rotation.y, face, 0.08);
      }
    },
  };
}

export { clamp };
