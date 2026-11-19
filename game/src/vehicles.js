// Puffin Vice 3D — cars: the box-model factory, the traffic system that
// drives the road graph from roads.js, the arcade driving physics for the
// player's car, and car-to-car collision resolution. Every car is one
// plain object: { mesh, kind, angle, speed, radius, hp, mode } where mode
// is one of 'traffic' | 'parked' | 'player' | 'police'. Traffic cars also
// carry a graph position { seg, s, dir } and cruise the network with a
// right-hand lane offset, choosing a connected segment at every junction.

import { ROAD_HALF, LANE_OFF, TUNE, SPOTS } from './config.js';
import { pointAt, exitNode, randomRoadPoint } from './roads.js';
import { clamp, angleLerp } from './random.js';

const CAR_COLORS = [0xff5d7a, 0x19c2c2, 0xffc21c, 0xf2f2f2, 0x7a5cff, 0xff8c42, 0x53d769, 0x2e6fd8, 0xe8e8ec, 0x30323c, 0xff2e88, 0x2ee6a8];
const bodyMats = new Map();

function bodyMat(color) {
  if (!bodyMats.has(color)) {
    bodyMats.set(color, new THREE.MeshPhongMaterial({ color, shininess: 90, specular: 0x888899 }));
  }
  return bodyMats.get(color);
}

const glassMat = new THREE.MeshPhongMaterial({ color: 0x18242e, shininess: 160, specular: 0xaaccdd });
const tyreMat = new THREE.MeshLambertMaterial({ color: 0x14151a });
const hubMat = new THREE.MeshLambertMaterial({ color: 0xb9bec9 });
const skirtMat = new THREE.MeshLambertMaterial({ color: 0x191a20 });
const plateMat = new THREE.MeshBasicMaterial({ color: 0xf5f2ee });
const headMat = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });
const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2e3e });

// One shared radial-gradient sprite texture for every glow in the game.
let glowTexShared = null;
function makeGlow(color, scale, opacity = 0.7) {
  if (!glowTexShared) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    rg.addColorStop(0, 'rgba(255,255,255,0.95)');
    rg.addColorStop(0.4, 'rgba(255,255,255,0.3)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 64, 64);
    glowTexShared = new THREE.CanvasTexture(c);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexShared, color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  s.scale.setScalar(scale);
  return s;
}

// Build one car mesh. Cars face +Z; wheels are returned for spin/steer.
export function makeCarMesh(kind, color) {
  const g = new THREE.Group();
  const sport = kind === 'sport';
  const van = kind === 'van';
  const bodyH = van ? 1.15 : sport ? 0.48 : 0.58;
  const bodyY = van ? 0.95 : 0.58;
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, bodyH, van ? 4.6 : 4.4), bodyMat(color));
  body.position.y = bodyY;
  body.castShadow = true;
  g.add(body);
  // A dark skirt under the body sells the ride height.
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.26, van ? 4.64 : 4.44), skirtMat);
  skirt.position.y = 0.3;
  g.add(skirt);

  if (van) {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.5, 1.1), glassMat);
    cab.position.set(0, 1.15, 1.85);
    g.add(cab);
  } else {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.5, 2.1), glassMat);
    cabin.position.set(0, bodyY + bodyH / 2 + 0.24, -0.25);
    cabin.castShadow = true;
    g.add(cabin);
    // A painted roof panel caps the glasshouse.
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.08, 1.2), bodyMat(color));
    roof.position.set(0, bodyY + bodyH / 2 + 0.52, -0.25);
    g.add(roof);
    // Wing mirrors.
    for (const sx of [-1, 1]) {
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.09), skirtMat);
      mirror.position.set(sx * 0.94, bodyY + bodyH / 2 + 0.28, 0.78);
      g.add(mirror);
    }
  }
  if (sport) {
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.09, 0.42), bodyMat(0x22222c));
    spoiler.position.set(0, 1.02, -2.05);
    g.add(spoiler);
  }
  if (kind === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.24, 0.4),
      new THREE.MeshBasicMaterial({ color: 0xffe259 }));
    sign.position.set(0, 1.42, -0.25);
    g.add(sign);
  }
  if (kind === 'police') {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.3, 4.42),
      new THREE.MeshLambertMaterial({ color: 0x1c4fd8 }));
    stripe.position.y = 0.52;
    g.add(stripe);
    const bar = new THREE.Group();
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xff2233 }));
    red.position.x = -0.3;
    const redGlow = makeGlow(0xff2233, 2.6, 0.8);
    redGlow.position.y = 0.2;
    red.add(redGlow);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x2266ff }));
    blue.position.x = 0.3;
    const blueGlow = makeGlow(0x2266ff, 2.6, 0.8);
    blueGlow.position.y = 0.2;
    blue.add(blueGlow);
    bar.add(red, blue);
    bar.position.set(0, 1.42, -0.25);
    bar.name = 'lightbar';
    g.add(bar);
  }

  const wheelGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.3, 12);
  const hubGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.32, 8);
  const wheels = [];
  const steerWheels = [];
  for (const [sx, sz] of [[-1, 1.45], [1, 1.45], [-1, -1.45], [1, -1.45]]) {
    const w = new THREE.Group();
    const tyre = new THREE.Mesh(wheelGeo, tyreMat);
    tyre.rotation.z = Math.PI / 2;
    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.rotation.z = Math.PI / 2;
    w.add(tyre, hub);
    w.position.set(sx * 0.98, 0.37, sz);
    g.add(w);
    wheels.push(w);
    if (sz > 0) steerWheels.push(w);
  }
  for (const sx of [-0.62, 0.62]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.06), headMat);
    head.position.set(sx, 0.66, 2.21);
    g.add(head);
    const headGlow = makeGlow(0xffdf9e, 1.35, 0.55);
    headGlow.position.set(sx, 0.66, 2.42);
    g.add(headGlow);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.06), tailMat);
    tail.position.set(sx, 0.7, -2.21);
    g.add(tail);
  }
  const tailGlow = makeGlow(0xff2e3e, 1.6, 0.5);
  tailGlow.position.set(0, 0.7, -2.42);
  g.add(tailGlow);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.22), plateMat);
  plate.position.set(0, 0.42, -2.23);
  plate.rotation.y = Math.PI;
  g.add(plate);
  g.userData.wheels = wheels;
  g.userData.steerWheels = steerWheels;
  return g;
}

