/*
Client script for TicTacPro Multiplayer
- Connects to SERVER_URL via Socket.IO
- Fallback if server unreachable:
   - local2p: local hotseat
   - vsai: local 1-player (minimax)
- Update SERVER_URL if needed
*/

const SERVER_URL = location.hostname === 'localhost'
  ? 'http://localhost:10000'  // local backend with port
  : 'https://ticky-tacky.onrender.com';  // deployed backend URL without port

/* ============== UI elements ============== */
const gridEl = document.getElementById('grid');
const turnText = document.getElementById('turnText');
const turnPill = document.getElementById('turnPill');
const message = document.getElementById('message');
const roomIdEl = document.getElementById('roomId');
const connStatus = document.getElementById('connStatus');
const nameInput = document.getElementById('nameInput');
const quickBtn = document.getElementById('quickBtn');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const roomInput = document.getElementById('roomInput');
const readyBtn = document.getElementById('readyBtn');
const rematchBtn = document.getElementById('rematchBtn');
const leaveBtn = document.getElementById('leaveBtn');
const local2pBtn = document.getElementById('local2p');
const vsaiBtn = document.getElementById('vsai');

const scoreXEl = document.getElementById('scoreX');
const scoreOEl = document.getElementById('scoreO');
const scoreDEl = document.getElementById('scoreD');

const winnerOverlay = document.getElementById('winnerOverlay');
const winnerName = document.getElementById('winnerName');
const confetti = document.getElementById('confetti');

/* ============== Game state ============== */
let board = Array(9).fill(null);
let localMode = null; // 'multiplayer' | 'local2p' | 'ai' | null
let mySymbol = null;
let currentTurn = 'X';
let roomId = null;
let socket = null;
let scores = { X: 0, O: 0, D: 0 };
let gameOver = false;
let isReady = false;

/* ============== Helpers ============== */
const winningCombos = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

function createGrid() {
  gridEl.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    const btn = document.createElement('button');
    btn.className = 'cell';
    btn.dataset.index = i;
    btn.setAttribute('aria-label', `Cell ${i + 1}`);
    btn.addEventListener('click', onCellClick);
    gridEl.appendChild(btn);
  }
}

function render() {
  const cells = [...gridEl.children];
  cells.forEach((c, i) => {
    c.classList.remove('x', 'o', 'disabled', 'winning');
    c.textContent = '';
    if (board[i]) {
      c.textContent = board[i];
      c.classList.add(board[i].toLowerCase());
      c.classList.add('disabled');
    }
  });

  turnText.textContent = gameOver ? 'Match complete' : `Turn: ${currentTurn}`;

  // Add winner glow to turn pill
  if (gameOver) {
    turnPill.classList.add('winner');
  } else {
    turnPill.classList.remove('winner');
  }

  scoreXEl.textContent = scores.X;
  scoreOEl.textContent = scores.O;
  scoreDEl.textContent = scores.D;
}

function updateMessage(txt) {
  message.textContent = txt;
}

function showWinnerPopup(winner, combo, isDraw = false) {
  gameOver = true;

  const popupTitle = document.getElementById('popupTitle');

  if (!isDraw) {
    // Add winning class to winning cells
    combo.forEach(index => {
      const cell = gridEl.children[index];
      if (cell) cell.classList.add('winning');
    });

    // Show winner popup
    popupTitle.textContent = '🎉 Winner! 🎉';
    winnerName.textContent = winner;
    winnerName.className = `winner-name ${winner.toLowerCase()}`;
    winnerOverlay.style.display = 'flex';

    // Burst confetti for celebration
    burstConfetti();
  } else {
    // Show draw popup
    popupTitle.textContent = 'RESULT';
    winnerName.textContent = "It's a Draw!";
    winnerName.className = 'winner-name';
    winnerOverlay.style.display = 'flex';
  }
}

function closeWinnerPopup() {
  winnerOverlay.style.display = 'none';
}

function checkWin(b) {
  for (const combo of winningCombos) {
    const [a, b1, c] = combo;
    if (b[a] && b[a] === b[b1] && b[a] === b[c]) return { player: b[a], combo };
  }
  return null;
}

