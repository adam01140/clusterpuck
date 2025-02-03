const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --------------------------
// Map & Level Editor State
// --------------------------
let mapWidth = 800;
let mapHeight = 600;
let obstacleIdCounter = 100;
let obstacles = [
  { id: obstacleIdCounter++, type: 'spike', x: 400, y: 150, radius: 20 },
  { id: obstacleIdCounter++, type: 'bumper', x: 200, y: 300, radius: 20 },
  { id: obstacleIdCounter++, type: 'booster', x: 350, y: 550, width: 50, height: 50 },
  { id: obstacleIdCounter++, type: 'bumper', x: 600, y: 200, radius: 20 }
];

let goal1 = { x: 0, y: Math.round((mapHeight - 120)/2), width: 10, height: 120, color: 'red' };
let goal2 = { x: mapWidth - 10, y: Math.round((mapHeight - 120)/2), width: 10, height: 120, color: 'blue' };

// --------------------
// Gameplay State
// --------------------
const FRAME_RATE = 1000 / 60;
let players = {};
let puck = { x: mapWidth/2, y: mapHeight/2, vx: 0, vy: 0, heldBy: null, radius: 10 };
let mousePos = {}; // keyed by socket id
let playerCount = 0;
const MAX_PLAYERS = 2;
let score = { player1: 0, player2: 0 };

app.use(express.static('public'));

function assignPlayerNumber() {
  if (playerCount === 1) return 'player1';
  if (playerCount === 2) return 'player2';
  return null;
}
function getSpawnPosition(playerNumber) {
  if (playerNumber === 'player1') return { x: 100, y: mapHeight / 2 };
  if (playerNumber === 'player2') return { x: mapWidth - 100, y: mapHeight / 2 };
  return { x: mapWidth / 2, y: mapHeight / 2 };
}
function distance(a, b) {
  return Math.sqrt((a.x - b.x)**2 + (a.y - b.y)**2);
}

function handleGoalScoring(playerNumber) {
  score[playerNumber]++;
  io.emit('updateScore', score);
  console.log(`Point for ${playerNumber.replace('player', 'Player ')}!`);
  resetPositions();
  checkWin();
}
function resetPositions() {
  puck.x = mapWidth / 2;
  puck.y = mapHeight / 2;
  puck.vx = 0;
  puck.vy = 0;
  puck.heldBy = null;
  for (let id in players) {
    const player = players[id];
    const spawn = getSpawnPosition(player.number);
    player.x = spawn.x;
    player.y = spawn.y;
    player.vx = 0;
    player.vy = 0;
    player.hasPuck = false;
    player.speedModifier = 1;
    player.canJolt = true;
    player.stuckWithTriangle = false;
  }
  io.emit('currentPlayers', players);
  io.emit('puckUpdate', puck);
}
function checkWin() {
  if (score.player1 >= 10) {
    io.emit('gameOver', 'Player 1');
    resetGame();
  } else if (score.player2 >= 10) {
    io.emit('gameOver', 'Player 2');
    resetGame();
  }
}
function resetGame() {
  score.player1 = 0;
  score.player2 = 0;
  resetPositions();
  io.emit('updateScore', score);
}
function checkGoal() {
  if (
    puck.x - puck.radius <= goal1.x + goal1.width &&
    puck.y > goal1.y &&
    puck.y < goal1.y + goal1.height
  ) {
    handleGoalScoring('player2');
    return true;
  }
  if (
    puck.x + puck.radius >= goal2.x &&
    puck.y > goal2.y &&
    puck.y < goal2.y + goal2.height
  ) {
    handleGoalScoring('player1');
    return true;
  }
  return false;
}

// New: Light bounce off spikes.
function checkPuckSpikeCollision() {
  obstacles.forEach(obs => {
    if (obs.type === 'spike') {
      if (!puck.heldBy && distance(puck, obs) < puck.radius + obs.radius) {
        puck.vx = -puck.vx * 0.8;
        puck.vy = -puck.vy * 0.8;
        console.log("Puck hit a spike and bounced lightly.");
      }
    }
  });
}