let carSerial = 0;

export function spawnCar(scene, kind, color, x, z, angle) {
  const mesh = makeCarMesh(kind, color);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = angle;
  scene.add(mesh);
  return {
    id: carSerial++,
    mesh, kind,
    angle, speed: 0,
    radius: TUNE.carRadius,
    hp: 100,
    mode: 'parked',
    cruise: 11,
    dead: false,
    wheelSpin: 0,
    path: null,
  };
}

// Point a car's mesh at its physics state and roll its wheels.
export function syncCarMesh(car, dt) {
  car.mesh.position.y = 0;
  car.mesh.rotation.y = car.angle;
  car.wheelSpin += (car.speed * dt) / 0.37;
  for (const w of car.mesh.userData.wheels) w.rotation.x = car.wheelSpin;
}

// --- Traffic: driving the graph ------------------------------------------------

// The pose a graph position implies: the point on the centre line, shifted
// to the right-hand lane for the direction of travel.
function pathPose(path) {
  const p = pointAt(path.seg, path.s);
  const tvx = p.tx * path.dir;
  const tvz = p.tz * path.dir;
  return {
    x: p.x + tvz * LANE_OFF,
    z: p.z - tvx * LANE_OFF,
    angle: Math.atan2(tvx, tvz),
  };
}

// At a junction pick the next segment: mostly the one that best continues
// the current heading, sometimes a random turn. A dead end (roundabout)
// simply reverses the car along the same segment.
function chooseNext(car, rng) {
  const path = car.path;
  const exitEnd = path.dir > 0 ? 1 : 0;
  const node = exitNode(path.seg, path.dir);
  const at = pointAt(path.seg, path.dir > 0 ? path.seg.len : 0);
  const hx = at.tx * path.dir;
  const hz = at.tz * path.dir;
  const options = [];
  for (const link of node.links) {
    if (link.seg === path.seg && link.end === exitEnd) continue;
    const q = pointAt(link.seg, link.end === 0 ? 0 : link.seg.len);
    const vx = link.end === 0 ? q.tx : -q.tx;
    const vz = link.end === 0 ? q.tz : -q.tz;
    options.push({ link, score: vx * hx + vz * hz });
  }
  if (!options.length) {
    path.dir = -path.dir;
    path.s = clamp(path.s, 0, path.seg.len);
    return;
  }
  options.sort((a, b) => b.score - a.score);
  const chosen = rng.chance(0.55)
    ? options[0]
    : options[Math.floor(rng.next() * options.length)];
  path.seg = chosen.link.seg;
  path.dir = chosen.link.end === 0 ? 1 : -1;
  path.s = chosen.link.end === 0 ? 0 : chosen.link.seg.len;
}

