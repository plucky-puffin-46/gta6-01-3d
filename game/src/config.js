// Puffin Vice 3D — shared tuning, palette and city layout constants.
// Everything the other modules need to agree on lives here: the street grid,
// the sunset Vice palette, and the gameplay numbers.

// Streets run along both axes at these coordinates; blocks sit between them.
export const STREETS = [-152, -76, 0, 76, 152];
export const ROAD_HALF = 9;              // half the road width (18 across)
export const LANE = 4.4;                 // lane offset from a street's centre line
export const CITY_MIN = -186;            // playable bounds (buildings / streets)
export const CITY_MAX = 186;
export const BEACH_X = 196;              // sand starts here, east edge
export const WATER_X = 252;              // water starts here
export const WORLD_X_MAX = 300;          // on-foot / car clamp on the east side

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

// Fixed landmarks the missions and respawns use. Positions are on streets or
// sidewalks just in front of their buildings.
export const SPOTS = {
  rico: { x: 13.5, z: -140 },                    // sidewalk corner by the cafe
  playerStart: { x: 8, z: -132 },
  cometPark: { x: -76 + 7.4, z: 96 },            // the teal Comet, kerbside on a west street
  chopShop: { x: 96, z: 76 - LANE },             // delivery point, south-east avenue
  briefcase: { x: 224, z: 36 },                  // out on the sand
  policeStation: { x: -104, z: -138 },
  hospital: { x: -104, z: 138 },
  packages: [
    { x: 76 - LANE, z: -30 },
    { x: -30, z: 76 + LANE },
    { x: 152 - LANE, z: 168 },
  ],
};
