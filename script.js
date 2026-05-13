const canvas = document.getElementById("game");
const ctx    = canvas.getContext("2d");
canvas.width  = 1400;
canvas.height = 700;

// ═══════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════
const GRAVITY         = 0.38;
const MAX_FALL        = 12;
const JUMP_CUT        = 0.55;
const COYOTE_FRAMES   = 8;
const JUMP_BUF_FRAMES = 10;
const WALL_JUMP_LOCK  = 9;
const DEATH_CD_FRAMES = 75;
const MAX_ENEMIES     = 18;  // hard cap on total enemies per level

const T   = 20;          // tile size in px — everything is built on this grid
const PW  = 22, PH = 22; // player size
const SPIKE_W = T, SPIKE_H = 14;

// ═══════════════════════════════════════════════════════
//  RNG
// ═══════════════════════════════════════════════════════
function makeRng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
let rng = makeRng(Date.now());
const ri  = n  => Math.floor(rng() * n);
const rf  = () => rng();
const rch = (...a) => a[ri(a.length)];
const clampY = y => Math.max(2*T, Math.min(canvas.height - 4*T, y));

// ═══════════════════════════════════════════════════════
//  LEVEL GENERATOR
//
//  The level is built from STRUCTURES — self-contained
//  architectural units placed left-to-right with gaps
//  between them.  Each structure is a small maze-like
//  arrangement of walls, floors, ledges and cover.
//
//  Structures:
//    "tower"    – a tall multi-storey building
//    "bunker"   – low wide fortified block
//    "bridge"   – elevated walkway with pillars
//    "ruins"    – asymmetric crumbling walls
//    "gate"     – two towers with a tunnel between them
// ═══════════════════════════════════════════════════════
function generateLevel() {
  rng = makeRng(Date.now());

  const platforms       = [];  // { x,y,w,h, kind }  kind: "floor"|"wall"|"cover"|"ledge"
  const movingPlatforms = [];
  const spikes          = [];
  const enemies         = [];

  // ─── primitive helpers ──────────────────────────────
  const addPlat = (x, y, w, h, kind = "floor") =>
    platforms.push({ x, y, width: w * T, height: h * T, kind });

  const addThinPlat = (x, y, w, kind = "ledge") =>
    platforms.push({ x, y, width: w * T, height: T, kind });

  const addMover = (x, y, w, axis, rangeTiles, speedMul = 1, phase = 0) =>
    movingPlatforms.push({
      x, y, width: w * T, height: T,
      ox: x, oy: y, axis,
      range: rangeTiles * T,
      speed: (0.3 + rf() * 0.25) * speedMul,
      t: phase
    });

  const addSpikes = (x, y, countTiles) => {
    for (let i = 0; i < countTiles; i++) {
      const bx = x + i * SPIKE_W;
      spikes.push({
        bx, by: y,
        tipX: bx + SPIKE_W / 2, tipY: y - SPIKE_H,
        rect: { x: bx + 2, y: y - SPIKE_H, width: SPIKE_W - 4, height: SPIKE_H }
      });
    }
  };

  // x = centre of where enemy stands, y = top of the surface they stand on
  const addEnemy = (x, y) => {
    if (enemies.length >= MAX_ENEMIES) return;  // respect the cap
    const ew = T * 1.6, eh = T * 1.6;
    enemies.push({
      x: x - ew / 2, y: y - eh,
      width: ew, height: eh,
      shootTimer:    60 + ri(80),
      shootInterval: 80 + ri(70),
      projectiles: []
    });
  };

  // ─── structure builders ─────────────────────────────
  // Each returns { width } in pixels so caller can advance curX.

  function structTower(baseX, baseY) {
    const floors  = 3 + ri(3);          // 3–5 storeys
    const w       = 5 + ri(4);          // 5–8 tiles wide
    const floorH  = 4 + ri(2);          // 4–5 tiles per floor
    const totalH  = floors * floorH;

    // Outer walls
    addPlat(baseX,           baseY - totalH * T, 1, totalH);          // left wall
    addPlat(baseX + (w-1)*T, baseY - totalH * T, 1, totalH, "wall"); // right wall

    for (let f = 0; f < floors; f++) {
      const floorY = baseY - (f + 1) * floorH * T;

      // Floor slab (with a gap for the stairwell)
      const gapCol = 1 + ri(w - 3);  // gap 1 tile wide
      if (gapCol > 1)
        addPlat(baseX + T, floorY, gapCol - 1, 1, "floor");
      if (gapCol < w - 2)
        addPlat(baseX + (gapCol + 1) * T, floorY, w - gapCol - 2, 1, "floor");

      // Interior ledge for cover mid-floor
      if (f < floors - 1) {
        const ledgeX = baseX + (1 + ri(w - 3)) * T;
        addThinPlat(ledgeX, floorY + floorH * T * 0.5, 2 + ri(2), "cover");
      }

      // Enemy on most floors
      if (rf() < 0.30) {
        const ex = baseX + (1 + ri(w - 2)) * T;
        addEnemy(ex + T / 2, floorY);
      }

      // Moving platform as internal lift on one floor
      if (f > 0 && rf() < 0.4) {
        addMover(baseX + T, floorY + T, w - 2, "v", floorH - 1, 0.8, f * Math.PI / 2);
      }
    }

    // Roof ledge
    addPlat(baseX, baseY - totalH * T, w, 1, "floor");

    // Entrance hole at ground level — spike trap or open
    if (rf() < 0.4) addSpikes(baseX + T, baseY, w - 2);

    return { width: w * T };
  }

  function structBunker(baseX, baseY) {
    const w   = 8 + ri(6);   // 8–13 tiles wide
    const h   = 2;            // 2 tiles tall (low profile)

    // Base slab
    addPlat(baseX, baseY - h * T, w, h, "wall");

    // Battlements: alternating merlons on top
    for (let i = 0; i < w; i += 2) {
      addPlat(baseX + i * T, baseY - (h + 1) * T, 1, 1, "cover");
    }

    // Interior cutouts — tunnels the player can crawl through
    const tunnels = 1 + ri(2);
    for (let t2 = 0; t2 < tunnels; t2++) {
      const tx = baseX + (2 + ri(w - 4)) * T;
      // Remove a section by placing a cover above the gap (creates a hole in the slab)
      // We do this with a floor above the gap flanked by walls
      addPlat(tx - T, baseY - (h + 1) * T, 1, 1, "wall");
      addPlat(tx + T, baseY - (h + 1) * T, 1, 1, "wall");
    }

    // Spike strip at base
    if (rf() < 0.5) addSpikes(baseX, baseY, w);

    // Enemy on roof
    if (rf() < 0.35) addEnemy(baseX + (w / 2) * T, baseY - h * T);
    if (rf() < 0.20) addEnemy(baseX + (1 + ri(w - 2)) * T, baseY - h * T);

    // Cover ledges floating above
    for (let i = 0; i < 2 + ri(2); i++) {
      const lx = baseX + ri(w - 2) * T;
      const ly = clampY(baseY - (h + 3 + ri(4)) * T);
      addThinPlat(lx, ly, 2 + ri(3), "cover");
    }

    return { width: w * T };
  }

  function structBridge(baseX, baseY) {
    const spans   = 2 + ri(3);  // 2–4 spans
    const spanW   = 4 + ri(3);  // tiles per span
    const pillarH = 3 + ri(4);  // pillar height in tiles
    const deckY   = baseY - pillarH * T;

    for (let s = 0; s < spans; s++) {
      const sx = baseX + s * spanW * T;

      // Pillar
      addPlat(sx, deckY, 1, pillarH, "wall");

      // Deck section
      addThinPlat(sx, deckY, spanW, "floor");

      // Under-bridge cover ledge (halfway up pillar)
      if (rf() < 0.5) {
        addThinPlat(sx + T, clampY(baseY - Math.floor(pillarH / 2) * T), spanW - 1, "cover");
      }

      // Enemy on deck
      if (rf() < 0.25) addEnemy(sx + spanW * T / 2, deckY);

      // Moving platform under one span
      if (s === Math.floor(spans / 2)) {
        addMover(sx, clampY(baseY - 2 * T), spanW, "h", spanW, 0.9, 0);
      }
    }

    // Closing pillar
    addPlat(baseX + spans * spanW * T, deckY, 1, pillarH, "wall");
    addThinPlat(baseX + spans * spanW * T, deckY, 2, "floor");

    // Spike strip at ground under bridge
    if (rf() < 0.6) addSpikes(baseX, baseY, spans * spanW);

    return { width: spans * spanW * T + 2 * T };
  }

  function structRuins(baseX, baseY) {
    const pieces = 3 + ri(4);
    let rx = baseX;
    let maxW = 0;

    for (let p = 0; p < pieces; p++) {
      const pW = 1 + ri(3);  // 1–3 tiles wide
      const pH = 2 + ri(5);  // 2–6 tiles tall
      const offset = ri(3) * T;
      const wallY = baseY - pH * T - offset;

      addPlat(rx, wallY, pW, pH, "wall");

      // Crumbled top ledge
      if (rf() < 0.5)
        addThinPlat(rx - T, wallY - T, pW + 1 + ri(2), "cover");

      // Enemy perched on top
      if (rf() < 0.25) addEnemy(rx + pW * T / 2, wallY);

      // Floating debris between pieces
      if (p < pieces - 1 && rf() < 0.6) {
        const debrisX = rx + pW * T + T;
        const debrisY = clampY(baseY - (2 + ri(pH)) * T);
        addThinPlat(debrisX, debrisY, 1 + ri(3), "cover");
      }

      const gap = T + ri(3) * T;
      rx += pW * T + gap;
      maxW = rx - baseX;
    }

    if (rf() < 0.5) addSpikes(baseX, baseY, Math.floor(maxW / SPIKE_W / 2));
    return { width: maxW };
  }

  function structGate(baseX, baseY) {
    const towerW  = 3;
    const towerH  = 5 + ri(3);
    const tunnelW = 4 + ri(3);   // gap between towers
    const totalW  = (towerW * 2 + tunnelW) * T;

    // Left tower
    addPlat(baseX,            baseY - towerH * T, towerW, towerH, "wall");
    // Right tower
    addPlat(baseX + (towerW + tunnelW) * T, baseY - towerH * T, towerW, towerH, "wall");

    // Gate arch — a platform spanning the top
    addPlat(baseX, baseY - towerH * T, towerW * 2 + tunnelW, 1, "floor");

    // Tunnel floor (ground level passthrough — player walks under arch)
    // Tunnel interior cover ledges
    for (let i = 1; i < tunnelW; i += 2) {
      addThinPlat(baseX + (towerW + i) * T, clampY(baseY - 3 * T), 1, "cover");
    }

    // Interior floors in each tower — 2 floors each
    for (let f = 1; f <= 2; f++) {
      const fy = baseY - f * Math.floor(towerH / 3) * T;
      addThinPlat(baseX + T,                        fy, towerW - 1, "floor");
      addThinPlat(baseX + (towerW + tunnelW) * T, fy, towerW - 1, "floor");
      if (rf() < 0.30) addEnemy(baseX + towerW * T / 2, fy);
      if (rf() < 0.30) addEnemy(baseX + (towerW + tunnelW + towerW / 2) * T, fy);
    }

    // Spike gauntlet inside tunnel
    if (rf() < 0.7)
      addSpikes(baseX + towerW * T, baseY, tunnelW);

    // Moving platform over arch
    addMover(baseX + T, baseY - (towerH + 1) * T, towerW * 2 + tunnelW - 2, "h",
             (tunnelW + towerW) / 2, 0.7, 0);

    return { width: totalW };
  }


  // ── FLOATING CLUSTER: a mid-air archipelago of ledges + cover + enemies
  // baseY here is the *height* at which the cluster floats (top of cluster)
  function structFloating(baseX, floatY) {
    const pieces  = 4 + ri(4);          // 4–7 floating pieces
    const spreadY = 8 * T;              // total vertical spread
    let rx = baseX;
    let maxW = 0;

    for (let i = 0; i < pieces; i++) {
      const pw    = 3 + ri(4);           // 3–6 tiles wide
      const py    = clampY(floatY + ri(spreadY) - spreadY / 2);
      const kind  = rf() < 0.4 ? "cover" : "ledge";
      addThinPlat(rx, py, pw, kind);

      // Enemy stands on top of this ledge
      if (rf() < 0.30) addEnemy(rx + pw * T / 2, py);

      // Occasional connector mover between adjacent pieces
      if (i < pieces - 1 && rf() < 0.45) {
        const gap = 3 + ri(3);
        addMover(rx + pw * T, clampY(py - T), gap, "h", gap, 0.9, i * Math.PI / 3);
      }

      rx += pw * T + T * (2 + ri(3));
      maxW = rx - baseX;
    }

    // Spike cloud beneath — spikes at ground level keep you from ignoring this
    addSpikes(baseX, canvas.height - 2 * T, Math.floor((maxW * 0.6) / SPIKE_W));

    return { width: maxW };
  }

  // ── CANOPY: a wide overhead structure you navigate under and over
  // Looks like a floating fortress ceiling with hanging platforms
  function structCanopy(baseX, baseY) {
    const w       = 12 + ri(6);          // 12–17 tiles wide total
    const ceilY   = clampY(baseY - (8 + ri(5)) * T); // ceiling height

    // Ceiling slab
    addPlat(baseX, ceilY, w, 1, "wall");

    // Hanging pillars — drop down from ceiling like stalactites
    const pillars = 2 + ri(3);
    for (let p = 0; p < pillars; p++) {
      const px  = baseX + (1 + Math.floor((p / pillars) * (w - 2))) * T;
      const ph  = 2 + ri(4);    // pillar length in tiles
      addPlat(px, ceilY + T, 1, ph, "wall");

      // Ledge at bottom of pillar — enemy perch
      addThinPlat(px - T, ceilY + (ph + 1) * T, 3, "cover");
      if (rf() < 0.35) addEnemy(px, ceilY + (ph + 1) * T);
    }

    // Platforms below the ceiling for the player to navigate
    for (let i = 0; i < 3 + ri(3); i++) {
      const lx = baseX + ri(w - 3) * T;
      const ly = clampY(ceilY + (3 + ri(5)) * T);
      addThinPlat(lx, ly, 2 + ri(3), "ledge");
    }

    // Moving platform patrolling under the ceiling
    addMover(baseX + T, ceilY + 2 * T, w - 2, "h", (w - 2) / 2, 0.7, 0);

    return { width: w * T };
  }

  // ─── assemble the level ──────────────────────────────
  const STRUCT_TYPES = ["tower","bunker","bridge","ruins","gate"];
  const GROUND_Y = canvas.height - 2 * T;  // ground line

  // Starting safe ground
  addPlat(0, GROUND_Y, 10, 2, "floor");

  let curX = 10 * T + T * 2;

  // Mix ground and air structures in the sequence
  const GROUND_TYPES = ["tower","bunker","bridge","ruins","gate"];
  const AIR_TYPES    = ["floating","canopy"];

  const sequence = [];
  for (let i = 0; i < 12; i++) {
    // Every 3rd structure is an air structure
    if (i % 3 === 2) sequence.push(rch(...AIR_TYPES));
    else             sequence.push(rch(...GROUND_TYPES));
  }

  for (const type of sequence) {
    let result;
    // Air structures float at a randomised height
    const airY = clampY(GROUND_Y - (8 + ri(8)) * T);
    switch (type) {
      case "tower":    result = structTower(curX, GROUND_Y);    break;
      case "bunker":   result = structBunker(curX, GROUND_Y);   break;
      case "bridge":   result = structBridge(curX, GROUND_Y);   break;
      case "ruins":    result = structRuins(curX, GROUND_Y);    break;
      case "gate":     result = structGate(curX, GROUND_Y);     break;
      case "floating": result = structFloating(curX, airY);     break;
      case "canopy":   result = structCanopy(curX, GROUND_Y);   break;
    }

    // Gap between structures — sometimes a mover bridge, sometimes ground
    const gapTiles = 3 + ri(5);
    const nextX = curX + result.width + gapTiles * T;

    if (gapTiles >= 4 && rf() < 0.55) {
      // Floating mover to cross the gap
      addMover(curX + result.width + T, GROUND_Y - 4 * T,
               gapTiles - 1, "h", gapTiles - 2, 1.0, rf() * Math.PI * 2);
    } else if (gapTiles <= 4) {
      // Short ground bridge
      addPlat(curX + result.width, GROUND_Y, gapTiles, 2, "floor");
    }

    curX = nextX;
  }

  // Final goal platform
  addPlat(curX, GROUND_Y, 8, 2, "floor");
  const goal = {
    x: curX + 3 * T, y: GROUND_Y - 3 * T,
    width: 2 * T, height: 2 * T
  };
  const levelWidth = curX + 10 * T;

  return { platforms, movingPlatforms, spikes, enemies, goal, levelWidth };
}

