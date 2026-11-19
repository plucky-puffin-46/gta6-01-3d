// Puffin Vice 3D — Rico's story chain: three missions with dialogue,
// waypoints, timers and payouts, then free-roam package work forever.
// The class talks to the rest of the game through the `game` facade the main
// loop hands it: player position/car, cash, HUD, wanted, sfx and autosave.

import { SPOTS } from './config.js';
import { dist2d } from './random.js';

const RICO = 'RICO';
const YOU = 'YOU';

function pickupMesh(color) {
  const group = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.9, 0.9),
    new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.55, shininess: 60 }),
  );
  box.position.y = 1.1;
  box.castShadow = true;
  group.add(box);
  group.userData.box = box;
  return group;
}

export class Missions {
  constructor(game) {
    this.game = game;
    this.index = 0;               // 0,1,2 = story missions; 3 = chain done
    this.stage = 'talk';          // talk | briefing | active substages | roam
    this.sub = '';                // active sub-stage: get/deliver/run/fetch/return/escape
    this.waypoint = { x: SPOTS.rico.x, z: SPOTS.rico.z, color: '#19c2c2' };
    this.dialogue = null;
    this.timer = 0;
    this.packageIndex = 0;
    this.roamTarget = null;
    this.pickup = null;           // floating pickup mesh (package / briefcase)
  }

  get chainDone() {
    return this.index >= 3;
  }

  // --- Dialogue plumbing -----------------------------------------------------

  startDialogue(lines, onDone) {
    this.dialogue = { lines, i: 0, onDone };
    const line = lines[0];
    this.game.hud.showDialogue(line.name, line.text);
  }

  advanceDialogue() {
    if (!this.dialogue) return false;
    this.dialogue.i++;
    if (this.dialogue.i >= this.dialogue.lines.length) {
      const done = this.dialogue.onDone;
      this.dialogue = null;
      this.game.hud.hideDialogue();
      if (done) done();
    } else {
      const line = this.dialogue.lines[this.dialogue.i];
      this.game.hud.showDialogue(line.name, line.text);
    }
    return true;
  }

  get dialogueActive() {
    return this.dialogue !== null;
  }

  // --- Story flow --------------------------------------------------------------

  // The player pressed E next to Rico.
  talkToRico() {
    if (this.stage !== 'talk' || this.dialogueActive) return;
    const g = this.game;
    if (this.index === 0) {
      this.startDialogue([
        { name: RICO, text: 'You look like a man who owes the wrong people money. I can fix that.' },
        { name: YOU, text: 'I drive, I carry, I don\'t ask questions. What\'s the job?' },
        { name: RICO, text: 'A teal Comet, parked up on the west side. The owner owes me. Take it, bring it to the Chop Shop — and try not to be seen.' },
      ], () => {
        this.stage = 'active';
        this.sub = 'get';
        this.waypoint = { x: SPOTS.cometPark.x, z: SPOTS.cometPark.z, color: '#ffd166' };
        g.toast('New objective: steal the teal Comet');
      });
    } else if (this.index === 1) {
      this.startDialogue([
        { name: RICO, text: 'Clean work. Now — three packages, three corners of the city, and the clock is not your friend.' },
        { name: RICO, text: 'The boys in blue will be watching the drops. Keep it at two stars of trouble, no more. Go!' },
      ], () => {
        this.stage = 'active';
        this.sub = 'run';
        this.packageIndex = 0;
        this.timer = 170;
        g.wanted.setFloor(2);
        this.placePickup(SPOTS.packages[0], 0xffb703);
        this.waypoint = { ...SPOTS.packages[0], color: '#ffd166' };
        g.toast('Package run: 170 seconds, 3 drops');
      });
    } else if (this.index === 2) {
      this.startDialogue([
        { name: RICO, text: 'Last job, biggest payday. A briefcase is sitting out on the sand, east beach.' },
        { name: RICO, text: 'The second you touch it, every cop in Vice Palms will know your name. Bring it to me, then disappear until the heat dies.' },
      ], () => {
        this.stage = 'active';
        this.sub = 'fetch';
        this.placePickup(SPOTS.briefcase, 0xff2e88);
        this.waypoint = { ...SPOTS.briefcase, color: '#ffd166' };
        g.toast('New objective: the briefcase on the beach');
      });
    }
  }