export class Traffic {
  constructor(scene, rng, city) {
    this.scene = scene;
    this.city = city;
    this.cars = [];
    for (let i = 0; i < TUNE.trafficCount; i++) this.cars.push(this.makeTrafficCar(rng));
  }

  makeTrafficCar(rng) {
    const pt = randomRoadPoint(rng);
    const kind = rng.pick(['sedan', 'sedan', 'sedan', 'sport', 'taxi', 'van']);
    const color = kind === 'taxi' ? 0xffc21c : rng.pick(CAR_COLORS);
    const car = spawnCar(this.scene, kind, color, pt.x, pt.z, 0);
    car.mode = 'traffic';
    car.path = { seg: pt.seg, s: pt.s, dir: rng.chance(0.5) ? 1 : -1 };
    car.cruise = rng.range(9.5, 14.5);
    car.speed = car.cruise;
    car.rng = rng;
    const pose = pathPose(car.path);
    car.mesh.position.set(pose.x, 0, pose.z);
    car.angle = pose.angle;
    syncCarMesh(car, 0);
    return car;
  }

  // Respawn a traffic car near (but not on top of) the action.
  recycle(car, rng, nearX, nearZ) {
    let pt = randomRoadPoint(rng);
    for (let i = 0; i < 14; i++) {
      const d = Math.hypot(pt.x - nearX, pt.z - nearZ);
      if (d > 115 && d < 245) break;
      pt = randomRoadPoint(rng);
    }
    car.path = { seg: pt.seg, s: pt.s, dir: rng.chance(0.5) ? 1 : -1 };
    car.speed = car.cruise;
    const pose = pathPose(car.path);
    car.mesh.position.set(pose.x, 0, pose.z);
    car.angle = pose.angle;
    syncCarMesh(car, 0);
  }

  update(dt, allCars, rng, focus) {
    const fx = focus ? focus.x : 0;
    const fz = focus ? focus.z : 0;
    for (const car of this.cars) {
      if (car.mode !== 'traffic') continue; // stolen by the player: hands off
      // Recycle cars that ended up too far from the action.
      if (focus && Math.hypot(car.mesh.position.x - fx, car.mesh.position.z - fz) > 285) {
        this.recycle(car, rng, fx, fz);
        continue;
      }
      // Brake for anything directly ahead.
      let target = car.cruise;
      const hx = Math.sin(car.angle);
      const hz = Math.cos(car.angle);
      for (const other of allCars) {
        if (other === car || other.dead) continue;
        const rx = other.mesh.position.x - car.mesh.position.x;
        const rz = other.mesh.position.z - car.mesh.position.z;
        const fwd = rx * hx + rz * hz;
        if (fwd < 0.5 || fwd > 12) continue;
        const lat = Math.abs(rx * hz - rz * hx);
        if (lat < 2.4) target = Math.min(target, Math.max(0, other.speed - 0.5));
      }
      car.speed += clamp(target - car.speed, -26 * dt, 7 * dt);
      car.speed = Math.max(0, car.speed);
      car.path.s += car.path.dir * car.speed * dt;
      if (car.path.s > car.path.seg.len || car.path.s < 0) chooseNext(car, car.rng || rng);
      // Smooth toward the lane pose so junction turns sweep, not snap.
      const pose = pathPose(car.path);
      const px = car.mesh.position.x;
      const pz = car.mesh.position.z;
      const k = 1 - Math.exp(-dt * 5.5);
      car.mesh.position.x = px + (pose.x - px) * k;
      car.mesh.position.z = pz + (pose.z - pz) * k;
      car.angle = angleLerp(car.angle, pose.angle, 1 - Math.exp(-dt * 4.5));
      syncCarMesh(car, dt);
    }
  }
}