function checkObstacleCollisions(player) {
  for (let obs of obstacles) {
    if (obs.type === 'spike') {
      if (distance(player, obs) < player.radius + obs.radius) {
        const spawn = getSpawnPosition(player.number);
        player.x = spawn.x;
        player.y = spawn.y;
        player.vx = 0;
        player.vy = 0;
        if (player.hasPuck) {
          player.hasPuck = false;
          if (puck.heldBy === player.number) puck.heldBy = null;
        }
        console.log(`Player ${player.number.replace('player', 'Player ')} hit a spike and was reset.`);
      }
    } else if (obs.type === 'bumper') {
      if (distance(player, obs) < player.radius + obs.radius) {
        let v = { x: player.vx, y: player.vy };
        if (!(Math.abs(v.x) < 0.01 && Math.abs(v.y) < 0.01)) {
          let cand1 = { x: v.y, y: -v.x };
          let cand2 = { x: -v.y, y: v.x };
          let n = { x: player.x - obs.x, y: player.y - obs.y };
          let dot1 = cand1.x * n.x + cand1.y * n.y;
          let dot2 = cand2.x * n.x + cand2.y * n.y;
          let chosen = (dot1 >= dot2) ? cand1 : cand2;
          player.vx = chosen.x * 6.0;
          player.vy = chosen.y * 6.0;
        }
        player.x += player.vx;
        player.y += player.vy;
        console.log(`Player ${player.number.replace('player', 'Player ')} hit a bumper and bounced hard.`);
      }
    } else if (obs.type === 'booster') {
      if (
        player.x + player.radius > obs.x &&
        player.x - player.radius < obs.x + obs.width &&
        player.y + player.radius > obs.y &&
        player.y - player.radius < obs.y + obs.height
      ) {
        if (Math.abs(player.vx) > 0.01 || Math.abs(player.vy) > 0.01) {
          const boostFactor = 2.0;
          player.vx *= boostFactor;
          player.vy *= boostFactor;
          console.log(`Player ${player.number.replace('player', 'Player ')} hit a booster and got a speed boost.`);
        }
      }
    }
  }
}

function checkPuckBumperCollision() {
  for (let obs of obstacles) {
    if (obs.type === 'bumper') {
      let threshold = puck.radius + obs.radius;
      if (puck.heldBy) threshold += 5;
      if (distance(puck, obs) < threshold) {
        if (puck.heldBy) {
          let dx = puck.x - obs.x;
          let dy = puck.y - obs.y;
          let ang = Math.atan2(dy, dx);
          puck.vx = Math.cos(ang) * 6;
          puck.vy = Math.sin(ang) * 6;
          puck.heldBy = null;
        } else {
          let v = { x: puck.vx, y: puck.vy };
          if (Math.abs(v.x) < 0.01 && Math.abs(v.y) < 0.01) continue;
          let cand1 = { x: v.y, y: -v.x };
          let cand2 = { x: -v.y, y: v.x };
          let n = { x: puck.x - obs.x, y: puck.y - obs.y };
          let dot1 = cand1.x * n.x + cand1.y * n.y;
          let dot2 = cand2.x * n.x + cand2.y * n.y;
          let chosen = (dot1 >= dot2) ? cand1 : cand2;
          puck.vx = chosen.x * 6.0;
          puck.vy = chosen.y * 6.0;
        }
        console.log("Puck hit a bumper and bounced hard.");
      }
    }
  }
}

function checkPuckPossession() {
  for (let id in players) {
    const player = players[id];
    if (!player.hasPuck && distance(player, puck) < player.radius + puck.radius + 5) {
      puck.heldBy = player.number;
      player.hasPuck = true;
      io.to(id).emit('puckPossession', { hasPuck: true });
      console.log(`Player ${player.number.replace('player', 'Player ')} picked up the puck.`);
    }
  }
}

function updatePuckPosition(playerNumber) {
  const player = Object.values(players).find(p => p.number === playerNumber);
  if (player && player.hasPuck && mousePos[player.socketId]) {
    const dx = mousePos[player.socketId].x - player.x;
    const dy = mousePos[player.socketId].y - player.y;
    const angle = Math.atan2(dy, dx);
    const tipDist = 10;
    const offset = player.stuckWithTriangle ? (player.radius + tipDist) : (player.radius + puck.radius + 5);
    puck.x = player.x + Math.cos(angle) * offset;
    puck.y = player.y + Math.sin(angle) * offset;
  }
}

io.on('connection', (socket) => {
  socket.on('updateObstacle', (obstacle) => {
    obstacles = obstacles.map(obs => obs.id === obstacle.id ? obstacle : obs);
    io.emit('obstacleUpdated', obstacle);
    console.log("Obstacle updated:", obstacle);
  });
});

