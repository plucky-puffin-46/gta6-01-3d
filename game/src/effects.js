// Puffin Vice 3D — a tiny pooled particle system (sparks, smoke, splashes of
// colour on pickups) built on one THREE.Points cloud, plus the muzzle-flash
// light the player and police shots share.

const MAX = 900;

export class Effects {
  constructor(scene) {
    this.positions = new Float32Array(MAX * 3);
    this.colors = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.head = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.55, vertexColors: true, transparent: true, opacity: 0.95,
      depthWrite: false, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    for (let i = 0; i < MAX; i++) this.positions[i * 3 + 1] = -50;

    // One reusable point light for muzzle flashes and crash sparks.
    this.flash = new THREE.PointLight(0xffc873, 0, 26);
    this.flash.position.set(0, -10, 0);
    scene.add(this.flash);
    this.flashTime = 0;
  }

  spawn(x, y, z, vx, vy, vz, life, r, g, b, grav) {
    const i = this.head;
    this.head = (this.head + 1) % MAX;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.colors[i * 3] = r;
    this.colors[i * 3 + 1] = g;
    this.colors[i * 3 + 2] = b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = grav;
  }

  burst(pos, { count = 14, color = [1, 0.75, 0.3], speed = 6, up = 4, life = 0.55, grav = -9 } = {}) {
    for (let n = 0; n < count; n++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.spawn(
        pos.x, pos.y ?? 1, pos.z,
        Math.cos(a) * s, up * (0.3 + Math.random() * 0.9), Math.sin(a) * s,
        life * (0.5 + Math.random() * 0.8),
        color[0], color[1], color[2], grav,
      );
    }
  }

  sparks(pos, count = 16) {
    this.burst(pos, { count, color: [1, 0.8, 0.35], speed: 7, up: 3.5, life: 0.45, grav: -11 });
    this.flashAt(pos, 2.4);
  }

  smoke(pos, count = 10) {
    this.burst(pos, { count, color: [0.32, 0.32, 0.36], speed: 1.6, up: 3.2, life: 1.15, grav: 2.5 });
  }

  // A low, tan puff that hangs around — dust kicked up by a drifting car.
  dust(pos, count = 7) {
    this.burst(pos, { count, color: [0.78, 0.66, 0.48], speed: 2.1, up: 1.1, life: 0.85, grav: 0.7 });
  }

  confetti(pos, count = 18) {
    this.burst(pos, { count, color: [0.45, 1, 0.6], speed: 4, up: 6, life: 0.8, grav: -6 });
  }

  flashAt(pos, intensity = 3) {
    this.flash.position.set(pos.x, (pos.y ?? 1) + 0.6, pos.z);
    this.flash.intensity = intensity;
    this.flashTime = 0.05;
  }

  update(dt) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.positions[i * 3 + 1] = -50;
        continue;
      }
      this.vel[i * 3 + 1] += this.grav[i] * dt;
      this.positions[i * 3] += this.vel[i * 3] * dt;
      this.positions[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.positions[i * 3 + 1] < 0.1) this.positions[i * 3 + 1] = 0.1;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      if (this.flashTime <= 0) this.flash.intensity = 0;
    }
  }
}
