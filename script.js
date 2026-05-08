const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const camera = { x: 0 };

canvas.width = 1000;
canvas.height = 500;

const levelWidth = 5000;
const SPAWN_X = 60;
const SPAWN_Y = 350;

const goal = { x: 4850, y: 150, width: 50, height: 50 };

const player = {
  x: SPAWN_X, y: SPAWN_Y,
  width: 36, height: 36,
  vx: 0, vy: 0,
  speed: 5.2,
  jumpPower: 10,
  onGround: false,
  // Coyote time & jump buffer
  coyoteTimer: 0,
  jumpBuffer: 0,
  // Wall jump
  wallJumpTimer: 0,    // locks horizontal control briefly after wall jump
  touchingWall: false,
  wallSide: null,
  wallSlideTimer: 0,
};

const gravity = 0.32;
const MAX_FALL = 10;
// Variable jump height — release early for shorter jump
const JUMP_CUT = 0.55;   // gentler cut so release doesn't kill momentum harshly
const COYOTE_FRAMES = 9;
const JUMP_BUFFER_FRAMES = 12;
const WALL_JUMP_LOCK = 10; // frames of horizontal lock after wall jump

// Death cooldown
let deathCooldown = 0;
const DEATH_COOLDOWN_FRAMES = 80; // ~1.3 seconds at 60fps

const platforms = [
  // Starting ledge
  { x: 0,    y: 390, width: 170, height: 20 },

  // First gap hops
  { x: 240,  y: 360, width: 70,  height: 20 },
  { x: 380,  y: 320, width: 65,  height: 20 },
  { x: 510,  y: 270, width: 65,  height: 20 },

  // ── WALL JUMP SHAFT #1 ──
  // Two tall walls with a 90px gap — must wall jump to climb
  { x: 640,  y: 100, width: 20,  height: 280 }, // left wall
  { x: 750,  y: 100, width: 20,  height: 280 }, // right wall
  { x: 660,  y: 100, width: 110, height: 20  }, // ceiling exit ledge

  // After shaft, continue right
  { x: 820,  y: 180, width: 90,  height: 20 },
  { x: 980,  y: 230, width: 80,  height: 20 },
  { x: 1120, y: 290, width: 75,  height: 20 },

  // Breather
  { x: 1270, y: 320, width: 140, height: 20 },

  // Spike gauntlet — tiny hops
  { x: 1530, y: 350, width: 55,  height: 20 },
  { x: 1665, y: 305, width: 55,  height: 20 },
  { x: 1800, y: 260, width: 55,  height: 20 },
  { x: 1935, y: 310, width: 55,  height: 20 },
  { x: 2070, y: 360, width: 55,  height: 20 },

  // ── WALL JUMP SHAFT #2 ── (taller, narrower, must wall jump 3 times)
  { x: 2230, y: 50,  width: 20,  height: 360 }, // left wall
  { x: 2330, y: 50,  width: 20,  height: 360 }, // right wall
  { x: 2250, y: 50,  width: 100, height: 20  }, // top exit
  // Entry ledge
  { x: 2155, y: 420, width: 80,  height: 20 },

  // Post shaft descent
  { x: 2410, y: 100, width: 80,  height: 20 },
  { x: 2550, y: 160, width: 80,  height: 20 },
  { x: 2690, y: 230, width: 80,  height: 20 },
  { x: 2830, y: 290, width: 130, height: 20 },

  // Precision section
  { x: 3030, y: 330, width: 55,  height: 20 },
  { x: 3160, y: 275, width: 55,  height: 20 },
  { x: 3290, y: 220, width: 55,  height: 20 },
  { x: 3420, y: 280, width: 55,  height: 20 },
  { x: 3550, y: 330, width: 55,  height: 20 },

  // ── WALL JUMP SHAFT #3 ── (final, 400px tall)
  { x: 3700, y: 0,   width: 20,  height: 420 }, // left wall
  { x: 3810, y: 0,   width: 20,  height: 420 }, // right wall
  { x: 3720, y: 0,   width: 110, height: 20  }, // top exit
  // Entry
  { x: 3625, y: 420, width: 80,  height: 20 },

  // Final approach
  { x: 3900, y: 80,  width: 90,  height: 20 },
  { x: 4050, y: 140, width: 80,  height: 20 },
  { x: 4190, y: 200, width: 80,  height: 20 },
  { x: 4340, y: 150, width: 80,  height: 20 },
  { x: 4490, y: 100, width: 80,  height: 20 },

  // Goal platform
  { x: 4780, y: 200, width: 200, height: 20 },
];

// Spikes
const SPIKE_W = 22;
const SPIKE_H = 26;