io.on('connection', (socket) => {
  socket.on('openLevel', (data) => {
    mapWidth = data.mapDimensions.width;
    mapHeight = data.mapDimensions.height;
    goal1 = data.goal1;
    goal2 = data.goal2;
    obstacles = data.obstacles;
    io.emit('mapDimensions', { width: mapWidth, height: mapHeight });
    io.emit('updateGoals', { goal1, goal2 });
    io.emit('currentObstacles', obstacles);
    console.log("Server state updated from opened level:", data);
  });
});

io.on('connection', (socket) => {
  console.log("A player connected:", socket.id);

  socket.on('joinGame', () => {
    if (playerCount >= MAX_PLAYERS) {
      socket.emit('playerJoined', { success: false, message: 'Sorry, the lobby is full.' });
      console.log(`Player ${socket.id} attempted to join, but the lobby is full.`);
      return;
    }
    playerCount++;
    const playerNumber = assignPlayerNumber();
    const spawn = getSpawnPosition(playerNumber);
    players[socket.id] = {
      socketId: socket.id,
      id: socket.id,
      number: playerNumber,
      x: spawn.x,
      y: spawn.y,
      radius: 20,
      hasPuck: false,
      canJolt: true,
      speedModifier: 1,
      vx: 0,
      vy: 0,
      stuckWithTriangle: false
    };
    const message = `You are ${playerNumber.replace('player', 'Player ')}`;
    socket.emit('playerJoined', { success: true, message });
    socket.emit('currentPlayers', players);
    socket.emit('puckData', puck);
    socket.emit('mapDimensions', { width: mapWidth, height: mapHeight });
    socket.emit('updateGoals', { goal1, goal2 });
    socket.emit('currentObstacles', obstacles);
    io.emit('updateScore', score);
    socket.broadcast.emit('newPlayer', players[socket.id]);
    console.log(`Player ${socket.id} joined as ${playerNumber.replace('player', 'Player ')}`);

    socket.on('mouseMove', (position) => { mousePos[socket.id] = position; });

    socket.on('playerMovement', (movementData) => {
      const player = players[socket.id];
      if (!player) return;
      const acceleration = 0.3 * player.speedModifier;
      player.vx += movementData.dx * acceleration;
      player.vy += movementData.dy * acceleration;
    });

    socket.on('jolt', (data) => {
      const player = players[socket.id];
      if (!player || !player.canJolt || player.hasPuck) return;
      let dx = data.mousePos.x - player.x;
      let dy = data.mousePos.y - player.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) { dx /= len; dy /= len; }
      const joltSpeed = 7;
      player.vx += dx * joltSpeed;
      player.vy += dy * joltSpeed;
      player.speedModifier = 0.7;
      socket.emit('modifySpeed', player.speedModifier);
      setTimeout(() => {
        player.speedModifier = 1;
        socket.emit('modifySpeed', player.speedModifier);
      }, 1500);
      player.canJolt = false;
      setTimeout(() => { player.canJolt = true; }, 1000);
      console.log(`Player ${player.number.replace('player', 'Player ')} performed a jolt.`);
    });

    socket.on('shootPuck', (direction) => {
      const player = players[socket.id];
      if (player && puck.heldBy === player.number) {
        puck.vx = direction.vx;
        puck.vy = direction.vy;
        puck.heldBy = null;
        player.hasPuck = false;
        player.stuckWithTriangle = false;
        socket.emit('puckPossession', { hasPuck: false });
        io.emit('puckShot', puck);
        console.log(`Player ${player.number.replace('player', 'Player ')} shot the puck.`);
      }
    });

    socket.on('stickPuck', () => {
      const player = players[socket.id];
      if (player && !player.hasPuck && !puck.heldBy) {
        player.hasPuck = true;
        player.stuckWithTriangle = true;
        puck.heldBy = player.number;
        socket.emit('puckPossession', { hasPuck: true });
        console.log(`Player ${player.number} picked up the puck via triangle collision.`);
      }
    });

    socket.on('addObstacle', (obstacle) => {
      obstacle.id = obstacleIdCounter++;
      obstacles.push(obstacle);
      io.emit('obstacleAdded', obstacle);
      console.log("Obstacle added:", obstacle);
    });
    socket.on('deleteObstacle', (obstacleId) => {
      obstacles = obstacles.filter(obs => obs.id !== obstacleId);
      io.emit('obstacleRemoved', obstacleId);
      console.log("Obstacle deleted:", obstacleId);
    });
    socket.on('updateMapDimensions', (data) => {
      mapWidth = data.width;
      mapHeight = data.height;
      io.emit('mapDimensions', { width: mapWidth, height: mapHeight });
      console.log("Map dimensions updated:", { width: mapWidth, height: mapHeight });
    });
    socket.on('updateLevelSettings', (data) => {
      mapWidth = data.mapDimensions.width;
      mapHeight = data.mapDimensions.height;
      goal1 = data.goal1;
      goal2 = data.goal2;
      io.emit('mapDimensions', { width: mapWidth, height: mapHeight });
      io.emit('updateGoals', { goal1, goal2 });
      console.log("Level settings updated:", data);
    });

    socket.on('disconnect', () => {
      console.log("Player disconnected:", socket.id);
      playerCount--;
      const disconnectedPlayer = players[socket.id];
      if (disconnectedPlayer) {
        if (puck.heldBy === disconnectedPlayer.number) puck.heldBy = null;
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
      }
    });
  });
});