  // The player got into a car; the Comet job cares which one.
  onEnterCar(car) {
    if (this.index === 0 && this.stage === 'active' && this.sub === 'get' && car === this.game.comet) {
      this.sub = 'deliver';
      this.waypoint = { ...SPOTS.chopShop, color: '#ffd166' };
      this.game.toast('Got the Comet — take it to the Chop Shop');
      this.game.sfx.pickup();
    }
  }

  placePickup(at, color) {
    this.clearPickup();
    this.pickup = pickupMesh(color);
    this.pickup.position.set(at.x, 0, at.z);
    this.game.scene.add(this.pickup);
  }

  clearPickup() {
    if (this.pickup) {
      this.game.scene.remove(this.pickup);
      this.pickup = null;
    }
  }

  completeMission(payout, line) {
    const g = this.game;
    g.addCash(payout);
    g.sfx.missionDone();
    g.hud.toast(`Mission complete  +$${payout.toLocaleString('en-US')}`);
    this.index++;
    this.stage = 'talk';
    this.sub = '';
    this.waypoint = { x: SPOTS.rico.x, z: SPOTS.rico.z, color: '#19c2c2' };
    if (line) this.startDialogue([line], null);
    g.autosave();
  }

  failRun() {
    const g = this.game;
    g.wanted.clearFloor();
    g.sfx.missionFail();
    this.clearPickup();
    this.stage = 'talk';
    this.sub = '';
    this.waypoint = { x: SPOTS.rico.x, z: SPOTS.rico.z, color: '#19c2c2' };
    this.startDialogue([
      { name: RICO, text: 'Too slow. The packages are cold and so is my patience. Come back and we try again.' },
    ], null);
  }

  // --- Per-frame ----------------------------------------------------------------

