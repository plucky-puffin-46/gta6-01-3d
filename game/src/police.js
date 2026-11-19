// Puffin Vice 3D — the wanted system and the Vice Palms PD.
// Wanted points rise when crimes are witnessed and drain while nobody in
// uniform can see the player. Police cars spawn on the streets around the
// player, chase, ram, and — when the player is on foot and cornered — fill
// the busted meter instead of running them down.

import { STREETS, TUNE, PALETTE } from './config.js';
import { clamp, angleDiff } from './random.js';
import { spawnCar, syncCarMesh } from './vehicles.js';

export class Wanted {
  constructor() {
    this.points = 0;
    this.floorPoints = 0;   // missions can hold the heat at a minimum
    this.unseenTime = 0;
    this.seen = false;
  }

  get effective() {
    return Math.max(this.points, this.floorPoints);
  }

  get stars() {
    return clamp(Math.ceil(this.effective / TUNE.wantedPerStar - 0.001), 0, 5);
  }

  // A crime only counts when somebody saw it.
  add(points, witnessed) {
    if (!witnessed || points <= 0) return;
    this.points = clamp(this.points + points, 0, TUNE.wantedPerStar * 5);
  }

  setFloor(stars) {
    this.floorPoints = stars * TUNE.wantedPerStar;
    if (stars > 0) this.points = Math.max(this.points, this.floorPoints);
  }

  clearFloor() {
    this.floorPoints = 0;
  }

  reset() {
    this.points = 0;
    this.floorPoints = 0;
    this.unseenTime = 0;
  }

  update(dt, seenByPolice) {
    this.seen = seenByPolice;
    if (seenByPolice) {
      this.unseenTime = 0;
    } else {
      this.unseenTime += dt;
      if (this.unseenTime > TUNE.unseenAfter && this.floorPoints === 0) {
        this.points = Math.max(0, this.points - TUNE.wantedDecay * dt);
      }
    }
  }
}

export class Police {
  constructor(scene, city) {
    this.scene = scene;
    this.city = city;
    this.cars = [];
    this.strobe = 0;
  }

  desiredCount(stars) {
    return stars <= 0 ? 0 : Math.min(2 + stars, 6);
  }

  spawnNear(rng, px, pz) {
    // Pick a street corner a good way from the player and drive in from it.
    let x = px;
    let z = pz;
    for (let tries = 0; tries < 12; tries++) {
      const sx = rng.pick(STREETS);
      const sz = rng.pick(STREETS);
      x = sx + rng.range(-6, 6);
      z = sz + rng.range(-6, 6);
      if (Math.hypot(x - px, z - pz) > 62) break;
    }
    const car = spawnCar(this.scene, 'police', PALETTE.police, x, z, rng.range(0, Math.PI * 2));
    car.mode = 'police';
    car.cruise = 30;
    this.cars.push(car);
    return car;
  }

  release(car) {
    this.scene.remove(car.mesh);
    this.cars.splice(this.cars.indexOf(car), 1);
  }

  // Keep the fleet matched to the wanted level.
  maintain(dt, wanted, rng, px, pz) {
    const want = this.desiredCount(wanted.stars);
    if (this.cars.length < want) {
      this.spawnNear(rng, px, pz);
    } else if (this.cars.length > want) {
      // The farthest unit gives up first.
      let far = null;
      let farD = -1;
      for (const c of this.cars) {
        const d = Math.hypot(c.mesh.position.x - px, c.mesh.position.z - pz);
        if (d > farD) { farD = d; far = c; }
      }
      if (far && farD > 30) this.release(far);
    }
    // Units hopelessly far away quietly rejoin nearer the action.
    for (const c of this.cars) {
      const d = Math.hypot(c.mesh.position.x - px, c.mesh.position.z - pz);
      if (d > 210) {
        c.mesh.position.set(rng.pick(STREETS) + rng.range(-5, 5), 0, rng.pick(STREETS) + rng.range(-5, 5));
        c.speed = 12;
      }
    }
  }

  // Drive every unit at the target. target: { x, z, vx, vz, speed, onFoot }.
  update(dt, target, city) {
    this.strobe += dt;
    const phase = Math.floor(this.strobe / 0.16) % 2;
    let anySees = false;
    for (const car of this.cars) {
      const pos = car.mesh.position;
      const dx = target.x - pos.x;
      const dz = target.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 60) anySees = true;
      // Aim a little ahead of a moving target so intercepts look deliberate.
      const lead = clamp(dist / 26, 0, 1.1);
      const tx = target.x + target.vx * lead;
      const tz = target.z + target.vz * lead;
      const desired = Math.atan2(tx - pos.x, tz - pos.z);
      const diff = angleDiff(car.angle, desired);
      const turn = clamp(diff, -2.4 * dt, 2.4 * dt);
      car.angle += turn;
      let top = 27 + Math.min(6, dist * 0.06);
      if (target.onFoot && dist < 7) top = 0;            // corner, don't flatten
      else if (!target.onFoot && dist < 9) top = Math.max(target.speed + 3, 12); // stay on the bumper
      if (car.dead) top = 0;
      // Accelerate gently, brake hard.
      car.speed += clamp(top - car.speed, -30 * dt, 13 * dt);
      pos.x += Math.sin(car.angle) * car.speed * dt;
      pos.z += Math.cos(car.angle) * car.speed * dt;
      city.collideCircle(pos, car.radius);
      syncCarMesh(car, dt);
      const bar = car.mesh.getObjectByName('lightbar');
      if (bar) {
        bar.children[0].visible = phase === 0;
        bar.children[1].visible = phase === 1;
      }
    }
    return anySees;
  }

  nearestDistance(x, z) {
    let best = Infinity;
    for (const c of this.cars) {
      best = Math.min(best, Math.hypot(c.mesh.position.x - x, c.mesh.position.z - z));
    }
    return best;
  }
}
