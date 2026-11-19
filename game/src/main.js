// Puffin Vice 3D — the game itself: boot, the third-person camera, on-foot
// and driving control, combat, police pressure, busted/wasted respawns,
// saving, and the deterministic ?scene= setups the screenshots are taken
// from. The other modules own the city, cars, people, police, missions,
// HUD, sound and particles; this file wires them together.

import { STREETS, LANE, PALETTE, TUNE, SPOTS } from './config.js';
import { Rng, clamp, angleLerp, angleDiff, dist2d } from './random.js';
import { Input } from './input.js';
import { Sfx as Audio } from './audio.js';
import { Effects } from './effects.js';
import { City, makeBeacon } from './city.js';
import { spawnCar, Traffic, spawnParkedCars, driveCar, collideCars, damageCar, syncCarMesh } from './vehicles.js';
import { makePersonMesh, animatePerson, Pedestrians, makeRico, layDown, standUp } from './people.js';
import { Wanted, Police } from './police.js';
import { Missions } from './missions.js';
import { Hud } from './hud.js';
import { saveGame, loadGame, hasSave } from './save.js';

// ---------------------------------------------------------------- boot

const params = new URLSearchParams(location.search);
const SHOT_SCENE = params.get('scene') || '';
const SEED = Number(params.get('seed') || 7);
const rng = new Rng(SEED);

window.__pageErrors = [];
addEventListener('error', (e) => window.__pageErrors.push(String(e.message || e.error)));

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 3200);
camera.position.set(30, 18, -90);

const city = new City(scene, rng);
const effects = new Effects(scene);
const sfx = new Audio();
const hud = new Hud();

const traffic = new Traffic(scene, rng, city);
const parkedCars = spawnParkedCars(scene, rng);
const comet = spawnCar(scene, 'sport', 0x12b5a5, SPOTS.cometPark.x, SPOTS.cometPark.z, Math.PI);
comet.mode = 'parked';
comet.occupied = false;
parkedCars.push(comet);
for (const c of parkedCars) c.occupied = rng.chance(0.3);

const cars = [...traffic.cars, ...parkedCars];
const peds = new Pedestrians(scene, rng, city);
const rico = makeRico(scene);
const wanted = new Wanted();
const police = new Police(scene, city);
const beacon = makeBeacon();
beacon.visible = false;
scene.add(beacon);

// ---------------------------------------------------------------- player

const player = {
  mesh: makePersonMesh({ shirt: 0x19c2c2, pants: 0x2c3550, skin: 0xf2c79b, hair: 0x2a1c14 }),
  angle: 2.54,
  hp: TUNE.playerMaxHealth,
  phase: 0,
  car: null,
  cash: TUNE.startCash,
  fireCooldown: 0,
  punchTime: 0,
  downTime: 0,
  hurtFlash: 0,
  vel: { x: 0, z: 0 },
};
player.mesh.position.set(SPOTS.playerStart.x, 0, SPOTS.playerStart.z);
player.mesh.rotation.y = player.angle;
scene.add(player.mesh);
const playerParts = player.mesh.userData.parts;

// The facade the mission system talks to.
const facade = {
  scene, hud, sfx, wanted, effects, comet,
  playerPos: { x: SPOTS.playerStart.x, z: SPOTS.playerStart.z },
  playerCar: null,
  addCash(n) { player.cash += n; if (n > 0) sfx.cash(); },
  autosave() { persist(); },
  removeCar(car) {
    if (player.car === car) {
      // The car leaves the world (the Comet gets chopped): put the player
      // back on their feet beside where it stood.
      player.mesh.position.set(car.mesh.position.x + 3, 0, car.mesh.position.z + 2);
      player.mesh.visible = true;
      player.car = null;
      facade.playerCar = null;
      sfx.engineStop();
    }
    scene.remove(car.mesh);
    const ci = cars.indexOf(car);
    if (ci >= 0) cars.splice(ci, 1);
    const pi = parkedCars.indexOf(car);
    if (pi >= 0) parkedCars.splice(pi, 1);
  },
};
const missions = new Missions(facade);