function isDraw(b) {
  return b.every(Boolean) && !checkWin(b);
}

function playLocalMove(idx, symbol) {
  if (gameOver || board[idx]) return;

  board[idx] = symbol;
  const win = checkWin(board);

  if (win) {
    gameOver = true;
    updateMessage(`${win.player} wins (local)!`);
    scores[win.player] += 1;
    showWinnerPopup(win.player, win.combo);
    render();
    return;
  } else if (isDraw(board)) {
    gameOver = true;
    updateMessage("Draw (local).");
    scores.D += 1;
    showWinnerPopup(null, [], true); // Pass true for draw
    render();
    return;
  }

  currentTurn = (currentTurn === 'X') ? 'O' : 'X';
  render();

  if (localMode === 'ai' && !gameOver && currentTurn !== mySymbol) {
    // AI move
    setTimeout(() => {
      const aiIndex = aiBestMove();
      playLocalMove(aiIndex, currentTurn);
    }, 240);
  }
}

/* ============== Minimax AI ============== */
function aiBestMove() {
  const ai = mySymbol === 'X' ? 'O' : 'X';
  const move = minimax(board.slice(), ai, ai);
  return move.index;
}

function minimax(newBoard, player, aiPlayer) {
  const avail = newBoard.reduce((a, c, i) => { if (!c) a.push(i); return a; }, []);
  const win = checkWin(newBoard);

  if (win) return { score: (win.player === aiPlayer) ? 10 : -10 };
  if (avail.length === 0) return { score: 0 };

  const moves = [];
  for (const i of avail) {
    const mv = { index: i };
    newBoard[i] = player;
    const next = (player === 'X') ? 'O' : 'X';
    const res = minimax(newBoard, next, aiPlayer);
    mv.score = res.score;
    newBoard[i] = null;
    moves.push(mv);
  }

  let best;
  if (player === aiPlayer) {
    let bestScore = -Infinity;
    for (const m of moves) if (m.score > bestScore) { bestScore = m.score; best = m; }
  } else {
    let bestScore = Infinity;
    for (const m of moves) if (m.score < bestScore) { bestScore = m.score; best = m; }
  }

  return best;
}

/* ============== UI events ============== */
function onCellClick(e) {
  const idx = Number(e.currentTarget.dataset.index);

  if (localMode === 'local2p' || localMode === 'ai') {
    // local hotseat or AI
    if (localMode === 'ai') {
      if (currentTurn !== mySymbol) return;
      playLocalMove(idx, currentTurn);
    } else {
      playLocalMove(idx, currentTurn);
    }
    render();
    return;
  }

  // multiplayer
  if (!socket || socket.disconnected) {
    updateMessage('Not connected to server.');
    return;
  }
  if (gameOver) return;

  socket.emit('playMove', { roomId, index: idx });
}

/* ============== Socket handling ============== */
function connectSocket() {
  console.log('connectSocket called');
  // dynamic import of socket.io client via CDN script injection if not already loaded
  if (!window.io) {
    console.log('Socket.IO not loaded, loading from CDN...');
    const s = document.createElement('script');
    s.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
    s.onload = () => {
      console.log('Socket.IO loaded from CDN');
      initSocket();
    };
    s.onerror = (error) => {
      console.error('Failed to load Socket.IO from CDN:', error);
      updateMessage('Failed to load Socket.IO client library');
    };
    document.head.appendChild(s);
  } else {
    console.log('Socket.IO already loaded');
    initSocket();
  }
}