// ═══════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════
let level, camera, player, deathCount, deathCooldown, levelComplete;

function initGame() {
  level         = generateLevel();
  camera        = { x: 0 };
  deathCount    = 0;
  deathCooldown = 0;
  levelComplete = false;
  player = {
    x: 3 * T, y: canvas.height - 4 * T - PH,
    width: PW, height: PH,
    vx: 0, vy: 0,
    speed: 4.2, jumpPower: 9,
    onGround: false,
    coyoteTimer: 0, jumpBuffer: 0,
    wallJumpTimer: 0,
    touchingWall: false, wallSide: null,
    wallSlideTimer: 0,
    canDoubleJump: false
  };
}
initGame();

// ═══════════════════════════════════════════════════════
//  INPUT
// ═══════════════════════════════════════════════════════
const keys = {}, justPressed = {};
document.addEventListener("keydown", e => {
  if (!keys[e.code]) justPressed[e.code] = true;
  keys[e.code] = true;
  if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"].includes(e.code))
    e.preventDefault();
});
document.addEventListener("keyup", e => { keys[e.code] = false; });

// ═══════════════════════════════════════════════════════
//  RESET
// ═══════════════════════════════════════════════════════
function resetPlayer() {
  deathCount++;
  deathCooldown = DEATH_CD_FRAMES;
  player.x = 3 * T; player.y = canvas.height - 4 * T - PH;
  player.vx = 0; player.vy = 0; player.onGround = false;
  player.coyoteTimer = player.jumpBuffer =
  player.wallJumpTimer = player.wallSlideTimer = 0;
  player.canDoubleJump = false;
  for (let e of level.enemies) e.projectiles = [];
}

