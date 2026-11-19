// Puffin Vice 3D — shared tuning, palette and the shape of Vice Palms.
// The city is NOT a grid: seven avenues radiate from a central plaza, two
// ring roads (plus a small plaza ring) circle it, a couple of diagonal
// avenues cut corners, and a curved boulevard follows the beach. Everything
// that needs to agree on that layout — road graph parameters, landmark
// positions, mission spots — lives here or is derived from here.

// --- The road network's parameters ------------------------------------------

export const ROAD_HALF = 9;              // half the road width (18 across)
export const LANE_OFF = 3.8;             // traffic lane offset from a centre line
export const PLAZA_R = 17;               // radius of the paved central plaza
export const RING_RADII = [27, 66, 120]; // plaza ring, inner ring, outer ring
export const RADIAL_ANGLES = [-160, -105, -55, -15, 30, 80, 130]; // degrees
export const RADIAL_END = 172;           // where landward avenues stop (roundabout)
export const BLVD_INSET = 30;            // boulevard sits this far west of the waterline

// The shoreline curves: the water's edge x for a given z. The sand runs from
// shoreX(z) - 38 to the waterline; the boulevard runs at shoreX(z) - 30.
export function shoreX(z) {
  return 205 + 30 * Math.sin(z * 0.0105) + 12 * Math.sin(z * 0.021 + 1.3);
}
export const boulevardX = (z) => shoreX(z) - BLVD_INSET;

// Playable bounds (the collide helper clamps actors into this region).
export const WORLD = { minX: -208, maxX: 312, minZ: -218, maxZ: 218 };

// Small polar helpers: an avenue at angle a (degrees) heads along
// (cos a, sin a) in the (x, z) plane; its left-hand perpendicular is
// (-sin a, cos a). dirAngle converts a heading vector to the game's
// facing convention (angle whose forward is (sin θ, cos θ)).
export const polar = (r, deg) => {
  const a = (deg * Math.PI) / 180;
  return { x: r * Math.cos(a), z: r * Math.sin(a) };
};
export const perpOf = (deg) => {
  const a = (deg * Math.PI) / 180;
  return { x: -Math.sin(a), z: Math.cos(a) };
};
export const dirAngle = (deg) => {
  const a = (deg * Math.PI) / 180;
  return Math.atan2(Math.cos(a), Math.sin(a));
};

// Sunset Vice palette.
export const PALETTE = {
  skyTop: 0x2e1a5e,
  skyMid: 0xb84a7d,
  skyLow: 0xff9e5e,
  fog: 0xe88a63,
  sun: 0xffb36b,
  hemiSky: 0xffd9a8,
  hemiGround: 0x274d4a,
  asphalt: 0x23242e,
  sidewalk: 0x8f9299,
  grass: 0x2f6b4f,
  sand: 0xecc987,
  water: 0x1595a8,
  pink: 0xff2e88,
  teal: 0x19c2c2,
  cream: 0xffe8c9,
  taxi: 0xffc21c,
  police: 0xf2f5f7,
};

// Player / world tuning.
export const TUNE = {
  walkSpeed: 7.2,
  sprintSpeed: 11.5,
  turnRate: 11,              // how fast the on-foot character faces movement
  playerRadius: 0.85,
  playerMaxHealth: 100,
  punchRange: 2.1,
  punchDamage: 34,
  shotDamage: 55,
  carRadius: 2.35,
  trafficCount: 15,
  parkedCount: 20,
  pedCount: 22,
  wantedPerStar: 3,          // wanted points per star
  wantedDecay: 0.55,         // points per second while unseen
  unseenAfter: 7,            // seconds unseen before decay starts
  bustedTime: 2.2,           // seconds in police reach (on foot) to be busted
  startCash: 250,
};

// --- Landmarks ----------------------------------------------------------------
// Named buildings placed beside a chosen avenue: `angle`/`r` give a point on
// the avenue's centre line, `side` (+1/-1) which side of the road the
// building stands on, w/d/h its size. city.js builds the block; the standing
// spot in front of it (respawn / meeting point) is derived here.

