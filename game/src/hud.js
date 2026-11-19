// Puffin Vice 3D — the heads-up display: DOM panels for cash, health, wanted
// stars, the objective banner and dialogue, plus the 2D canvas minimap that
// mirrors the 3D city (streets, beach, sea, blips and the waypoint).

import { STREETS, ROAD_HALF, BEACH_X, WATER_X } from './config.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.root = $('hud');
    this.cashEl = $('cash');
    this.healthEl = $('healthbar');
    this.starsEl = $('stars');
    this.modeEl = $('mode');
    this.objText = $('objtext');
    this.objLabel = document.querySelector('#objective small');
    this.timerEl = $('timer');
    this.dlg = $('dialogue');
    this.dlgName = $('dlgname');
    this.dlgText = $('dlgtext');
    this.bustedWrap = $('bustedwrap');
    this.bustedFill = $('bustedfill');
    this.toastEl = $('toast');
    this.vignette = $('vignette');
    this.map = $('minimap').getContext('2d');
    this.toastUntil = 0;
    this.lastStars = -1;
    this.lastCash = null;
    this.lastObjective = '';
    this.starsEl.style.transition = 'transform .16s ease';
  }

  show() {
    this.root.classList.add('on');
  }

  hide() {
    this.root.classList.remove('on');
  }

  setCash(n) {
    if (n === this.lastCash) return;
    this.lastCash = n;
    this.cashEl.textContent = '$' + Math.round(n).toLocaleString('en-US');
  }

  setHealth(frac) {
    this.healthEl.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
  }

  setStars(n) {
    if (n === this.lastStars) return;
    const rising = this.lastStars >= 0 && n > this.lastStars;
    this.lastStars = n;
    let html = '';
    for (let i = 0; i < 5; i++) html += `<span class="${i < n ? 'lit' : 'dim'}">★</span>`;
    this.starsEl.innerHTML = html;
    if (rising) {
      // A little jolt when the heat goes up, so the change registers.
      this.starsEl.style.transform = 'scale(1.28)';
      setTimeout(() => { this.starsEl.style.transform = 'scale(1)'; }, 170);
    }
  }

  setMode(html) {
    if (this.modeEl.innerHTML !== html) this.modeEl.innerHTML = html;
  }

  setObjective(label, text, timerText = '') {
    // Called every frame; only touch the DOM when something actually changed
    // (the mission timer is the one part that legitimately ticks down).
    const key = label + '|' + text + '|' + timerText;
    if (key === this.lastObjective) return;
    this.lastObjective = key;
    this.objLabel.textContent = label;
    this.objText.textContent = text;
    this.timerEl.textContent = timerText;
  }

  showDialogue(name, text) {
    this.dlgName.textContent = name;
    this.dlgText.textContent = text;
    this.dlg.classList.add('on');
  }

  hideDialogue() {
    this.dlg.classList.remove('on');
  }

  setBusted(frac) {
    if (frac === null || frac <= 0) {
      this.bustedWrap.classList.remove('on');
      return;
    }
    this.bustedWrap.classList.add('on');
    this.bustedFill.style.width = Math.min(1, frac) * 100 + '%';
  }

  toast(text, seconds = 2.4) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastUntil = performance.now() + seconds * 1000;
  }

  setHurt(amount) {
    this.vignette.style.opacity = String(Math.max(0, Math.min(1, amount)));
  }

  update() {
    if (this.toastUntil && performance.now() > this.toastUntil) {
      this.toastEl.classList.remove('show');
      this.toastUntil = 0;
    }
  }

  // view: { x, z, angle } of the player; markers: [{ x, z, color, r, pulse }]
  drawMinimap(view, markers, police, t) {
    const g = this.map;
    const W = 192;
    const H = 192;
    const s = W / 520; // world units -> px, x range -215..305
    const mx = (x) => (x + 215) * s;
    const mz = (z) => H / 2 + z * s;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#17352a';
    g.fillRect(0, 0, W, H);
    // Sea and sand on the east edge.
    g.fillStyle = '#c9a86a';
    g.fillRect(mx(BEACH_X), 0, mx(WATER_X) - mx(BEACH_X), H);
    g.fillStyle = '#12586e';
    g.fillRect(mx(WATER_X), 0, W - mx(WATER_X), H);
    // Streets.
    g.strokeStyle = '#454b5c';
    g.lineWidth = Math.max(2, ROAD_HALF * 2 * s);
    for (const st of STREETS) {
      g.beginPath();
      g.moveTo(mx(st), mz(-196));
      g.lineTo(mx(st), mz(196));
      g.stroke();
      g.beginPath();
      g.moveTo(mx(-196), mz(st));
      g.lineTo(mx(286), mz(st));
      g.stroke();
    }
    // Police blips strobe red/blue like the light bars.
    const copColor = Math.floor(t / 0.16) % 2 === 0 ? '#ff3348' : '#3d7bff';
    for (const c of police) {
      g.fillStyle = copColor;
      g.beginPath();
      g.arc(mx(c.mesh.position.x), mz(c.mesh.position.z), 3.1, 0, Math.PI * 2);
      g.fill();
    }
    // Objective markers (waypoint, Rico, packages).
    for (const m of markers) {
      const r = m.r || 4;
      const rr = m.pulse ? r + Math.sin(t * 5) * 1.2 : r;
      g.fillStyle = m.color;
      g.beginPath();
      g.arc(mx(m.x), mz(m.z), rr, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 1.2;
      g.stroke();
    }
    // Player arrow.
    const px = mx(view.x);
    const py = mz(view.z);
    const fx = Math.sin(view.angle);
    const fz = Math.cos(view.angle);
    const phi = Math.atan2(fx, -fz);
    g.save();
    g.translate(px, py);
    g.rotate(phi);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -6.5);
    g.lineTo(4.4, 5);
    g.lineTo(0, 2.6);
    g.lineTo(-4.4, 5);
    g.closePath();
    g.fill();
    g.restore();
  }
}