function initSocket() {
  console.log('initSocket called, SERVER_URL:', SERVER_URL);
  if (socket && socket.connected) {
    console.log('Socket already connected');
    return;
  }

  try {
    console.log('Creating new socket connection...');

    socket = io(SERVER_URL, {
      transports: ['websocket'], // force websocket transport (optional but recommended)
      withCredentials: true
    });

    connStatus.innerHTML = 'Server: <span style="color:#60a5fa">connecting...</span>';

    socket.on("connect", () => {
      console.log("Connected to server");
      setInterval(() => socket.emit("pingServer"), 25000); // send ping every 25s
    });

    socket.on('disconnect', () => {
      connStatus.innerHTML = 'Server: <span style="color:#ef4444">disconnected</span>';
      updateMessage('Disconnected from server — fallback available.');
    });

    socket.on('connect_error', (error) => {
      connStatus.innerHTML = 'Server: <span style="color:#ef4444">connection failed</span>';
      updateMessage('Connection failed: ' + (error.message || 'Unknown error'));
      console.error('Socket connection error:', error);
    });

    socket.on('roomCreated', ({ roomId: rid }) => {
      roomId = rid;
      roomIdEl.textContent = rid;
      updateMessage('Room created. Waiting for other player...');
    });

    socket.on('roomUpdate', (room) => {
      if (!room) return;
      roomId = room.roomId;
      roomIdEl.textContent = room.roomId;

      // Update player information
      const me = room.players.find(p => p.socketId === socket.id);
      if (me) {
        mySymbol = me.symbol;
        updateMessage(`You are ${me.symbol}. Players: ${room.players.map(p => p.name + '(' + p.symbol + ')').join(' vs ')}`);
      } else {
        updateMessage(`Players: ${room.players.map(p => p.name + '(' + p.symbol + ')').join(' vs ')}`);
      }

      // Update game state
      currentTurn = room.turn;
      board = room.board.slice();

      // Update UI based on room status
      if (room.status === 'waiting') {
        updateMessage(`Waiting for players... (${room.playerCount}/2)`);
      } else if (room.status === 'waitingReady') {
        updateMessage(`Both players joined! Press Ready to start. (${room.readyCount}/2 ready)`);
        readyBtn.style.display = 'inline-block';
      } else if (room.status === 'playing') {
        updateMessage(`Game in progress! ${currentTurn}'s turn`);
        readyBtn.style.display = 'none';
      } else if (room.status === 'finished') {
        updateMessage(`Game finished!`);
        readyBtn.style.display = 'none';
      }

      render();
    });

    socket.on('matchReady', (room) => {
      // two players joined, waiting for ready
      updateMessage('Both players joined! Press Ready to start the game.');
      roomIdEl.textContent = room.roomId;
      readyBtn.style.display = 'inline-block';
      readyBtn.textContent = 'Ready';
      isReady = false;
    });

    socket.on('gameStart', (room) => {
      board = room.board.slice();
      currentTurn = room.turn;
      gameOver = false;
      isReady = false;
      readyBtn.style.display = 'none';
      updateMessage('Game started! Good luck!');
      render();
    });

    socket.on('boardUpdate', ({ board: b, turn }) => {
      board = b.slice();
      currentTurn = turn;
      render();
    });

    socket.on('invalidMove', ({ reason }) => updateMessage('Invalid move: ' + reason));

    socket.on('gameOver', ({ result, winner, combo, room }) => {
      gameOver = true;
      if (result === 'win') {
        updateMessage(`${winner} wins!`);
        scores[winner] += 1;
        showWinnerPopup(winner, combo);
        burstConfetti();
      } else {
        updateMessage('Draw.');
        scores.D += 1;
        showWinnerPopup(winner, combo, true); // Pass true for draw
      }
      render();
    });

    socket.on('errorMsg', ({ error }) => updateMessage(error || 'Server error'));
    socket.on('opponentLeft', ({ message: m }) => updateMessage(m || 'Opponent left'));

    socket.on('rematchUpdate', ({ votes }) => {
      updateMessage(`Rematch votes: ${votes}/2`);
    });

  } catch (error) {
    connStatus.innerHTML = 'Server: <span style="color:#ef4444">error</span>';
    updateMessage('Failed to initialize socket: ' + error.message);
    console.error('Socket initialization error:', error);
  }
}

/* ============== Buttons wiring ============== */
quickBtn.addEventListener('click', () => {
  connectSocket();
  socket.emit('quickplay', { name: nameInput.value || 'Player' });
  localMode = 'multiplayer';
  updateMessage('Searching for match...');
});