// ═══════════════════════════════════════════════════════
//  GAME LOOP
// ═══════════════════════════════════════════════════════
function gameLoop() {
  update(); draw();
  for (let k in justPressed) delete justPressed[k];
  requestAnimationFrame(gameLoop);
}

// ═══════════════════════════════════════════════════════
//  UPDATE
// ═══════════════════════════════════════════════════════
function update() {
  if (justPressed["KeyR"]) { initGame(); return; }
  if (levelComplete) return;
  if (deathCooldown > 0) { deathCooldown--; return; }

  const { platforms, movingPlatforms, spikes, enemies, goal, levelWidth } = level;
  const allSolid = [...platforms, ...movingPlatforms];

  // timers
  if (player.coyoteTimer  > 0) player.coyoteTimer--;
  if (player.jumpBuffer   > 0) player.jumpBuffer--;
  if (player.wallJumpTimer > 0) player.wallJumpTimer--;
  if (justPressed["ArrowUp"]) player.jumpBuffer = JUMP_BUF_FRAMES;

  // ── Double jump (Space) ──────────────────────────────
  if (justPressed["Space"] && !player.onGround && player.canDoubleJump
      && !player.touchingWall) {
    player.vy = -player.jumpPower * 0.88;  // slightly weaker than first jump
    player.canDoubleJump = false;
  }

  // move movers
  for (let mp of movingPlatforms) {
    mp.t += mp.speed * 0.025;
    const px = mp.x, py = mp.y;
    if (mp.axis === "h") mp.x = mp.ox + Math.sin(mp.t) * mp.range;
    else                 mp.y = mp.oy + Math.sin(mp.t) * mp.range;
    mp.dx = mp.x - px; mp.dy = mp.y - py;
  }

  // horizontal input
  if (player.wallJumpTimer === 0) {
    if (keys["ArrowLeft"])       player.vx = -player.speed;
    else if (keys["ArrowRight"]) player.vx =  player.speed;
    else                         player.vx *= 0.75;
  } else { player.vx *= 0.90; }

  // gravity
  const rising = player.vy < 0;
  let grav = GRAVITY;
  if (rising && !keys["ArrowUp"]) grav = GRAVITY / JUMP_CUT;
  if (!rising) grav = GRAVITY * 1.15;
  player.vy = Math.min(player.vy + grav, MAX_FALL);

  // horizontal move + collide
  player.x += player.vx;
  if (player.x < 0) { player.x = 0; player.vx = 0; }
  player.touchingWall = false; player.wallSide = null;
  for (let p of allSolid) {
    if (!isCol(player, p)) continue;
    if (player.vx > 0) { player.x = p.x - player.width;  player.touchingWall = true; player.wallSide = "right"; }
    else               { player.x = p.x + p.width;        player.touchingWall = true; player.wallSide = "left";  }
    player.vx = 0;
  }

  // vertical move + collide
  player.y += player.vy;
  const wasOnGround = player.onGround;
  player.onGround = false;
  for (let p of allSolid) {
    if (!isCol(player, p)) continue;
    const isMP = p.dx !== undefined;
    if (player.vy > 0) {
      player.y = p.y - player.height; player.vy = 0; player.onGround = true;
      player.canDoubleJump = true;  // regain double jump on landing
      if (isMP) { player.x += p.dx; player.y += p.dy; }
    } else { player.y = p.y + p.height; player.vy = 0; }
  }
  if (wasOnGround && !player.onGround && player.vy >= 0)
    player.coyoteTimer = COYOTE_FRAMES;

  // wall slide
  if (player.touchingWall && !player.onGround && player.vy > 0) {
    player.vy = Math.min(player.vy, 1.8);
    player.wallSlideTimer = 4;
  }

  // jump
  if (player.jumpBuffer > 0 && (player.onGround || player.coyoteTimer > 0)) {
    player.vy = -player.jumpPower;
    player.onGround = player.coyoteTimer = player.jumpBuffer = 0;
  }

  // wall jump
  if (player.jumpBuffer > 0 && player.touchingWall && !player.onGround) {
    player.vy = -player.jumpPower * 0.9;
    player.vx = player.wallSide === "right" ? -player.speed * 1.3 : player.speed * 1.3;
    player.wallJumpTimer = WALL_JUMP_LOCK;
    player.jumpBuffer = player.coyoteTimer = 0;
  }

  // enemies + projectiles
  for (let en of enemies) {
    en.shootTimer--;
    if (en.shootTimer <= 0) {
      en.shootTimer = en.shootInterval;
      const dx = (player.x + PW/2) - (en.x + en.width/2);
      const dy = (player.y + PH/2) - (en.y + en.height/2);
      const d  = Math.hypot(dx, dy) || 1;
      en.projectiles.push({
        x: en.x + en.width/2 - 4, y: en.y + en.height/2 - 4,
        vx: (dx/d)*3.2, vy: (dy/d)*3.2,
        width: 8, height: 8, life: 220
      });
    }
    for (let i = en.projectiles.length - 1; i >= 0; i--) {
      const pr = en.projectiles[i];
      pr.x += pr.vx; pr.y += pr.vy; pr.life--;
      let hit = allSolid.some(p => isCol(pr, p));
      if (hit || pr.life <= 0 || pr.x < camera.x - 80 || pr.x > camera.x + canvas.width + 80)
        { en.projectiles.splice(i, 1); continue; }
      if (isCol(pr, player)) { resetPlayer(); return; }
    }
  }

  // spikes / pit
  for (let s of spikes) if (isCol(player, s.rect)) { resetPlayer(); return; }
  if (player.y > canvas.height + 40) { resetPlayer(); return; }

  // camera
  camera.x = Math.max(0, Math.min(player.x - canvas.width / 2,
                                   level.levelWidth - canvas.width));

  if (isCol(player, goal)) levelComplete = true;
}

