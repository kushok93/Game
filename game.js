"use strict";

const SIZE = 10;
const FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
const LETTERS = "АБВГДЕЖЗИК";
const AI_DELAY = 600;
const CONNECT_TIMEOUT = 20000;

const EMPTY = 0, SHIP = 1, MISS = 2, HIT = 3, SUNK = 4;

const T = {
  card: "#131c2e",
  border: "#1f2a40",
  muted: "#7c8aa5",
  accent: "#38bdf8",
  water: "#16263f",
  waterHover: "#24476f",
  missBg: "#0f192a",
  missDot: "#4b5d7a",
  ship: "#5b6b85",
  shipEdge: "#8193b2",
  hitBg: "#3a1d24",
  hit: "#fb923c",
  sunk: "#7f1d1d",
  sunkEdge: "#ef4444",
  sunkMark: "#fecaca",
  ok: "#22c55e",
  okBg: "#14532d",
  bad: "#ef4444",
  badBg: "#5b1a1a",
};

const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, sans-serif';

const key = (r, c) => r * SIZE + c;
const inside = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
const randInt = n => Math.floor(Math.random() * n);
const choice = arr => arr[randInt(arr.length)];
const coordName = ([r, c]) => `${LETTERS[c]}${r + 1}`;
const sameCell = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1];

// ---------- логика ----------

class Ship {
  constructor(cells) {
    this.cells = cells.map(([r, c]) => [r, c]);
    this.hits = new Set();
  }

  has(r, c) {
    return this.cells.some(([a, b]) => a === r && b === c);
  }

  get sunk() {
    return this.hits.size === this.cells.length;
  }
}

class Board {
  constructor() {
    this.reset();
  }

  reset() {
    this.grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
    this.ships = [];
  }

  static shipCells(r, c, length, horizontal) {
    return Array.from({ length }, (_, i) => (horizontal ? [r, c + i] : [r + i, c]));
  }

  /** Клетки вокруг набора клеток (включая диагонали), без самих клеток. */
  neighbors(cells) {
    const own = new Set(cells.map(([r, c]) => key(r, c)));
    const result = new Map();
    for (const [r, c] of cells) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if (inside(rr, cc) && !own.has(key(rr, cc))) result.set(key(rr, cc), [rr, cc]);
        }
      }
    }
    return [...result.values()];
  }

  canPlace(cells) {
    if (!cells.every(([r, c]) => inside(r, c))) return false;
    return [...cells, ...this.neighbors(cells)].every(([r, c]) => this.grid[r][c] === EMPTY);
  }

  place(cells) {
    this.ships.push(new Ship(cells));
    for (const [r, c] of cells) this.grid[r][c] = SHIP;
  }

  placeRandom() {
    for (;;) {
      this.reset();
      if (this.tryFill()) return;
    }
  }

  tryFill() {
    for (const length of FLEET) {
      let placed = false;
      for (let i = 0; i < 300 && !placed; i++) {
        const cells = Board.shipCells(randInt(SIZE), randInt(SIZE), length, Math.random() < 0.5);
        if (this.canPlace(cells)) {
          this.place(cells);
          placed = true;
        }
      }
      if (!placed) return false;
    }
    return true;
  }

  shipAt(r, c) {
    return this.ships.find(s => s.has(r, c)) || null;
  }

  /** Возвращает 'repeat', 'miss', 'hit' или 'kill'. */
  shoot(r, c) {
    const state = this.grid[r][c];
    if (state === MISS || state === HIT || state === SUNK) return "repeat";
    if (state === EMPTY) {
      this.grid[r][c] = MISS;
      return "miss";
    }
    const ship = this.shipAt(r, c);
    ship.hits.add(key(r, c));
    this.grid[r][c] = HIT;
    if (!ship.sunk) return "hit";
    this.markSunk(ship);
    return "kill";
  }

  markSunk(ship) {
    for (const [r, c] of ship.cells) this.grid[r][c] = SUNK;
    for (const [r, c] of this.neighbors(ship.cells)) {
      if (this.grid[r][c] === EMPTY) this.grid[r][c] = MISS;
    }
  }

  /** Для поля соперника в онлайне: записать ответ на наш выстрел. */
  applyResult(r, c, result, cells) {
    if (result === "miss") {
      this.grid[r][c] = MISS;
    } else if (result === "hit") {
      this.grid[r][c] = HIT;
    } else if (result === "kill") {
      const ship = new Ship(cells);
      for (const [a, b] of cells) ship.hits.add(key(a, b));
      this.ships.push(ship);
      this.markSunk(ship);
    }
  }

  /** Показать оставшиеся корабли соперника после конца партии. */
  reveal(fleet) {
    for (const cells of fleet) {
      if (this.shipAt(...cells[0])) continue;
      const ship = new Ship(cells);
      for (const [r, c] of cells) if (this.grid[r][c] === HIT) ship.hits.add(key(r, c));
      this.ships.push(ship);
    }
  }

  sunkCount() {
    return this.ships.filter(s => s.sunk).length;
  }

  allSunk() {
    return this.sunkCount() === FLEET.length;
  }

  shipsLeft() {
    return FLEET.length - this.sunkCount();
  }
}