setInterval(() => {
  if (!puck.heldBy) {
    puck.x += puck.vx;
    puck.y += puck.vy;
    puck.vx *= 0.99;
    puck.vy *= 0.99;
    const MAX_PUCK_SPEED = 15;
    let puckSpeed = Math.sqrt(puck.vx * puck.vx + puck.vy * puck.vy);
    if (puckSpeed > MAX_PUCK_SPEED) {
      const factor = MAX_PUCK_SPEED / puckSpeed;
      puck.vx *= factor;
      puck.vy *= factor;
    }
    if (!checkGoal()) {
      if (puck.x < puck.radius || puck.x > mapWidth - puck.radius) {
        puck.vx = -puck.vx;
        puck.x = Math.max(puck.radius, Math.min(puck.x, mapWidth - puck.radius));
      }
      if (puck.y < puck.radius || puck.y > mapHeight - puck.radius) {
        puck.vy = -puck.vy;
        puck.y = Math.max(puck.radius, Math.min(puck.y, mapHeight - puck.radius));
      }
      checkPuckPossession();
    }
  } else {
    updatePuckPosition(puck.heldBy);
  }
  checkPuckBumperCollision();
  checkPuckSpikeCollision();
  
  for (let id in players) {
    const player = players[id];
    player.x += player.vx;
    player.y += player.vy;
    player.vx *= 0.9;
    player.vy *= 0.9;
    const maxSpeed = 4.0;
    const speedMag = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
    if (speedMag > maxSpeed) {
      const factor = maxSpeed / speedMag;
      player.vx *= factor;
      player.vy *= factor;
    }
    player.x = Math.max(player.radius, Math.min(player.x, mapWidth - player.radius));
    player.y = Math.max(player.radius, Math.min(player.y, mapHeight - player.radius));
    for (let otherId in players) {
      if (otherId === id) continue;
      const otherPlayer = players[otherId];
      const d = distance(player, otherPlayer);
      const minDist = player.radius + otherPlayer.radius;
      if (d < minDist) {
        const overlap = (minDist - d) / 2;
        const nx = (player.x - otherPlayer.x) / d;
        const ny = (player.y - otherPlayer.y) / d;
        player.x += nx * overlap;
        player.y += ny * overlap;
        otherPlayer.x -= nx * overlap;
        otherPlayer.y -= ny * overlap;
        const damping = 0.5;
        const dvx = player.vx - otherPlayer.vx;
        const dvy = player.vy - otherPlayer.vy;
        player.vx -= (damping * dvx) / 2;
        player.vy -= (damping * dvy) / 2;
        otherPlayer.vx += (damping * dvx) / 2;
        otherPlayer.vy += (damping * dvy) / 2;
        io.emit('playerMoved', { id: id, x: player.x, y: player.y });
        io.emit('playerMoved', { id: otherId, x: otherPlayer.x, y: otherPlayer.y });
      }
    }
    checkObstacleCollisions(player);
    io.emit('playerMoved', { id: id, x: player.x, y: player.y });
    if (!player.hasPuck) {
      if (distance(player, puck) < player.radius + puck.radius + 5) {
        puck.heldBy = player.number;
        player.hasPuck = true;
        io.to(id).emit('puckPossession', { hasPuck: true });
        console.log(`Player ${player.number.replace('player', 'Player ')} picked up the puck.`);
      }
    }
  }
  io.emit('puckUpdate', puck);
}, FRAME_RATE);

server.listen(process.env.PORT || 3000, () => {
  console.log(`Server listening on port ${process.env.PORT || 3000}`);
});