const spikeGroups = [
  // Early gaps
  { x: 170, y: 500, count: 4 },
  // Under shaft 1
  { x: 640, y: 500, count: 6 },
  // Gauntlet
  { x: 1430, y: 500, count: 28 },
  // Under shaft 2
  { x: 2155, y: 500, count: 8 },
  // Mid ground
  { x: 2960, y: 500, count: 4 },
  { x: 3560, y: 500, count: 3 },
  // Under shaft 3
  { x: 3625, y: 500, count: 4 },
  // Final approach pits
  { x: 3990, y: 500, count: 3 },
  { x: 4270, y: 500, count: 3 },
  // Platform edge traps
  { x: 1330, y: 320, count: 2 },
  { x: 2870, y: 290, count: 2 },
];

const spikes = [];
for (let g of spikeGroups) {
  for (let i = 0; i < g.count; i++) {
    const bx = g.x + i * SPIKE_W;
    spikes.push({
      bx, by: g.y,
      tipX: bx + SPIKE_W / 2, tipY: g.y - SPIKE_H,
      rect: { x: bx + 3, y: g.y - SPIKE_H, width: SPIKE_W - 6, height: SPIKE_H }
    });
  }
}

const keys = {};
const justPressed = {};
document.addEventListener("keydown", e => {
  if (!keys[e.code]) justPressed[e.code] = true;
  keys[e.code] = true;
  e.preventDefault();
});
document.addEventListener("keyup", e => { keys[e.code] = false; });

let levelComplete = false;
let deathCount = 0;

function resetPlayer() {
  deathCount++;
  deathCooldown = DEATH_COOLDOWN_FRAMES;
  player.x = SPAWN_X; player.y = SPAWN_Y;
  player.vx = 0; player.vy = 0;
  player.onGround = false;
  player.coyoteTimer = 0;
  player.jumpBuffer = 0;
  player.wallJumpTimer = 0;
  player.wallSlideTimer = 0;
}

function gameLoop() {
  update();
  draw();
  for (let k in justPressed) delete justPressed[k];
  requestAnimationFrame(gameLoop);
}

function update() {
  if (levelComplete) return;

  // Tick death cooldown — player is frozen during it
  if (deathCooldown > 0) {
    deathCooldown--;
    return;
  }

  // Tick timers
  if (player.coyoteTimer > 0)    player.coyoteTimer--;
  if (player.jumpBuffer > 0)     player.jumpBuffer--;
  if (player.wallJumpTimer > 0)  player.wallJumpTimer--;

  // Buffer jump input
  if (justPressed["ArrowUp"]) player.jumpBuffer = JUMP_BUFFER_FRAMES;

  // Horizontal movement (suppressed briefly after wall jump)
  if (player.wallJumpTimer === 0) {
    if (keys["ArrowLeft"])       player.vx = -player.speed;
    else if (keys["ArrowRight"]) player.vx =  player.speed;
    else                         player.vx *= 0.78;
  } else {
    // Gradually return control during wall jump lock
    player.vx *= 0.92;
  }

  // Variable gravity — rise slower when holding jump
  const isRising = player.vy < 0;
  const holdingJump = keys["ArrowUp"];
  // Slightly heavier on descent for control, but not aggressive
  let grav = gravity;
  if (isRising && !holdingJump) grav = gravity / JUMP_CUT;
  if (!isRising) grav = gravity * 1.15;

  player.vy += grav;
  if (player.vy > MAX_FALL) player.vy = MAX_FALL;

  // Horizontal movement & collision
  player.x += player.vx;
  if (player.x < 0) { player.x = 0; player.vx = 0; }

  player.touchingWall = false;
  player.wallSide = null;

  for (let p of platforms) {
    if (isCol(player, p)) {
      if (player.vx > 0) {
        player.x = p.x - player.width;
        player.touchingWall = true; player.wallSide = "right";
      } else if (player.vx < 0) {
        player.x = p.x + p.width;
        player.touchingWall = true; player.wallSide = "left";
      }
      player.vx = 0;
    }
  }

  // Vertical movement & collision
  player.y += player.vy;
  const wasOnGround = player.onGround;
  player.onGround = false;

  for (let p of platforms) {
    if (isCol(player, p)) {
      if (player.vy > 0) {
        player.y = p.y - player.height;
        player.vy = 0; player.onGround = true;
      } else if (player.vy < 0) {
        player.y = p.y + p.height;
        player.vy = 0;
      }
    }
  }

  // Set coyote time when leaving ground
  if (wasOnGround && !player.onGround && player.vy >= 0) {
    player.coyoteTimer = COYOTE_FRAMES;
  }

  // Wall slide
  const canWallSlide = player.touchingWall && !player.onGround && player.vy > 0;
  if (canWallSlide) {
    player.vy = Math.min(player.vy, 2.2); // slow slide
    player.wallSlideTimer = 4;
  }

  // Jump (ground or coyote)
  const canJump = player.onGround || player.coyoteTimer > 0;
  if (player.jumpBuffer > 0 && canJump) {
    player.vy = -player.jumpPower;
    player.onGround = false;
    player.coyoteTimer = 0;
    player.jumpBuffer = 0;
  }

  // Wall jump
  if (player.jumpBuffer > 0 && player.touchingWall && !player.onGround) {
    player.vy = -player.jumpPower * 0.92;
    player.vx = player.wallSide === "right" ? -player.speed * 1.3 : player.speed * 1.3;
    player.wallJumpTimer = WALL_JUMP_LOCK;
    player.jumpBuffer = 0;
    player.coyoteTimer = 0;
  }

  // Spike / pit death
  for (let s of spikes) {
    if (isCol(player, s.rect)) { resetPlayer(); return; }
  }
  if (player.y > canvas.height + 60) { resetPlayer(); return; }

  // Camera
  camera.x = player.x - canvas.width / 2;
  if (camera.x < 0) camera.x = 0;
  if (camera.x > levelWidth - canvas.width) camera.x = levelWidth - canvas.width;

  if (isCol(player, goal)) levelComplete = true;
}

