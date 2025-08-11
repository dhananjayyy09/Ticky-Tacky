// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

// Serve the main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/game', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve CSS and JS files specifically
app.get('/styles.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'styles.css'));
});

app.get('/script.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'script.js'));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] }
});

const PORT = process.env.PORT || 3000;

/*
Room matchmaking model:
- Each room holds exactly 2 players max.
- Server keeps authoritative game state per room: board array, current turn (X/O), ready flags.
- Players are assigned symbol X or O by server.
- Server enforces valid moves and broadcasts updates.
*/

const rooms = {}; // { roomId: { players: { socketId: {name, symbol}}, board: Array(9), turn, ready: Set, status } }

function createRoomId() {
  return Math.random().toString(36).slice(2,9);
}

io.on('connection', socket => {
  console.log(`sock connected ${socket.id}`);

  // helper
  function safeEmit(ev, payload) {
    try { socket.emit(ev, payload); } catch(e) {}
  }

  // find or create room and join
  socket.on('quickplay', ({ name }) => {
    // look for a room with one slot
    let target = null;
    for(const [rid, room] of Object.entries(rooms)) {
      if(Object.keys(room.players).length === 1 && room.status === 'waiting') { target = rid; break; }
    }
    if(!target) target = createRoomId();
    joinRoom(target, socket, name);
  });

  socket.on('createRoom', ({ name }) => {
    const rid = createRoomId();
    joinRoom(rid, socket, name);
    safeEmit('roomCreated', { roomId: rid });
  });

  socket.on('joinRoom', ({ roomId, name }) => {
    if(!rooms[roomId]) {
      safeEmit('errorMsg', { error: 'Room not found' });
      return;
    }
    if(Object.keys(rooms[roomId].players).length >= 2) {
      safeEmit('errorMsg', { error: 'Room full' });
      return;
    }
    joinRoom(roomId, socket, name);
  });

  function joinRoom(roomId, socket, name) {
    if(!rooms[roomId]) {
      rooms[roomId] = {
        players: {},
        board: Array(9).fill(null),
        turn: 'X',
        ready: new Set(),
        status: 'waiting', // waiting | waitingReady | playing | finished
        rematchVotes: new Set()
      };
    }
    const room = rooms[roomId];
    
    // Check if room is full
    if(Object.keys(room.players).length >= 2) {
      safeEmit('errorMsg', { error: 'Room is full' });
      return;
    }
    
    // assign symbol
    const used = Object.values(room.players).map(p => p.symbol);
    const symbol = used.includes('X') ? 'O' : 'X';
    
    // Add player to room
    room.players[socket.id] = { 
      name: name || (symbol === 'X' ? 'Player X' : 'Player O'), 
      symbol, 
      socketId: socket.id 
    };
    
    // Reset ready state for this player
    room.ready.delete(socket.id);
    
    socket.join(roomId);
    
    // notify participants
    io.to(roomId).emit('roomUpdate', getRoomPublic(roomId));
    console.log(`socket ${socket.id} joined ${roomId} as ${symbol}`);
    
    // start match if two players
    if(Object.keys(room.players).length === 2) {
      room.status = 'waitingReady';
      room.board = Array(9).fill(null);
      room.turn = 'X';
      room.ready.clear(); // Reset ready states
      io.to(roomId).emit('matchReady', getRoomPublic(roomId));
    }
  }

  socket.on('setReady', ({ roomId, ready }) => {
    const room = rooms[roomId];
    if(!room) {
      safeEmit('errorMsg', { error: 'Room not found' });
      return;
    }
    
    if(!room.players[socket.id]) {
      safeEmit('errorMsg', { error: 'You are not in this room' });
      return;
    }
    
    if(ready) {
      room.ready.add(socket.id);
    } else {
      room.ready.delete(socket.id);
    }
    
    // Update room status for all players
    io.to(roomId).emit('roomUpdate', getRoomPublic(roomId));
    
    // Check if both players are ready
    if(room.ready.size === 2) {
      room.status = 'playing';
      room.board = Array(9).fill(null);
      room.turn = 'X';
      room.rematchVotes = new Set();
      io.to(roomId).emit('gameStart', getRoomPublic(roomId));
    }
  });

  socket.on('playMove', ({ roomId, index }) => {
    const room = rooms[roomId];
    if(!room) {
      safeEmit('errorMsg', { error: 'Room not found' });
      return;
    }
    
    if(room.status !== 'playing') {
      safeEmit('invalidMove', { reason: 'Game is not in progress' });
      return;
    }
    
    const player = room.players[socket.id];
    if(!player) {
      safeEmit('errorMsg', { error: 'You are not in this room' });
      return;
    }
    
    // validate turn
    if(player.symbol !== room.turn) {
      safeEmit('invalidMove', { reason: 'Not your turn' });
      return;
    }
    
    // validate index
    if(index < 0 || index > 8 || room.board[index]) {
      safeEmit('invalidMove', { reason: 'Invalid cell' });
      return;
    }
    
    // Make the move
    room.board[index] = player.symbol;
    console.log(`Player ${player.symbol} played at position ${index} in room ${roomId}`);
    
    // check win/draw
    const win = checkWin(room.board);
    if(win) {
      room.status = 'finished';
      io.to(roomId).emit('gameOver', { 
        result: 'win', 
        winner: win.player, 
        combo: win.combo, 
        room: getRoomPublic(roomId) 
      });
      console.log(`Game over in room ${roomId}: ${win.player} wins`);
      return;
    } else if(room.board.every(Boolean)) {
      room.status = 'finished';
      io.to(roomId).emit('gameOver', { 
        result: 'draw', 
        room: getRoomPublic(roomId) 
      });
      console.log(`Game over in room ${roomId}: Draw`);
      return;
    } else {
      // next turn
      room.turn = (room.turn === 'X') ? 'O' : 'X';
      io.to(roomId).emit('boardUpdate', { 
        board: room.board.slice(), 
        turn: room.turn 
      });
      console.log(`Turn changed to ${room.turn} in room ${roomId}`);
    }
  });

  socket.on('rematch', ({ roomId }) => {
    const room = rooms[roomId];
    if(!room) {
      safeEmit('errorMsg', { error: 'Room not found' });
      return;
    }
    
    if(!room.players[socket.id]) {
      safeEmit('errorMsg', { error: 'You are not in this room' });
      return;
    }
    
    if(room.status !== 'finished') {
      safeEmit('errorMsg', { error: 'Game is not finished yet' });
      return;
    }
    
    room.rematchVotes.add(socket.id);
    io.to(roomId).emit('rematchUpdate', { votes: room.rematchVotes.size });
    
    if(room.rematchVotes.size === 2) {
      // Reset game for rematch
      room.board = Array(9).fill(null);
      room.turn = 'X';
      room.status = 'playing';
      room.ready = new Set(Object.keys(room.players));
      room.rematchVotes = new Set();
      io.to(roomId).emit('gameStart', getRoomPublic(roomId));
      console.log(`Rematch started in room ${roomId}`);
    }
  });

  socket.on('leaveRoom', ({ roomId }) => {
    leaveRoom(roomId, socket);
  });

  socket.on('disconnect', () => {
    console.log('disconnect', socket.id);
    // remove from any room
    for(const rid of Object.keys(rooms)) {
      if(rooms[rid].players[socket.id]) {
        // notify other player
        const other = Object.keys(rooms[rid].players).find(id => id !== socket.id);
        leaveRoom(rid, socket, true);
        if(other) {
          io.to(other).emit('opponentLeft', { message: 'Opponent disconnected' });
        }
      }
    }
  });

  function leaveRoom(roomId, socket, silent=false) {
    const room = rooms[roomId];
    if(!room) return;
    
    const player = room.players[socket.id];
    if(player) {
      console.log(`Player ${player.name} (${player.symbol}) left room ${roomId}`);
    }
    
    delete room.players[socket.id];
    room.ready.delete(socket.id);
    room.rematchVotes.delete(socket.id);
    socket.leave(roomId);
    
    if(Object.keys(room.players).length === 0) {
      // Room is empty, delete it
      delete rooms[roomId];
      console.log(`Room ${roomId} deleted (empty)`);
    } else {
      // Reset room state for remaining player
      room.status = 'waiting';
      room.board = Array(9).fill(null);
      room.turn = 'X';
      room.ready.clear();
      room.rematchVotes.clear();
      
      if(!silent) {
        io.to(roomId).emit('roomUpdate', getRoomPublic(roomId));
        io.to(roomId).emit('opponentLeft', { message: 'Opponent left the room' });
      }
      console.log(`Room ${roomId} reset for remaining player`);
    }
  }

  function getRoomPublic(roomId) {
    const r = rooms[roomId];
    if(!r) return null;
    
    const players = Object.values(r.players).map(p => ({ 
      name: p.name, 
      symbol: p.symbol, 
      socketId: p.socketId,
      isReady: r.ready.has(p.socketId)
    }));
    
    return {
      roomId,
      players,
      board: r.board.slice(),
      turn: r.turn,
      status: r.status,
      readyCount: r.ready.size,
      playerCount: players.length,
      canStart: r.status === 'waitingReady' && r.ready.size === 2,
      isGameActive: r.status === 'playing',
      isGameFinished: r.status === 'finished'
    };
  }

  function checkWin(b) {
    const combos = [
      [0,1,2],[3,4,5],[6,7,8],
      [0,3,6],[1,4,7],[2,5,8],
      [0,4,8],[2,4,6]
    ];
    for(const combo of combos) {
      const [a,b1,c] = combo;
      if(b[a] && b[a] === b[b1] && b[a] === b[c]) return { player: b[a], combo };
    }
    return null;
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