  update(dt, t) {
    const g = this.game;
    if (this.pickup) {
      this.pickup.userData.box.rotation.y = t * 2.4;
      this.pickup.userData.box.position.y = 1.1 + Math.sin(t * 3) * 0.22;
    }
    if (this.stage !== 'active') return;
    const p = g.playerPos;

    if (this.index === 0 && this.sub === 'deliver') {
      const comet = g.comet;
      if (g.playerCar === comet &&
          dist2d(p.x, p.z, SPOTS.chopShop.x, SPOTS.chopShop.z) < 8) {
        this.completeMission(800, { name: RICO, text: 'Beautiful. She\'ll be in pieces by sunrise — the good kind. Come see me, there\'s more.' });
        // The Comet is chopped: it leaves the world.
        g.removeCar(comet);
      }
    } else if (this.index === 1 && this.sub === 'run') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.failRun();
        return;
      }
      const target = SPOTS.packages[this.packageIndex];
      if (dist2d(p.x, p.z, target.x, target.z) < 5.5) {
        g.sfx.pickup();
        g.addCash(150);
        g.hud.toast(`Package ${this.packageIndex + 1} of 3  +$150`);
        this.packageIndex++;
        if (this.packageIndex >= SPOTS.packages.length) {
          g.wanted.clearFloor();
          this.clearPickup();
          this.completeMission(1200, { name: RICO, text: 'Three for three, and still breathing. One more job — the big one.' });
        } else {
          this.placePickup(SPOTS.packages[this.packageIndex], 0xffb703);
          this.waypoint = { ...SPOTS.packages[this.packageIndex], color: '#ffd166' };
        }
      }
    } else if (this.index === 2 && this.sub === 'fetch') {
      if (dist2d(p.x, p.z, SPOTS.briefcase.x, SPOTS.briefcase.z) < 5.5) {
        this.clearPickup();
        this.sub = 'return';
        g.wanted.setFloor(3);
        g.wanted.add(9, true);
        g.sfx.pickup();
        g.hud.toast('You have the briefcase — the whole city is coming');
        this.waypoint = { x: SPOTS.rico.x, z: SPOTS.rico.z, color: '#ffd166' };
      }
    } else if (this.index === 2 && this.sub === 'return') {
      if (dist2d(p.x, p.z, SPOTS.rico.x, SPOTS.rico.z) < 7) {
        this.sub = 'escape';
        g.wanted.clearFloor();
        this.waypoint = null;
        g.hud.toast('Briefcase delivered — now lose the cops!');
      }
    } else if (this.index === 2 && this.sub === 'escape') {
      if (g.wanted.stars === 0) {
        this.completeMission(2000, { name: RICO, text: 'A ghost. Nobody saw a thing. Vice Palms is yours now, friend — work finds you from here.' });
        this.startRoam();
      }
    }
  }

  // After the story: endless little package jobs.
  startRoam() {
    if (!this.chainDone) return;
    this.stage = 'roam';
    const g = this.game;
    const spots = [
      { x: -152 + 4.4, z: -40 }, { x: 30, z: 152 - 4.4 }, { x: 152 - 4.4, z: 60 },
      { x: -60, z: -152 + 4.4 }, { x: 224, z: -80 }, { x: 76 + 4.4, z: 120 },
    ];
    this.roamTarget = spots[Math.floor(Math.random() * spots.length)];
    this.placePickup(this.roamTarget, 0x53d769);
    this.waypoint = { ...this.roamTarget, color: '#53d769' };
  }

  updateRoam() {
    if (this.stage !== 'roam' || !this.roamTarget) return;
    const p = this.game.playerPos;
    if (dist2d(p.x, p.z, this.roamTarget.x, this.roamTarget.z) < 5.5) {
      this.game.sfx.pickup();
      this.game.addCash(200);
      this.game.hud.toast('Package delivered  +$200');
      this.clearPickup();
      this.startRoam();
    }
  }

  // What the HUD banner should say right now.
  objective() {
    if (this.dialogueActive) return { label: 'VICE PALMS', text: 'Talking…' };
    if (this.chainDone) return { label: 'FREE ROAM', text: 'Grab the green package — $200 a run' };
    if (this.stage === 'talk') return { label: 'STORY', text: 'Go see Rico by the Cafe Vice' };
    if (this.index === 0) {
      return this.sub === 'deliver'
        ? { label: 'MISSION 1 · HOT COMET', text: 'Deliver the teal Comet to the Chop Shop' }
        : { label: 'MISSION 1 · HOT COMET', text: 'Steal the teal Comet on the west side' };
    }
    if (this.index === 1) {
      return {
        label: 'MISSION 2 · PACKAGE RUN',
        text: `Deliver package ${this.packageIndex + 1} of 3`,
        timer: Math.max(0, Math.ceil(this.timer)) + 's',
      };
    }
    if (this.sub === 'fetch') return { label: 'MISSION 3 · THE BRIEFCASE', text: 'Pick up the briefcase on the east beach' };
    if (this.sub === 'return') return { label: 'MISSION 3 · THE BRIEFCASE', text: 'Bring the briefcase back to Rico' };
    return { label: 'MISSION 3 · THE BRIEFCASE', text: 'Lose the cops — break their line of sight!' };
  }

  // Restore from a save: jump the story to the saved point.
  restore(index, chainDone) {
    this.index = chainDone ? 3 : index;
    this.stage = 'talk';
    this.sub = '';
    this.waypoint = { x: SPOTS.rico.x, z: SPOTS.rico.z, color: '#19c2c2' };
    if (this.chainDone) this.startRoam();
  }
}