function draw() {
  // Background
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, "#0d0d1a");
  sky.addColorStop(1, "#1a1a3a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Platforms
  for (let p of platforms) {
    ctx.fillStyle = "#3d5a3e";
    ctx.fillRect(p.x - camera.x, p.y, p.width, p.height);
    ctx.fillStyle = "#5a8a5c";
    ctx.fillRect(p.x - camera.x, p.y, p.width, 4);
  }

  // Spikes
  for (let s of spikes) {
    ctx.beginPath();
    ctx.moveTo(s.bx - camera.x, s.by);
    ctx.lineTo(s.tipX - camera.x, s.tipY);
    ctx.lineTo(s.bx + SPIKE_W - camera.x, s.by);
    ctx.closePath();
    ctx.fillStyle = "#b0b8c8";
    ctx.fill();
    ctx.strokeStyle = "#6a7080";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Wall-slide particle hint
  if (player.touchingWall && !player.onGround && player.vy > 0) {
    const px = player.x - camera.x + (player.wallSide === "right" ? player.width : -4);
    ctx.fillStyle = "rgba(200,200,255,0.5)";
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(px, player.y + 8 + i * 12, 4, 4);
    }
  }

  // Goal
  ctx.fillStyle = "#ffd700";
  ctx.fillRect(goal.x - camera.x, goal.y, goal.width, goal.height);
  ctx.fillStyle = "#333";
  ctx.font = "bold 26px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("★", goal.x - camera.x + goal.width / 2, goal.y + 34);

  // Player — flash white during death cooldown
  if (deathCooldown > 0) {
    const flash = Math.floor(deathCooldown / 6) % 2 === 0;
    ctx.fillStyle = flash ? "white" : "#cc2222";
  } else {
    ctx.fillStyle = "#cc2222";
  }
  ctx.fillRect(player.x - camera.x, player.y, player.width, player.height);

  // Eyes (hidden during cooldown flash)
  if (deathCooldown === 0) {
    ctx.fillStyle = "white";
    ctx.fillRect(player.x - camera.x + 7,  player.y + 9,  7, 7);
    ctx.fillRect(player.x - camera.x + 22, player.y + 9,  7, 7);
    ctx.fillStyle = "#111";
    ctx.fillRect(player.x - camera.x + 9,  player.y + 11, 3, 3);
    ctx.fillRect(player.x - camera.x + 24, player.y + 11, 3, 3);
  }

  // Death cooldown bar
  if (deathCooldown > 0) {
    const barW = 120;
    const progress = deathCooldown / DEATH_COOLDOWN_FRAMES;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(canvas.width / 2 - barW / 2, 20, barW, 12);
    ctx.fillStyle = "#e05050";
    ctx.fillRect(canvas.width / 2 - barW / 2, 20, barW * progress, 12);
    ctx.strokeStyle = "white";
    ctx.lineWidth = 1;
    ctx.strokeRect(canvas.width / 2 - barW / 2, 20, barW, 12);
    ctx.fillStyle = "white";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("respawning...", canvas.width / 2, 50);
  }

  // Death counter
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "15px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`Deaths: ${deathCount}`, 12, 24);

  // Wall jump hint (early in level)
  if (player.x < 700 && !levelComplete) {
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("↑ to jump  |  press ↑ while on a wall to wall jump", canvas.width / 2, canvas.height - 14);
  }

  // Level complete
  if (levelComplete) {
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffd700";
    ctx.font = "bold 52px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Level Complete! 🎉", canvas.width / 2, canvas.height / 2 - 24);
    ctx.fillStyle = "white";
    ctx.font = "24px sans-serif";
    ctx.fillText(`Deaths: ${deathCount}`, canvas.width / 2, canvas.height / 2 + 24);
  }
}

function isCol(a, b) {
  return a.x < b.x + b.width  && a.x + a.width  > b.x &&
         a.y < b.y + b.height && a.y + a.height > b.y;
}

gameLoop();