/** Охота по шахматной сетке, затем добивание вдоль линии попаданий. */
class AI {
  constructor() {
    this.hits = [];
  }

  static open(board, r, c) {
    return inside(r, c) && (board.grid[r][c] === EMPTY || board.grid[r][c] === SHIP);
  }

  choose(board) {
    if (this.hits.length) {
      const targets = this.targets().filter(([r, c]) => AI.open(board, r, c));
      if (targets.length) return choice(targets);
    }
    const free = [];
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (AI.open(board, r, c)) free.push([r, c]);
    const parity = free.filter(([r, c]) => (r + c) % 2 === 0);
    return choice(parity.length ? parity : free);
  }

  targets() {
    if (this.hits.length === 1) {
      const [r, c] = this.hits[0];
      return [[r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]];
    }
    const rows = new Set(this.hits.map(([r]) => r));
    if (rows.size === 1) {
      const r = this.hits[0][0];
      const cols = this.hits.map(([, c]) => c).sort((a, b) => a - b);
      return [[r, cols[0] - 1], [r, cols[cols.length - 1] + 1]];
    }
    const c = this.hits[0][1];
    const rs = [...rows].sort((a, b) => a - b);
    return [[rs[0] - 1, c], [rs[rs.length - 1] + 1, c]];
  }

  report(cell, result) {
    if (result === "hit") this.hits.push(cell);
    else if (result === "kill") this.hits = [];
  }
}

// ---------- отрисовка ----------

function roundRect(ctx, x0, y0, x1, y1, r) {
  r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  ctx.beginPath();
  ctx.moveTo(x0 + r, y0);
  ctx.arcTo(x1, y0, x1, y1, r);
  ctx.arcTo(x1, y1, x0, y1, r);
  ctx.arcTo(x0, y1, x0, y0, r);
  ctx.arcTo(x0, y0, x1, y0, r);
  ctx.closePath();
}

function setupCanvas(canvas, w, h) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

class BoardView {
  constructor(canvas, tracker) {
    this.canvas = canvas;
    this.tracker = tracker;
    this.state = null;
    this.fx = null;
  }

  resize(cell, margin) {
    this.cell = cell;
    this.m = margin;
    this.side = margin + SIZE * cell + 2;
    this.ctx = setupCanvas(this.canvas, this.side, this.side);
    this.tctx = setupCanvas(this.tracker, this.side, 22);
  }

  cellBox(r, c) {
    const g = 3;
    const x0 = this.m + c * this.cell + g / 2;
    const y0 = this.m + r * this.cell + g / 2;
    return [x0, y0, x0 + this.cell - g, y0 + this.cell - g];
  }