// ═══════════════════════════════════════════════════════
//  DRAW
// ═══════════════════════════════════════════════════════

// Colour palette per platform kind
const KIND_COLORS = {
  floor:  { body: "#3a4a3c", top: "#5a7a5c" },
  wall:   { body: "#3c3840", top: "#5c4860" },
  cover:  { body: "#4a3a50", top: "#8a6890" },
  ledge:  { body: "#2a4040", top: "#4a7878" },
};

function draw() {
  const { platforms, movingPlatforms, spikes, enemies, goal } = level;

  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, "#09090f"); sky.addColorStop(1, "#151525");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Static platforms — colour coded by kind
  for (let p of platforms) {
    const sx = p.x - camera.x;
    if (sx > canvas.width + 10 || sx + p.width < -10) continue;
    const c = KIND_COLORS[p.kind] || KIND_COLORS.floor;
    ctx.fillStyle = c.body;
    ctx.fillRect(sx, p.y, p.width, p.height);
    ctx.fillStyle = c.top;
    ctx.fillRect(sx, p.y, p.width, Math.min(3, p.height));
    // Faint grid lines on tall blocks to suggest brickwork
    if (p.height > T) {
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 1;
      for (let row = T; row < p.height; row += T) {
        ctx.beginPath();
        ctx.moveTo(sx, p.y + row);
        ctx.lineTo(sx + p.width, p.y + row);
        ctx.stroke();
      }
      for (let col = T; col < p.width; col += T) {
        ctx.beginPath();
        ctx.moveTo(sx + col, p.y);
        ctx.lineTo(sx + col, p.y + p.height);
        ctx.stroke();
      }
    }
  }

  // Moving platforms
  for (let mp of movingPlatforms) {
    const mx = mp.x - camera.x;
    if (mx > canvas.width + 10 || mx + mp.width < -10) continue;
    // Ghost range hint
    const g1x = mp.axis === "h" ? mp.ox - mp.range - camera.x : mx;
    const g1y = mp.axis === "v" ? mp.oy - mp.range : mp.y;
    const g2x = mp.axis === "h" ? mp.ox + mp.range - camera.x : mx;
    const g2y = mp.axis === "v" ? mp.oy + mp.range : mp.y;
    ctx.fillStyle = "rgba(60,130,170,0.10)";
    ctx.fillRect(g1x, g1y, mp.width, mp.height);
    ctx.fillRect(g2x, g2y, mp.width, mp.height);
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = "rgba(80,180,220,0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (mp.axis === "h") { ctx.moveTo(g1x + mp.width/2, mp.y + mp.height/2); ctx.lineTo(g2x + mp.width/2, mp.y + mp.height/2); }
    else                 { ctx.moveTo(mx + mp.width/2, g1y + mp.height/2);   ctx.lineTo(mx + mp.width/2, g2y + mp.height/2); }
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#1e5a7a";
    ctx.fillRect(mx, mp.y, mp.width, mp.height);
    ctx.fillStyle = "#3aaad0";
    ctx.fillRect(mx, mp.y, mp.width, 3);
  }

  // Spikes
  for (let s of spikes) {
    const sx = s.bx - camera.x;
    if (sx > canvas.width || sx + SPIKE_W < 0) continue;
    ctx.beginPath();
    ctx.moveTo(sx, s.by); ctx.lineTo(s.tipX - camera.x, s.tipY); ctx.lineTo(sx + SPIKE_W, s.by);
    ctx.closePath();
    ctx.fillStyle = "#909090"; ctx.fill();
    ctx.strokeStyle = "#606060"; ctx.lineWidth = 1; ctx.stroke();
  }

  // Enemies
  for (let en of enemies) {
    const ex = en.x - camera.x;
    if (ex > canvas.width + 20 || ex + en.width < -20) continue;
    ctx.fillStyle = "#6a0000";
    ctx.fillRect(ex, en.y, en.width, en.height);
    // Eye
    ctx.fillStyle = "#ff3333";
    ctx.beginPath(); ctx.arc(ex + en.width/2, en.y + en.height*0.35, T*0.3, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = "white";
    ctx.beginPath(); ctx.arc(ex + en.width/2, en.y + en.height*0.35, T*0.14, 0, Math.PI*2); ctx.fill();
    // Charge ring
    const ratio = 1 - en.shootTimer / en.shootInterval;
    if (ratio > 0.55) {
      ctx.strokeStyle = `rgba(255,60,60,${((ratio-0.55)/0.45).toFixed(2)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(ex + en.width/2, en.y + en.height/2, T*0.9, 0, Math.PI*2); ctx.stroke();
    }
    // Projectiles
    for (let pr of en.projectiles) {
      const px = pr.x - camera.x;
      ctx.fillStyle = "#ff5500";
      ctx.beginPath(); ctx.arc(px+4, pr.y+4, 5, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "rgba(255,130,0,0.3)";
      ctx.beginPath(); ctx.arc(px+4, pr.y+4, 9, 0, Math.PI*2); ctx.fill();
    }
  }

  // Double-jump pip — small dot above player when charge is available
  if (player.canDoubleJump && !player.onGround) {
    ctx.fillStyle = "rgba(120,200,255,0.85)";
    ctx.beginPath();
    ctx.arc(player.x - camera.x + player.width/2, player.y - 5, 3, 0, Math.PI*2);
    ctx.fill();
  }

  // Double-jump pip — small dot above player when charge is available
  if (player.canDoubleJump && !player.onGround) {
    ctx.fillStyle = "rgba(120,200,255,0.85)";
    ctx.beginPath();
    ctx.arc(player.x - camera.x + player.width/2, player.y - 5, 3, 0, Math.PI*2);
    ctx.fill();
  }

  // Wall-slide sparks
  if (player.touchingWall && !player.onGround && player.vy > 0) {
    const px = player.x - camera.x + (player.wallSide === "right" ? player.width : -3);
    ctx.fillStyle = "rgba(180,180,255,0.55)";
    for (let i = 0; i < 3; i++) ctx.fillRect(px, player.y + 4 + i*8, 3, 3);
  }

  // Goal
  ctx.fillStyle = "#ffd700";
  ctx.fillRect(goal.x - camera.x, goal.y, goal.width, goal.height);
  ctx.fillStyle = "#443300"; ctx.font = `bold ${T}px sans-serif`; ctx.textAlign = "center";
  ctx.fillText("★", goal.x - camera.x + goal.width/2, goal.y + goal.height*0.75);

  // Player
  const flashing = deathCooldown > 0 && Math.floor(deathCooldown/5) % 2 === 0;
  ctx.fillStyle = flashing ? "#ffffff" : "#cc2222";
  ctx.fillRect(player.x - camera.x, player.y, player.width, player.height);
  if (!flashing) {
    ctx.fillStyle = "white";
    ctx.fillRect(player.x - camera.x + 4, player.y + 5, 5, 5);
    ctx.fillRect(player.x - camera.x + 13, player.y + 5, 5, 5);
    ctx.fillStyle = "#111";
    ctx.fillRect(player.x - camera.x + 5, player.y + 6, 3, 3);
    ctx.fillRect(player.x - camera.x + 14, player.y + 6, 3, 3);
  }

  // Respawn bar
  if (deathCooldown > 0) {
    const bw = 100, bx = canvas.width/2 - 50;
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(bx, 18, bw, 10);
    ctx.fillStyle = "#d04040"; ctx.fillRect(bx, 18, bw*(deathCooldown/DEATH_CD_FRAMES), 10);
    ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1; ctx.strokeRect(bx, 18, bw, 10);
    ctx.fillStyle = "white"; ctx.font = "10px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("respawning...", canvas.width/2, 42);
  }

  // HUD
  ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.font = "14px sans-serif"; ctx.textAlign = "left";
  ctx.fillText(`Deaths: ${deathCount}`, 10, 22);
  ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.textAlign = "right";
  ctx.fillText("R = new level", canvas.width - 10, 22);

  // Controls hint at start
  if (player.x < 200 && !levelComplete) {
    ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.font = "12px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("← → move  |  ↑ jump  |  Space = double jump  |  ↑ on wall = wall jump", canvas.width/2, canvas.height - 12);
  }

  // Level complete
  if (levelComplete) {
    ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = "#ffd700"; ctx.font = "bold 46px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("Level Complete! 🎉", canvas.width/2, canvas.height/2 - 24);
    ctx.fillStyle = "white"; ctx.font = "22px sans-serif";
    ctx.fillText(`Deaths: ${deathCount}`, canvas.width/2, canvas.height/2 + 18);
    ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "14px sans-serif";
    ctx.fillText("Press R for a new level", canvas.width/2, canvas.height/2 + 50);
  }
}

function isCol(a, b) {
  return a.x < b.x + b.width  && a.x + a.width  > b.x &&
         a.y < b.y + b.height && a.y + a.height > b.y;
}

gameLoop();