function persist(showToast = false) {
  const ok = saveGame({
    cash: player.cash,
    missionIndex: missions.index,
    chainDone: missions.chainDone,
    x: facade.playerPos.x,
    z: facade.playerPos.z,
  });
  if (showToast) hud.toast(ok ? 'Game saved' : 'Save failed');
}

// ---------------------------------------------------------------- state

let mode = 'menu';           // menu | play | pause | help | busted | wasted
let overlayTimer = 0;
let camYaw = Math.PI;
let camPitch = 0.34;
let camDist = 10.5;
let shake = 0;
let bustedMeter = 0;
let elapsed = 0;
let framesRendered = 0;
let lastMouseMoveT = -9e9;
let shotCarAutopilot = false;

addEventListener('mousemove', () => { lastMouseMoveT = performance.now(); });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- helpers

function witnessed(x, z) {
  for (const ped of peds.peds) {
    if (ped.state === 'dead') continue;
    if (dist2d(ped.mesh.position.x, ped.mesh.position.z, x, z) < 26) return true;
  }
  return police.nearestDistance(x, z) < 42;
}

function nearestCarTo(x, z, maxD) {
  let best = null;
  let bestD = maxD;
  for (const car of cars) {
    if (car.dead) continue;
    const d = dist2d(car.mesh.position.x, car.mesh.position.z, x, z);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

function teleport(x, z) {
  player.mesh.position.set(x, 0, z);
  standUp(player.mesh);
  player.downTime = 0;
  city.collideCircle(player.mesh.position, TUNE.playerRadius);
}

// ---------------------------------------------------------------- cars in/out

function enterCar(car) {
  const wasTraffic = car.mode === 'traffic';
  const occupied = wasTraffic || car.occupied;
  player.car = car;
  facade.playerCar = car;
  car.mode = 'player';
  car.occupied = false;
  player.mesh.visible = false;
  if (occupied) {
    // The driver comes out the hard way and runs for it.
    const ped = peds.peds.find((p) => p.state === 'walk');
    if (ped) {
      ped.mesh.position.set(car.mesh.position.x + 2.4, 0, car.mesh.position.z + 1);
      peds.scare(ped.mesh.position.x, ped.mesh.position.z, 6);
    }
    sfx.carjack();
    wanted.add(2, witnessed(car.mesh.position.x, car.mesh.position.z));
    hud.toast('Carjacked!');
  } else {
    sfx.door();
    wanted.add(1, witnessed(car.mesh.position.x, car.mesh.position.z));
  }
  missions.onEnterCar(car);
  sfx.engineStart();
}

function exitCar() {
  const car = player.car;
  if (!car) return;
  const side = car.angle + Math.PI / 2;
  player.mesh.position.set(
    car.mesh.position.x + Math.sin(side) * 2.6,
    0,
    car.mesh.position.z + Math.cos(side) * 2.6,
  );
  city.collideCircle(player.mesh.position, TUNE.playerRadius);
  player.mesh.visible = true;
  player.angle = car.angle;
  car.mode = 'parked';
  car.speed = 0;
  player.car = null;
  facade.playerCar = null;
  sfx.engineStop();
  sfx.door();
}

// ---------------------------------------------------------------- combat

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function groundAim() {
  ndc.set((Input.mouseX / innerWidth) * 2 - 1, -(Input.mouseY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const o = raycaster.ray.origin;
  const d = raycaster.ray.direction;
  if (Math.abs(d.y) < 1e-4) return null;
  const t = (1.15 - o.y) / d.y;
  if (t < 0) return null;
  return { x: o.x + d.x * t, z: o.z + d.z * t };
}

function punch() {
  player.punchTime = 0.26;
  const px = player.mesh.position.x;
  const pz = player.mesh.position.z;
  sfx.punch();
  for (const ped of peds.peds) {
    if (ped.state === 'down' || ped.state === 'dead') continue;
    const d = dist2d(ped.mesh.position.x, ped.mesh.position.z, px, pz);
    if (d > TUNE.punchRange) continue;
    const ang = Math.atan2(ped.mesh.position.x - px, ped.mesh.position.z - pz);
    if (Math.abs(angleDiff(player.angle, ang)) > 1.05) continue;
    peds.knockDown(ped, false);
    wanted.add(1, witnessed(px, pz));
    peds.scare(px, pz, 13);
    effects.burst(ped.mesh.position, { count: 6, color: [1, 0.9, 0.6], speed: 3, up: 3, life: 0.3 });
    return;
  }
}

function shoot(aim) {
  if (player.fireCooldown > 0 || !aim) return;
  player.fireCooldown = 0.21;
  const px = player.mesh.position.x;
  const pz = player.mesh.position.z;
  player.angle = Math.atan2(aim.x - px, aim.z - pz);
  sfx.shot();
  const gx = px + Math.sin(player.angle) * 0.65;
  const gz = pz + Math.cos(player.angle) * 0.65;
  effects.flashAt({ x: gx, y: 1.3, z: gz }, 3.2);
  effects.burst({ x: gx, y: 1.3, z: gz }, { count: 4, color: [1, 0.85, 0.4], speed: 2, up: 0.6, life: 0.16 });
  peds.scare(px, pz, 19);
  wanted.add(1, witnessed(px, pz));
  // Hitscan: nearest victim within a narrow cone along the aim direction.
  const dx = aim.x - px;
  const dz = aim.z - pz;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  let bestT = 46;
  let hitPed = null;
  let hitCar = null;
  for (const ped of peds.peds) {
    if (ped.state === 'dead') continue;
    const rx = ped.mesh.position.x - px;
    const rz = ped.mesh.position.z - pz;
    const along = rx * ux + rz * uz;
    if (along < 0.5 || along > bestT) continue;
    if (Math.abs(rx * uz - rz * ux) < 0.95) { bestT = along; hitPed = ped; hitCar = null; }
  }
  for (const car of cars) {
    if (car.dead || car === player.car) continue;
    const rx = car.mesh.position.x - px;
    const rz = car.mesh.position.z - pz;
    const along = rx * ux + rz * uz;
    if (along < 0.5 || along > bestT) continue;
    if (Math.abs(rx * uz - rz * ux) < 2.1) { bestT = along; hitCar = car; hitPed = null; }
  }
  const hitPos = { x: px + ux * bestT, y: 1, z: pz + uz * bestT };
  if (hitPed) {
    peds.knockDown(hitPed, true);
    effects.burst(hitPed.mesh.position, { count: 10, color: [0.85, 0.2, 0.25], speed: 3.4, up: 3, life: 0.5 });
    wanted.add(2, witnessed(px, pz));
  } else if (hitCar) {
    damageCar(hitCar, 22, effects);
    effects.sparks(hitPos, 8);
    if (hitCar.mode === 'police') wanted.add(2, witnessed(px, pz));
  }
}

// ---------------------------------------------------------------- busted / wasted

function doBusted() {
  mode = 'busted';
  overlayTimer = 2.6;
  const fine = Math.min(player.cash, 150 + wanted.stars * 60);
  player.cash -= fine;
  document.getElementById('bustednote').textContent =
    `The Vice Palms PD took you in. Fine: $${fine}.`;
  document.getElementById('bustedscreen').classList.add('on');
  sfx.bustedJingle();
  sfx.sirenStop();
  sfx.engineStop();
}

function doWasted() {
  mode = 'wasted';
  overlayTimer = 2.6;
  const fine = Math.min(player.cash, 200);
  player.cash -= fine;
  document.getElementById('wastednote').textContent =
    `You woke up at Vice Palms General. Medical bill: $${fine}.`;
  document.getElementById('wastedscreen').classList.add('on');
  sfx.missionFail();
  sfx.sirenStop();
  sfx.engineStop();
}

function respawn() {
  document.getElementById('bustedscreen').classList.remove('on');
  document.getElementById('wastedscreen').classList.remove('on');
  if (player.car) {
    player.car.mode = 'parked';
    player.car.speed = 0;
    player.car = null;
    facade.playerCar = null;
  }
  player.mesh.visible = true;
  player.hp = TUNE.playerMaxHealth;
  bustedMeter = 0;
  wanted.reset();
  for (const c of [...police.cars]) police.release(c);
  teleport(...(mode === 'busted' ? [SPOTS.policeStation.x, SPOTS.policeStation.z] : [SPOTS.hospital.x, SPOTS.hospital.z]));
  mode = 'play';
}

// ---------------------------------------------------------------- per-frame updates

function updatePlayerOnFoot(dt) {
  const pos = player.mesh.position;
  if (player.downTime > 0) {
    player.downTime -= dt;
    if (player.downTime <= 0) standUp(player.mesh);
    return;
  }
  let mx = 0;
  let mz = 0;
  if (Input.down('KeyW', 'ArrowUp')) mz += 1;
  if (Input.down('KeyS', 'ArrowDown')) mz -= 1;
  if (Input.down('KeyA', 'ArrowLeft')) mx -= 1;
  if (Input.down('KeyD', 'ArrowRight')) mx += 1;
  const moving = mx !== 0 || mz !== 0;
  const sprint = Input.down('ShiftLeft', 'ShiftRight');
  const aim = groundAim();
  const aiming = Input.mouseDown || performance.now() - lastMouseMoveT < 2200;
  if (moving) {
    // Camera-relative movement: screen-forward is away from the camera,
    // screen-right is the camera's right hand.
    const fx = Math.sin(camYaw) * -mz + Math.cos(camYaw) * mx;
    const fz = Math.cos(camYaw) * -mz - Math.sin(camYaw) * mx;
    const speed = sprint ? TUNE.sprintSpeed : TUNE.walkSpeed;
    const fl = Math.hypot(fx, fz) || 1;
    pos.x += (fx / fl) * speed * dt;
    pos.z += (fz / fl) * speed * dt;
    if (!aiming || !aim) {
      player.angle = angleLerp(player.angle, Math.atan2(fx, fz), 1 - Math.exp(-dt * TUNE.turnRate));
    }
    player.phase += dt * speed * 1.55;
    animatePerson(playerParts, player.phase, sprint ? 1 : 0.8);
  } else {
    animatePerson(playerParts, player.phase, 0);
    playerParts.legL.rotation.x *= 0.8;
    playerParts.legR.rotation.x *= 0.8;
    playerParts.armL.rotation.x *= 0.8;
    playerParts.armR.rotation.x *= 0.8;
  }
  if (aiming && aim && !missions.dialogueActive) {
    player.angle = angleLerp(player.angle, Math.atan2(aim.x - pos.x, aim.z - pos.z), 1 - Math.exp(-dt * 14));
  }
  if (player.punchTime > 0) {
    player.punchTime -= dt;
    playerParts.armR.rotation.x = -2.1 * Math.sin((player.punchTime / 0.26) * Math.PI);
  }
  city.collideCircle(pos, TUNE.playerRadius);
  player.mesh.rotation.y = player.angle;
}

function updatePlayerDriving(dt) {
  const car = player.car;
  let throttle = 0;
  let steer = 0;
  if (Input.down('KeyW', 'ArrowUp')) throttle += 1;
  if (Input.down('KeyS', 'ArrowDown')) throttle -= 1;
  if (Input.down('KeyA', 'ArrowLeft')) steer += 1;
  if (Input.down('KeyD', 'ArrowRight')) steer -= 1;
  const boosting = Input.down('ShiftLeft', 'ShiftRight');
  const preSpeed = Math.abs(car.speed);
  const preX = car.mesh.position.x;
  const preZ = car.mesh.position.z;
  driveCar(car, throttle, steer, dt, boosting);
  city.collideCircle(car.mesh.position, car.radius);
  const corrected = Math.hypot(car.mesh.position.x - preX, car.mesh.position.z - preZ);
  const travelled = preSpeed * dt;
  if (travelled - corrected > 1.2 && preSpeed > 7) {
    // Ran into a building: crunch.
    car.speed *= 0.3;
    shake = Math.min(1, preSpeed / 26);
    sfx.crash(0.9);
    effects.sparks(car.mesh.position, 14);
    hurtPlayer(preSpeed * 0.55);
  }
  player.mesh.position.copy(car.mesh.position);
  sfx.engineSet(1, Math.abs(car.speed) / 36);
}

function hurtPlayer(amount) {
  if (mode !== 'play') return;
  player.hp -= amount;
  player.hurtFlash = 1;
  if (player.hp <= 0) {
    player.hp = 0;
    doWasted();
  }
}

function onCarCrash(a, b, impact) {
  const mid = {
    x: (a.mesh.position.x + b.mesh.position.x) / 2,
    y: 0.8,
    z: (a.mesh.position.z + b.mesh.position.z) / 2,
  };
  effects.sparks(mid, Math.min(22, 6 + impact));
  damageCar(a, impact * 1.6, effects);
  damageCar(b, impact * 1.6, effects);
  if (a === player.car || b === player.car) {
    shake = Math.min(1, impact / 15);
    sfx.crash(clamp(impact / 12, 0.3, 1));
    if (impact > 9) hurtPlayer(impact * 0.7);
    const other = a === player.car ? b : a;
    if (other.mode === 'police') wanted.add(2, true);
    else if (impact > 8) wanted.add(1, witnessed(mid.x, mid.z));
  } else if (impact > 7) {
    sfx.crash(0.4);
  }
}

function updateWorld(dt) {
  const px = facade.playerPos.x;
  const pz = facade.playerPos.z;
  traffic.update(dt, cars, rng);
  // A stolen traffic car should eventually be replaced out of sight.
  peds.update(dt);
  const target = {
    x: px, z: pz,
    vx: player.vel.x, vz: player.vel.z,
    speed: player.car ? player.car.speed : 0,
    onFoot: !player.car,
  };
  police.maintain(dt, wanted, rng, px, pz);
  const seen = police.update(dt, target, city);
  wanted.update(dt, seen && wanted.stars > 0);
  collideCars(cars, onCarCrash);
  for (const car of cars) {
    if (car.mode === 'parked' && !car.dead) syncCarMesh(car, 0);
  }
  // Cars versus pedestrians, and versus the player on foot.
  for (const car of cars) {
    if (Math.abs(car.speed) < 4 || car === player.car) continue;
    for (const ped of peds.peds) {
      if (ped.state === 'down' || ped.state === 'dead') continue;
      if (dist2d(ped.mesh.position.x, ped.mesh.position.z, car.mesh.position.x, car.mesh.position.z) < 2.35) {
        peds.knockDown(ped, Math.abs(car.speed) > 17);
        peds.scare(car.mesh.position.x, car.mesh.position.z, 15);
        car.speed *= 0.72;
        sfx.crash(0.4);
      }
    }
    if (!player.car && player.downTime <= 0 &&
        dist2d(player.mesh.position.x, player.mesh.position.z, car.mesh.position.x, car.mesh.position.z) < 2.3) {
      hurtPlayer(9 + Math.abs(car.speed) * 0.55);
      layDown(player.mesh);
      player.downTime = 1.0;
      const away = Math.atan2(player.mesh.position.x - car.mesh.position.x, player.mesh.position.z - car.mesh.position.z);
      player.mesh.position.x += Math.sin(away) * 2.2;
      player.mesh.position.z += Math.cos(away) * 2.2;
      shake = Math.max(shake, 0.5);
      sfx.crash(0.7);
    }
  }
  // The player running people down is a serious crime.
  if (player.car && Math.abs(player.car.speed) > 4) {
    for (const ped of peds.peds) {
      if (ped.state === 'down' || ped.state === 'dead') continue;
      if (dist2d(ped.mesh.position.x, ped.mesh.position.z, player.mesh.position.x, player.mesh.position.z) < 2.35) {
        peds.knockDown(ped, Math.abs(player.car.speed) > 17);
        peds.scare(player.mesh.position.x, player.mesh.position.z, 16);
        wanted.add(3, true);
        player.car.speed *= 0.7;
        shake = Math.max(shake, 0.4);
        sfx.crash(0.6);
      }
    }
  }
  // Busted pressure while on foot.
  if (!player.car && wanted.stars > 0 && mode === 'play') {
    const nd = police.nearestDistance(px, pz);
    if (nd < 4.6) bustedMeter += dt / TUNE.bustedTime;
    else bustedMeter = Math.max(0, bustedMeter - dt * 0.8);
    if (bustedMeter >= 1) doBusted();
  } else {
    bustedMeter = Math.max(0, bustedMeter - dt * 0.8);
  }
  // Siren loudness follows the nearest unit.
  if (police.cars.length) {
    sfx.sirenStart();
    sfx.sirenSet(clamp(1 - police.nearestDistance(px, pz) / 55, 0.12, 1));
  } else {
    sfx.sirenStop();
  }
}

// ---------------------------------------------------------------- camera

function updateCamera(dt) {
  if (mode === 'menu') {
    // A slow drift above the east avenue, looking down its corridor toward
    // the beach and the low sun: open road, flanking towers, sea at the end.
    const sway = Math.sin(elapsed * 0.07);
    camera.position.set(-52 + sway * 4, 10.5 + Math.sin(elapsed * 0.11) * 1.2, -76);
    camera.lookAt(160, 3, -70);
    return;
  }
  const target = player.car ? player.car.mesh.position : player.mesh.position;
  camYaw -= Input.dragDX * 0.0052;
  camPitch = clamp(camPitch + Input.dragDY * 0.0035, 0.08, 1.05);
  camDist = clamp(camDist + Input.wheel * 1.4, 7, 19);
  if (player.car) {
    // Drift back behind the car when the player isn't orbiting.
    if (!Input.dragging) camYaw = angleLerp(camYaw, player.car.angle + Math.PI, 1 - Math.exp(-dt * 1.6));
  }
  const dist = player.car ? camDist + 3.5 : camDist;
  const back = {
    x: target.x + Math.sin(camYaw) * Math.cos(camPitch) * dist,
    z: target.z + Math.cos(camYaw) * Math.cos(camPitch) * dist,
  };
  const height = 1.6 + Math.sin(camPitch) * dist;
  const k = 1 - Math.exp(-dt * 7);
  camera.position.x += (back.x - camera.position.x) * k;
  camera.position.z += (back.z - camera.position.z) * k;
  camera.position.y += (height - camera.position.y) * k;
  if (camera.position.y < 1.1) camera.position.y = 1.1;
  const look = { x: target.x, y: 1.7, z: target.z };
  if (shake > 0.003) {
    look.x += (Math.random() - 0.5) * shake * 1.4;
    look.y += (Math.random() - 0.5) * shake * 1.1;
    shake *= Math.exp(-dt * 5.2);
  }
  camera.lookAt(look.x, look.y, look.z);
}

// ---------------------------------------------------------------- HUD sync

function syncHud() {
  hud.setCash(player.cash);
  hud.setHealth(player.hp / TUNE.playerMaxHealth);
  hud.setStars(wanted.stars);
  hud.setMode(player.car
    ? `DRIVING &nbsp;<b>${player.car.kind === 'sport' ? 'COMET' : player.car.kind.toUpperCase()}</b>`
    : 'ON FOOT');
  const obj = missions.objective();
  hud.setObjective(obj.label, obj.text, obj.timer ? '⏱ ' + obj.timer : '');
  hud.setBusted(bustedMeter > 0.02 ? bustedMeter : null);
  player.hurtFlash = Math.max(0, player.hurtFlash - 0.03);
  hud.setHurt(Math.max(player.hurtFlash, player.hp < 30 ? 0.35 + Math.sin(elapsed * 5) * 0.1 : 0));
  const markers = [];
  if (missions.waypoint) markers.push({ x: missions.waypoint.x, z: missions.waypoint.z, color: '#ffd166', r: 4.4, pulse: true });
  if (missions.stage === 'talk' || missions.sub === 'return') {
    markers.push({ x: SPOTS.rico.x, z: SPOTS.rico.z, color: '#19c2c2', r: 3.4 });
  }
  const view = {
    x: facade.playerPos.x, z: facade.playerPos.z,
    angle: player.car ? player.car.angle : player.angle,
  };
  hud.drawMinimap(view, markers, police.cars, elapsed);
  hud.update();
}

// ---------------------------------------------------------------- input actions

function handleActions() {
  if (Input.pressed.has('KeyP') || Input.pressed.has('Escape')) {
    if (mode === 'play') {
      mode = 'pause';
      document.getElementById('pausescreen').classList.add('on');
    } else if (mode === 'pause' || mode === 'help') {
      mode = 'play';
      document.getElementById('pausescreen').classList.remove('on');
      document.getElementById('helpscreen').classList.remove('on');
    }
    return;
  }
  if (Input.pressed.has('KeyH')) {
    if (mode === 'play') {
      mode = 'help';
      document.getElementById('helpscreen').classList.add('on');
    } else if (mode === 'help') {
      mode = 'play';
      document.getElementById('helpscreen').classList.remove('on');
    }
    return;
  }
  if (mode !== 'play') return;
  if (Input.pressed.has('KeyK')) persist(true);
  if (Input.pressed.has('KeyE')) {
    if (missions.dialogueActive) {
      missions.advanceDialogue();
    } else if (player.car) {
      exitCar();
    } else {
      const pos = player.mesh.position;
      const car = nearestCarTo(pos.x, pos.z, 3.6);
      if (car) enterCar(car);
      else if (dist2d(pos.x, pos.z, SPOTS.rico.x, SPOTS.rico.z) < 3.8) missions.talkToRico();
    }
  }
  if (Input.pressed.has('KeyF')) {
    if (player.car) exitCar();
    else if (!missions.dialogueActive) punch();
  }
  if (Input.clicked && !player.car && !missions.dialogueActive) {
    const aim = groundAim();
    if (aim) shoot(aim);
  }
  player.fireCooldown = Math.max(0, player.fireCooldown - 1 / 60);
}

// ---------------------------------------------------------------- start / scenes

function beginPlay(fromSave) {
  document.getElementById('startscreen').classList.remove('on');
  hud.show();
  mode = 'play';
  sfx.unlock();
  if (fromSave) {
    const data = loadGame();
    if (data) {
      player.cash = data.cash;
      missions.restore(data.missionIndex, data.chainDone);
      teleport(data.x, data.z);
      hud.toast('Welcome back to Vice Palms');
    }
  }
}

document.getElementById('startbtn').addEventListener('click', () => beginPlay(false));
document.getElementById('continuebtn').addEventListener('click', () => beginPlay(true));
if (!hasSave()) document.getElementById('continuebtn').disabled = true;
Input.attach(canvas);

// Deterministic screenshot setups: fixed states, no input needed.
function setupShotScene(name) {
  document.getElementById('startscreen').classList.remove('on');
  hud.show();
  mode = 'play';
  if (name === 'menu') {
    document.getElementById('startscreen').classList.add('on');
    hud.hide();
    mode = 'menu';
    return;
  }
  if (name === 'foot') {
    // Stand at the open intersection corner south-east of Rico: no palms or
    // towers crowd the camera line here.
    teleport(8.5, -144.5);
    player.angle = Math.atan2(SPOTS.rico.x - 8.5, SPOTS.rico.z + 144.5);
    player.mesh.rotation.y = player.angle;
    camYaw = player.angle + Math.PI;
    missions.talkToRico();
    return;
  }
  if (name === 'drive' || name === 'chase') {
    const kind = name === 'drive' ? 'sport' : 'sedan';
    // The drive shot is the Comet run: the player is in the teal Comet itself.
    const color = name === 'drive' ? 0x12b5a5 : 0x19c2c2;
    const car = spawnCar(scene, kind, color, -26, LANE, Math.PI / 2);
    car.mode = 'player';
    car.speed = 17;
    cars.push(car);
    player.car = car;
    facade.playerCar = car;
    player.mesh.visible = false;
    player.mesh.position.copy(car.mesh.position);
    camYaw = car.angle + Math.PI;
    camPitch = 0.28;
    shotCarAutopilot = true;
    // Posed traffic on the same avenue, so the road reads alive in a still.
    const poseTraffic = (u, dir, kind2, color2) => {
      const tc = spawnCar(scene, kind2, color2, u, dir > 0 ? LANE : -LANE, dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      tc.mode = 'traffic';
      tc.axis = 'x';
      tc.street = 0;
      tc.dir = dir;
      tc.u = u;
      tc.cruise = 11;
      tc.speed = 11;
      tc.turnCooldown = 99;
      tc.rng = rng;
      traffic.cars.push(tc);
      cars.push(tc);
    };
    if (name === 'drive') {
      poseTraffic(38, 1, 'van', 0xf2f2f2);
      poseTraffic(64, -1, 'taxi', 0xffc21c);
      poseTraffic(110, 1, 'sedan', 0x53d769);
      missions.index = 0;
      missions.stage = 'active';
      missions.sub = 'deliver';
      missions.waypoint = { ...SPOTS.chopShop, color: '#ffd166' };
    } else {
      wanted.points = 9;
      missions.index = 2;
      missions.stage = 'active';
      missions.sub = 'escape';
      missions.waypoint = null;
      // Two units cut the player off ahead; a third closes in at the frame's
      // edge — a chase the camera can actually see.
      camDist = 9;
      const poses = [
        { x: 2, z: 10.8, angle: Math.PI + 0.6 },
        { x: 10, z: -5.2, angle: Math.PI - 0.45 },
        { x: -34.5, z: -8.5, angle: Math.PI / 2 },
      ];
      for (const pose of poses) {
        const cop = police.spawnNear(rng, pose.x, pose.z);
        cop.mesh.position.set(pose.x, 0, pose.z);
        cop.angle = pose.angle;
        cop.speed = 14;
      }
      poseTraffic(52, -1, 'sedan', 0xff5d7a);
    }
  }
}

if (SHOT_SCENE) setupShotScene(SHOT_SCENE);

// In screenshot scenes the player's car drives itself down the avenue.
function shotAutopilot(dt) {
  if (!shotCarAutopilot || !player.car) return;
  const car = player.car;
  const steer = clamp(angleDiff(car.angle, Math.PI / 2) * 1.4, -0.7, 0.7);
  driveCar(car, 0.82, steer, dt, false);
  city.collideCircle(car.mesh.position, car.radius);
  if (car.mesh.position.x > 168) {
    car.mesh.position.x = -168;
    for (const cop of police.cars) cop.mesh.position.x -= 300;
  }
  player.mesh.position.copy(car.mesh.position);
  if (SHOT_SCENE === 'chase' && framesRendered % 26 === 0) {
    effects.sparks({ x: car.mesh.position.x - 3, y: 0.7, z: car.mesh.position.z + 1.4 }, 7);
  }
}

// ---------------------------------------------------------------- main loop

const clock = new THREE.Clock();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  framesRendered++;

  if (mode === 'play' || mode === 'pause' || mode === 'help') {
    handleActions();
    if (mode === 'play') { // an action may have paused us
      if (SHOT_SCENE) shotAutopilot(dt);
      else if (player.car) updatePlayerDriving(dt);
      else updatePlayerOnFoot(dt);
      const anchor = player.car ? player.car.mesh.position : player.mesh.position;
      const prevX = facade.playerPos.x;
      const prevZ = facade.playerPos.z;
      facade.playerPos.x = anchor.x;
      facade.playerPos.z = anchor.z;
      if (dt > 0) {
        player.vel.x = (anchor.x - prevX) / dt;
        player.vel.z = (anchor.z - prevZ) / dt;
      }
      updateWorld(dt);
      missions.update(dt, elapsed);
      missions.updateRoam();
      // The objective beacon tracks the mission waypoint.
      if (missions.waypoint && !missions.dialogueActive) {
        beacon.visible = true;
        beacon.position.set(missions.waypoint.x, 0, missions.waypoint.z);
        beacon.userData.spin(elapsed);
      } else {
        beacon.visible = false;
      }
      rico.marker.visible = missions.stage === 'talk' || missions.sub === 'return';
      rico.update(elapsed, facade.playerPos);
      city.followShadows(anchor.x, anchor.z);
    }
  } else if (mode === 'busted' || mode === 'wasted') {
    overlayTimer -= dt;
    if (overlayTimer <= 0) respawn();
  } else if (mode === 'menu') {
    // The menu world idles: traffic rolls, the sea moves, Rico waits.
    traffic.update(dt, cars, rng);
    peds.update(dt);
    rico.update(elapsed, null);
  }

  city.update(dt, elapsed);
  effects.update(dt);
  updateCamera(dt);
  if (mode !== 'menu') syncHud();
  renderer.render(scene, camera);
  Input.postFrame();
  if (SHOT_SCENE && framesRendered > 110) window.__shotReady = true;
}

frame();