// Parked cars tucked against the kerbs of random segments, ready to borrow.
export function spawnParkedCars(scene, rng) {
  const cars = [];
  for (let i = 0; i < TUNE.parkedCount; i++) {
    let pt = null;
    for (let tries = 0; tries < 8; tries++) {
      const cand = randomRoadPoint(rng);
      if (cand.seg.len < 40) continue;
      if (cand.s < 15 || cand.s > cand.seg.len - 15) continue;
      pt = cand;
      break;
    }
    if (!pt) continue;
    const side = rng.chance(0.5) ? 1 : -1;
    const nx = pt.tz;
    const nz = -pt.tx;
    const x = pt.x + nx * side * (ROAD_HALF - 1.7);
    const z = pt.z + nz * side * (ROAD_HALF - 1.7);
    // Keep Rico's corner and the Comet's spot clear for the story beats.
    if (Math.hypot(x - SPOTS.rico.x, z - SPOTS.rico.z) < 13) continue;
    if (Math.hypot(x - SPOTS.cometPark.x, z - SPOTS.cometPark.z) < 12) continue;
    const kind = rng.pick(['sedan', 'sedan', 'sport', 'van']);
    const color = rng.pick(CAR_COLORS);
    const angle = Math.atan2(pt.tx, pt.tz) + (side < 0 ? Math.PI : 0);
    const car = spawnCar(scene, kind, color, x, z, angle);
    car.mode = 'parked';
    cars.push(car);
  }
  return cars;
}

// --- Player driving ------------------------------------------------------------

// Arcade car physics: throttle/brake/steer in [-1, 1]; returns the speed.
export function driveCar(car, throttle, steer, dt, boosting) {
  const maxSpeed = (car.kind === 'sport' ? 41 : 34) * (boosting ? 1.18 : 1);
  if (throttle > 0) {
    car.speed += 17 * throttle * dt * (1 - Math.max(0, car.speed) / (maxSpeed * 1.25));
  } else if (throttle < 0) {
    car.speed += (car.speed > 0.5 ? -30 : -11) * -throttle * dt;
  }
  // Rolling drag and a soft top speed.
  car.speed -= car.speed * 0.55 * dt;
  if (throttle === 0) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 3.2 * dt);
  car.speed = clamp(car.speed, -11, maxSpeed);
  const steerAuthority = clamp(Math.abs(car.speed) / 9, 0, 1) * (1 - clamp(Math.abs(car.speed) / 90, 0, 0.45));
  car.angle += steer * 1.65 * steerAuthority * dt * (car.speed < 0 ? -1 : 1) * clamp(Math.abs(car.speed) / 6, 0.25, 1);
  const nx = car.mesh.position.x + Math.sin(car.angle) * car.speed * dt;
  const nz = car.mesh.position.z + Math.cos(car.angle) * car.speed * dt;
  car.mesh.position.x = nx;
  car.mesh.position.z = nz;
  for (const w of car.mesh.userData.steerWheels) w.rotation.y = steer * 0.42;
  syncCarMesh(car, dt);
  return car.speed;
}

// --- Collisions ----------------------------------------------------------------

// Push overlapping cars apart; report hard hits through onCrash(a, b, impact).
export function collideCars(cars, onCrash) {
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    if (a.dead) continue;
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      if (b.dead) continue;
      const dx = b.mesh.position.x - a.mesh.position.x;
      const dz = b.mesh.position.z - a.mesh.position.z;
      const minD = a.radius + b.radius - 0.7;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minD * minD || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const push = (minD - d) / 2;
      const ux = dx / d;
      const uz = dz / d;
      const aMovable = a.mode !== 'parked';
      const bMovable = b.mode !== 'parked';
      if (aMovable) { a.mesh.position.x -= ux * push; a.mesh.position.z -= uz * push; }
      if (bMovable) { b.mesh.position.x += ux * push; b.mesh.position.z += uz * push; }
      const impact = Math.abs(a.speed - b.speed) + Math.abs(a.speed) * 0.3;
      if (Math.abs(a.speed) > 2 || Math.abs(b.speed) > 2) {
        if (aMovable) a.speed *= 0.45;
        if (bMovable) b.speed *= 0.45;
        if (impact > 4) onCrash(a, b, impact);
      }
    }
  }
}

// Damage a car; heavy damage smokes, fatal damage kills the engine.
export function damageCar(car, amount, effects) {
  car.hp -= amount;
  if (car.hp < 45 && !car.dead) {
    effects.smoke(car.mesh.position, 4);
  }
  if (car.hp <= 0 && !car.dead) {
    car.dead = true;
    car.speed = 0;
    effects.smoke(car.mesh.position, 16);
  }
}