function landmarkSpot(lm) {
  const base = polar(lm.r, lm.angle);
  const p = perpOf(lm.angle);
  // Where the facade actually lands: city.js centres the block at
  // ROAD_HALF + 2.2 + d/2 from the centre line, and the block's width w
  // runs perpendicular to the avenue, so the road-facing wall sits at
  // ROAD_HALF + 2.2 + (d - w) / 2 — 9.2 for all four landmarks (each has
  // w = d + 4). The standing spot is on the forecourt, just off the kerb
  // in front of that wall.
  const off = ROAD_HALF - 0.6;
  return { x: base.x + p.x * lm.side * off, z: base.z + p.z * lm.side * off };
}

export const LANDMARKS = [
  { id: 'cafe', sign: 'CAFE VICE', angle: 80, r: 92, side: -1, w: 26, d: 22, h: 15, color: 0xf7c8d8, signColor: '#ff2e88', signBg: '#fff3fa' },
  { id: 'police', sign: 'POLICE', angle: -105, r: 90, side: 1, w: 28, d: 24, h: 16, color: 0xdfe9f5, signColor: '#ffffff', signBg: '#1c4fd8' },
  { id: 'hospital', sign: 'HOSPITAL', angle: 130, r: 90, side: 1, w: 28, d: 24, h: 15, color: 0xf5f2ee, signColor: '#e0213a', signBg: '#ffffff' },
  { id: 'chop', sign: 'CHOP SHOP', angle: 30, r: 148, side: -1, w: 30, d: 26, h: 13, color: 0x3a3f4a, signColor: '#ffb36b', signBg: '#22242c' },
];

// Fixed spots the missions and respawns use, all anchored to the new map.
const cafeSpot = landmarkSpot(LANDMARKS[0]);
const policeSpot = landmarkSpot(LANDMARKS[1]);
const hospitalSpot = landmarkSpot(LANDMARKS[2]);
const chopBase = polar(LANDMARKS[3].r, LANDMARKS[3].angle);
const chopPerp = perpOf(LANDMARKS[3].angle);

export const SPOTS = {
  rico: cafeSpot,                                   // in front of the Cafe Vice
  // A step and a half from Rico, toward the avenue (perp sign flips:
  // Rico stands on the -1 side of the 80° avenue, so +perp walks back
  // toward the road) — close enough to talk, clear of the traffic lanes.
  playerStart: { x: cafeSpot.x + perpOf(80).x * 1.6, z: cafeSpot.z + perpOf(80).z * 1.6 },
  // The teal Comet, kerbside on the west-northwest avenue, facing outward.
  cometPark: (() => {
    const base = polar(86, -160);
    const p = perpOf(-160);
    return {
      x: base.x + p.x * (ROAD_HALF - 1.7),
      z: base.z + p.z * (ROAD_HALF - 1.7),
      angle: dirAngle(-160),
    };
  })(),
  // Delivery point at the Chop Shop's kerb (close enough to trigger from
  // the driving lane).
  chopShop: {
    x: chopBase.x + chopPerp.x * LANDMARKS[3].side * (ROAD_HALF + 0.5),
    z: chopBase.z + chopPerp.z * LANDMARKS[3].side * (ROAD_HALF + 0.5),
  },
  briefcase: { x: shoreX(44) - 15, z: 44 },          // out on the sand
  policeStation: policeSpot,
  hospital: hospitalSpot,
  // Package-run drops: each sits in a driving lane so a car can grab it.
  packages: [
    (() => { const b = polar(138, -55); const p = perpOf(-55); return { x: b.x + p.x * LANE_OFF, z: b.z + p.z * LANE_OFF }; })(),
    { x: boulevardX(-120) - LANE_OFF, z: -120 },
    (() => { const b = polar(152, 130); const p = perpOf(130); return { x: b.x + p.x * LANE_OFF, z: b.z + p.z * LANE_OFF }; })(),
  ],
};

// Free-roam package spots, spread over the whole map.
export const ROAM_SPOTS = [
  { x: boulevardX(95) - LANE_OFF, z: 95 },
  (() => { const b = polar(150, -105); const p = perpOf(-105); return { x: b.x + p.x * LANE_OFF, z: b.z + p.z * LANE_OFF }; })(),
  (() => { const b = polar(120, 30); const p = perpOf(30); return { x: b.x + p.x * LANE_OFF, z: b.z + p.z * LANE_OFF }; })(),
  { x: shoreX(-85) - 16, z: -85 },
  (() => { const b = polar(140, -160); const p = perpOf(-160); return { x: b.x + p.x * LANE_OFF, z: b.z + p.z * LANE_OFF }; })(),
  { x: boulevardX(-30) - LANE_OFF, z: -30 },
];