createBtn.addEventListener('click', () => {
  connectSocket();
  socket.emit('createRoom', { name: nameInput.value || 'Player' });
  localMode = 'multiplayer';
  updateMessage('Room being created...');
});

joinBtn.addEventListener('click', () => {
  const rid = roomInput.value.trim();
  if (!rid) return updateMessage('Enter a room ID to join.');
  connectSocket();
  socket.emit('joinRoom', { roomId: rid, name: nameInput.value || 'Player' });
  localMode = 'multiplayer';
  updateMessage('Joining room...');
});

readyBtn.addEventListener('click', () => {
  if (localMode !== 'multiplayer' || !socket) {
    updateMessage('Not in a multiplayer room.');
    return;
  }

  if (!roomId) {
    updateMessage('No room to get ready in.');
    return;
  }

  isReady = !isReady;
  readyBtn.textContent = isReady ? 'Unready' : 'Ready';
  readyBtn.className = isReady ? 'btn ready' : 'btn ghost';

  socket.emit('setReady', { roomId, ready: isReady });
  updateMessage(isReady ? 'You are ready!' : 'You are not ready.');
});

rematchBtn.addEventListener('click', () => {
  if (localMode !== 'multiplayer' || !socket) {
    updateMessage('No multiplayer room — rematch local');
    return;
  }
  socket.emit('rematch', { roomId });
  updateMessage('Rematch requested.');
});

leaveBtn.addEventListener('click', () => {
  if (localMode === 'multiplayer' && socket && roomId) {
    socket.emit('leaveRoom', { roomId });
    updateMessage('Left room.');
    roomId = null;
    roomIdEl.textContent = '—';
  }
  // reset local state
  localMode = null;
  resetLocal();
});

local2pBtn.addEventListener('click', () => {
  localMode = 'local2p';
  resetLocal();
  updateMessage('Local 2-player mode: take turns.');
  render();
});

vsaiBtn.addEventListener('click', () => {
  localMode = 'ai';
  mySymbol = 'X';
  resetLocal();
  updateMessage('Playing vs AI (you = X). You start.');
  render();
});

function resetLocal() {
  board = Array(9).fill(null);
  gameOver = false;
  currentTurn = 'X';
  scores = { X: 0, O: 0, D: 0 };
  render();
  roomIdEl.textContent = '—';
  winnerOverlay.style.display = 'none';
  turnPill.classList.remove('winner');
}

/* ============== Keyboard support ============== */
window.addEventListener('keydown', (e) => {
  if (e.key >= '1' && e.key <= '9') {
    const mapping = [6, 7, 8, 3, 4, 5, 0, 1, 2];
    const idx = mapping[Number(e.key) - 1];
    const cell = gridEl.children[idx];
    if (cell) cell.click();
  } else if (e.key === 'r' || e.key === 'R') {
    if (localMode === 'local2p' || localMode === 'ai') resetLocal();
    else updateMessage('Press Rematch in multiplayer.');
  }
});

/* ============== Confetti ============== */
function burstConfetti() {
  confetti.innerHTML = '';
  const colors = ['#7c3aed', '#06b6d4', '#60a5fa', '#fb923c', '#10b981', '#f43f5e'];

  for (let i = 0; i < 24; i++) {
    const d = document.createElement('div');
    d.className = 'dot';
    d.style.left = Math.random() * 100 + '%';
    d.style.top = (Math.random() * 30) + '%';
    d.style.background = colors[Math.floor(Math.random() * colors.length)];
    d.style.transform = `translateY(-20px)`;
    d.style.animationDelay = (Math.random() * 300) + 'ms';
    d.style.opacity = 1;
    confetti.appendChild(d);
  }

  setTimeout(() => confetti.innerHTML = '', 1200);
}

/* ============== Init ============== */
createGrid();
render();
connectSocket(); // attempt connect but no harm if server not present
updateMessage('Ready. Connect for multiplayer or choose local/AI.');