  spanBox(cells) {
    const rows = cells.map(([r]) => r), cols = cells.map(([, c]) => c);
    const [x0, y0] = this.cellBox(Math.min(...rows), Math.min(...cols));
    const [, , x1, y1] = this.cellBox(Math.max(...rows), Math.max(...cols));
    return [x0, y0, x1, y1];
  }

  cellFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (x < this.m || y < this.m) return null;
    const r = Math.floor((y - this.m) / this.cell), c = Math.floor((x - this.m) / this.cell);
    return inside(r, c) ? [r, c] : null;
  }

  draw(board, opts = {}) {
    this.state = { board, ...opts };
    this.paint();
  }

  paint() {
    if (!this.state) return;
    const { board, showShips, preview, hover, last } = this.state;
    const ctx = this.ctx, rad = 7;
    ctx.clearRect(0, 0, this.side, this.side);

    ctx.fillStyle = T.muted;
    ctx.font = `bold 12px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < SIZE; i++) {
      const mid = this.m + i * this.cell + this.cell / 2;
      ctx.fillText(LETTERS[i], mid, this.m / 2);
      ctx.fillText(String(i + 1), this.m / 2, mid);
    }

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const st = board.grid[r][c];
        let fill = T.water;
        if (st === MISS) fill = T.missBg;
        else if (st === HIT) fill = T.hitBg;
        else if (sameCell(hover, [r, c]) && (st === EMPTY || st === SHIP)) fill = T.waterHover;
        roundRect(ctx, ...this.cellBox(r, c), rad);
        ctx.fillStyle = fill;
        ctx.fill();
      }
    }

    ctx.lineWidth = 1;
    for (const ship of board.ships) {
      if (!showShips && !ship.sunk) continue;
      roundRect(ctx, ...this.spanBox(ship.cells), rad);
      ctx.fillStyle = ship.sunk ? T.sunk : T.ship;
      ctx.fill();
      ctx.strokeStyle = ship.sunk ? T.sunkEdge : T.shipEdge;
      ctx.stroke();
    }

    if (preview && preview.cells.length) {
      roundRect(ctx, ...this.spanBox(preview.cells), rad);
      ctx.fillStyle = preview.ok ? T.okBg : T.badBg;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = preview.ok ? T.ok : T.bad;
      ctx.stroke();
    }

    ctx.lineCap = "round";
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const st = board.grid[r][c];
        const [x0, y0, x1, y1] = this.cellBox(r, c);
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        if (st === MISS) {
          ctx.beginPath();
          ctx.arc(cx, cy, 3, 0, Math.PI * 2);
          ctx.fillStyle = T.missDot;
          ctx.fill();
        } else if (st === HIT || st === SUNK) {
          const p = this.cell * 0.22;
          ctx.beginPath();
          ctx.moveTo(cx - p, cy - p);
          ctx.lineTo(cx + p, cy + p);
          ctx.moveTo(cx - p, cy + p);
          ctx.lineTo(cx + p, cy - p);
          ctx.lineWidth = 3;
          ctx.strokeStyle = st === HIT ? T.hit : T.sunkMark;
          ctx.stroke();
        }
      }
    }

    if (last) {
      const [x0, y0, x1, y1] = this.cellBox(...last);
      roundRect(ctx, x0 - 1, y0 - 1, x1 + 1, y1 + 1, rad);
      ctx.lineWidth = 2;
      ctx.strokeStyle = T.accent;
      ctx.stroke();
    }

    if (this.fx) {
      const t = Math.min(1, (performance.now() - this.fx.t0) / 220);
      const [x0, y0, x1, y1] = this.cellBox(...this.fx.cell);
      ctx.beginPath();
      ctx.arc((x0 + x1) / 2, (y0 + y1) / 2, this.cell * (0.15 + 0.65 * t), 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1, 4 * (1 - t));
      ctx.strokeStyle = this.fx.color;
      ctx.stroke();
    }
  }

  shot(cell, color) {
    const fx = { cell, color, t0: performance.now() };
    this.fx = fx;
    const loop = () => {
      if (this.fx !== fx) return;
      if (performance.now() - fx.t0 >= 220) this.fx = null;
      this.paint();
      if (this.fx) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  drawTracker(board, setup = false) {
    const ctx = this.tctx;
    ctx.clearRect(0, 0, this.side, 22);
    let seg = 11, gap = 9;
    const total = 20 * seg + 9 * gap, avail = this.side - this.m;
    if (total > avail) {
      seg *= avail / total;
      gap *= avail / total;
    }
    const h = 8, y = 7;
    const sunkLens = board.ships.filter(s => s.sunk).map(s => s.cells.length);
    let x = this.m;
    FLEET.forEach((length, i) => {
      const w = length * seg;
      let fill = null, stroke = null, lw = 1;
      if (setup) {
        if (i < board.ships.length) fill = T.ship;
        else if (i === board.ships.length) { stroke = T.accent; lw = 2; }
        else stroke = T.border;
      } else {
        const idx = sunkLens.indexOf(length);
        if (idx >= 0) sunkLens.splice(idx, 1);
        fill = idx >= 0 ? T.sunk : T.ship;
      }
      roundRect(ctx, x + lw / 2, y, x + w - lw / 2, y + h, h / 2);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); }
      x += w + gap;
    });
  }
}

// ---------- игра ----------

const $ = id => document.getElementById(id);

class Game {
  constructor() {
    this.pView = new BoardView($("p-canvas"), $("p-tracker"));
    this.eView = new BoardView($("e-canvas"), $("e-tracker"));
    this.net = null;
    this.mode = null;
    this.phase = "menu";
    this.gameId = 0;
    this.player = new Board();
    this.enemy = new Board();
    this.bindEvents();
    this.layout();

    const room = /room=([A-Za-z0-9]{6})/.exec(location.hash);
    if (room) this.join(room[1].toUpperCase());
    else this.showMenu();
  }

  bindEvents() {
    $("btn-ai").onclick = () => this.startAI();
    $("btn-host").onclick = () => this.host();
    $("join-form").onsubmit = e => {
      e.preventDefault();
      const code = $("join-code").value.trim().toUpperCase();
      if (/^[A-Z0-9]{6}$/.test(code)) this.join(code);
      else this.setStatus("Код комнаты — 6 символов", "lose");
    };
    $("btn-copy").onclick = () => this.copyLink();
    $("btn-cancel").onclick = () => this.showMenu();

    $("btn-rotate").onclick = () => this.rotate();
    $("btn-random").onclick = () => this.randomPlace();
    $("btn-clear").onclick = () => this.clearPlace();
    $("btn-start").onclick = () => this.startGame();
    $("btn-again").onclick = () => this.again();
    $("btn-new").onclick = () => this.newRound();
    $("btn-menu").onclick = () => this.showMenu();

    const pc = this.pView.canvas, ec = this.eView.canvas;
    pc.addEventListener("mousemove", e => this.onPlayerMove(e));
    pc.addEventListener("mouseleave", () => this.setPreview(null));
    pc.addEventListener("click", e => this.onPlayerClick(e));
    pc.addEventListener("contextmenu", e => {
      e.preventDefault();
      this.rotate();
    });
    ec.addEventListener("mousemove", e => this.onEnemyMove(e));
    ec.addEventListener("mouseleave", () => this.onEnemyLeave());
    ec.addEventListener("click", e => this.onEnemyClick(e));
    ec.addEventListener("contextmenu", e => e.preventDefault());

    document.addEventListener("keydown", e => {
      if (e.target.tagName === "INPUT") return;
      if ("rRкК".includes(e.key) && e.key.length === 1) this.rotate();
    });
    window.addEventListener("resize", () => {
      this.layout();
      if (this.phase !== "menu" && this.phase !== "lobby") this.redraw();
    });
    window.addEventListener("beforeunload", () => {
      if (this.net) this.net.send({ t: "bye" });
    });
  }

  layout() {
    const w = document.documentElement.clientWidth;
    const avail = w >= 920 ? 388 : Math.min(w - 32 - 34, 420);
    const margin = avail < 330 ? 20 : 26;
    const cell = Math.max(22, Math.min(36, Math.floor((avail - margin - 2) / SIZE)));
    this.pView.resize(cell, margin);
    this.eView.resize(cell, margin);
  }

  // ---------- экраны и статус ----------

  showScreen(name) {
    for (const id of ["menu", "lobby", "game"]) $(id).hidden = id !== name;
  }

  setStatus(text, kind = "info") {
    const el = $("status");
    el.textContent = text;
    el.className = "status " + kind;
  }

  get online() {
    return this.mode === "online";
  }

  get opponent() {
    return this.online ? "Соперник" : "Компьютер";
  }

  showMenu(message, kind = "info") {
    this.closeNet();
    this.gameId++;
    this.mode = null;
    this.phase = "menu";
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    $("subtitle").textContent = "против компьютера или онлайн с другом";
    this.showScreen("menu");
    this.setStatus(message || "Выберите режим игры", kind);
  }

  closeNet() {
    clearTimeout(this.connectTimer);
    if (this.net) {
      this.net.send({ t: "bye" });
      this.net.destroy();
      this.net = null;
    }
  }

  // ---------- режимы ----------

  startAI() {
    this.mode = "ai";
    $("subtitle").textContent = "против компьютера";
    this.newRound();
  }

  makeNet() {
    this.closeNet();
    const net = new Net({
      onRoom: code => this.net === net && this.showLobby(code),
      onConnect: () => this.net === net && this.onConnected(),
      onData: msg => this.net === net && this.onData(msg),
      onClose: () => this.net === net && this.onDisconnect(),
      onError: text => this.net === net && this.onNetError(text),
    });
    this.net = net;
    return net;
  }

  host() {
    if (typeof Peer === "undefined") {
      this.setStatus("Не удалось загрузить модуль онлайн-игры. Проверьте интернет", "lose");
      return;
    }
    this.isHost = true;
    this.phase = "lobby";
    this.setStatus("Создаём комнату…", "wait");
    this.makeNet().host();
  }

  join(code) {
    if (typeof Peer === "undefined") {
      this.showMenu("Не удалось загрузить модуль онлайн-игры. Проверьте интернет", "lose");
      return;
    }
    this.isHost = false;
    this.phase = "lobby";
    this.showScreen("menu");
    $("join-code").value = code;
    this.setStatus(`Подключаемся к комнате ${code}…`, "wait");
    this.makeNet().join(code);
    clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => {
      if (this.phase === "lobby") {
        this.showMenu("Не удалось соединиться с другом. Возможно, мешает сеть — попробуйте, чтобы игру создал другой игрок", "lose");
      }
    }, CONNECT_TIMEOUT);
  }

  showLobby(code) {
    const link = `${location.origin}${location.pathname}#room=${code}`;
    $("room-code").textContent = code;
    $("room-link").value = link;
    $("btn-copy").textContent = "Скопировать";
    this.showScreen("lobby");
    this.setStatus("Ждём друга…", "wait");
  }

  copyLink() {
    const input = $("room-link");
    const done = () => {
      $("btn-copy").textContent = "Скопировано!";
      setTimeout(() => ($("btn-copy").textContent = "Скопировать"), 1500);
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(input.value).then(done, () => {
        input.select();
        document.execCommand("copy");
        done();
      });
    } else {
      input.select();
      document.execCommand("copy");
      done();
    }
  }

  onConnected() {
    clearTimeout(this.connectTimer);
    this.mode = "online";
    this.round = 0;
    $("subtitle").textContent = "онлайн с другом";
    this.newRound();
  }

  onDisconnect() {
    if (!this.online) {
      if (this.phase === "lobby") this.showMenu("Соединение прервано", "lose");
      return;
    }
    this.gameId++;
    this.phase = "over";
    this.disconnected = true;
    this.setStatus("Соперник отключился", "lose");
    this.refreshControls();
    this.redraw();
  }

  onNetError(text) {
    if (this.online) this.onDisconnect();
    else this.showMenu(text, "lose");
  }

  // ---------- раунд ----------

  newRound() {
    this.gameId++;
    this.player = new Board();
    this.enemy = new Board();
    if (!this.online) {
      this.enemy.placeRandom();
      this.ai = new AI();
    }
    this.toPlace = [...FLEET];
    this.horizontal = true;
    this.preview = null;
    this.hover = null;
    this.enemyHover = null;
    this.lastShot = null;
    this.lastAi = null;
    this.phase = "setup";
    this.playerTurn = true;
    this.awaiting = false;
    this.meReady = false;
    this.peerReady = false;
    this.myRematch = false;
    this.peerRematch = false;
    this.disconnected = false;
    $("e-title").textContent = this.opponent;
    this.showScreen("game");
    this.setupStatus();
    this.refreshControls();
    this.redraw();
  }

  setupStatus() {
    if (this.meReady) {
      this.setStatus("Флот готов. Ждём, пока соперник расставит корабли…", "wait");
    } else if (this.toPlace.length) {
      const orient = this.horizontal ? "горизонтально" : "вертикально";
      const peer = this.online && this.peerReady ? " · соперник уже готов" : "";
      this.setStatus(`Расставьте флот — ${this.toPlace[0]}-палубный, ${orient}${peer}`);
    } else {
      this.setStatus("Флот готов к бою. Нажмите «Начать игру»", "turn");
    }
  }

  refreshControls() {
    const show = {};
    let hint = "";
    if (this.phase === "setup" && !this.meReady) {
      Object.assign(show, { rotate: 1, random: 1, clear: 1, start: 1, menu: 1 });
      hint = "ЛКМ — поставить корабль   ·   ПКМ или R — повернуть";
    } else if (this.phase === "setup") {
      show.menu = 1;
    } else if (this.phase === "play") {
      if (!this.online) show.new = 1;
      show.menu = 1;
      hint = "Попадание даёт право на ещё один выстрел";
    } else if (this.phase === "over") {
      if (!this.disconnected && !this.myRematch) show.again = 1;
      show.menu = 1;
    }
    for (const name of ["rotate", "random", "clear", "start", "again", "new", "menu"]) {
      $("btn-" + name).hidden = !show[name];
    }
    $("btn-start").disabled = this.toPlace.length > 0;
    $("btn-again").textContent = this.online ? "Реванш" : "Играть снова";
    $("hint").textContent = hint;
    this.updateCursor();
  }

  canShoot() {
    return this.phase === "play" && this.playerTurn && !this.awaiting;
  }

  updateCursor() {
    this.eView.canvas.style.cursor = this.canShoot() ? "crosshair" : "default";
    this.pView.canvas.style.cursor = this.phase === "setup" && !this.meReady ? "pointer" : "default";
  }

  updateCounters() {
    const total = FLEET.length;
    $("p-counter").textContent = this.phase === "setup"
      ? `Размещено ${this.player.ships.length} из ${total}`
      : `Осталось ${this.player.shipsLeft()} из ${total}`;
    $("e-counter").textContent = `Осталось ${this.enemy.shipsLeft()} из ${total}`;
  }

  redraw() {
    this.drawPlayer();
    this.drawEnemy();
    this.updateCounters();
  }

  drawPlayer() {
    this.pView.draw(this.player, { showShips: true, preview: this.preview, last: this.lastAi });
    this.pView.drawTracker(this.player, this.phase === "setup");
  }

  drawEnemy() {
    this.eView.draw(this.enemy, {
      showShips: this.phase === "over",
      hover: this.canShoot() ? this.enemyHover : null,
      last: this.lastShot,
    });
    this.eView.drawTracker(this.enemy);
  }

  // ---------- расстановка ----------

  canPlaceNow() {
    return this.phase === "setup" && !this.meReady && this.toPlace.length > 0;
  }

  setPreview(cell) {
    this.hover = cell;
    if (!this.canPlaceNow() || !cell) {
      this.preview = null;
    } else {
      const cells = Board.shipCells(...cell, this.toPlace[0], this.horizontal);
      this.preview = { cells: cells.filter(([r, c]) => inside(r, c)), ok: this.player.canPlace(cells) };
    }
    this.drawPlayer();
  }

  onPlayerMove(e) {
    const cell = this.pView.cellFromEvent(e);
    if (!sameCell(cell, this.hover) && (cell || this.hover)) this.setPreview(cell);
  }

  onPlayerClick(e) {
    if (!this.canPlaceNow()) return;
    const cell = this.pView.cellFromEvent(e);
    if (!cell) return;
    const cells = Board.shipCells(...cell, this.toPlace[0], this.horizontal);
    if (!this.player.canPlace(cells)) return;
    this.player.place(cells);
    this.toPlace.shift();
    this.afterSetupChange();
  }

  rotate() {
    if (!this.canPlaceNow()) return;
    this.horizontal = !this.horizontal;
    this.setupStatus();
    this.setPreview(this.hover);
  }

  randomPlace() {
    if (this.phase !== "setup" || this.meReady) return;
    this.player.placeRandom();
    this.toPlace = [];
    this.afterSetupChange();
  }

  clearPlace() {
    if (this.phase !== "setup" || this.meReady) return;
    this.player = new Board();
    this.toPlace = [...FLEET];
    this.afterSetupChange();
  }

  afterSetupChange() {
    this.setupStatus();
    this.refreshControls();
    this.updateCounters();
    this.setPreview(this.hover);
  }

  startGame() {
    if (this.toPlace.length || this.phase !== "setup") return;
    this.preview = null;
    if (!this.online) {
      this.beginBattle(true);
      return;
    }
    this.meReady = true;
    this.net.send({ t: "ready" });
    if (this.peerReady) {
      this.beginBattle(this.isHost === (this.round % 2 === 0));
    } else {
      this.setupStatus();
      this.refreshControls();
      this.redraw();
    }
  }

  beginBattle(myTurn) {
    this.phase = "play";
    this.playerTurn = myTurn;
    if (myTurn) this.setStatus("Ваш ход — выберите клетку на поле противника", "turn");
    else this.setStatus(`Первым ходит ${this.opponent.toLowerCase()}…`, "wait");
    this.refreshControls();
    this.redraw();
  }

  // ---------- бой ----------

  onEnemyMove(e) {
    if (!this.canShoot()) return;
    const cell = this.eView.cellFromEvent(e);
    if (!sameCell(cell, this.enemyHover)) {
      this.enemyHover = cell;
      this.drawEnemy();
    }
  }

  onEnemyLeave() {
    this.enemyHover = null;
    this.drawEnemy();
  }

  onEnemyClick(e) {
    if (!this.canShoot()) return;
    const cell = this.eView.cellFromEvent(e);
    if (!cell) return;
    const st = this.enemy.grid[cell[0]][cell[1]];
    if (st !== EMPTY && st !== SHIP) return;
    if (this.online) {
      this.awaiting = true;
      this.setStatus(`${coordName(cell)} — выстрел…`, "wait");
      this.updateCursor();
      this.net.send({ t: "shot", r: cell[0], c: cell[1] });
      return;
    }
    this.handleMyResult(cell, this.enemy.shoot(...cell));
  }

  /** Результат нашего выстрела по полю противника. */
  handleMyResult(cell, result) {
    this.lastShot = cell;
    const coord = coordName(cell);
    if (this.enemy.allSunk()) {
      this.finish(true);
    } else if (result === "miss") {
      this.playerTurn = false;
      this.enemyHover = null;
      this.setStatus(`${coord} — мимо. Ход: ${this.opponent.toLowerCase()}…`, "wait");
      if (!this.online) setTimeout(() => this.computerTurn(this.gameId), AI_DELAY);
    } else {
      const word = result === "kill" ? "корабль потоплен!" : "попадание!";
      this.setStatus(`${coord} — ${word} Стреляйте ещё`, "hit");
    }
    this.updateCursor();
    this.redraw();
    this.eView.shot(cell, result === "miss" ? T.accent : T.hit);
  }

  computerTurn(gameId) {
    if (gameId !== this.gameId || this.phase !== "play") return;
    const cell = this.ai.choose(this.player);
    const result = this.player.shoot(...cell);
    this.ai.report(cell, result);
    this.handleTheirResult(cell, result);
  }

  /** Результат выстрела противника по нашему полю. */
  handleTheirResult(cell, result) {
    this.lastAi = cell;
    const coord = coordName(cell);
    if (this.player.allSunk()) {
      this.finish(false);
    } else if (result === "miss") {
      this.playerTurn = true;
      this.setStatus(`${this.opponent}: ${coord} — мимо. Ваш ход`, "turn");
    } else {
      const word = result === "kill" ? "потопил ваш корабль" : "попал";
      this.setStatus(`${this.opponent}: ${coord} — ${word}…`, "wait");
      if (!this.online) setTimeout(() => this.computerTurn(this.gameId), AI_DELAY);
    }
    this.updateCursor();
    this.redraw();
    this.pView.shot(cell, result === "miss" ? T.accent : T.hit);
  }

  finish(win) {
    this.phase = "over";
    if (win) this.setStatus("Победа! Весь флот противника потоплен", "win");
    else this.setStatus("Поражение. Ваш флот потоплен", "lose");
    if (this.online && win) this.net.send({ t: "fleet", fleet: this.player.ships.map(s => s.cells) });
    this.refreshControls();
    this.redraw();
  }

  again() {
    if (!this.online) {
      this.newRound();
      return;
    }
    this.myRematch = true;
    this.net.send({ t: "rematch" });
    if (this.peerRematch) {
      this.round++;
      this.newRound();
    } else {
      this.setStatus("Ждём ответа соперника…", "wait");
      this.refreshControls();
    }
  }

  // ---------- сообщения соперника ----------

  onData(msg) {
    if (!msg || typeof msg !== "object") return;
    switch (msg.t) {
      case "ready":
        this.peerReady = true;
        if (this.phase === "setup" && this.meReady) this.beginBattle(this.isHost === (this.round % 2 === 0));
        else if (this.phase === "setup") this.setupStatus();
        break;

      case "shot": {
        if (this.phase !== "play" || this.playerTurn) return;
        const r = msg.r | 0, c = msg.c | 0;
        if (!inside(r, c)) return;
        let result = this.player.shoot(r, c);
        if (result === "repeat") result = "miss";
        const reply = { t: "result", r, c, result };
        if (result === "kill") reply.cells = this.player.shipAt(r, c).cells;
        if (this.player.allSunk()) {
          reply.gameOver = true;
          reply.fleet = this.player.ships.map(s => s.cells);
        }
        this.net.send(reply);
        this.handleTheirResult([r, c], result);
        break;
      }

      case "result":
        if (this.phase !== "play" || !this.awaiting) return;
        this.awaiting = false;
        this.enemy.applyResult(msg.r, msg.c, msg.result, msg.cells);
        if (msg.gameOver && msg.fleet) this.enemy.reveal(msg.fleet);
        this.handleMyResult([msg.r, msg.c], msg.result);
        break;

      case "fleet":
        if (Array.isArray(msg.fleet)) {
          this.enemy.reveal(msg.fleet);
          this.redraw();
        }
        break;

      case "rematch":
        this.peerRematch = true;
        if (this.phase !== "over") return;
        if (this.myRematch) {
          this.round++;
          this.newRound();
        } else {
          this.setStatus("Соперник предлагает реванш!", "turn");
        }
        break;

      case "bye":
        if (this.net) this.net.lost();
        break;
    }
  }
}

window.game = new Game();
