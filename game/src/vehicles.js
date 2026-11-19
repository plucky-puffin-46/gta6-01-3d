// Puffin Vice 3D — cars: the box-model factory, the lane-following traffic
// system, the arcade driving physics for the player's car, and car-to-car
// collision resolution. Every car is one plain object:
// { mesh, kind, angle, speed, radius, hp, mode } where mode is one of
// 'traffic' | 'parked' | 'player' | 'police'.

import { STREETS, LANE, CITY_MIN, CITY_MAX, TUNE } from './config.js';
import { clamp, angleLerp } from './random.js';

const CAR_COLORS = [0xff5d7a, 0x19c2c2, 0xffc21c, 0xf2f2f2, 0x7a5cff, 0xff8c42, 0x53d769, 0x2e6fd8, 0xe8e8ec, 0x30323c];
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
const headMat = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });
const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2e3e });

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

  if (van) {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.5, 1.1), glassMat);
    cab.position.set(0, 1.15, 1.85);
    g.add(cab);
  } else {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.5, 2.1), glassMat);
    cabin.position.set(0, bodyY + bodyH / 2 + 0.24, -0.25);
    cabin.castShadow = true;
    g.add(cabin);
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
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x2266ff }));
    blue.position.x = 0.3;
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
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.06), tailMat);
    tail.position.set(sx, 0.7, -2.21);
    g.add(tail);
  }
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
  };
}

// Point a car's mesh at its physics state and roll its wheels.
export function syncCarMesh(car, dt) {
  car.mesh.position.y = 0;
  car.mesh.rotation.y = car.angle;
  car.wheelSpin += (car.speed * dt) / 0.37;
  for (const w of car.mesh.userData.wheels) w.rotation.x = car.wheelSpin;
}

// --- Traffic -----------------------------------------------------------------

export class Traffic {
  constructor(scene, rng, city) {
    this.scene = scene;
    this.city = city;
    this.cars = [];
    for (let i = 0; i < TUNE.trafficCount; i++) this.cars.push(this.makeTrafficCar(rng, i));
  }

  makeTrafficCar(rng, i) {
    const axis = rng.chance(0.5) ? 'x' : 'z';
    const street = rng.pick(STREETS);
    const dir = rng.chance(0.5) ? 1 : -1;
    const u = rng.range(CITY_MIN + 16, CITY_MAX - 16);
    const kind = rng.pick(['sedan', 'sedan', 'sedan', 'sport', 'taxi', 'van']);
    const color = kind === 'taxi' ? 0xffc21c : rng.pick(CAR_COLORS);
    const { x, z, angle } = lanePose(axis, street, dir, u);
    const car = spawnCar(this.scene, kind, color, x, z, angle);
    car.mode = 'traffic';
    car.axis = axis;
    car.street = street;
    car.dir = dir;
    car.u = u;
    car.cruise = rng.range(9.5, 14.5);
    car.speed = car.cruise;
    car.turnCooldown = rng.range(2, 9);
    car.rng = rng;
    return car;
  }

  // Respawn a traffic car that ended up too far from the action.
  recycle(car, rng, nearX, nearZ) {
    const fresh = this.makeTrafficCar(rng, 0);
    car.axis = fresh.axis;
    car.street = fresh.street;
    car.dir = fresh.dir;
    car.u = fresh.u;
    car.cruise = fresh.cruise;
    car.speed = fresh.cruise;
    this.scene.remove(fresh.mesh);
    const { x, z } = lanePose(car.axis, car.street, car.dir, car.u);
    car.mesh.position.set(x, 0, z);
    if (Math.hypot(x - nearX, z - nearZ) < 46) car.u += 90; // not on top of the player
  }

  update(dt, allCars, rng) {
    for (const car of this.cars) {
      if (car.mode !== 'traffic') continue; // stolen by the player: hands off
      car.turnCooldown -= dt;
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
      car.u += car.dir * car.speed * dt;
      // Turn at intersections, sometimes.
      if (car.turnCooldown <= 0) {
        for (const cross of STREETS) {
          if (Math.abs(car.u - cross) < 1.4 && rng.chance(0.4)) {
            const oldStreet = car.street;
            car.axis = car.axis === 'x' ? 'z' : 'x';
            car.street = cross;
            car.dir = rng.chance(0.5) ? 1 : -1;
            // Along the new axis the car sits where its old street put it.
            car.u = oldStreet;
            car.turnCooldown = rng.range(4, 11);
            break;
          }
        }
      }
      if (car.u < CITY_MIN - 30 || car.u > CITY_MAX + 30) {
        car.dir *= -1;
        car.u = clamp(car.u, CITY_MIN - 28, CITY_MAX + 28);
      }
      const pose = lanePose(car.axis, car.street, car.dir, car.u);
      // Smooth toward the lane pose so turns sweep instead of snapping.
      const px = car.mesh.position.x;
      const pz = car.mesh.position.z;
      const k = 1 - Math.exp(-dt * 5.5);
      car.mesh.position.x = px + (pose.x - px) * k;
      car.mesh.position.z = pz + (pose.z - pz) * k;
      car.angle = angleLerp(car.angle, pose.angle, 1 - Math.exp(-dt * 4.5));
      car.speed = Math.max(0, car.speed);
      syncCarMesh(car, dt);
    }
  }
}

export function lanePose(axis, street, dir, u) {
  if (axis === 'z') {
    return { x: street + (dir > 0 ? -LANE : LANE), z: u, angle: dir > 0 ? 0 : Math.PI };
  }
  return { x: u, z: street + (dir > 0 ? LANE : -LANE), angle: dir > 0 ? Math.PI / 2 : -Math.PI / 2 };
}

// Parked cars along the kerbs, ready to be borrowed.
export function spawnParkedCars(scene, rng) {
  const cars = [];
  for (let i = 0; i < TUNE.parkedCount; i++) {
    const alongZ = rng.chance(0.5);
    const street = rng.pick(STREETS);
    const side = rng.chance(0.5) ? 1 : -1;
    const u = rng.range(CITY_MIN + 14, CITY_MAX - 14);
    // Skip spots too close to intersections.
    if (STREETS.some((s) => Math.abs(u - s) < 13)) continue;
    const kind = rng.pick(['sedan', 'sedan', 'sport', 'van']);
    const color = rng.pick(CAR_COLORS);
    const off = side * 7.4; // tucked against the kerb, clear of the lanes
    const x = alongZ ? street + off : u;
    const z = alongZ ? u : street + off;
    const angle = alongZ ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2);
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
