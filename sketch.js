// ============================================================
//  YOUR CREATURE  —  sketch.js
//  MDDN242 Project 2  |  Two Liquid Familiars / Split Maze
// ============================================================

new p5(function(p) {

    // ============================================================
    //  CONFIG  ← tweak anything here, Buddy
    // ============================================================

    // ── Maze layout ──
    let CELL    = 40;    // px per maze cell (bigger = fewer cells, larger corridors)
    const HUD_H = 120;   // px reserved at top for HUD panels

    // ── Creature physics ──
    let BLOB_DIST;
    const NUM_BLOBS = 28;    // blob ring resolution — higher = smoother body
    const SPRING_K  = 0.18;  // blob spring stiffness
    const DAMPING   = 0.68;  // blob velocity damping
    function deriveSizes() { BLOB_DIST = CELL * 0.30; }

    // ── Gameplay numbers ──
    const GHOSTS_PER_MAZE   = 4;    // ← how many ghosts spawn per maze
    const GEMS_PER_MAZE     = 12;   // ← gems placed per maze
    const SPIKES_PER_MAZE   = 5;    // ← spike traps placed per maze
    const DOORS_PER_MAZE    = 8;    // ← doors placed per maze
    const PATHS_PER_MAZE    = 8;    // ← BFS paths computed per creature
    const TELEPORTERS_PER   = 5;    // ← teleporter hubs per creature
    const DEATH_LIMIT       = 5;    // ← deaths before maze regenerates
    const KILL_GHOST_COST   = 5;    // ← gems to kill nearest ghost
    const MUTATE_MAZE_COST  = 5;    // ← gems to mutate maze section
    const BONUS_GEMS             = 10;   // ← gem bonus when both reach end
    const WINS_FOR_CELEBRATION   = 3;    // ← joint wins before big heart celebration
    const ALLY_COST          = 10;   // ← gems to summon a ghost-killing ally
    const CREATURE_SPEED    = 0.13; // ← multiplier of CELL for creature speed
    const EYE_RADIUS        = 0.38;  // ← eye size multiplier of BLOB_DIST (bigger = larger eyes)
    const NARROW_CHANCE     = 0.18;  // ← fraction of passages that are narrow (0=none, 1=all)

    // ── Timing (frames at 60fps) ──
    const REROUTE_FRAMES        = 180;  // frames blocked before rerouting
    const PATH_SWITCH_INTERVAL  = 1800; // frames between auto-repath (30s)
    const MAZE_SHIFT_INTERVAL   = 1800; // frames between automatic wall shifts (30s)
    const RESET_DELAY           = 180;  // frames of celebration before new maze

    // ── Performance caps ──
    const MAX_GHOSTS = GHOSTS_PER_MAZE * 2;
    const MAX_GEMS   = GEMS_PER_MAZE   * 2;
    const MAX_SPIKES = SPIKES_PER_MAZE * 2;
    const MAX_DOORS  = DOORS_PER_MAZE  * 2;
    const MAX_TRAIL  = 120;  // trail points per creature
    const TRAIL_MAX  = MAX_TRAIL;
    const TRAIL_LIFE = 80;   // frames until trail fades
    const DOOR_ANIM_SPEED = 0.045;

    // ── Persistent state (never reset between mazes) ──
    let resetTimer    = -1;
    let jointWins     = 0;   // joint maze completions this session
    let celebrating   = false; // big heart celebration active
    let celebrateT    = 0;   // celebration animation timer
    let celebrateBtn  = null; // play-again button rect
    let deathCounts   = [0, 0];
    let gemCounts     = [0, 0];
    let mazeGeneration = 0;
    let totalDeaths   = [0, 0];
    let mazesWon      = [0, 0];
    let mazesLost     = [0, 0];

    const PALETTES = [
        { body:[4,12,20],   glow:[0,210,255],  shimmer:[0,140,220],  trail:[4,18,28],  trailGlow:[0,190,240]  },
        { body:[16,4,20],   glow:[210,40,220], shimmer:[255,70,200], trail:[28,8,24],  trailGlow:[200,40,200] },
    ];

    // ============================================================
    //  TWO INDEPENDENT MAZES (left half / right half)
    // ============================================================
    // Each maze is a self-contained object: {cols, rows, cells, offsetX}
    let mazeL = null;  // left  — creature 0
    let mazeR = null;  // right — creature 1

    let doors       = [];
    let teleporters = [];
    let creatures   = [];
    let ghosts      = [];
    let gems        = [];
    let particles   = [];  // pop bursts
    let allies      = [];  // summoned ghost-killers   // collectables — creature picks these up for points
    let spikes      = [];   // traps — send creature back on touch, click to deactivate
    let _creatureId = 0;

    // ============================================================
    //  SETUP
    // ============================================================
    function isMobile() { return window.innerWidth <= 768; }
    function canvasSize() {
        if (isMobile()) return { w:window.innerWidth, h:window.innerHeight };
        return { w:p.windowWidth-40, h:p.windowHeight-40 };
    }

    p.setup = function() {
        let sz = canvasSize();
        p.createCanvas(sz.w, sz.h).parent('canvas-container');
        deriveSizes();
        loadStats();
        init();
    };

    // ============================================================
    //  INIT
    // ============================================================
    function init() {
        creatures   = [];
        doors       = [];
        teleporters = [];
        ghosts      = [];
        gems        = [];
        spikes      = [];
        particles   = [];
        allies      = [];
        resetTimer  = -1;

        let halfW = p.floor(p.width / 2);
        let gap   = 2; // px gap between the two mazes

        // Build left maze — starts below HUD
        mazeL = buildMaze(halfW - gap, p.height, 0, HUD_H);
        // Build right maze — starts below HUD
        mazeR = buildMaze(p.width - halfW - gap, p.height, halfW + gap, HUD_H);

        // Creature 0: left maze, left→right
        let r0     = p.floor(mazeL.rows * 0.5);
        let paths0 = findMultiplePaths(mazeL, 0, r0, mazeL.cols-1, r0, PATHS_PER_MAZE);
        let c0 = createCreature(mazeL,
            paths0[0][0].col * CELL + CELL/2 + mazeL.offsetX,
            paths0[0][0].row * CELL + CELL/2 + mazeL.offsetY,
            paths0, PALETTES[0]
        );
        c0.gemsCollected = gemCounts[0] || 0;  // restore gem total across resets
        creatures.push(c0);

        // Creature 1: right maze, right→left
        let r1     = p.floor(mazeR.rows * 0.5);
        let paths1 = findMultiplePaths(mazeR, mazeR.cols-1, r1, 0, r1, PATHS_PER_MAZE);
        let c1 = createCreature(mazeR,
            paths1[0][0].col * CELL + CELL/2 + mazeR.offsetX,
            paths1[0][0].row * CELL + CELL/2 + mazeR.offsetY,
            paths1, PALETTES[1]
        );
        c1.gemsCollected = gemCounts[1] || 0;  // restore gem total across resets
        creatures.push(c1);

        placeDoors(c0, DOORS_PER_MAZE);
        placeDoors(c1, DOORS_PER_MAZE);
        placeTeleporters(c0, TELEPORTERS_PER);
        placeTeleporters(c1, TELEPORTERS_PER);

        // 4 ghosts per maze, spread across quadrants
        ghosts = [];
        gems   = [];
        spikes = [];
        spawnGhosts(mazeL, GHOSTS_PER_MAZE);
        spawnGhosts(mazeR, GHOSTS_PER_MAZE);
        placeGems(mazeL, c0, GEMS_PER_MAZE);
        placeGems(mazeR, c1, GEMS_PER_MAZE);
        placeSpikes(mazeL, c0, SPIKES_PER_MAZE);
        placeSpikes(mazeR, c1, SPIKES_PER_MAZE);
    }

    // ============================================================
    //  MAZE GENERATION
    // ============================================================
    function buildMaze(pixelW, pixelH, offsetX, offsetY) {
        offsetY = offsetY || 0;
        let cols = p.max(p.floor(pixelW / CELL), 5);
        let rows = p.max(p.floor((pixelH - offsetY) / CELL), 5);
        let cells = [];
        for (let r = 0; r < rows; r++) {
            cells[r] = [];
            for (let c = 0; c < cols; c++)
                cells[r][c] = { col:c, row:r, visited:false, walls:{N:true,S:true,E:true,W:true} };
        }
        // Iterative DFS carve
        let stack = [{c:0, r:0}];
        cells[0][0].visited = true;
        while (stack.length > 0) {
            let {c, r} = stack[stack.length-1];
            let dirs = p.shuffle(['N','S','E','W']);
            let moved = false;
            for (let d of dirs) {
                let nc=c, nr=r;
                if (d==='N') nr--; if (d==='S') nr++;
                if (d==='E') nc++; if (d==='W') nc--;
                if (nr>=0 && nr<rows && nc>=0 && nc<cols && !cells[nr][nc].visited) {
                    cells[r][c].walls[d]              = false;
                    cells[nr][nc].walls[opposite(d)]  = false;
                    cells[nr][nc].visited = true;
                    stack.push({c:nc, r:nr});
                    moved = true; break;
                }
            }
            if (!moved) stack.pop();
        }
        // ── Extra wall removals for multiple openings / loops ──
        // Remove ~15% of remaining walls to create braided paths with multiple choices
        let extraRemovals = Math.floor(cols * rows * 0.15);
        let attempts = 0;
        while (extraRemovals > 0 && attempts < 2000) {
            attempts++;
            let r = Math.floor(Math.random() * rows);
            let c = Math.floor(Math.random() * cols);
            let dirs2 = ['N','S','E','W'];
            let d = dirs2[Math.floor(Math.random()*4)];
            let nc=c, nr=r;
            if (d==='N') nr--; if (d==='S') nr++;
            if (d==='E') nc++; if (d==='W') nc--;
            if (nr<0||nr>=rows||nc<0||nc>=cols) continue;
            if (!cells[r][c].walls[d]) continue; // already open
            // Don't remove border walls (keep maze bounded)
            if (c===0&&d==='W'||c===cols-1&&d==='E') continue;
            if (r===0&&d==='N'||r===rows-1&&d==='S') continue;
            cells[r][c].walls[d]            = false;
            cells[nr][nc].walls[opposite(d)] = false;
            extraRemovals--;
        }

        // Mark some passages as narrow — blocks ghosts, slows creatures
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                for (let d of ['E','S']) {
                    let nc=c, nr=r;
                    if (d==='E') nc++; else nr++;
                    if (nc>=cols||nr>=rows) continue;
                    if (!cells[r][c].walls[d]) {
                        let isNarrow = Math.random() < NARROW_CHANCE;
                        cells[r][c]['narrow_'+d]                       = isNarrow;
                        cells[nr][nc]['narrow_'+{E:'W',S:'N'}[d]]      = isNarrow;
                        // Ghosts can't squeeze — mark as impassable for them
                        cells[r][c]['ghostWall_'+d]                    = isNarrow;
                        cells[nr][nc]['ghostWall_'+{E:'W',S:'N'}[d]]   = isNarrow;
                    }
                }
            }
        }
        return { cols, rows, cells, offsetX, offsetY,
                 shiftTimer: MAZE_SHIFT_INTERVAL + Math.floor(Math.random()*600) };
    }

    function opposite(d) { return {N:'S',S:'N',E:'W',W:'E'}[d]; }

    // ============================================================
    //  PATHFINDING (per-maze)
    // ============================================================
    function findMultiplePaths(mz, sc, sr, ec, er, maxPaths) {
        let results = [];
        let first = bfs(mz, sc, sr, ec, er, new Set());
        if (!first) return [[{col:sc,row:sr},{col:ec,row:er}]];
        results.push(first);
        for (let attempt = 0; attempt < 40 && results.length < maxPaths; attempt++) {
            let blocked = new Set();
            for (let ex of results) {
                let s = p.floor(ex.length*0.2), e = p.floor(ex.length*0.8);
                for (let i = s; i <= e; i++) blocked.add(`${ex[i].col},${ex[i].row}`);
            }
            let np = bfs(mz, sc, sr, ec, er, blocked);
            if (!np) continue;
            if (!results.some(r => pathSimilarity(r, np) > 0.5)) results.push(np);
        }
        return results;
    }

    function bfs(mz, sc, sr, ec, er, blocked) {
        let queue   = [{c:sc, r:sr, path:[{col:sc,row:sr}]}];
        let visited = new Set([`${sc},${sr}`]);
        while (queue.length > 0) {
            let {c, r, path} = queue.shift();
            if (c===ec && r===er) return path;
            let cell = mz.cells[r][c];
            for (let m of [
                {d:'N',nc:c,  nr:r-1},{d:'S',nc:c,  nr:r+1},
                {d:'E',nc:c+1,nr:r  },{d:'W',nc:c-1,nr:r  },
            ]) {
                let key = `${m.nc},${m.nr}`;
                if (m.nr<0||m.nr>=mz.rows||m.nc<0||m.nc>=mz.cols) continue;
                if (!cell.walls[m.d] && !visited.has(key) && !blocked.has(key)) {
                    visited.add(key);
                    queue.push({c:m.nc, r:m.nr, path:[...path,{col:m.nc,row:m.nr}]});
                }
            }
        }
        return null;
    }

    function pathSimilarity(a, b) {
        let sa = new Set(a.map(n=>`${n.col},${n.row}`));
        return b.filter(n=>sa.has(`${n.col},${n.row}`)).length / Math.max(a.length,b.length);
    }

    // ============================================================
    //  DOORS
    // ============================================================
    function placeDoors(creature, count) {
        count = Math.min(count, Math.max(0, MAX_DOORS - doors.length));
        let placed=0, used=new Set();
        for (let attempt=0; attempt<80 && placed<count; attempt++) {
            let pIdx = p.floor(p.random(creature.paths.length));
            let path = creature.paths[pIdx];
            if (path.length < 7) continue;
            let iMin=2, iMax=path.length-3;
            if (iMin>=iMax) continue;
            let i = p.floor(p.random(iMin,iMax));
            let a=path[i-1], b=path[i];
            let dc=b.col-a.col, dr=b.row-a.row;
            if (Math.abs(dc)+Math.abs(dr)!==1) continue;
            let dir=dc===1?'E':dc===-1?'W':dr===1?'S':'N';
            let key=`${a.col},${a.row},${dir}`;
            if (used.has(key)) continue;
            used.add(key);
            doors.push({col:a.col, row:a.row, dir, open:false, openAmt:0,
                        ownerId:creature.id, mz:creature.mz, pathIdx:pIdx});
            placed++;
        }
    }

    function doorMidpoint(door) {
        let dc=door.dir==='E'?1:door.dir==='W'?-1:0;
        let dr=door.dir==='S'?1:door.dir==='N'?-1:0;
        let oy=door.mz.offsetY||0;
        return {
            x: door.col*CELL+CELL/2 + dc*CELL/2 + door.mz.offsetX,
            y: door.row*CELL+CELL/2 + dr*CELL/2 + oy
        };
    }

    // Only check doors in THIS creature's maze — survives regeneration
    function doorBlocksStep(path, fromIdx, creatureId) {
        if (fromIdx<=0||fromIdx>=path.length) return null;
        let a=path[fromIdx-1], b=path[fromIdx];
        let dc=b.col-a.col, dr=b.row-a.row;
        if (Math.abs(dc)+Math.abs(dr)!==1) return null;
        let dir=dc===1?'E':dc===-1?'W':dr===1?'S':'N';
        let opp=opposite(dir);
        // Find which maze this creature is in
        let c = creatures.find(cr => cr.id === creatureId);
        let cMz = c ? c.mz : null;
        for (let d of doors) {
            if (d.open) continue;
            if (cMz && d.mz !== cMz) continue;  // filter by maze ref
            if (d.col===a.col&&d.row===a.row&&d.dir===dir) return d;
            if (d.col===b.col&&d.row===b.row&&d.dir===opp) return d;
        }
        return null;
    }

    p.mousePressed = function() {
        let mx=p.mouseX, my=p.mouseY;
        // Play-again button during celebration
        if (celebrating && celebrateBtn &&
            mx>celebrateBtn.x&&mx<celebrateBtn.x+celebrateBtn.w&&
            my>celebrateBtn.y&&my<celebrateBtn.y+celebrateBtn.h) {
            resetGame(); return;
        }
        if (celebrating) return; // block other clicks during celebration
        // Toggle stats popup via button — load data fresh only on open
        if (statsBtn && mx>statsBtn.x && mx<statsBtn.x+statsBtn.w && my>statsBtn.y && my<statsBtn.y+statsBtn.h) {
            if (!showPopup) openPopup(); else showPopup = false;
            return;
        }
        if (showPopup) { showPopup=false; return; }
        // Left click — open doors OR activate inactive teleporter
        if (p.mouseButton === p.LEFT) {
            for (let door of doors) {
                let mp=doorMidpoint(door);
                let dx=mx-mp.x, dy=my-mp.y;
                if (dx*dx+dy*dy < (CELL*1.2)*(CELL*1.2)) door.open=true;
            }
            tryActivateTeleporter(mx, my);
            // HUD buttons — use rects stored by drawHUD each frame
            for (let c of creatures) {
                if (c._btn1 && mx>c._btn1.x && mx<c._btn1.x+c._btn1.w && my>c._btn1.y && my<c._btn1.y+c._btn1.h)
                    killNearestGhost(c);
                if (c._btn2 && mx>c._btn2.x && mx<c._btn2.x+c._btn2.w && my>c._btn2.y && my<c._btn2.y+c._btn2.h)
                    mutateMaze(c);
                if (c._btn3 && mx>c._btn3.x && mx<c._btn3.x+c._btn3.w && my>c._btn3.y && my<c._btn3.y+c._btn3.h)
                    summonAlly(c);
            }
            // Click to disarm spikes
            for (let sp of spikes) {
                if (!sp.armed) continue;
                let dx=mx-sp.x, dy=my-sp.y;
                if (dx*dx+dy*dy < (CELL*0.7)*(CELL*0.7)) { sp.armed=false; sp.resetTimer=0; }
            }
        }
        // Right click — send creature back to start
        if (p.mouseButton === p.RIGHT) {
            for (let c of creatures) {
                let dx=mx-c.x, dy=my-c.y;
                if (dx*dx+dy*dy < (BLOB_DIST*2.5)*(BLOB_DIST*2.5)) {
                    sendToStart(c);
                }
            }
        }
    };

    // Prevent context menu on right-click
    document.addEventListener("contextmenu", e => e.preventDefault());

    // ── Kill nearest ghost (costs 5 gems) — removes ONE ghost from this maze ──
    function killNearestGhost(creature) {
        if (creature.gemsCollected < KILL_GHOST_COST) return;
        // Find ghosts in the SAME maze object reference
        let mazeGhosts = ghosts.filter(g => g.mz === creature.mz);
        if (mazeGhosts.length === 0) return; // no ghosts to kill
        // Find the nearest one
        let best = null, bestD = Infinity;
        for (let g of mazeGhosts) {
            let dx = g.x - creature.x, dy = g.y - creature.y;
            let d  = dx*dx + dy*dy;
            if (d < bestD) { bestD = d; best = g; }
        }
        if (!best) return;
        creature.gemsCollected -= KILL_GHOST_COST;
        let cIdx = creatures.indexOf(creature);
        if (cIdx >= 0) gemCounts[cIdx] = creature.gemsCollected;
        // Splice out exactly that one ghost
        let gi = ghosts.indexOf(best);
        if (gi >= 0) {
            spawnPop(best.x, best.y, 255, 120, 50, 22);
            ghosts.splice(gi, 1);
        }
        creature.killFlash = 30;
    }

    // ── Summon ally ghost-killer (costs 10 gems) ──
    function summonAlly(creature) {
        if (creature.gemsCollected < ALLY_COST) return;
        // Max 2 active allies per maze at once
        let mzAllies = allies.filter(a => a.mz === creature.mz);
        if (mzAllies.length >= 2) return;
        creature.gemsCollected -= ALLY_COST;
        let cIdx = creatures.indexOf(creature);
        if (cIdx >= 0) gemCounts[cIdx] = creature.gemsCollected;
        // Spawn near the creature's current position
        let col = p.constrain(p.floor((creature.x - creature.mz.offsetX)/CELL), 0, creature.mz.cols-1);
        let row = p.constrain(p.floor((creature.y - (creature.mz.offsetY||0))/CELL), 0, creature.mz.rows-1);
        allies.push({
            mz:    creature.mz,
            x:     col*CELL+CELL/2+creature.mz.offsetX,
            y:     row*CELL+CELL/2+(creature.mz.offsetY||0),
            col, row,
            targetCol: col, targetRow: row,
            moving:  false,
            dir:     null,
            phase:   p.random(p.TWO_PI),
            speed:   CELL * 0.14,
            life:    600,   // despawns after 600 frames if no kill
            ownerId: creature.id,
        });
        creature.killFlash = 20;
    }

    function updateAllies() {
        for (let i = allies.length-1; i >= 0; i--) {
            let a = allies[i];
            a.phase += 0.07;
            a.life--;
            if (a.life <= 0) { allies.splice(i,1); continue; }

            // Navigate toward nearest ghost in same maze
            let target = null, bestD = Infinity;
            for (let g of ghosts) {
                if (g.mz !== a.mz) continue;
                let dx=g.x-a.x, dy=g.y-a.y;
                let d=dx*dx+dy*dy;
                if (d < bestD) { bestD=d; target=g; }
            }
            if (!target) { allies.splice(i,1); continue; } // no ghosts left

            // Move cell by cell
            if (!a.moving) {
                let d = pickGhostDir(a.mz, a.col, a.row, a.dir, target, {chaseProb:0.92});
                if (!d) continue;
                a.dir = d;
                a.moving = true;
                let nc=a.col, nr=a.row;
                if (d==='N') nr--; if (d==='S') nr++;
                if (d==='E') nc++; if (d==='W') nc--;
                a.targetCol = p.constrain(nc, 0, a.mz.cols-1);
                a.targetRow = p.constrain(nr, 0, a.mz.rows-1);
            }

            let tx=a.targetCol*CELL+CELL/2+a.mz.offsetX;
            let ty=a.targetRow*CELL+CELL/2+(a.mz.offsetY||0);
            let dx=tx-a.x, dy=ty-a.y, dist=Math.sqrt(dx*dx+dy*dy);
            if (dist < a.speed+1) {
                a.x=tx; a.y=ty; a.col=a.targetCol; a.row=a.targetRow; a.moving=false;
            } else {
                a.x+=(dx/dist)*a.speed; a.y+=(dy/dist)*a.speed;
            }

            // Kill ghost on contact
            for (let gi=ghosts.length-1; gi>=0; gi--) {
                let g=ghosts[gi];
                if (g.mz!==a.mz) continue;
                let ex=g.x-a.x, ey=g.y-a.y;
                if (ex*ex+ey*ey < (CELL*0.9)*(CELL*0.9)) {
                    spawnPop(g.x, g.y, 255, 220, 0, 28); // gold pop
                    spawnPop(a.x, a.y, 255, 180, 0, 20);
                    ghosts.splice(gi, 1);
                    allies.splice(i, 1);
                    break;
                }
            }
        }
    }

    function drawAllies() {
        for (let a of allies) {
            let pulse = 0.5+0.5*Math.sin(a.phase);
            let sz = CELL*0.46 + pulse*CELL*0.05;
            let lifeFrac = a.life / 600;

            p.push(); p.translate(a.x, a.y);

            // Glow — gold
            for (let ring=3; ring>=1; ring--) {
                p.noStroke();
                p.fill(255, 200+ring*10, 0, p.map(ring,1,3,25,5) * lifeFrac);
                p.ellipse(0,0,sz*2+ring*8);
            }

            // Body — gold ghost shape matching enemy ghosts
            p.noStroke(); p.fill(255, 200, 0, 210 * lifeFrac);
            p.beginShape();
            let steps=24;
            for (let i=0; i<=steps; i++) {
                let ang = p.PI + (i/steps)*p.PI;
                p.curveVertex(Math.cos(ang)*sz*0.5, Math.sin(ang)*sz*0.5);
            }
            let bumps=3;
            for (let i=0; i<=bumps*2; i++) {
                let f=i/(bumps*2);
                let bx=p.lerp(-sz*0.5, sz*0.5, f);
                let by=(i%2===0) ? sz*0.45 : sz*0.22+Math.sin(a.phase*2)*sz*0.06;
                p.curveVertex(bx, by);
            }
            p.endShape(p.CLOSE);

            // Inner highlight
            p.fill(255,240,120,80*lifeFrac); p.ellipse(-sz*0.1,-sz*0.15,sz*0.55,sz*0.4);

            // Eyes — target-seeking pupils
            let lookX=0, lookY=0;
            let nearGhost = ghosts.find(g=>g.mz===a.mz);
            if (nearGhost) {
                let ang=Math.atan2(nearGhost.y-a.y, nearGhost.x-a.x);
                lookX=Math.cos(ang)*3; lookY=Math.sin(ang)*3;
            }
            let er=sz*0.11;
            for (let eo of [{x:-sz*0.18,y:-sz*0.05},{x:sz*0.18,y:-sz*0.05}]) {
                p.fill(255,255,255,230*lifeFrac); p.ellipse(eo.x,eo.y,er*2,er*2.4);
                p.fill(80,40,0,220*lifeFrac);     p.ellipse(eo.x+lookX*0.5,eo.y+lookY*0.5,er*1.1,er*1.3);
            }

            // Life bar above head
            let barW=sz*1.1, barH=3;
            p.noStroke(); p.fill(40,40,40,160); p.rect(-barW/2,-sz*0.85,barW,barH,2);
            p.fill(255,200,0,200*lifeFrac); p.rect(-barW/2,-sz*0.85,barW*lifeFrac,barH,2);

            p.pop();
        }
    }

    // ── Mutate a section of the maze (costs 10 gems) ──
    // Picks a random 3×3 region and re-carves it, opening new passages
    function mutateMaze(creature) {
        if (creature.gemsCollected < MUTATE_MAZE_COST) return;
        creature.gemsCollected -= MUTATE_MAZE_COST;
        let cIdx = creatures.indexOf(creature);
        if (cIdx >= 0) gemCounts[cIdx] = creature.gemsCollected;

        let mz = creature.mz;

        // Centre mutation on creature's current cell
        let creatureCol = p.constrain(p.floor((creature.x - mz.offsetX) / CELL), 1, mz.cols - 3);
        let creatureRow = p.constrain(p.floor((creature.y - (mz.offsetY||0)) / CELL), 1, mz.rows - 3);
        let ac = creatureCol, ar = creatureRow;
        let w = 3, h = 3;

        // Reset visited flags for the region only
        for (let r = ar; r < ar+h; r++)
            for (let c = ac; c < ac+w; c++)
                mz.cells[r][c].visited = false;

        // Re-carve within the 3x3 patch using iterative DFS
        let stack = [{c:ac, r:ar}];
        mz.cells[ar][ac].visited = true;
        while (stack.length > 0) {
            let {c, r} = stack[stack.length-1];
            let dirs = p.shuffle(['N','S','E','W']);
            let moved = false;
            for (let d of dirs) {
                let nc=c, nr=r;
                if (d==='N') nr--; if (d==='S') nr++;
                if (d==='E') nc++; if (d==='W') nc--;
                if (nr < ar || nr >= ar+h || nc < ac || nc >= ac+w) continue;
                if (mz.cells[nr][nc].visited) continue;
                mz.cells[r][c].walls[d]             = false;
                mz.cells[nr][nc].walls[opposite(d)] = false;
                mz.cells[nr][nc].visited = true;
                stack.push({c:nc, r:nr});
                moved = true; break;
            }
            if (!moved) stack.pop();
        }

        // ── REPATH from SPAWN → GOAL so creature can walk a valid path after death ──
        // Always repath from the fixed spawn so sendToStart + pathIndex=1 is consistent
        let newPaths = findMultiplePaths(mz, creature.spawnCol, creature.spawnRow,
                                          creature.goalCol,  creature.goalRow, PATHS_PER_MAZE);
        if (newPaths && newPaths.length > 0 && newPaths[0].length > 1) {
            creature.paths      = newPaths;
            creature.pathSetIdx = 0;
            // Find closest node to current position so creature doesn't teleport
            creature.pathIndex  = closestPathStep(newPaths[0], creature.x, creature.y, mz.offsetX);
            creature.trail      = [];
        }

        // Visual flash showing mutated region
        creature.mutateFlash  = 30;
        creature.mutateRegion = {
            x: ac*CELL + mz.offsetX,
            y: ar*CELL + (mz.offsetY||0),
            w: w*CELL, h: h*CELL
        };
    }

    function sendToStart(c) {
        // Always use the fixed spawn point — not path[0] which changes after mutation
        c.x = c.spawnX;
        c.y = c.spawnY;
        for (let b of c.blobs) { b.x=c.x; b.y=c.y; b.vx=0; b.vy=0; }
        c.pathIndex     = 1;
        c.pathSetIdx    = 0;
        c.finished      = false;
        c.finishTimer   = 0;
        c.blocked       = false;
        c.blockedFrames = 0;
        c.teleporting   = false;
        c.vx=0; c.vy=0;
        c.trail=[];
        resetTimer = -1;

        // Track death and sync to persistent array
        c.deathCount++;
        let cIdx = creatures.indexOf(c);
        if (cIdx >= 0) {
            deathCounts[cIdx] = c.deathCount;
            totalDeaths[cIdx]++;
        }

        // Flash the screen for this creature's side
        c.deathFlash = 20; // frames of flash
        saveStats();

        // If this creature has died enough times, regenerate its maze
        if (c.deathCount >= DEATH_LIMIT) {
            c.deathCount = 0;
            if (cIdx >= 0) deathCounts[cIdx] = 0;
            scheduleMapChange(cIdx);
        }
    }

    // Regenerate just one side of the maze after a short delay
    let mapChangeTimer = -1;
    let mapChangeSide  = -1;

    function scheduleMapChange(sideIdx) {
        mapChangeTimer = 90; // ~1.5 second warning flash before change
        mapChangeSide  = sideIdx;
    }

    function tickMapChange() {
        if (mapChangeTimer < 0) return;
        mapChangeTimer--;
        if (mapChangeTimer === 0) {
            mazeGeneration++;
            regenerateSide(mapChangeSide);
            mapChangeTimer = -1;
            mapChangeSide  = -1;
        }
    }

    function regenerateSide(sideIdx) {
        let halfW = p.floor(p.width / 2);
        let gap   = 2;
        mazesLost[sideIdx]++;

        if (sideIdx === 0) {
            let oldMaze = mazeL;  // capture OLD ref BEFORE rebuilding
            mazeL = buildMaze(halfW - gap, p.height, 0, HUD_H);
            // Filter out objects belonging to the OLD maze
            doors       = doors.filter(d => d.mz !== oldMaze);
            teleporters = teleporters.filter(t => t.mz !== oldMaze);
            gems        = gems.filter(g => g.mz !== oldMaze);
            spikes      = spikes.filter(s => s.mz !== oldMaze);
            ghosts      = ghosts.filter(g => g.mz !== oldMaze);
            let r0    = p.floor(mazeL.rows * 0.5);
            let p0    = findMultiplePaths(mazeL, 0, r0, mazeL.cols-1, r0, PATHS_PER_MAZE);
            let prevGems = creatures[0] ? creatures[0].gemsCollected : 0;
            let c0 = createCreature(mazeL,
                p0[0][0].col*CELL+CELL/2+mazeL.offsetX,
                p0[0][0].row*CELL+CELL/2+mazeL.offsetY, p0, PALETTES[0]);
            c0.gemsCollected = prevGems;  // gems roll over!
            creatures[0] = c0;
            placeDoors(c0, DOORS_PER_MAZE);
            placeTeleporters(c0, TELEPORTERS_PER);
            spawnGhosts(mazeL, GHOSTS_PER_MAZE);
            placeGems(mazeL, c0, GEMS_PER_MAZE);
            placeSpikes(mazeL, c0, SPIKES_PER_MAZE);
        } else {
            let oldMaze = mazeR;
            mazeR = buildMaze(p.width - halfW - gap, p.height, halfW + gap, HUD_H);
            doors       = doors.filter(d => d.mz !== oldMaze);
            teleporters = teleporters.filter(t => t.mz !== oldMaze);
            gems        = gems.filter(g => g.mz !== oldMaze);
            spikes      = spikes.filter(s => s.mz !== oldMaze);
            ghosts      = ghosts.filter(g => g.mz !== oldMaze);
            let r1    = p.floor(mazeR.rows * 0.5);
            let p1    = findMultiplePaths(mazeR, mazeR.cols-1, r1, 0, r1, PATHS_PER_MAZE);
            let prevGems = creatures[1] ? creatures[1].gemsCollected : 0;
            let c1 = createCreature(mazeR,
                p1[0][0].col*CELL+CELL/2+mazeR.offsetX,
                p1[0][0].row*CELL+CELL/2+mazeR.offsetY, p1, PALETTES[1]);
            c1.gemsCollected = prevGems;  // gems roll over!
            creatures[1] = c1;
            placeDoors(c1, DOORS_PER_MAZE);
            placeTeleporters(c1, TELEPORTERS_PER);
            spawnGhosts(mazeR, GHOSTS_PER_MAZE);
            placeGems(mazeR, c1, GEMS_PER_MAZE);
            placeSpikes(mazeR, c1, SPIKES_PER_MAZE);
        }
    }

    // ============================================================
    //  PARTICLES  — pop bursts for ghost death + player death
    // ============================================================
    function spawnPop(x, y, r, g, b, count) {
        for (let i = 0; i < count; i++) {
            let angle  = p.random(p.TWO_PI);
            let speed  = p.random(1.5, 5.5);
            particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                r, g, b,
                life: 1.0,
                decay: p.random(0.03, 0.07),
                sz: p.random(3, 10),
            });
        }
    }

    function updateParticles() {
        for (let i = particles.length - 1; i >= 0; i--) {
            let pt = particles[i];
            pt.x   += pt.vx;
            pt.y   += pt.vy;
            pt.vx  *= 0.88;
            pt.vy  *= 0.88;
            pt.vy  += 0.12;  // slight gravity
            pt.life -= pt.decay;
            if (pt.life <= 0) particles.splice(i, 1);
        }
    }

    function drawParticles() {
        p.noStroke();
        for (let pt of particles) {
            let a = pt.life * 220;
            p.fill(pt.r, pt.g, pt.b, a);
            p.ellipse(pt.x, pt.y, pt.sz * pt.life, pt.sz * pt.life);
        }
    }

    // ============================================================
    //  GHOSTS  (Pac-Man style chasers, wall-aware, bounce off edges)
    // ============================================================
    const GHOST_SPEED       = CELL * 0.09;   // slightly slower than creature
    const GHOST_CATCH_DIST  = CELL * 0.85;   // distance to catch a creature
    const GHOST_CHASE_PROB  = 0.75;          // probability of moving toward creature vs random

    // Spread ghosts across quadrants so they cover the maze evenly
    function spawnGhosts(mz, count) {
        // Global ghost cap
        count = Math.min(count, Math.max(0, MAX_GHOSTS - ghosts.length));
        if (count <= 0) return;
        let qCols = p.floor(mz.cols / 2);
        let qRows = p.floor(mz.rows / 2);
        let quadrants = [
            {c0:1,       r0:1,       c1:qCols,       r1:qRows      },
            {c0:qCols+1, r0:1,       c1:mz.cols-2,   r1:qRows      },
            {c0:1,       r0:qRows+1, c1:qCols,       r1:mz.rows-2  },
            {c0:qCols+1, r0:qRows+1, c1:mz.cols-2,   r1:mz.rows-2  },
        ];
        for (let i = 0; i < count; i++) {
            let q   = quadrants[i % quadrants.length];
            let col = p.floor(p.random(q.c0, q.c1+1));
            let row = p.floor(p.random(q.r0, q.r1+1));
            col = p.constrain(col, 0, mz.cols-1);
            row = p.constrain(row, 0, mz.rows-1);
            // Each ghost has a slightly different speed and chase probability
            let ghostDelay = i * 60 + p.floor(p.random(30));
            ghosts.push({
                mz,
                x: col*CELL + CELL/2 + mz.offsetX,
                y: row*CELL + CELL/2 + (mz.offsetY||0),
                col, row,
                dir: null,
                targetCol: col, targetRow: row,
                moving: false,
                phase: p.random(p.TWO_PI),
                speed:      CELL * p.random(0.07, 0.11),
                chaseProb:  p.random(0.55, 0.88),
                hue:        p.floor(p.random(4)),
                spawnDelay: ghostDelay,  // stagger ghost activation  // 0=red 1=orange 2=pink 3=blue
            });
        }
    }

    // Pick a valid direction for the ghost to move from (col,row)
    // Prefers moving toward the nearest creature in the same maze
    // Avoids reversing (lastDir = opposite) unless it's the only option
    // BFS for ghosts — respects ghost walls (narrow passages) and closed doors
    // Returns the first direction to take from (col,row) toward (tc,tr)
    function ghostBFS(mz, col, row, tc, tr) {
        if (col===tc && row===tr) return null;
        let queue   = [{c:col, r:row, path:[]}];
        let visited = new Set([`${col},${row}`]);
        while (queue.length > 0) {
            let {c, r, path} = queue.shift();
            let cell = mz.cells[r][c];
            for (let d of ['N','S','E','W']) {
                let nc=c, nr=r;
                if (d==='N') nr--; if (d==='S') nr++;
                if (d==='E') nc++; if (d==='W') nc--;
                if (nr<0||nr>=mz.rows||nc<0||nc>=mz.cols) continue;
                let key=`${nc},${nr}`;
                if (visited.has(key)) continue;
                // Ghost can't pass narrow passages or closed doors
                if (cell.walls[d] || cell['ghostWall_'+d]) continue;
                // Ghost can't pass through closed doors (same check as doorBlocksStep)
                let blocked=false;
                for (let door of doors) {
                    if (door.open) continue;
                    let opp=opposite(d);
                    if (door.col===c&&door.row===r&&door.dir===d)   { blocked=true; break; }
                    if (door.col===nc&&door.row===nr&&door.dir===opp){ blocked=true; break; }
                }
                if (blocked) continue;
                visited.add(key);
                let newPath = path.length===0 ? [d] : path;
                if (nc===tc && nr===tr) return path.length===0 ? d : path[0];
                queue.push({c:nc, r:nr, path: path.length===0 ? [d] : path});
            }
        }
        return null; // no path found
    }

    function pickGhostDir(mz, col, row, lastDir, targetCreature, ghost) {
        let cell = mz.cells[row][col];
        let dirs = ['N','S','E','W'];
        // Ghosts can't pass narrow passages (ghostWall flag)
        let open = dirs.filter(d => !cell.walls[d] && !cell['ghostWall_'+d]);
        if (open.length === 0) return null;

        // Avoid reversing unless stuck
        let noReverse = open.filter(d => d !== opposite(lastDir));
        let candidates = noReverse.length > 0 ? noReverse : open;

        // If chasing, bias toward the direction that closes distance to creature
        let chaseP = (ghost && ghost.chaseProb) ? ghost.chaseProb : GHOST_CHASE_PROB;
        if (targetCreature && p.random() < chaseP) {
            let cx = targetCreature.x - mz.offsetX;
            let cy = targetCreature.y - (mz.offsetY||0);
            let gcx = col*CELL + CELL/2;
            let gcy = row*CELL + CELL/2;

            // Score each direction by how much it closes distance
            let scored = candidates.map(d => {
                let nc=col, nr=row;
                if (d==='N') nr--; if (d==='S') nr++;
                if (d==='E') nc++; if (d==='W') nc--;
                let nx=nc*CELL+CELL/2, ny=nr*CELL+CELL/2;
                let distBefore = Math.sqrt((gcx-cx)**2+(gcy-cy)**2);
                let distAfter  = Math.sqrt((nx-cx)**2+(ny-cy)**2);
                return { d, score: distBefore - distAfter };
            });
            scored.sort((a,b) => b.score - a.score);
            // Mostly pick best, occasionally random (so it doesn't perfectly corner)
            let topP = (ghost && ghost.chaseProb) ? ghost.chaseProb : 0.82;
            return p.random() < topP ? scored[0].d : candidates[p.floor(p.random(candidates.length))];
        }

        return candidates[p.floor(p.random(candidates.length))];
    }

    function updateGhosts() {
        for (let g of ghosts) {
            g.phase += 0.06;
            if (g.spawnDelay > 0) { g.spawnDelay--; continue; }

            let target = creatures.find(c => c.mz === g.mz && !c.finished);

            if (!g.moving) {
                let d = null;

                // Use BFS to find real path to creature
                if (target) {
                    let tc = p.constrain(p.floor((target.x - g.mz.offsetX)/CELL), 0, g.mz.cols-1);
                    let tr = p.constrain(p.floor((target.y - (g.mz.offsetY||0))/CELL), 0, g.mz.rows-1);
                    d = ghostBFS(g.mz, g.col, g.row, tc, tr);
                }
                // Fallback: random open direction if BFS fails or no target
                if (!d) {
                    let cell = g.mz.cells[g.row][g.col];
                    let open = ['N','S','E','W'].filter(dir =>
                        !cell.walls[dir] && !cell['ghostWall_'+dir]
                    );
                    let noRev = open.filter(dir => dir !== opposite(g.dir));
                    let cands = noRev.length > 0 ? noRev : open;
                    if (cands.length === 0) continue;
                    d = cands[p.floor(p.random(cands.length))];
                }

                g.dir = d;
                g.moving = true;
                let nc=g.col, nr=g.row;
                if (d==='N') nr--; if (d==='S') nr++;
                if (d==='E') nc++; if (d==='W') nc--;
                nc = p.constrain(nc, 0, g.mz.cols-1);
                nr = p.constrain(nr, 0, g.mz.rows-1);
                g.targetCol = nc; g.targetRow = nr;
            }

            // Move toward target cell
            let tx = g.targetCol*CELL+CELL/2+g.mz.offsetX;
            let ty = g.targetRow*CELL+CELL/2+(g.mz.offsetY||0);
            let dx = tx - g.x, dy = ty - g.y;
            let dist = Math.sqrt(dx*dx+dy*dy);

            if (dist < (g.speed||GHOST_SPEED) + 1) {
                g.x = tx; g.y = ty;
                g.col = g.targetCol; g.row = g.targetRow;
                g.moving = false;
            } else {
                g.x += (dx/dist)*(g.speed||GHOST_SPEED);
                g.y += (dy/dist)*(g.speed||GHOST_SPEED);
            }

            // Check catch — send creature back to start
            if (target && !target.teleporting) {
                let cdx = g.x - target.x, cdy = g.y - target.y;
                if (cdx*cdx+cdy*cdy < GHOST_CATCH_DIST*GHOST_CATCH_DIST) {
                    spawnPop(target.x, target.y, 80, 200, 255, 18);
                    sendToStart(target);
                    // Ghost bounces back to a random spot after catching
                    g.col = p.floor(p.random(1, g.mz.cols-1));
                    g.row = p.floor(p.random(1, g.mz.rows-1));
                    g.x   = g.col*CELL+CELL/2+g.mz.offsetX;
                    g.y   = g.row*CELL+CELL/2+(g.mz.offsetY||0);
                    g.moving = false;
                }
            }
        }
    }

    function drawGhosts() {
        for (let g of ghosts) {
            if (g.spawnDelay > 0) continue;  // not active yet — hidden
            let x=g.x, y=g.y;
            let pulse = 0.5+0.5*Math.sin(g.phase);
            let sz = CELL*0.52 + pulse*CELL*0.06;

            // Define gc FIRST before any use
            let ghostColors = [[220,30,30],[240,120,20],[220,60,160],[30,180,220]];
            let gc = ghostColors[g.hue||0];

            p.push();
            p.translate(x, y);

            // Eerie glow
            for (let ring=3; ring>=1; ring--) {
                p.noStroke();
                p.fill(gc[0], gc[1]*0.5+ring*10, gc[2]*0.3, p.map(ring,1,3,30,6));
                p.ellipse(0, 0, sz*2 + ring*8);
            }

            // Ghost body — classic pac-man shape: dome top, wavy skirt
            p.noStroke();
            p.fill(gc[0], gc[1], gc[2], 200);
            p.beginShape();
            let steps = 24;
            // Dome top (semicircle)
            for (let i=0; i<=steps; i++) {
                let a = p.PI + (i/steps)*p.PI;  // 180° to 360°
                p.curveVertex(Math.cos(a)*sz*0.5, Math.sin(a)*sz*0.5);
            }
            // Wavy skirt bottom — 3 bumps
            let bumps = 3;
            for (let i=0; i<=bumps*2; i++) {
                let f  = i/(bumps*2);
                let bx = p.lerp(-sz*0.5, sz*0.5, f);
                let by = (i%2===0) ? sz*0.45 : sz*0.22 + Math.sin(g.phase*2)*sz*0.06;
                p.curveVertex(bx, by);
            }
            p.endShape(p.CLOSE);

            // Inner highlight
            p.fill(Math.min(255,gc[0]+40), Math.min(255,gc[1]+50), Math.min(255,gc[2]+50), 80);
            p.ellipse(-sz*0.1, -sz*0.15, sz*0.55, sz*0.4);

            // Eyes — white with dark pupils
            let eyeOffsets = [{x:-sz*0.18, y:-sz*0.05},{x:sz*0.18, y:-sz*0.05}];
            // Pupils track toward creature direction
            let eyeTarget = creatures.find(c => c.mz === g.mz);
            let lookX=0, lookY=0;
            if (eyeTarget) {
                let ang = Math.atan2(eyeTarget.y-y, eyeTarget.x-x);
                lookX = Math.cos(ang)*3; lookY = Math.sin(ang)*3;
            }
            for (let eo of eyeOffsets) {
                p.fill(255,255,255); p.ellipse(eo.x, eo.y, sz*0.22, sz*0.26);
                p.fill(20,20,120);  p.ellipse(eo.x+lookX*0.5, eo.y+lookY*0.5, sz*0.12, sz*0.14);
            }

            p.pop();
        }
    }

    // ============================================================
    //  GEMS  (collectables — creature auto-picks up when nearby)
    // ============================================================
    // Returns true if (col,row) is too close to any already-placed object in occupied set
    function tooClose(col, row, occupied, minDist) {
        for (let [oc, or_] of occupied) {
            if (Math.abs(col-oc) + Math.abs(row-or_) < minDist) return true;
        }
        return false;
    }

    function placeGems(mz, creature, count) {
        count = Math.min(count, Math.max(0, MAX_GEMS - gems.length));
        if (count <= 0) return;

        // Build occupied set from already-placed objects in this maze
        let occupied = new Set();
        for (let g of gems)   if (g.mz===mz)   occupied.add(`${g.col},${g.row}`);
        for (let s of spikes) if (s.mz===mz)   occupied.add(`${s.col},${s.row}`);

        // Collect ALL interior nodes across all paths, deduplicated
        let nodeMap = new Map();
        for (let path of creature.paths) {
            let lo = Math.floor(path.length * 0.12);
            let hi = path.length - 3;
            for (let i = lo; i < hi; i++) {
                let n = path[i], key = `${n.col},${n.row}`;
                if (!nodeMap.has(key)) nodeMap.set(key, n);
            }
        }
        let allNodes = p.shuffle([...nodeMap.values()]);

        // Enforce minimum spacing of 3 cells between gems
        let MIN_DIST = 3;
        let placed = 0;
        let placedSet = [];  // [{col,row}]
        for (let n of allNodes) {
            if (placed >= count) break;
            let key = `${n.col},${n.row}`;
            if (occupied.has(key)) continue;
            // Check distance from all previously placed gems this session
            let bad = placedSet.some(p2 =>
                Math.abs(n.col-p2.col) + Math.abs(n.row-p2.row) < MIN_DIST
            );
            if (bad) continue;
            occupied.add(key);
            placedSet.push(n);
            gems.push({
                mz, ownerId: creature.id,
                col: n.col, row: n.row,
                x: n.col*CELL+CELL/2+mz.offsetX,
                y: n.row*CELL+CELL/2+(mz.offsetY||0),
                collected: false,
                phase: p.random(p.TWO_PI),
                type: p.floor(p.random(3)),
                spawnDelay: placed * 30 + p.floor(p.random(20)),  // stagger appearance
            });
            placed++;
        }
    }

    function updateGems() {
        for (let gem of gems) {
            if (gem.collected) continue;
            if (gem.spawnDelay > 0) { gem.spawnDelay--; continue; }  // not visible yet
            gem.phase += 0.05;
            // Check if creature picks it up
            let c = creatures.find(cr => cr.mz === gem.mz);
            if (!c || c.finished) continue;
            let dx = c.x - gem.x, dy = c.y - gem.y;
            if (dx*dx+dy*dy < (CELL*0.55)*(CELL*0.55)) {
                gem.collected = true;
                c.gemsCollected++;
                let cIdx = creatures.indexOf(c);
                if (cIdx >= 0) gemCounts[cIdx] = c.gemsCollected;
                c.speed = Math.min(c.speed * 1.04, CELL * 0.22);
                c.gemFlash = 15; // frames of sparkle flash
            }
        }
    }

    function drawGems() {
        for (let gem of gems) {
            if (gem.collected) continue;
            if (gem.spawnDelay > 0) continue;  // not visible yet
            let pulse = 0.5+0.5*Math.sin(gem.phase);
            let sz    = CELL*0.22 + pulse*CELL*0.06;
            p.push();
            p.translate(gem.x, gem.y);

            // Glow
            p.noStroke();
            if      (gem.type===0) p.fill(80,220,255,  30*pulse);
            else if (gem.type===1) p.fill(255,200,80,  30*pulse);
            else                   p.fill(180,80,255,  30*pulse);
            p.ellipse(0,0,sz*3,sz*3);

            // Gem body
            if (gem.type===0) {
                // Diamond
                p.fill(80,220,255, 200);
                p.beginShape();
                p.vertex(0,-sz); p.vertex(sz*0.6,0); p.vertex(0,sz*0.7); p.vertex(-sz*0.6,0);
                p.endShape(p.CLOSE);
                p.fill(200,240,255,120);
                p.beginShape(); p.vertex(0,-sz); p.vertex(sz*0.6,0); p.vertex(0,-sz*0.1); p.endShape(p.CLOSE);
            } else if (gem.type===1) {
                // Circle gem
                p.fill(255,200,80, 200);
                p.ellipse(0,0,sz*2,sz*2);
                p.fill(255,240,160,120);
                p.ellipse(-sz*0.25,-sz*0.25,sz*0.8,sz*0.6);
            } else {
                // Star
                p.fill(180,80,255, 200);
                p.beginShape();
                for (let i=0;i<5;i++) {
                    let a1=(i/5)*p.TWO_PI-p.HALF_PI;
                    let a2=((i+0.5)/5)*p.TWO_PI-p.HALF_PI;
                    p.vertex(Math.cos(a1)*sz,Math.sin(a1)*sz);
                    p.vertex(Math.cos(a2)*sz*0.45,Math.sin(a2)*sz*0.45);
                }
                p.endShape(p.CLOSE);
            }
            p.pop();
        }
    }

    // ============================================================
    //  SPIKES  (traps — click to deactivate, auto-reset after a while)
    // ============================================================
    const SPIKE_RESET_FRAMES = 360;  // frames until spike rearms

    function placeSpikes(mz, creature, count) {
        count = Math.min(count, Math.max(0, MAX_SPIKES - spikes.length));
        if (count <= 0) return;

        // Build occupied set — gems already placed + teleporter exit cells
        let occupied = new Set();
        for (let g of gems)   if (g.mz===mz) occupied.add(`${g.col},${g.row}`);
        // Also keep teleporter exit cells safe
        for (let hub of teleporters) {
            if (hub.mz!==mz) continue;
            for (let ex of hub.exits) occupied.add(`${ex.col},${ex.row}`);
            occupied.add(`${hub.entry.col},${hub.entry.row}`);
        }

        // Protect spawn area (first 35%) and finish area of every path
        let safeKeys = new Set();
        for (let path of creature.paths) {
            let safeLen = p.floor(path.length * 0.35);
            for (let i = 0; i < safeLen; i++) safeKeys.add(`${path[i].col},${path[i].row}`);
            for (let i = path.length-3; i < path.length; i++)
                safeKeys.add(`${path[i].col},${path[i].row}`);
        }

        // Collect candidates from middle 35–90% of each path, deduplicated
        let nodeMap = new Map();
        for (let path of creature.paths) {
            let lo = p.floor(path.length * 0.35);
            let hi = p.floor(path.length * 0.90);
            for (let i = lo; i < hi; i++) {
                let n = path[i], key = `${n.col},${n.row}`;
                if (!safeKeys.has(key) && !nodeMap.has(key)) nodeMap.set(key, n);
            }
        }
        let candidates = p.shuffle([...nodeMap.values()]);

        // Enforce min spacing of 4 cells between spikes
        const MIN_DIST = 4;
        let placed = 0, placedSet = [];
        for (let n of candidates) {
            if (placed >= count) break;
            let key = `${n.col},${n.row}`;
            if (occupied.has(key)) continue;
            let bad = placedSet.some(p2 =>
                Math.abs(n.col-p2.col) + Math.abs(n.row-p2.row) < MIN_DIST
            );
            if (bad) continue;
            occupied.add(key);
            placedSet.push(n);
            spikes.push({
                mz, ownerId: creature.id,
                col: n.col, row: n.row,
                x: n.col*CELL+CELL/2+mz.offsetX,
                y: n.row*CELL+CELL/2+(mz.offsetY||0),
                armed: false,  // start disarmed, arm after spawnDelay
                resetTimer: 0,
                hitCooldown: 0,
                phase: p.random(p.TWO_PI),
                spawnDelay: placed * 45 + p.floor(p.random(30)),  // stagger arming
            });
            placed++;
        }
    }

    function updateSpikes() {
        for (let sp of spikes) {
            sp.phase += 0.04;
            // Countdown spawn delay before arming
            if (sp.spawnDelay > 0) { sp.spawnDelay--; if (sp.spawnDelay===0) sp.armed=true; continue; }
            // Tick post-death invincibility so creature isn't killed again immediately
            if (sp.hitCooldown > 0) { sp.hitCooldown--; continue; }
            if (!sp.armed) {
                sp.resetTimer++;
                if (sp.resetTimer >= SPIKE_RESET_FRAMES) {
                    sp.armed = true;
                    sp.resetTimer = 0;
                }
                continue;
            }
            // Match creature by maze reference (survives regeneration)
            let c = creatures.find(cr => cr.mz === sp.mz);
            if (!c || c.finished || c.teleporting || c.postTeleportGrace > 0) continue;
            let dx = c.x - sp.x, dy = c.y - sp.y;
            if (dx*dx+dy*dy < (CELL*0.30)*(CELL*0.30)) {
                spawnPop(c.x, c.y, 255, 80, 80, 16);
                sendToStart(c);
                sp.hitCooldown = 120; // 2 second grace before this spike can kill again
            }
        }
    }

    function drawSpikes() {
        for (let sp of spikes) {
            p.push();
            p.translate(sp.x, sp.y);
            let pulse = 0.5+0.5*Math.sin(sp.phase);

            if (sp.armed) {
                // Red pulsing X of spikes
                p.noStroke();
                p.fill(200, 30, 30, 30+20*pulse);
                p.ellipse(0,0,CELL*0.8,CELL*0.8);
                // 4 spike triangles
                let sc2 = CELL*0.26;
                p.fill(220, 40, 40, 210);
                for (let i=0;i<4;i++) {
                    p.push(); p.rotate(i*p.HALF_PI);
                    p.beginShape();
                    p.vertex(0, -sc2*1.1);
                    p.vertex(-sc2*0.35, -sc2*0.3);
                    p.vertex( sc2*0.35, -sc2*0.3);
                    p.endShape(p.CLOSE);
                    p.pop();
                }
                // Diagonal spikes
                p.fill(200, 60, 60, 160);
                for (let i=0;i<4;i++) {
                    p.push(); p.rotate(p.PI/4 + i*p.HALF_PI);
                    p.beginShape();
                    p.vertex(0, -sc2*0.8);
                    p.vertex(-sc2*0.25, -sc2*0.15);
                    p.vertex( sc2*0.25, -sc2*0.15);
                    p.endShape(p.CLOSE);
                    p.pop();
                }
                // Click hint
                let hint = 0.4+0.4*Math.sin(p.frameCount*0.08);
                p.noStroke(); p.fill(255,100,100,110*hint);
                p.textAlign(p.CENTER,p.CENTER); p.textSize(CELL*0.13);
                p.text('click',0,CELL*0.44);
            } else {
                // Disarmed — dim grey, shows rearm progress arc
                p.noStroke(); p.fill(80,80,80,60);
                p.ellipse(0,0,CELL*0.6,CELL*0.6);
                p.fill(100,100,100,80);
                for (let i=0;i<4;i++) {
                    p.push(); p.rotate(i*p.HALF_PI);
                    p.triangle(0,-CELL*0.18,-CELL*0.07,-CELL*0.06,CELL*0.07,-CELL*0.06);
                    p.pop();
                }
                // Rearm arc
                let frac = sp.resetTimer/SPIKE_RESET_FRAMES;
                p.noFill(); p.stroke(200,60,60,80);
                p.strokeWeight(2);
                p.arc(0,0,CELL*0.7,CELL*0.7,-p.HALF_PI,-p.HALF_PI+frac*p.TWO_PI);
            }
            p.pop();
        }
    }

    // ============================================================
    //  TELEPORTERS  — Hub model
    //  Each creature has ONE entry hub + 3 secondary exits that
    //  rotate which is active. Stepping on the hub warps to whichever
    //  secondary is currently hot. Click an inactive secondary to
    //  force-activate it. Exits land mid-path on DIFFERENT paths so
    //  they naturally pull the creature onto new routes.
    // ============================================================
    const TP_EXIT_CYCLE = 420;   // frames each exit stays active before rotating

    // teleporters array stores HUB objects:
    //   { entry:{col,row}, exits:[{col,row,pathIdx},...], activeExitIdx, timer,
    //     ownerId, mz, phase }

    function placeTeleporters(creature, numExits) {
        let mz   = creature.mz;
        let paths = creature.paths;

        // Pick entry from partway along path 0 (fixed hub position)
        let mainPath = paths[0];
        if (mainPath.length < 8) return;
        let entryI = p.floor(mainPath.length * 0.25);
        let entry  = mainPath[entryI];

        // One exit per path (different path = different route through maze)
        let exits = [];
        let usedCells = new Set([`${entry.col},${entry.row}`]);

        for (let pi = 0; pi < paths.length && exits.length < numExits; pi++) {
            let path = paths[pi];
            // Pick an exit from the SECOND half of this path so it's further along
            let lo = p.floor(path.length * 0.50);
            let hi = p.floor(path.length * 0.80);
            if (lo >= hi) continue;
            let xi  = p.floor(p.random(lo, hi));
            let node = path[xi];
            let key  = `${node.col},${node.row}`;
            if (usedCells.has(key)) continue;
            // Never place exit on a spike cell
            let onSpike = spikes.some(s => s.mz===mz && s.col===node.col && s.row===node.row);
            if (onSpike) continue;
            usedCells.add(key);
            exits.push({ col:node.col, row:node.row, pathIdx:pi });
        }

        if (exits.length === 0) return;

        // Stagger starting active exit so the two creatures aren't in sync
        let startIdx = p.floor(p.random(exits.length));
        teleporters.push({
            entry,
            exits,
            activeExitIdx: startIdx,
            timer:   TP_EXIT_CYCLE,
            ownerId: creature.id,
            mz,
            phase:   p.random(p.TWO_PI),
        });
    }

    function updateTeleporters() {
        for (let hub of teleporters) {
            hub.phase += 0.04;
            hub.timer--;
            if (hub.timer <= 0) {
                // Rotate to next exit
                hub.activeExitIdx = (hub.activeExitIdx + 1) % hub.exits.length;
                hub.timer = TP_EXIT_CYCLE;
            }
        }
    }

    function checkTeleport(c) {
        if (c.teleporting || c.finished) return;
        let col = p.constrain(p.floor((c.x - c.mz.offsetX) / CELL), 0, c.mz.cols-1);
        let row = p.constrain(p.floor((c.y - (c.mz.offsetY||0)) / CELL), 0, c.mz.rows-1);

        for (let hub of teleporters) {
            if (hub.mz !== c.mz) continue;  // match by maze reference
            if (col !== hub.entry.col || row !== hub.entry.row) continue;

            // Warp to whichever exit is currently active
            let exit    = hub.exits[hub.activeExitIdx];
            let destX   = exit.col * CELL + CELL/2 + c.mz.offsetX;
            let destY   = exit.row * CELL + CELL/2 + (c.mz.offsetY||0);

            c.teleporting      = true;
            c.teleportProgress = 0;
            c.teleportFrom     = { x: hub.entry.col*CELL+CELL/2+c.mz.offsetX,
                                   y: hub.entry.row*CELL+CELL/2+(c.mz.offsetY||0) };
            c.teleportTo       = { x: destX, y: destY };

            // Switch creature to the path that this exit belongs to
            let targetPathIdx = exit.pathIdx;
            c.pathSetIdx  = targetPathIdx;
            c.pathIndex   = closestPathStep(c.paths[targetPathIdx], destX, destY, c.mz.offsetX);
            c.trail = [];
            return;
        }
    }

    // Left-click an exit portal to force-rotate to it immediately
    function tryActivateTeleporter(mx, my) {
        for (let hub of teleporters) {
            // Check entry portal
            let ex = hub.entry.col*CELL+CELL/2+hub.mz.offsetX;
            let ey = hub.entry.row*CELL+CELL/2;
            // Check each exit portal
            for (let ei = 0; ei < hub.exits.length; ei++) {
                let exit = hub.exits[ei];
                let px = exit.col*CELL+CELL/2+hub.mz.offsetX;
                let py = exit.row*CELL+CELL/2+(hub.mz.offsetY||0);
                let hitR = (CELL*0.75)*(CELL*0.75);
                if ((mx-px)**2+(my-py)**2 < hitR) {
                    // Jump active exit to this one
                    hub.activeExitIdx = ei;
                    hub.timer = TP_EXIT_CYCLE;
                    return;
                }
            }
        }
    }

    // ============================================================
    //  CREATURE FACTORY
    // ============================================================
    function createCreature(mz, x, y, paths, palette) {
        // Note: caller must set gemsCollected from gemCounts after creation
        let blobs=[];
        for (let i=0;i<NUM_BLOBS;i++) {
            let a=(i/NUM_BLOBS)*p.TWO_PI;
            blobs.push({x:x+Math.cos(a)*BLOB_DIST, y:y+Math.sin(a)*BLOB_DIST, vx:0, vy:0});
        }
        let destPt  = paths[0][paths[0].length-1];
        let startPt = paths[0][0];
        return {
            id:_creatureId++, mz, x, y, vx:0, vy:0,
            // Fixed spawn and goal — never change even after mutation
            spawnX:   startPt.col*CELL+CELL/2+mz.offsetX,
            spawnY:   startPt.row*CELL+CELL/2+(mz.offsetY||0),
            spawnCol: startPt.col,
            spawnRow: startPt.row,
            goalCol:  destPt.col,
            goalRow:  destPt.row,
            paths, pathSetIdx:0, pathIndex:1,
            blobs, trail:[],
            eyeOpen:1, blinkTimer:p.random(60,200),
            speed:CELL*CREATURE_SPEED,
            squishX:1, squishY:1,
            blocked:false, blockedFrames:0,
            corridorX1:0, corridorY1:0, corridorX2:p.width, corridorY2:p.height,
            palette,
            finished:false, finishTimer:0,
            finishX:destPt.col*CELL+CELL/2+mz.offsetX,
            finishY:destPt.row*CELL+CELL/2,
            teleporting:false, teleportProgress:0, teleportFrom:null, teleportTo:null,
            postTeleportGrace: 0,  // frames of spike immunity after teleporting
            squeezeScale: 1.0,  // 1=normal, <1=narrow passage slowdown
            pathSwitchTimer: PATH_SWITCH_INTERVAL + p.floor(p.random(300)),
            gemsCollected: 0,
            deathCount: 0,
            deathFlash: 0,
            gemFlash:   0,
            killFlash:  0,
            mutateFlash: 0,
            mutateRegion: null,
            // Liquid drip params — random per-creature for organic variety
            dripAngles:  Array.from({length:5}, ()=>p.random(p.TWO_PI)),
            dripPhases:  Array.from({length:5}, ()=>p.random(p.TWO_PI)),
            dripSpeeds:  Array.from({length:5}, ()=>p.random(0.018,0.04)),
            noiseOffset: p.random(1000),
        };
    }

    // ============================================================
    //  CORRIDOR BOUNDS (per-maze)
    // ============================================================
    function getCorridorBounds(c) {
        let mz  = c.mz;
        let oy  = mz.offsetY||0;
        let col = p.constrain(p.floor((c.x-mz.offsetX)/CELL), 0, mz.cols-1);
        let row = p.constrain(p.floor((c.y-oy)/CELL), 0, mz.rows-1);
        let cell=mz.cells[row][col]; let mg=1;
        let x1=col*CELL+mg+mz.offsetX, y1=row*CELL+mg+oy;
        let x2=(col+1)*CELL-mg+mz.offsetX, y2=(row+1)*CELL-mg+oy;
        if (!cell.walls.E&&col+1<mz.cols) x2=(col+2)*CELL-mg+mz.offsetX;
        if (!cell.walls.W&&col-1>=0)       x1=(col-1)*CELL+mg+mz.offsetX;
        if (!cell.walls.S&&row+1<mz.rows) y2=(row+2)*CELL-mg+oy;
        if (!cell.walls.N&&row-1>=0)       y1=(row-1)*CELL+mg+oy;
        return {x1,y1,x2,y2};
    }

    // ============================================================
    //  DRAW LOOP
    // ============================================================
    p.draw = function() {
        try {
        p.background(6,6,12);

        for (let door of doors)
            if (door.open&&door.openAmt<1) door.openAmt=Math.min(1,door.openAmt+DOOR_ANIM_SPEED);
        shiftMazes();
        updateTeleporters();

        // Draw divider line
        p.stroke(30,80,50,60); p.strokeWeight(1);
        p.line(p.width/2, 0, p.width/2, p.height);

        drawMaze(mazeL);
        drawMaze(mazeR);
        updateGems();
        updateSpikes();
        drawTeleporters();
        drawDoors();
        drawSpikes();
        drawGems();

        for (let c of creatures) {
            moveCreature(c);
            recordTrail(c);
            updateCreature(c);
        }
        for (let c of creatures) drawTrail(c);
        for (let c of creatures) drawCreature(c);
        updateGhosts();
        drawGhosts();
        updateAllies();
        drawAllies();
        updateParticles();
        drawParticles();
        drawFinishOverlay();
        drawCelebration();
        drawHUD();
        drawStatsButton();
        drawPastRunsPopup();
        drawMapChangeWarning();
        tickReset();
        tickMapChange();
        tickCelebration();
        } catch(e) {
            p.background(0);
            p.fill(255,80,80); p.noStroke();
            p.textSize(14); p.textAlign(p.LEFT, p.TOP);
            p.text('ERROR: ' + e.message, 10, 10);
            p.text(e.stack ? e.stack.split('\n')[1] : '', 10, 30);
            console.error('DRAW ERROR:', e);
        }
    };

    // ============================================================
    //  MOVEMENT
    // ============================================================
    // Returns speed/size scale for the passage between path[idx-1] and path[idx]
    function getNarrowFactor(c, path, idx) {
        if (idx <= 0 || idx >= path.length) return 1;
        let a = path[idx-1], b = path[idx];
        let dc = b.col-a.col, dr = b.row-a.row;
        if (Math.abs(dc)+Math.abs(dr) !== 1) return 1;
        let dir = dc===1?'E':dc===-1?'W':dr===1?'S':'N';
        let cell = c.mz.cells[a.row] && c.mz.cells[a.row][a.col];
        if (!cell) return 1;
        return cell['narrow_'+dir] ? 0.45 : 1.0;  // narrow = 45% speed
    }

    function moveCreature(c) {
        if (c.finished) {
            c.finishTimer++;
            let bob=Math.sin(c.finishTimer*0.055)*BLOB_DIST*0.1;
            c.x+=(c.finishX-c.x)*0.06;
            c.y+=(c.finishY+bob-c.y)*0.06;
            c.vx=0; c.vy=0;
            let b=getCorridorBounds(c);
            c.corridorX1=b.x1;c.corridorY1=b.y1;c.corridorX2=b.x2;c.corridorY2=b.y2;
            return;
        }

        if (c.teleporting) {
            c.teleportProgress+=0.07;
            if (c.teleportProgress>=1) {
                c.x=c.teleportTo.x; c.y=c.teleportTo.y;
                for (let b of c.blobs){b.x=c.x;b.y=c.y;b.vx=0;b.vy=0;}
                c.teleporting=false; c.teleportProgress=0;
            } else {
                let t=c.teleportProgress;
                if (t<0.5){c.x+=(c.teleportFrom.x-c.x)*0.2;c.y+=(c.teleportFrom.y-c.y)*0.2;}
                else       {c.x+=(c.teleportTo.x  -c.x)*0.3;c.y+=(c.teleportTo.y  -c.y)*0.3;}
            }
            c.vx=0;c.vy=0;
            return;
        }

        // ── Timed repath every 30 seconds — recompute from current position ──
        c.pathSwitchTimer--;
        if (c.pathSwitchTimer <= 0) {
            let mz2    = c.mz;
            let curCol = p.constrain(p.floor((c.x - mz2.offsetX) / CELL), 0, mz2.cols-1);
            let curRow = p.constrain(p.floor((c.y - (mz2.offsetY||0)) / CELL), 0, mz2.rows-1);
            let oldGoal2 = c.paths[0][c.paths[0].length-1];
            let newPaths2 = findMultiplePaths(mz2, curCol, curRow, oldGoal2.col, oldGoal2.row, 8);
            if (newPaths2 && newPaths2.length > 0 && newPaths2[0].length > 1) {
                c.paths      = newPaths2;
                c.pathSetIdx = 0;
                c.pathIndex  = 1;
                c.trail      = [];
            } else {
                // Fallback: just cycle existing paths
                c.pathSetIdx = (c.pathSetIdx + 1) % c.paths.length;
                c.pathIndex  = closestPathStep(c.paths[c.pathSetIdx], c.x, c.y, c.mz.offsetX);
            }
            c.pathSwitchTimer = PATH_SWITCH_INTERVAL;
        }

        let path=c.paths[c.pathSetIdx];
        let idx=p.constrain(c.pathIndex,0,path.length-1);

        let blocker=doorBlocksStep(path,idx,c.id);
        if (blocker&&!blocker.open) {
            c.blocked=true; c.blockedFrames++;
            c.vx=0; c.vy=0;
            if (c.blockedFrames>=REROUTE_FRAMES) {
                let np=findUnblockedPath(c);
                if (np!==null&&np!==c.pathSetIdx){
                    c.pathSetIdx=np;
                    c.pathIndex=closestPathStep(c.paths[np],c.x,c.y,c.mz.offsetX);
                }
                c.blockedFrames=0;
            }
            return;
        }
        c.blocked=false; c.blockedFrames=0;

        checkTeleport(c);
        if (c.teleporting) return;

        let target=path[idx];
        let tx=target.col*CELL+CELL/2+c.mz.offsetX, ty=target.row*CELL+CELL/2+(c.mz.offsetY||0);
        let dx=tx-c.x, dy=ty-c.y;
        let dist=Math.sqrt(dx*dx+dy*dy);

        if (dist<c.speed+2) {
            c.pathIndex++;
            if (c.pathIndex>=path.length) {
                let end=path[path.length-1];
                c.finishX=end.col*CELL+CELL/2+c.mz.offsetX;
                c.finishY=end.row*CELL+CELL/2+(c.mz.offsetY||0);
                c.pathIndex=path.length-1;
                c.finished=true; c.finishTimer=0;
                c.vx=0; c.vy=0;
                let cIdx2 = creatures.indexOf(c);
                if (cIdx2 >= 0) { mazesWon[cIdx2]++; saveStats(); }
                checkAllFinished();
            }
        } else {
            let spd=p.min(c.speed+dist*0.04,CELL*0.24);
            c.vx=(dx/dist)*spd; c.vy=(dy/dist)*spd;
            c.x+=c.vx; c.y+=c.vy;
            let angle=Math.atan2(dy,dx);
            let stretch=p.map(dist,0,CELL,1,1.25,true);
            c.squishX=1+(stretch-1)*Math.abs(Math.cos(angle));
            c.squishY=1+(stretch-1)*Math.abs(Math.sin(angle));
        }

        let b=getCorridorBounds(c);
        c.corridorX1=b.x1;c.corridorY1=b.y1;c.corridorX2=b.x2;c.corridorY2=b.y2;
    }

    function findUnblockedPath(c) {
        for (let pi=0;pi<c.paths.length;pi++) {
            if (pi===c.pathSetIdx) continue;
            let path=c.paths[pi];
            let hasBlock=false;
            for (let i=1;i<path.length;i++) {
                if (doorBlocksStep(path,i,c.id)){hasBlock=true;break;}
            }
            if (!hasBlock) return pi;
        }
        return null;
    }

    function closestPathStep(path,x,y,offsetX) {
        let best=0, bestD=Infinity;
        for (let i=0;i<path.length;i++) {
            let pt=path[i];
            let d=(pt.col*CELL+CELL/2+offsetX-x)**2+(pt.row*CELL+CELL/2-y)**2;
            if (d<bestD){bestD=d;best=i;}
        }
        return best;
    }

    function checkAllFinished() {
        if (!creatures.every(c=>c.finished)) return;
        jointWins++;
        // Bonus gems
        for (let c of creatures) { c.gemsCollected += BONUS_GEMS; c.gemFlash = 40; }
        gemCounts[0] = creatures[0].gemsCollected;
        gemCounts[1] = creatures[1].gemsCollected;
        saveStats();
        if (jointWins >= WINS_FOR_CELEBRATION) {
            // Big celebration — don't auto-reset, show full-screen heart
            celebrating = true;
            celebrateT  = 0;
        } else {
            resetTimer = RESET_DELAY;
        }
    }
    function tickReset() {
        if (resetTimer<0) return;
        resetTimer--;
        if (resetTimer===0){resetTimer=-1;init();}
    }

    function tickCelebration() {
        if (!celebrating) return;
        celebrateT++;
    }

    function resetGame() {
        jointWins   = 0;
        celebrating = false;
        celebrateT  = 0;
        init();
    }

    // ============================================================
    //  TRAIL  (short, quick fade, clears on teleport)
    // ============================================================
    function recordTrail(c) {
        if (c.teleporting) return; // no trail while teleporting
        if (p.frameCount%2===0) {
            c.trail.push({x:c.x,y:c.y,age:0});
            if (c.trail.length>TRAIL_MAX) c.trail.shift();
        }
        for (let pt of c.trail) pt.age++;
    }

    function drawTrail(c) {
        let trail=c.trail; if (trail.length<2) return;
        let pal=c.palette;
        p.push(); p.noFill();
        for (let i=1;i<trail.length;i++) {
            let pt=trail[i],prev=trail[i-1];
            let progress=i/trail.length;
            let ageFade=1-p.constrain(pt.age/TRAIL_LIFE,0,1);
            let alpha=ageFade*progress*200; if (alpha<3) continue;
            let w=progress*ageFade*BLOB_DIST*0.9;
            p.stroke(pal.trail[0],pal.trail[1],pal.trail[2],alpha*0.9);
            p.strokeWeight(w);
            p.line(prev.x,prev.y,pt.x,pt.y);
            p.stroke(pal.trailGlow[0],pal.trailGlow[1],pal.trailGlow[2],alpha*0.4);
            p.strokeWeight(w*0.35);
            p.line(prev.x,prev.y,pt.x,pt.y);
        }
        p.pop();
    }

    // ============================================================
    //  UPDATE CREATURE PHYSICS  (blob ring only, no tentacles)
    // ============================================================
    function updateCreature(c) {
        let t=p.frameCount;
        let scaleFactor=1;
        if (c.teleporting) {
            let tp=c.teleportProgress;
            scaleFactor=tp<0.5?p.map(tp,0,0.5,1,0):p.map(tp,0.5,1,0,1);
            scaleFactor=p.max(scaleFactor,0.01);
        }
        let shakeAmt=c.blocked?CELL*0.14:0;
        let sx=c.blocked?(Math.random()-0.5)*shakeAmt*2:0;
        let sy=c.blocked?(Math.random()-0.5)*shakeAmt*2:0;

        for (let i=0;i<NUM_BLOBS;i++) {
            let b=c.blobs[i];
            let angle=(i/NUM_BLOBS)*p.TWO_PI;
            // Heavy noise deformation — very organic, mercury-like morphing
            // Two layers of noise at different scales and speeds for complex shapes
            let n1=p.noise(c.noiseOffset+Math.cos(angle)*1.2+t*0.004,
                           Math.sin(angle)*1.2+t*0.003);
            let n2=p.noise(c.noiseOffset*2.7+Math.cos(angle)*2.4+t*0.009,
                           Math.sin(angle)*2.4+t*0.008);
            // n1 gives big slow waves, n2 gives small fast ripples
            let noiseR = n1*0.7 + n2*0.3;
            let sqzScale = c.squeezeScale || 1;
            let r=BLOB_DIST*(0.55 + noiseR*1.0)*scaleFactor*sqzScale;  // squeeze in narrow passages
            let tx=c.x+sx+Math.cos(angle)*r*c.squishX;
            let ty=c.y+sy+Math.sin(angle)*r*c.squishY;
            b.vx+=(tx-b.x)*SPRING_K; b.vy+=(ty-b.y)*SPRING_K;
            b.vx*=DAMPING; b.vy*=DAMPING;
            b.x+=b.vx; b.y+=b.vy;
        }

        // Update drip phases
        for (let i=0;i<c.dripPhases.length;i++) c.dripPhases[i]+=c.dripSpeeds[i];

        c.blinkTimer--;
        if (c.blinkTimer<=0) {
            c.eyeOpen=0;
            if (c.blinkTimer<-8){c.eyeOpen=1;c.blinkTimer=p.random(80,300);}
        }
        c.squishX=p.lerp(c.squishX,1,0.09);
        c.squishY=p.lerp(c.squishY,1,0.09);
        if (c.deathFlash        > 0) c.deathFlash--;
        if (c.gemFlash          > 0) c.gemFlash--;
        if (c.killFlash         > 0) c.killFlash--;
        if (c.mutateFlash       > 0) c.mutateFlash--;
        if (c.postTeleportGrace > 0) c.postTeleportGrace--;
    }

    // ============================================================
    //  DRAW CREATURE  (liquid blob — no tentacles)
    // ============================================================
    function drawCreature(c) {
        let pal=c.palette;
        p.push();

        let gr=c.blocked?200:pal.glow[0];
        let gg=c.blocked?60:pal.glow[1];
        let gb=c.blocked?10:pal.glow[2];

        // ── Outer ambient glow ──
        for (let g=5;g>=1;g--) {
            p.noStroke();
            p.fill(gr,gg,gb, p.map(g,1,5,40,4));
            drawBlobShape(c, g*BLOB_DIST*0.16);
        }

        // ── Liquid drips / protrusions ──
        // These are small teardrop shapes that pulse out from the surface
        drawDrips(c, pal);

        // ── Drop shadow ──
        p.noStroke(); p.fill(0,0,0,55);
        p.push(); p.translate(BLOB_DIST*0.15,BLOB_DIST*0.2);
        drawBlobShape(c,0); p.pop();

        // ── Main body ──
        p.fill(pal.body[0],pal.body[1],pal.body[2]);
        drawBlobShape(c,0);

        // ── Subsurface scatter / depth ──
        p.fill(gr,gg,gb,18);
        drawBlobShape(c,-BLOB_DIST*0.15);

        // ── Specular highlight — top-left bright spot ──
        let hx=c.x-BLOB_DIST*0.28, hy=c.y-BLOB_DIST*0.3;
        p.noStroke();
        p.fill(255,255,255,50);
        p.ellipse(hx, hy, BLOB_DIST*0.55, BLOB_DIST*0.38);
        p.fill(255,255,255,28);
        p.ellipse(hx+BLOB_DIST*0.08, hy+BLOB_DIST*0.06, BLOB_DIST*0.22, BLOB_DIST*0.15);

        // ── Finished sparkle halo ──
        if (c.finished) {
            let pulse=0.5+0.5*Math.sin(c.finishTimer*0.08);
            p.noFill();
            for (let ring=3;ring>=1;ring--) {
                p.stroke(pal.glow[0],pal.glow[1],pal.glow[2],50*pulse/ring);
                p.strokeWeight(ring*1.6);
                p.ellipse(c.x,c.y,CELL*(0.9+ring*0.28+pulse*0.14));
            }
        }

        drawEyes(c);
        p.pop();
    }

    // Liquid drip protrusions — slow mercury surface-tension blobs
    function drawDrips(c, pal) {
        for (let i=0;i<c.dripAngles.length;i++) {
            let baseAngle = c.dripAngles[i];
            let phase     = c.dripPhases[i];
            let ext       = 0.5+0.5*Math.sin(phase); // 0..1

            // Drip extends well past the body — mercury drop stretching
            let dripR = BLOB_DIST*(1.0 + ext*0.9);
            let tipX  = c.x+Math.cos(baseAngle)*dripR;
            let tipY  = c.y+Math.sin(baseAngle)*dripR;

            // Root sits on body surface
            let rootX = c.x+Math.cos(baseAngle)*BLOB_DIST*0.6;
            let rootY = c.y+Math.sin(baseAngle)*BLOB_DIST*0.6;

            // Width tapers: fat at root, narrow at tip — teardrop
            let wRoot = BLOB_DIST*(0.35+ext*0.18);
            let wTip  = BLOB_DIST*(0.08+ext*0.06);
            let len   = Math.sqrt((tipX-rootX)**2+(tipY-rootY)**2);
            let mid   = 0.35; // bias the fattest point toward root

            p.noStroke();
            // Draw 8 cross-sections to approximate a tapered teardrop
            let steps = 8;
            for (let s=0;s<steps;s++) {
                let f    = s/(steps-1);
                let cx   = rootX+(tipX-rootX)*f;
                let cy   = rootY+(tipY-rootY)*f;
                // Width profile: wide near root, pinches to tip
                let wf   = f<mid ? p.lerp(wRoot,wRoot*1.1,f/mid)
                                 : p.lerp(wRoot*1.1,wTip,(f-mid)/(1-mid));
                let alpha= p.lerp(220, 0, f*f);
                p.fill(pal.body[0],pal.body[1],pal.body[2],alpha);
                p.ellipse(cx, cy, wf, wf);
            }

            // Pendant drop at tip — spherical blob that pinches off
            if (ext > 0.3) {
                let dropR=BLOB_DIST*(0.12+ext*0.14);
                // Slight droop from gravity
                let dropX=tipX + Math.cos(baseAngle)*dropR*0.3;
                let dropY=tipY + Math.sin(baseAngle)*dropR*0.3 + ext*BLOB_DIST*0.08;
                p.fill(pal.body[0],pal.body[1],pal.body[2],180*ext);
                p.ellipse(dropX, dropY, dropR*2, dropR*2.2);
                // Tiny specular on pendant
                p.fill(255,255,255, 60*ext);
                p.ellipse(dropX-dropR*0.3, dropY-dropR*0.3, dropR*0.5, dropR*0.4);
            }
        }
    }

    function drawBlobShape(c, ro) {
        let pts=c.blobs;
        p.beginShape();
        for (let i=0;i<pts.length;i++) {
            let curr=pts[i], angle=(i/pts.length)*p.TWO_PI;
            p.curveVertex(curr.x+Math.cos(angle)*ro, curr.y+Math.sin(angle)*ro);
        }
        for (let i=0;i<3;i++) {
            let curr=pts[i], angle=(i/pts.length)*p.TWO_PI;
            p.curveVertex(curr.x+Math.cos(angle)*ro, curr.y+Math.sin(angle)*ro);
        }
        p.endShape(p.CLOSE);
    }

    function drawEyes(c) {
        let r = BLOB_DIST * EYE_RADIUS;
        let lookX, lookY;

        // When finished, eyes look toward the OTHER creature
        if (c.finished) {
            let other = creatures.find(o => o !== c);
            if (other) {
                let ang = Math.atan2(other.y - c.y, other.x - c.x);
                lookX = Math.cos(ang) * 2.2;
                lookY = Math.sin(ang) * 2.2;
            } else {
                lookX = 0; lookY = 0;
            }
        } else if (c.blocked) {
            // Panicked single eye — no look offset
            lookX = 0; lookY = 0;
        } else {
            let tAngle = Math.atan2(c.vy, c.vx + 0.001);
            lookX = Math.cos(tAngle) * 1.8;
            lookY = Math.sin(tAngle) * 1.8;
        }

        if (c.blocked && !c.finished) {
            // One wide panicked eye
            p.noStroke(); p.fill(255, 80, 80);
            p.ellipse(c.x + lookX, c.y + lookY, r*2.2, r*1.4*c.eyeOpen);
            if (c.eyeOpen > 0.2) {
                p.fill(5, 5, 10);
                p.ellipse(c.x + lookX, c.y + lookY, r*1.1, r*1.1*c.eyeOpen);
            }
        } else {
            // Two normal eyes — heart-shaped pupils when finished
            let offsets = [{x:-BLOB_DIST*0.28, y:-BLOB_DIST*0.18}, {x:BLOB_DIST*0.28, y:-BLOB_DIST*0.22}];
            for (let eo of offsets) {
                let ex = c.x + eo.x + lookX;
                let ey = c.y + eo.y + lookY;
                p.noStroke();
                // White of eye — slightly warm pink when finished
                if (c.finished) p.fill(255, 220, 220); else p.fill(230, 245, 230);
                p.ellipse(ex, ey, r*2, r*2*c.eyeOpen);
                if (c.eyeOpen > 0.2) {
                    p.fill(5, 5, 10);
                    p.ellipse(ex + lookX*0.4, ey + lookY*0.4, r*1.05, r*1.05*c.eyeOpen);
                    p.fill(255, 255, 255, 220);
                    p.ellipse(ex - r*0.28, ey - r*0.28, r*0.38, r*0.38);
                }
            }
        }
    }

    // ============================================================
    //  MAZE DRAWING
    // ============================================================
    function drawMaze(mz) {
        if (!mz) return;
        p.push();
        let ox=mz.offsetX;
        let mazeOY=mz.offsetY||0;  // declared first — used throughout

        // Faint path highlights
        for (let c of creatures) {
            if (c.mz!==mz) continue;
            for (let pi=0;pi<c.paths.length;pi++) {
                let path=c.paths[pi], isCurrent=(pi===c.pathSetIdx);
                p.noFill();
                p.strokeWeight(isCurrent?CELL*0.48:CELL*0.18);
                p.stroke(c.palette.glow[0],c.palette.glow[1],c.palette.glow[2],isCurrent?28:8);
                p.beginShape();
                for (let pt of path) p.vertex(pt.col*CELL+CELL/2+ox, pt.row*CELL+CELL/2+mazeOY);
                p.endShape();
            }
        }

        // Walls
        p.stroke(30,180,80,90); p.strokeWeight(1.5);
        for (let r=0;r<mz.rows;r++) {
            for (let c=0;c<mz.cols;c++) {
                let cell=mz.cells[r][c], x=c*CELL+ox, y=r*CELL+mazeOY;
                if (cell.walls.N) p.line(x,y,x+CELL,y);
                if (cell.walls.S) p.line(x,y+CELL,x+CELL,y+CELL);
                if (cell.walls.W) p.line(x,y,x,y+CELL);
                if (cell.walls.E) p.line(x+CELL,y,x+CELL,y+CELL);
                // ── Narrow passages — prominent squeeze gates ──
                let gap = CELL * 0.32;
                let off = (CELL - gap) / 2;
                let pulse = 0.55 + 0.45 * Math.sin(p.frameCount * 0.05 + c * 0.7 + r * 1.1);

                if (!cell.walls.E && cell['narrow_E']) {
                    // Thick wall stubs — same colour as walls but heavier
                    p.stroke(30, 200, 100, 180); p.strokeWeight(4);
                    p.line(x+CELL, y,        x+CELL, y+off);        // top stub
                    p.line(x+CELL, y+off+gap, x+CELL, y+CELL);     // bottom stub

                    // Filled squeeze gate rectangle — bright teal block
                    p.noStroke();
                    p.fill(0, 220, 180, 55 + 35*pulse);
                    p.rect(x+CELL-3, y+off, 6, gap);

                    // Centre line highlight
                    p.stroke(80, 255, 220, 180 + 60*pulse); p.strokeWeight(2);
                    p.line(x+CELL, y+off, x+CELL, y+off+gap);

                    // Small arrow chevron pointing right
                    p.stroke(100, 255, 200, 160 + 80*pulse); p.strokeWeight(1.5);
                    let mx2 = x+CELL, my2 = y+CELL/2, as2 = gap*0.22;
                    p.line(mx2-as2, my2-as2, mx2, my2);
                    p.line(mx2, my2, mx2-as2, my2+as2);

                    p.stroke(30,180,80,90); p.strokeWeight(1.5); // restore
                }

                if (!cell.walls.S && cell['narrow_S']) {
                    // Thick wall stubs
                    p.stroke(30, 200, 100, 180); p.strokeWeight(4);
                    p.line(x,        y+CELL, x+off,      y+CELL);  // left stub
                    p.line(x+off+gap, y+CELL, x+CELL,    y+CELL);  // right stub

                    // Filled squeeze gate
                    p.noStroke();
                    p.fill(0, 220, 180, 55 + 35*pulse);
                    p.rect(x+off, y+CELL-3, gap, 6);

                    // Centre line highlight
                    p.stroke(80, 255, 220, 180 + 60*pulse); p.strokeWeight(2);
                    p.line(x+off, y+CELL, x+off+gap, y+CELL);

                    // Small arrow chevron pointing down
                    p.stroke(100, 255, 200, 160 + 80*pulse); p.strokeWeight(1.5);
                    let mx3 = x+CELL/2, my3 = y+CELL, as3 = gap*0.22;
                    p.line(mx3-as3, my3-as3, mx3, my3);
                    p.line(mx3, my3, mx3+as3, my3-as3);

                    p.stroke(30,180,80,90); p.strokeWeight(1.5); // restore
                }
            }
        }

        // Corner dots
        p.fill(30,180,80,45); p.noStroke();
        for (let r=0;r<=mz.rows;r++) for (let c=0;c<=mz.cols;c++) p.ellipse(c*CELL+ox,r*CELL+mazeOY,2.5);

        // Shift flash
        drawShiftFlash(mz);

        // Goal markers
        for (let c of creatures) {
            if (c.mz!==mz) continue;
            let path=c.paths[c.pathSetIdx];
            let goal=path[path.length-1]; if (!goal) continue;
            let gx=goal.col*CELL+CELL/2+ox, gy=goal.row*CELL+CELL/2+mazeOY;
            let pulse=0.5+0.5*p.sin(p.frameCount*0.05);
            p.noFill();
            p.stroke(c.palette.glow[0],c.palette.glow[1],c.palette.glow[2],180*pulse);
            p.strokeWeight(2.5); p.ellipse(gx,gy,CELL*0.7+pulse*8);
            p.fill(c.palette.glow[0],c.palette.glow[1],c.palette.glow[2],60*pulse);
            p.noStroke(); p.ellipse(gx,gy,CELL*0.35);
        }
        p.pop();
    }

    // ============================================================
    //  DOOR DRAWING
    // ============================================================
    function drawDoors() {
        for (let door of doors) {
            let mp=doorMidpoint(door);
            let horiz=(door.dir==='E'||door.dir==='W');
            let t=door.openAmt;
            p.push(); p.translate(mp.x,mp.y);
            if (!door.open) {
                let halo=0.5+0.5*Math.sin(p.frameCount*0.06);
                p.noStroke(); p.fill(255,200,0,22*halo);
                p.ellipse(0,0,CELL*1.15,CELL*1.15);
            }
            p.rotate(horiz?0:p.HALF_PI);
            p.rotate(t*p.HALF_PI);
            let dw=CELL*0.07,dh=CELL*0.9;
            p.noStroke();
            p.fill(255,200,0,p.lerp(235,45,t)); p.rect(-dw/2,-dh/2,dw,dh,3);
            p.fill(255,240,80,p.lerp(190,18,t)); p.rect(-dw/2,-dh/2,dw*0.28,dh,3);
            if (t<0.5){p.fill(255,150,0);p.ellipse(dw*0.7,0,dw*1.2);}
            p.pop();
            if (!door.open) {
                let hint=0.5+0.5*Math.sin(p.frameCount*0.09);
                p.push(); p.textAlign(p.CENTER,p.CENTER); p.textSize(CELL*0.19);
                p.noStroke(); p.fill(255,220,0,140*hint);
                p.text('click',mp.x,mp.y-CELL*0.65); p.pop();
            }
        }
    }

    // ============================================================
    //  TELEPORTER DRAWING  — Hub + rotating exits
    // ============================================================
    function drawTeleporters() {
        for (let hub of teleporters) {
            let ox  = hub.mz.offsetX;
            let hx  = hub.entry.col*CELL+CELL/2+ox;
            let hy  = hub.entry.row*CELL+CELL/2+(hub.mz.offsetY||0);
            let timeFrac = 1 - hub.timer / TP_EXIT_CYCLE;  // 0→1 countdown to next rotation

            // Draw entry hub — always active/bright
            drawHubPortal(hx, hy, hub, true);

            // Draw each exit
            for (let ei = 0; ei < hub.exits.length; ei++) {
                let exit    = hub.exits[ei];
                let ex      = exit.col*CELL+CELL/2+ox;
                let ey      = exit.row*CELL+CELL/2;
                let isHot   = (ei === hub.activeExitIdx);

                // Dashed link from hub to active exit
                if (isHot) {
                    p.push();
                    p.stroke(180,100,255, 20+12*Math.sin(hub.phase));
                    p.strokeWeight(1);
                    p.drawingContext.setLineDash([4,8]);
                    p.line(hx, hy, ex, ey);
                    p.drawingContext.setLineDash([]);
                    p.pop();
                }

                drawExitPortal(ex, ey, hub, ei, isHot, timeFrac);
            }
        }
    }

    // Hub entry — large bright spinning portal, always open
    function drawHubPortal(x, y, hub, isEntry) {
        p.push(); p.translate(x, y);
        let pulse  = 0.5+0.5*Math.sin(hub.phase);
        let radius = CELL*0.38 + pulse*CELL*0.07;
        p.noFill();
        for (let ring=4;ring>=1;ring--) {
            p.stroke(160, 60+ring*15, 255, 35*pulse/ring);
            p.strokeWeight(ring*2.0);
            p.ellipse(0,0,radius*2+ring*5);
        }
        for (let i=0;i<8;i++) {
            let angle=hub.phase*1.3+(i/8)*p.TWO_PI;
            p.stroke(200,100,255,100*pulse); p.strokeWeight(1.5);
            p.line(Math.cos(angle)*radius*0.25,Math.sin(angle)*radius*0.25,
                   Math.cos(angle)*radius*0.9, Math.sin(angle)*radius*0.9);
        }
        p.noStroke();
        p.fill(100,20,180, 80+40*pulse); p.ellipse(0,0,radius);
        p.fill(220,160,255,60+40*pulse); p.ellipse(0,0,radius*0.45);
        p.fill(220,190,255,180);
        p.textAlign(p.CENTER,p.CENTER); p.textSize(CELL*0.15); p.noStroke();
        p.text('IN',0,0);
        p.pop();
    }

    // Exit portals — hot exit glows, others are dim with rotation arc
    function drawExitPortal(x, y, hub, exitIdx, isHot, timeFrac) {
        p.push(); p.translate(x, y);
        let radius = CELL*0.30;

        if (isHot) {
            let pulse = 0.5+0.5*Math.sin(-hub.phase);
            // Bright hot exit — green tint to distinguish from entry
            p.noFill();
            for (let ring=3;ring>=1;ring--) {
                p.stroke(80, 200+ring*10, 180, 30*pulse/ring);
                p.strokeWeight(ring*2.0);
                p.ellipse(0,0,radius*2+ring*4);
            }
            for (let i=0;i<6;i++) {
                let angle=-hub.phase*1.4+(i/6)*p.TWO_PI;
                p.stroke(100,220,200,90*pulse); p.strokeWeight(1.3);
                p.line(Math.cos(angle)*radius*0.28,Math.sin(angle)*radius*0.28,
                       Math.cos(angle)*radius*0.88,Math.sin(angle)*radius*0.88);
            }
            p.noStroke();
            p.fill(20,140,120, 70+35*pulse); p.ellipse(0,0,radius*1.0);
            p.fill(150,255,230, 50+35*pulse); p.ellipse(0,0,radius*0.42);
            p.fill(180,255,240,180);
            p.textAlign(p.CENTER,p.CENTER); p.textSize(CELL*0.14); p.noStroke();
            p.text('OUT',0,0);
            // Rotation countdown arc — shows when this exit deactivates
            p.noFill(); p.stroke(100,255,200,80);
            p.strokeWeight(2.5);
            p.arc(0,0,radius*2.4,radius*2.4,-p.HALF_PI,-p.HALF_PI+(1-timeFrac)*p.TWO_PI);
        } else {
            // Dim inactive exit — shows which path it leads to
            let pathNum = hub.exits[exitIdx].pathIdx;
            // Slightly different grey tones per path
            let brightness = 60 + pathNum*15;
            p.noFill();
            p.stroke(brightness,brightness,brightness+30,50);
            p.strokeWeight(1.5);
            p.ellipse(0,0,radius*2);
            p.noStroke(); p.fill(brightness,brightness,brightness+40,60);
            p.ellipse(0,0,radius*0.7);
            // Show which path number this exit leads to
            p.fill(160,160,200,100);
            p.textAlign(p.CENTER,p.CENTER); p.textSize(CELL*0.14); p.noStroke();
            p.text('P'+(pathNum+1),0,0);
            // Click hint
            let hint=0.3+0.3*Math.sin(p.frameCount*0.06+exitIdx);
            p.fill(140,200,140,90*hint);
            p.textSize(CELL*0.12);
            p.text('click',0,radius+CELL*0.2);
        }
        p.pop();
    }

    // ============================================================
    //  CELEBRATION — full-screen heart after WINS_FOR_CELEBRATION joint wins
    // ============================================================
    function drawCelebration() {
        if (!celebrating) return;
        let ctx = p.drawingContext;
        let t   = celebrateT;

        // Phase 1 (0-60): dark overlay fades in
        // Phase 2 (60-180): heart expands from centre outward
        // Phase 3 (180+): full screen, show play-again button

        // Dark overlay
        let overlayAlpha = p.constrain(p.map(t, 0, 60, 0, 230), 0, 230);
        p.noStroke(); p.fill(4, 4, 10, overlayAlpha);
        p.rect(0, 0, p.width, p.height);

        // Expanding heart — grows from tiny to covering the screen
        let heartPhase = p.constrain(t - 40, 0, 999);
        // Use easeOutExpo for dramatic expansion
        let eased = heartPhase < 140
            ? 1 - Math.pow(2, -10 * heartPhase / 140)
            : 1;
        let maxSz  = p.width * 0.72;
        let sz     = maxSz * eased;
        let pulse  = t > 180 ? 0.5 + 0.5 * Math.sin(t * 0.07) : 0;
        sz        += pulse * CELL * 1.2;

        let hcx = p.width / 2;
        let hcy = p.height / 2 - CELL * 0.5;

        if (sz > 4) {
            ctx.save();
            // Full heart (both halves) — blend both creature colours
            let pal0 = creatures[0] ? creatures[0].palette : PALETTES[0];
            let pal1 = creatures[1] ? creatures[1].palette : PALETTES[1];

            // Draw right half (creature 1 colour)
            drawRightHalfHeart(ctx, hcx, hcy, sz);
            let gr1 = ctx.createRadialGradient(hcx+sz*0.25, hcy-sz*0.2, 0, hcx, hcy, sz*1.1);
            gr1.addColorStop(0, `rgba(${pal1.glow[0]},${pal1.glow[1]},${pal1.glow[2]},0.95)`);
            gr1.addColorStop(1, `rgba(${pal1.glow[0]*0.3|0},${pal1.glow[1]*0.3|0},${pal1.glow[2]*0.3|0},0.6)`);
            ctx.fillStyle = gr1; ctx.fill();

            // Draw left half (creature 0 colour)
            drawLeftHalfHeart(ctx, hcx, hcy, sz);
            let gr0 = ctx.createRadialGradient(hcx-sz*0.25, hcy-sz*0.2, 0, hcx, hcy, sz*1.1);
            gr0.addColorStop(0, `rgba(${pal0.glow[0]},${pal0.glow[1]},${pal0.glow[2]},0.95)`);
            gr0.addColorStop(1, `rgba(${pal0.glow[0]*0.3|0},${pal0.glow[1]*0.3|0},${pal0.glow[2]*0.3|0},0.6)`);
            ctx.fillStyle = gr0; ctx.fill();

            // Specular sheen
            drawLeftHalfHeart(ctx, hcx - sz*0.1, hcy - sz*0.12, sz*0.45);
            ctx.fillStyle = `rgba(255,255,255,${0.15 + 0.1*pulse})`;
            ctx.fill();
            drawRightHalfHeart(ctx, hcx + sz*0.1, hcy - sz*0.12, sz*0.45);
            ctx.fill();
            ctx.restore();
        }

        // Particle burst — ongoing sparkles
        if (t > 60 && t % 3 < 2) {
            let angle = p.random(p.TWO_PI);
            let dist  = p.random(sz * 0.3, sz * 0.8);
            let pal   = p.random() > 0.5
                ? (creatures[0]||{palette:PALETTES[0]}).palette
                : (creatures[1]||{palette:PALETTES[1]}).palette;
            spawnPop(
                hcx + Math.cos(angle)*dist,
                hcy + Math.sin(angle)*dist*0.8,
                pal.glow[0], pal.glow[1], pal.glow[2], 3
            );
        }

        // Text + play-again button (after heart fills screen)
        if (t > 160) {
            let textFade = p.constrain(p.map(t, 160, 220, 0, 1), 0, 1);

            // "YOU DID IT" title
            p.push();
            p.noStroke();
            p.textAlign(p.CENTER, p.CENTER);
            p.textFont('monospace');
            p.textSize(CELL * 1.1);
            p.fill(255, 255, 255, 220 * textFade);
            p.text('YOU DID IT', hcx, hcy - CELL * 1.2);

            p.textSize(CELL * 0.38);
            p.fill(220, 220, 255, 180 * textFade);
            p.text(jointWins + ' mazes cleared together!', hcx, hcy - CELL * 0.3);

            // Stats summary
            let gems0 = creatures[0] ? creatures[0].gemsCollected : gemCounts[0];
            let gems1 = creatures[1] ? creatures[1].gemsCollected : gemCounts[1];
            p.textSize(CELL * 0.28);
            p.fill(180, 240, 255, 160 * textFade);
            p.text('◆ ' + gems0 + '  wins:' + mazesWon[0], hcx - CELL*3.5, hcy + CELL * 0.6);
            p.fill(255, 180, 255, 160 * textFade);
            p.text('◆ ' + gems1 + '  wins:' + mazesWon[1], hcx + CELL*1.5, hcy + CELL * 0.6);
            p.pop();

            // Play-again button
            let bw = 200, bh = 50;
            let bx = hcx - bw/2, by = hcy + CELL * 1.5;
            celebrateBtn = {x:bx, y:by, w:bw, h:bh};
            let hover = p.mouseX>bx&&p.mouseX<bx+bw&&p.mouseY>by&&p.mouseY<by+bh;
            let btnAlpha = textFade * (hover ? 1 : 0.85);

            p.push();
            p.noStroke();
            p.fill(255, 255, 255, 40 * btnAlpha);
            p.rect(bx, by, bw, bh, 10);
            p.noFill();
            p.stroke(255, 255, 255, 180 * btnAlpha);
            p.strokeWeight(hover ? 2.5 : 1.5);
            p.rect(bx, by, bw, bh, 10);
            p.noStroke();
            p.fill(255, 255, 255, 230 * btnAlpha);
            p.textAlign(p.CENTER, p.CENTER);
            p.textFont('monospace');
            p.textSize(CELL * 0.48);
            p.text('▶  PLAY AGAIN', hcx, by + bh/2);
            p.pop();
        } else {
            celebrateBtn = null;
        }
    }

    // ============================================================
    //  HUD  — separate panels per side, full stats, big buttons
    // ============================================================
    function drawHUD() {
        p.push();
        p.textFont('monospace');

        let hw = p.floor(p.width / 2);

        for (let i = 0; i < creatures.length; i++) {
            let c      = creatures[i];
            let pal    = c.palette;
            let isLeft = (i === 0);
            let halfX  = isLeft ? 0 : hw;

            // ── Full-screen flash effects (drawn under HUD) ──
            if (c.deathFlash > 0) {
                p.noStroke();
                p.fill(200, 30, 30, p.map(c.deathFlash, 0, 20, 0, 90));
                p.rect(halfX, 0, hw, p.height);
            }
            if (c.gemFlash > 0) {
                p.noStroke();
                p.fill(80, 220, 255, p.map(c.gemFlash, 0, 15, 0, 45));
                p.rect(halfX, 0, hw, p.height);
            }
            if (c.killFlash > 0) {
                p.noStroke();
                p.fill(255, 200, 0, p.map(c.killFlash, 0, 30, 0, 60));
                p.rect(halfX, 0, hw, p.height);
            }
            if (c.mutateFlash > 0 && c.mutateRegion) {
                let mr = c.mutateRegion;
                let a  = p.map(c.mutateFlash, 0, 30, 0, 140);
                p.noStroke(); p.fill(100, 200, 255, a * 0.3);
                p.rect(mr.x, mr.y, mr.w, mr.h);
                p.noFill(); p.stroke(100, 200, 255, a);
                p.strokeWeight(2); p.rect(mr.x, mr.y, mr.w, mr.h);
            }

            // ── Panel layout ──
            let panelX = halfX + 8;
            let panelY = 8;
            let panelW = hw - 16;
            let panelH = HUD_H - 16;  // always fits inside the reserved HUD band

            // Panel background — solid dark with colour border
            p.noStroke();
            p.fill(8, 10, 18, 220);
            p.rect(panelX, panelY, panelW, panelH, 6);
            // Coloured top border
            p.fill(pal.glow[0], pal.glow[1], pal.glow[2], 160);
            p.rect(panelX, panelY, panelW, 3, 6, 6, 0, 0);
            // Coloured left strip
            p.rect(panelX, panelY, 4, panelH, 6, 0, 0, 6);

            // ── Stats column (left side of panel) ──
            let sx = panelX + 12;
            p.textSize(12); p.textAlign(p.LEFT, p.TOP);

            // Gems
            p.fill(80, 220, 255, 255);
            p.text('◆ GEMS: ' + c.gemsCollected, sx, panelY + 10);

            // Current maze deaths vs limit
            let deathColor = c.deathCount >= DEATH_LIMIT - 1 ? [255,80,80] : [220,130,130];
            p.fill(deathColor[0], deathColor[1], deathColor[2], 240);
            p.text('💀 MAZE: ' + c.deathCount + '/' + DEATH_LIMIT, sx, panelY + 27);

            // Total deaths (lifetime)
            p.fill(160, 100, 100, 200);
            p.textSize(10);
            p.text('total deaths: ' + totalDeaths[i], sx, panelY + 43);

            // Mazes won / lost
            p.fill(80, 200, 120, 200);
            p.text('won: ' + mazesWon[i] + '   lost: ' + mazesLost[i], sx, panelY + 57);

            // Death pip indicators
            p.noStroke();
            for (let d = 0; d < DEATH_LIMIT; d++) {
                if (d < c.deathCount) p.fill(220, 60, 60, 240);
                else p.fill(40, 40, 60, 180);
                p.ellipse(sx + d * 14, panelY + 73, 10, 10);
            }

            // ── 3 buttons side-by-side, top-right of panel ──
            // Each button is (panelW/3 - gap) wide, 38px tall, fits in HUD_H
            let bGap  = 4;
            let bW    = Math.floor((panelW - 150 - bGap*2) / 3);
            let panelH2 = HUD_H - 16;
            let bH    = panelH2 - 16;  // buttons fill most of the panel height
            let bY    = panelY + 8;
            let b1X   = panelX + panelW - (bW*3 + bGap*2) - 8;
            let b2X   = b1X + bW + bGap;
            let b3X   = b2X + bW + bGap;

            // Helper to draw one compact button
            function drawBtn(bx, by, bw, bh, icon, label, cost, active, r, g, b_) {
                p.noStroke();
                if (active) p.fill(r, g, b_, 230); else p.fill(r*0.18, g*0.18, b_*0.18, 160);
                p.rect(bx, by, bw, bh, 4);
                if (active) {
                    p.noFill(); p.stroke(r, g, b_, 200); p.strokeWeight(1.5);
                    p.rect(bx, by, bw, bh, 4);
                }
                p.noStroke();
                if (active) p.fill(255, 255, 255, 240); else p.fill(120, 120, 120, 150);
                p.textSize(13); p.textAlign(p.CENTER, p.CENTER);
                p.text(icon, bx + bw*0.5, by + bh*0.33);
                p.textSize(8);
                p.text(label, bx + bw*0.5, by + bh*0.67);
                p.textSize(7);
                if (active) p.fill(255, 230, 100, 200); else p.fill(100, 100, 80, 130);
                p.text('(' + cost + '◆)', bx + bw*0.5, by + bh*0.88);
            }

            let canKill  = c.gemsCollected >= KILL_GHOST_COST && ghosts.some(g=>g.mz===c.mz);
            let canAlly  = c.gemsCollected >= ALLY_COST;
            let canMutate= c.gemsCollected >= MUTATE_MAZE_COST;

            drawBtn(b1X, bY, bW, bH, '☠', 'Kill Ghost',   KILL_GHOST_COST,  canKill,   220, 50,  50);
            drawBtn(b2X, bY, bW, bH, '👻','Ally',          ALLY_COST,         canAlly,   200, 170, 0);
            drawBtn(b3X, bY, bW, bH, '⚡', 'Mutate',       MUTATE_MAZE_COST,  canMutate, 40,  140, 220);

            c._btn1 = {x:b1X, y:bY, w:bW, h:bH};
            c._btn2 = {x:b3X, y:bY, w:bW, h:bH};   // mutate
            c._btn3 = {x:b2X, y:bY, w:bW, h:bH};   // ally
        }

        p.pop();
    }

    // ============================================================
    //  MAP CHANGE WARNING
    // ============================================================
    function drawMapChangeWarning() {
        if (mapChangeTimer < 0) return;
        let frac   = mapChangeTimer / 90;
        let flash  = Math.sin(p.frameCount * 0.4) > 0;
        let isLeft = (mapChangeSide === 0);
        let hx     = isLeft ? 0 : p.floor(p.width/2);
        let hw     = p.floor(p.width/2);

        p.push();
        // Pulsing red border
        if (flash) {
            p.noFill();
            p.stroke(255, 60, 60, 180 * frac);
            p.strokeWeight(4);
            p.rect(hx + 2, 2, hw - 4, p.height - 4, 4);
        }
        // Warning text
        p.noStroke();
        p.fill(255, 80, 80, 200 * frac * (flash ? 1 : 0.5));
        p.textAlign(p.CENTER, p.CENTER);
        p.textSize(CELL * 0.7);
        p.text('NEW MAZE', hx + hw/2, p.height/2 - CELL);
        p.textSize(CELL * 0.28);
        p.fill(255, 140, 140, 180 * frac * (flash ? 1 : 0.5));
        p.text('too many deaths!', hx + hw/2, p.height/2 + CELL * 0.2);
        p.pop();
    }

    // ============================================================
    //  FINISH OVERLAY — each creature slides its own half-heart
    //  in from its side toward the centre divider
    // ============================================================

    // Draw just the LEFT half of a heart (left lobe + bottom-left)
    // Heart centred at (cx, cy), half-width sz
    function drawLeftHalfHeart(ctx, cx, cy, sz) {
        let w = sz, h = sz * 1.1;
        ctx.beginPath();
        ctx.moveTo(cx, cy + h * 0.48);           // tip (centre bottom)
        ctx.bezierCurveTo(
            cx - w * 0.08, cy + h * 0.12,
            cx - w * 0.95, cy - h * 0.08,
            cx - w * 0.48, cy - h * 0.48
        );
        ctx.bezierCurveTo(
            cx - w * 0.02, cy - h * 0.88,
            cx,            cy - h * 0.44,
            cx,            cy - h * 0.22
        );
        ctx.lineTo(cx, cy + h * 0.48);           // back down to tip
        ctx.closePath();
    }

    // Draw just the RIGHT half of a heart
    function drawRightHalfHeart(ctx, cx, cy, sz) {
        let w = sz, h = sz * 1.1;
        ctx.beginPath();
        ctx.moveTo(cx, cy + h * 0.48);           // tip (centre bottom)
        ctx.lineTo(cx, cy - h * 0.22);           // up to centre join
        ctx.bezierCurveTo(
            cx,            cy - h * 0.44,
            cx + w * 0.02, cy - h * 0.88,
            cx + w * 0.48, cy - h * 0.48
        );
        ctx.bezierCurveTo(
            cx + w * 0.95, cy - h * 0.08,
            cx + w * 0.08, cy + h * 0.12,
            cx,            cy + h * 0.48
        );
        ctx.closePath();
    }

    function drawFinishOverlay() {
        let ctx = p.drawingContext;
        // Heart target: vertically centred, horizontally at the divider
        let hcx = p.width / 2;
        let hcy = HUD_H + (p.height - HUD_H) / 2;  // true centre of maze area
        let bothDone = creatures.every(c => c.finished);

        for (let i = 0; i < creatures.length; i++) {
            let c = creatures[i];
            if (!c.finished) continue;
            let isLeft = (i === 0);
            let pal    = c.palette;
            let pulse  = 0.5 + 0.5 * Math.sin(c.finishTimer * 0.06);
            let sz     = CELL * (1.4 + pulse * 0.2);

            // Slide in from the edge toward centre over ~60 frames
            let slideT  = Math.min(c.finishTimer / 60, 1);
            // easeOutBack for a satisfying snap
            let ease    = 1 + 2.7 * Math.pow(slideT - 1, 3) + 1.7 * Math.pow(slideT - 1, 2);
            ease        = Math.max(0, Math.min(1.08, ease));

            // Left half starts far left, right half starts far right
            let startX  = isLeft ? hcx - p.width * 0.45 : hcx + p.width * 0.45;
            let heartX  = startX + (hcx - startX) * ease;
            let heartY  = hcy;

            // Glow behind the half
            p.push();
            p.noStroke();
            p.fill(pal.glow[0], pal.glow[1], pal.glow[2], 22 + 16 * pulse);
            p.ellipse(heartX + (isLeft ? -sz*0.3 : sz*0.3), heartY, sz*2.5, sz*2.5);
            p.pop();

            // Draw the half-heart using native canvas
            ctx.save();
            if (isLeft) drawLeftHalfHeart(ctx, heartX, heartY, sz);
            else        drawRightHalfHeart(ctx, heartX, heartY, sz);

            // Fill with creature colour gradient
            let grad = ctx.createRadialGradient(
                heartX + (isLeft ? -sz*0.2 : sz*0.2), heartY - sz*0.2, 0,
                heartX, heartY, sz * 1.1
            );
            grad.addColorStop(0, `rgba(${pal.glow[0]},${pal.glow[1]},${pal.glow[2]},1)`);
            grad.addColorStop(1, `rgba(${pal.glow[0]*0.3|0},${pal.glow[1]*0.3|0},${pal.glow[2]*0.3|0},0.65)`);
            ctx.fillStyle = grad;
            ctx.fill();

            // Specular highlight
            ctx.save();
            if (isLeft) drawLeftHalfHeart(ctx, heartX - sz*0.08, heartY - sz*0.12, sz*0.5);
            else        drawRightHalfHeart(ctx, heartX + sz*0.08, heartY - sz*0.12, sz*0.5);
            ctx.fillStyle = `rgba(255,255,255,${0.22 + 0.14*pulse})`;
            ctx.fill();
            ctx.restore();
            ctx.restore();

            // Sparkles — more intense when both done
            if (p.frameCount % (bothDone ? 4 : 9) < 2) {
                spawnPop(
                    heartX + p.random(-sz*0.6, isLeft ? 0 : sz*0.6),
                    heartY + p.random(-sz*0.7, sz*0.5),
                    pal.glow[0], pal.glow[1], pal.glow[2], bothDone ? 3 : 1
                );
            }
        }

        // Both finished — dim overlay + NEW MAZE label below
        if (resetTimer <= 0) return;
        let fade = p.map(resetTimer, RESET_DELAY, 0, 0, 160);
        let tf   = 0.5 + 0.5 * Math.sin(p.frameCount * 0.15);
        p.push();
        p.noStroke(); p.fill(6, 6, 12, fade * 0.38);
        p.rect(0, 0, p.width, p.height);
        p.textAlign(p.CENTER, p.CENTER);
        p.textSize(CELL * 0.38); p.fill(30, 200, 80, 180 * tf);
        p.text('NEW MAZE', p.width/2, HUD_H + (p.height-HUD_H)/2 + CELL * 2.8);
        p.pop();
    }

    // ============================================================
    //  AUTOMATIC WALL SHIFTS  — walls move every 30 seconds
    //  Toggling a random interior wall forces creatures to repath
    // ============================================================
    function shiftMazes() {
        for (let mz of [mazeL, mazeR]) {
            if (!mz) continue;
            mz.shiftTimer--;
            if (mz.shiftTimer > 0) continue;
            mz.shiftTimer = MAZE_SHIFT_INTERVAL;

            // Pick a random interior cell (not on the border)
            let attempts = 0;
            while (attempts++ < 30) {
                let c = p.floor(p.random(1, mz.cols - 1));
                let r = p.floor(p.random(1, mz.rows - 1));
                // Pick a random direction that leads to a valid neighbour
                let dirs = p.shuffle(['N','S','E','W']);
                for (let d of dirs) {
                    let nc=c, nr=r;
                    if (d==='N') nr--; if (d==='S') nr++;
                    if (d==='E') nc++; if (d==='W') nc--;
                    if (nr<0||nr>=mz.rows||nc<0||nc>=mz.cols) continue;
                    let opp = opposite(d);

                    // Toggle this wall — if it's a wall, open it; if open, close it
                    // But never isolate a cell (keep at least one open exit)
                    let cell    = mz.cells[r][c];
                    let neigh   = mz.cells[nr][nc];
                    let wasWall = cell.walls[d];

                    if (!wasWall) {
                        // Closing a passage — only if both cells have other exits
                        let cellExits  = ['N','S','E','W'].filter(x=>x!==d  &&!cell.walls[x]).length;
                        let neighExits = ['N','S','E','W'].filter(x=>x!==opp&&!neigh.walls[x]).length;
                        if (cellExits < 1 || neighExits < 1) continue; // would isolate
                        cell.walls[d]    = true;
                        neigh.walls[opp] = true;
                    } else {
                        // Opening a new passage
                        cell.walls[d]    = false;
                        neigh.walls[opp] = false;
                    }

                    // Flash the shifted wall location
                    mz.shiftFlash = { c, r, d, timer: 45, opened: wasWall };

                    // Force any creature in this maze to repath from current pos
                    for (let creature of creatures) {
                        if (creature.mz !== mz || creature.finished) continue;
                        let curC = p.constrain(p.floor((creature.x - mz.offsetX)/CELL), 0, mz.cols-1);
                        let curR = p.constrain(p.floor((creature.y - (mz.offsetY||0))/CELL), 0, mz.rows-1);
                        let goal = creature.paths[0][creature.paths[0].length-1];
                        let newP = findMultiplePaths(mz, curC, curR, goal.col, goal.row, PATHS_PER_MAZE);
                        if (newP && newP.length > 0 && newP[0].length > 1) {
                            creature.paths      = newP;
                            creature.pathSetIdx = 0;
                            creature.pathIndex  = 1;
                            creature.trail      = [];
                        }
                    }
                    break;
                }
                if (mz.shiftFlash) break;
            }
        }
    }

    // Draw the wall-shift flash indicator in drawMaze
    function drawShiftFlash(mz) {
        if (!mz.shiftFlash) return;
        let sf = mz.shiftFlash;
        sf.timer--;
        if (sf.timer <= 0) { mz.shiftFlash = null; return; }
        let oy  = mz.offsetY || 0;
        let ox  = mz.offsetX;
        let frac = sf.timer / 45;
        let x1  = sf.c * CELL + ox, y1 = sf.r * CELL + oy;
        let x2  = x1 + CELL,        y2 = y1 + CELL;
        // Highlight the two cells involved
        p.push();
        p.noStroke();
        p.fill(sf.opened ? 80 : 255, sf.opened ? 200 : 80, 80, 60 * frac);
        p.rect(x1, y1, CELL, CELL);
        // Draw a bright line on the toggled wall edge
        p.stroke(sf.opened ? 60 : 255, sf.opened ? 255 : 60, 60, 200 * frac);
        p.strokeWeight(3);
        if (sf.d==='E'||sf.d==='W') {
            let wx = (sf.d==='E') ? x2 : x1;
            p.line(wx, y1, wx, y2);
        } else {
            let wy = (sf.d==='S') ? y2 : y1;
            p.line(x1, wy, x2, wy);
        }
        p.pop();
    }

    // ============================================================
    //  PERSISTENT STATS  (localStorage)
    // ============================================================
    function saveStats() {
        try {
            let data = {
                totalDeaths, mazesWon, mazesLost,
                gemCounts, mazeGeneration,
                savedAt: new Date().toISOString(),
            };
            localStorage.setItem('familiar_stats', JSON.stringify(data));
        } catch(e) {}
    }

    function loadStats() {
        try {
            let raw = localStorage.getItem('familiar_stats');
            if (!raw) return;
            let d = JSON.parse(raw);
            if (d.totalDeaths)  totalDeaths  = d.totalDeaths;
            if (d.mazesWon)     mazesWon     = d.mazesWon;
            if (d.mazesLost)    mazesLost    = d.mazesLost;
            if (d.gemCounts)    gemCounts    = d.gemCounts;
            if (d.mazeGeneration !== undefined) mazeGeneration = d.mazeGeneration;
        } catch(e) {}
    }

    // Past scores popup — cache data at open time, never read localStorage in draw loop
    let showPopup   = false;
    let popupData   = null;   // cached stats, loaded once when popup opens
    let statsBtn    = null;   // {x,y,w,h} set each frame

    function drawStatsButton() {
        if (celebrating) { statsBtn = null; return; }  // hidden during celebration
        // Small button right at the centre divider, vertically centred
        let bw = 110, bh = 26;
        let bx = p.width/2 - bw/2;
        let by = HUD_H + (p.height - HUD_H)/2 - bh/2;  // true centre of maze area
        statsBtn = {x:bx, y:by, w:bw, h:bh};
        let hover = p.mouseX>bx && p.mouseX<bx+bw && p.mouseY>by && p.mouseY<by+bh;
        p.push();
        p.noStroke();
        p.fill(10, 16, 30, 200);
        p.rect(bx, by, bw, bh, 6);
        p.noFill();
        p.stroke(showPopup ? 60:40, showPopup ? 220:160, showPopup ? 100:80, hover?255:180);
        p.strokeWeight(hover ? 2 : 1.5);
        p.rect(bx, by, bw, bh, 6);
        p.noStroke();
        p.fill(showPopup ? 80:60, showPopup ? 220:180, showPopup ? 120:100, hover?255:200);
        p.textFont('monospace'); p.textSize(10);
        p.textAlign(p.CENTER, p.CENTER);
        p.text('📊 PAST SCORES', bx+bw/2, by+bh/2);
        p.pop();
    }

    // Load popup data once — called only when toggling open, not every frame
    function openPopup() {
        try {
            let raw = localStorage.getItem('familiar_stats');
            popupData = raw ? JSON.parse(raw) : null;
        } catch(e) { popupData = null; }
        showPopup = true;
    }

    function drawPastRunsPopup() {
        if (celebrating) { showPopup = false; return; }  // close during celebration
        if (!showPopup || !popupData) return;
        // All drawing uses cached popupData — no localStorage reads here
        let d  = popupData;
        let px = p.width/2 - 160, py = 60, pw = 320, ph = 165;
        let alpha = 220;

        p.push();
        p.noStroke(); p.fill(0, 0, 0, alpha * 0.5);
        p.rect(px+4, py+4, pw, ph, 10);
        p.fill(10, 14, 26, alpha);
        p.rect(px, py, pw, ph, 10);
        p.noFill(); p.stroke(60, 180, 100, alpha); p.strokeWeight(1.5);
        p.rect(px, py, pw, ph, 10);

        p.noStroke(); p.textFont('monospace');
        p.fill(60, 220, 100, alpha);
        p.textSize(13); p.textAlign(p.CENTER, p.TOP);
        p.text('LAST SESSION', p.width/2, py + 12);

        let sx = px + 20, sy = py + 36;
        p.textSize(11); p.textAlign(p.LEFT, p.TOP);
        p.fill(80, 200, 255, alpha);
        p.text('GREEN  ◆ gems: ' + (d.gemCounts?.[0]||0), sx, sy);
        p.text('       won: '+(d.mazesWon?.[0]||0)+'  lost: '+(d.mazesLost?.[0]||0)+'  deaths: '+(d.totalDeaths?.[0]||0), sx, sy+16);
        p.fill(200, 80, 220, alpha);
        p.text('PURPLE ◆ gems: ' + (d.gemCounts?.[1]||0), sx, sy+36);
        p.text('       won: '+(d.mazesWon?.[1]||0)+'  lost: '+(d.mazesLost?.[1]||0)+'  deaths: '+(d.totalDeaths?.[1]||0), sx, sy+52);

        p.fill(120, 120, 160, alpha * 0.8);
        p.textSize(9); p.textAlign(p.CENTER, p.BOTTOM);
        let ts = d.savedAt ? new Date(d.savedAt).toLocaleString() : '';
        p.text('saved: ' + ts, p.width/2, py + ph - 16);
        p.text('click anywhere to dismiss', p.width/2, py + ph - 4);
        p.pop();
    }

    // ============================================================
    //  RESIZE
    // ============================================================
    p.windowResized = function() {
        let sz=canvasSize();
        p.resizeCanvas(sz.w,sz.h);
        deriveSizes();
        init();
    };

}, document.body);