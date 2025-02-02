/* client.js */

// =======================
// Firebase Initialization
// =======================
var firebaseConfig = {
 apiKey: "AIzaSyDMJlfraZTCNDlit1dgJ4Z1MbLdLgGG1V8",
  authDomain: "cluster-825c6.firebaseapp.com",
  databaseURL: "https://cluster-825c6-default-rtdb.firebaseio.com",
  projectId: "cluster-825c6",
  storageBucket: "cluster-825c6.firebasestorage.app",
  messagingSenderId: "274663865161",
  appId: "1:274663865161:web:f8ff687b71efbe2b557898",
  measurementId: "G-KCM0ZSB341"
};
firebase.initializeApp(firebaseConfig);

let currentUser = null;

// -----------------------
// Firebase Auth Handlers
// -----------------------
const loginModal = document.getElementById('loginModal');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginButton = document.getElementById('loginButton');
const signupButton = document.getElementById('signupButton');
const loginError = document.getElementById('loginError');
const logoutButton = document.getElementById('logoutButton');
const welcomeMessage = document.getElementById('welcomeMessage');

loginButton.addEventListener('click', () => {
  const email = emailInput.value;
  const password = passwordInput.value;
  firebase.auth().signInWithEmailAndPassword(email, password)
    .then((userCredential) => { currentUser = userCredential.user; })
    .catch((error) => { loginError.textContent = error.message; });
});

signupButton.addEventListener('click', () => {
  const email = emailInput.value;
  const password = passwordInput.value;
  firebase.auth().createUserWithEmailAndPassword(email, password)
    .then((userCredential) => { currentUser = userCredential.user; })
    .catch((error) => { loginError.textContent = error.message; });
});

logoutButton.addEventListener('click', () => {
  firebase.auth().signOut().then(() => {
    currentUser = null;
    loginModal.style.display = 'flex';
    document.getElementById('topMenu').style.display = 'none';
  });
});

firebase.auth().onAuthStateChanged((user) => {
  if (user) {
    currentUser = user;
    loginModal.style.display = 'none';
    document.getElementById('topMenu').style.display = 'flex';
    welcomeMessage.textContent = `Welcome, ${user.email}`;
  } else {
    currentUser = null;
    loginModal.style.display = 'flex';
    document.getElementById('topMenu').style.display = 'none';
  }
});

// ====================
// Game & Level Editor
// ====================
const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const playButton = document.getElementById('playButton');
const scoreboard = document.getElementById('scoreboard');

// --- Game State ---
let mapDimensions = { width: 800, height: 600 };
let players = {};
let puck = { x: mapDimensions.width / 2, y: mapDimensions.height / 2, radius: 10 };
let localPlayerId = null;
let mousePos = { x: 0, y: 0 };
let isPlaying = false;
let score = { player1: 0, player2: 0 };

// --- Level Editor State ---
let obstacles = []; // set from server
let draggingNewObstacle = null;
let isDraggingBorder = false;
let draggingBorder = null;
let contextMenuObstacle = null;
let draggedObstacle = null;
// (Goal–dragging code remains unchanged.)
let draggedGoal = null;

let zoom = 1;
let offsetX = 0;
let offsetY = 0;
let isPanning = false;
let panStart = { x: 0, y: 0 };
let initialOffset = { x: 0, y: 0 };

// --- Goal Settings (movable red/blue goals) ---
let goal1 = { x: 0, y: (mapDimensions.height - 120) / 2, width: 10, height: 120, color: 'red' };
let goal2 = { x: mapDimensions.width - 10, y: (mapDimensions.height - 120) / 2, width: 10, height: 120, color: 'blue' };

const keys = {};
document.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; });
document.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

// --- Load Obstacle Images ---
const spikeImg = new Image();
spikeImg.src = "spike.png";
const bounceImg = new Image();
bounceImg.src = "bounce.png";
const boostImg = new Image();
boostImg.src = "boost.png";

// --- Palette Setup ---
const paletteSpike = document.getElementById('palette-spike');
const paletteBounce = document.getElementById('palette-bounce');
const paletteBoost = document.getElementById('palette-boost');

if (paletteSpike) {
  paletteSpike.addEventListener('mousedown', () => { draggingNewObstacle = { type: 'spike', radius: 20, x: 0, y: 0 }; });
}
if (paletteBounce) {
  paletteBounce.addEventListener('mousedown', () => { draggingNewObstacle = { type: 'bumper', radius: 20, x: 0, y: 0 }; });
}
if (paletteBoost) {
  paletteBoost.addEventListener('mousedown', () => { draggingNewObstacle = { type: 'booster', width: 50, height: 50, x: 0, y: 0 }; });
}

// --- Charge Shot Variables ---
let isChargingShot = false;
let shotChargeStartTime = null;

// --- Utility Functions ---
function toWorldCoords(x, y) {
  return { x: (x - offsetX) / zoom, y: (y - offsetY) / zoom };
}
function distance(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// --------------------------
// Unified Mousedown Handler
// --------------------------
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX;
  const mouseY = e.clientY;
  const leftBorderScreen = offsetX;
  const rightBorderScreen = offsetX + mapDimensions.width * zoom;
  const topBorderScreen = offsetY;
  const bottomBorderScreen = offsetY + mapDimensions.height * zoom;
  
  // If clicking near a border, start border dragging.
  if (Math.abs(mouseX - leftBorderScreen) < 10 ||
      Math.abs(mouseX - rightBorderScreen) < 10 ||
      Math.abs(mouseY - topBorderScreen) < 10 ||
      Math.abs(mouseY - bottomBorderScreen) < 10) {
    isDraggingBorder = true;
    if (Math.abs(mouseX - leftBorderScreen) < 10) draggingBorder = 'left';
    else if (Math.abs(mouseX - rightBorderScreen) < 10) draggingBorder = 'right';
    else if (Math.abs(mouseY - topBorderScreen) < 10) draggingBorder = 'top';
    else if (Math.abs(mouseY - bottomBorderScreen) < 10) draggingBorder = 'bottom';
    return;
  }
  
  const worldPos = toWorldCoords(mouseX - rect.left, mouseY - rect.top);
  
  // If clicking on local player's character:
  if (players[localPlayerId]) {
    const local = players[localPlayerId];
    if (distance(worldPos, {x: local.x, y: local.y}) < local.radius * 1.5) {
      if (local.hasPuck) {
        // Start charging shot.
        isChargingShot = true;
        shotChargeStartTime = Date.now();
        return;
      } else {
        socket.emit('jolt', { mousePos });
      }
    }
  }
  
  // Otherwise, start panning.
  isPanning = true;
  panStart = { x: e.clientX, y: e.clientY };
  initialOffset = { x: offsetX, y: offsetY };
});

// --------------------------
// Mouseup Handler (and end of dragging)
canvas.addEventListener('mouseup', (e) => {
  if (draggingNewObstacle) {
    socket.emit('addObstacle', draggingNewObstacle);
    draggingNewObstacle = null;
  }
  if (isDraggingBorder) {
    isDraggingBorder = false;
    draggingBorder = null;
  }
  if (isPanning) { isPanning = false; }
  if (draggedObstacle) {
    socket.emit('updateObstacle', draggedObstacle);
    draggedObstacle = null;
  }
  // If the user was charging a shot, fire the puck.
  if (isPlaying && isChargingShot) {
    const chargeDuration = Date.now() - shotChargeStartTime;
    const maxChargeTime = 2000;
    const clampedCharge = Math.min(chargeDuration, maxChargeTime);
    const baseSpeed = 7;
    const maxExtraSpeed = 20;
    const chargeSpeed = baseSpeed + (clampedCharge / maxChargeTime) * maxExtraSpeed;
    const player = players[localPlayerId];
    if (player) {
      const dx = mousePos.x - player.x;
      const dy = mousePos.y - player.y;
      const angle = Math.atan2(dy, dx);
      const vx = chargeSpeed * Math.cos(angle);
      const vy = chargeSpeed * Math.sin(angle);
      socket.emit('shootPuck', { vx, vy });
      console.log(`Charged shot for ${clampedCharge}ms, shooting puck with velocity (${vx.toFixed(2)}, ${vy.toFixed(2)})`);
    }
    isChargingShot = false;
    shotChargeStartTime = null;
  }
  
  // If a goal was being dragged, send the updated settings.
  if (draggedGoal) {
    socket.emit('updateLevelSettings', { mapDimensions, goal1, goal2 });
    draggedGoal = null;
  }
});

// --------------------------
// Other Mouse Event Listeners
// --------------------------
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const canvasX = e.clientX - rect.left;
  const canvasY = e.clientY - rect.top;
  
  if (isPanning) {
    offsetX = initialOffset.x + (e.clientX - panStart.x);
    offsetY = initialOffset.y + (e.clientY - panStart.y);
  }
  
  const worldPos = toWorldCoords(canvasX, canvasY);
  mousePos = worldPos;
  
  if (isPlaying) socket.emit('mouseMove', { x: worldPos.x, y: worldPos.y });
  if (draggingNewObstacle) {
    draggingNewObstacle.x = worldPos.x;
    draggingNewObstacle.y = worldPos.y;
  }
  if (isDraggingBorder && draggingBorder) {
    if (draggingBorder === 'left' || draggingBorder === 'right')
      mapDimensions.width = Math.max(worldPos.x, 200);
    else if (draggingBorder === 'top' || draggingBorder === 'bottom')
      mapDimensions.height = Math.max(worldPos.y, 200);
    socket.emit('updateMapDimensions', mapDimensions);
  }
  if (draggedObstacle) {
    draggedObstacle.x = worldPos.x;
    draggedObstacle.y = worldPos.y;
  }
  // If dragging a goal, update its position (centered on the cursor).
  if (draggedGoal) {
    if (draggedGoal === 'goal1') {
      goal1.x = worldPos.x - goal1.width / 2;
      goal1.y = worldPos.y - goal1.height / 2;
    } else if (draggedGoal === 'goal2') {
      goal2.x = worldPos.x - goal2.width / 2;
      goal2.y = worldPos.y - goal2.height / 2;
    }
  }
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const worldPosBefore = { x: (mouseX - offsetX) / zoom, y: (mouseY - offsetY) / zoom };
  zoom = (e.deltaY < 0) ? zoom * 1.1 : zoom * 0.9;
  offsetX = mouseX - zoom * worldPosBefore.x;
  offsetY = mouseY - zoom * worldPosBefore.y;
});

// ---- Double-Click Handler ----
// If the user double-clicks on a goal, begin dragging it;
// otherwise, check obstacles.
canvas.addEventListener('dblclick', (e) => {
  const rect = canvas.getBoundingClientRect();
  const worldPos = toWorldCoords(e.clientX - rect.left, e.clientY - rect.top);
  // Check goal1:
  if (worldPos.x >= goal1.x && worldPos.x <= goal1.x + goal1.width &&
      worldPos.y >= goal1.y && worldPos.y <= goal1.y + goal1.height) {
    draggedGoal = 'goal1';
    return;
  }
  // Check goal2:
  if (worldPos.x >= goal2.x && worldPos.x <= goal2.x + goal2.width &&
      worldPos.y >= goal2.y && worldPos.y <= goal2.y + goal2.height) {
    draggedGoal = 'goal2';
    return;
  }
  // Otherwise, check obstacles:
  for (let obs of obstacles) {
    if (obs.type === 'booster') {
      if (worldPos.x >= obs.x && worldPos.x <= obs.x + obs.width &&
          worldPos.y >= obs.y && worldPos.y <= obs.y + obs.height) { draggedObstacle = obs; return; }
    } else {
      if (distance(worldPos, obs) < obs.radius) { draggedObstacle = obs; return; }
    }
  }
});

// ---- Custom Context Menu ----
const contextMenu = document.createElement('div');
contextMenu.style.position = 'absolute';
contextMenu.style.background = '#fff';
contextMenu.style.border = '1px solid #000';
contextMenu.style.padding = '5px';
contextMenu.style.display = 'none';
contextMenu.innerHTML = '<div id="deleteOption">Delete</div>';
document.body.appendChild(contextMenu);
document.getElementById('deleteOption').addEventListener('click', () => {
  if (contextMenuObstacle) {
    socket.emit('deleteObstacle', contextMenuObstacle.id);
    obstacles = obstacles.filter((obs) => obs.id !== contextMenuObstacle.id);
    contextMenuObstacle = null;
    hideContextMenu();
  }
});
function showContextMenu(x, y) {
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.style.display = 'block';
}
function hideContextMenu() { contextMenu.style.display = 'none'; }

// --------------------
// Play Button Handler
// --------------------
playButton.addEventListener('click', () => {
  socket.emit('joinGame');
  console.log("Join game requested.");
});

// ------------------------
// Socket Event Handlers
// ------------------------
socket.on('playerJoined', (data) => {
  if (data.success) {
    localPlayerId = socket.id;
    playButton.style.display = 'none';
    canvas.style.display = 'block';
    alert(data.message);
    isPlaying = true;
    console.log(`Joined game as ${data.message}`);
  } else {
    alert(data.message);
    console.log(`Join game failed: ${data.message}`);
  }
});
socket.on('puckPossession', (data) => {
  const player = players[localPlayerId];
  if (player) { player.hasPuck = data.hasPuck; console.log(`Puck possession: ${data.hasPuck ? 'Yes' : 'No'}`); }
});
socket.on('currentPlayers', (serverPlayers) => { players = serverPlayers; if (!localPlayerId) localPlayerId = socket.id; console.log("Current players:", players); });
socket.on('newPlayer', (newPlayer) => { players[newPlayer.id] = newPlayer; console.log(`New player: ${newPlayer.number.replace('player', 'Player ')}`); });
socket.on('playerMoved', (playerData) => { if (players[playerData.id]) { players[playerData.id].x = playerData.x; players[playerData.id].y = playerData.y; } });
socket.on('playerDisconnected', (playerId) => { if (players[playerId]) { console.log(`Player ${players[playerId].number.replace('player', '')} disconnected.`); delete players[playerId]; } });
socket.on('puckData', (serverPuck) => { puck = serverPuck; console.log("Initial puck data received:", puck); });
socket.on('puckShot', (serverPuck) => { puck = serverPuck; console.log("Puck was shot:", puck); });
socket.on('puckUpdate', (updatedPuck) => { puck = updatedPuck; });
socket.on('updateScore', (newScore) => {
  score = newScore;
  scoreboard.textContent = `Player 1: ${score.player1} | Player 2: ${score.player2}`;
  console.log("Score updated:", score);
});
socket.on('gameOver', (winner) => {
  alert(`${winner} won the game!`);
  console.log(`Game over! ${winner} won.`);
  location.reload();
});
socket.on('modifySpeed', (modifier) => { });
socket.on('mapDimensions', (data) => { mapDimensions = data; });
socket.on('updateGoals', (data) => { goal1 = data.goal1; goal2 = data.goal2; });
socket.on('currentObstacles', (obsArray) => { obstacles = obsArray; });
socket.on('obstacleAdded', (obs) => { obstacles.push(obs); });
socket.on('obstacleRemoved', (obsId) => { obstacles = obstacles.filter((obs) => obs.id !== obsId); });
socket.on('obstacleUpdated', (obs) => { obstacles = obstacles.map(o => o.id === obs.id ? obs : o); });

// ---------------------------
// Movement and Drawing
// ---------------------------
function handleMovement() {
  let dx = 0, dy = 0;
  const speed = 1;
  if (keys['w']) dy = -speed;
  if (keys['s']) dy = speed;
  if (keys['a']) dx = -speed;
  if (keys['d']) dx = speed;
  if (dx || dy) socket.emit('playerMovement', { dx, dy });
}

function draw() {
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Apply pan & zoom.
  ctx.translate(offsetX, offsetY);
  ctx.scale(zoom, zoom);

  // Draw map border.
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'black';
  ctx.strokeRect(0, 0, mapDimensions.width, mapDimensions.height);
  
  // Draw movable goals.
  ctx.fillStyle = goal1.color;
  ctx.fillRect(goal1.x, goal1.y, goal1.width, goal1.height);
  ctx.fillStyle = goal2.color;
  ctx.fillRect(goal2.x, goal2.y, goal2.width, goal2.height);
  
  // Draw obstacles using images.
  obstacles.forEach((obs) => {
    if (obs.type === 'spike') {
      ctx.drawImage(spikeImg, obs.x - obs.radius, obs.y - obs.radius, obs.radius * 2, obs.radius * 2);
    } else if (obs.type === 'bumper') {
      ctx.drawImage(bounceImg, obs.x - obs.radius, obs.y - obs.radius, obs.radius * 2, obs.radius * 2);
    } else if (obs.type === 'booster') {
      ctx.drawImage(boostImg, obs.x, obs.y, obs.width, obs.height);
    }
  });

  if (draggedObstacle) {
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 3;
    if (draggedObstacle.type === 'booster') {
      ctx.strokeRect(draggedObstacle.x, draggedObstacle.y, draggedObstacle.width, draggedObstacle.height);
    } else {
      ctx.beginPath();
      ctx.arc(draggedObstacle.x, draggedObstacle.y, draggedObstacle.radius, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }

  // Draw players.
  for (let id in players) {
    const player = players[id];
    ctx.fillStyle = (player.id === localPlayerId) ? 'green' : 'blue';
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.radius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(player.number.replace('player', 'P'), player.x, player.y);
  }

  // Draw the puck.
  ctx.fillStyle = 'red';
  ctx.beginPath();
  ctx.arc(puck.x, puck.y, puck.radius, 0, 2 * Math.PI);
  ctx.fill();

  // ---- Classic Blue Charge-Up Ring ----
  if (isChargingShot && players[localPlayerId]) {
    const player = players[localPlayerId];
    const elapsed = Date.now() - shotChargeStartTime;
    const maxChargeTime = 2000;
    const maxRingRadius = player.radius + 5;
    const ringRadius = Math.min((elapsed / maxChargeTime) * maxRingRadius, maxRingRadius);
    ctx.strokeStyle = 'blue';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(player.x, player.y, ringRadius, 0, 2 * Math.PI);
    ctx.stroke();
  }

  // ---- Directional Triangle (aim indicator) ----
  if (localPlayerId && players[localPlayerId]) {
    const player = players[localPlayerId];
    const angle = Math.atan2(mousePos.y - player.y, mousePos.x - player.x);
    const r = player.radius;
    const tipDist = 10;
    const baseCenter = { x: player.x + r * Math.cos(angle), y: player.y + r * Math.sin(angle) };
    const tip = { x: player.x + (r + tipDist) * Math.cos(angle), y: player.y + (r + tipDist) * Math.sin(angle) };
    const halfWidth = 5;
    const perp = { x: -Math.sin(angle), y: Math.cos(angle) };
    const baseLeft = { x: baseCenter.x + halfWidth * perp.x, y: baseCenter.y + halfWidth * perp.y };
    const baseRight = { x: baseCenter.x - halfWidth * perp.x, y: baseCenter.y - halfWidth * perp.y };
    ctx.fillStyle = 'black';
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(baseLeft.x, baseLeft.y);
    ctx.lineTo(baseRight.x, baseRight.y);
    ctx.closePath();
    ctx.fill();

    // Check for triangle collision with puck.
    if (!player.hasPuck && !puck.heldBy && distance(tip, puck) < 15) {
      socket.emit('stickPuck');
    }
  }

  if (draggingNewObstacle) {
    if (draggingNewObstacle.type === 'spike') {
      ctx.drawImage(spikeImg, draggingNewObstacle.x - draggingNewObstacle.radius, draggingNewObstacle.y - draggingNewObstacle.radius, draggingNewObstacle.radius * 2, draggingNewObstacle.radius * 2);
    } else if (draggingNewObstacle.type === 'bumper') {
      ctx.drawImage(bounceImg, draggingNewObstacle.x - draggingNewObstacle.radius, draggingNewObstacle.y - draggingNewObstacle.radius, draggingNewObstacle.radius * 2, draggingNewObstacle.radius * 2);
    } else if (draggingNewObstacle.type === 'booster') {
      ctx.drawImage(boostImg, draggingNewObstacle.x, draggingNewObstacle.y, draggingNewObstacle.width, draggingNewObstacle.height);
    }
  }
  
  ctx.restore();
}

function gameLoop() {
  if (isPlaying) { handleMovement(); draw(); }
  requestAnimationFrame(gameLoop);
}
gameLoop();

// ---- Save, Library, and Settings Functionality ----
const saveButton = document.getElementById('saveButton');
const libraryButton = document.getElementById('libraryButton');
const settingsButton = document.getElementById('settingsButton');

saveButton.addEventListener('click', () => {
  if (!currentUser) { alert("You must be logged in to save levels."); return; }
  const levelName = prompt("Enter a name for your level:");
  if (!levelName) return;
  const levelData = { name: levelName, mapDimensions, goal1, goal2, obstacles };
  firebase.database().ref('levels/' + currentUser.uid).push(levelData)
    .then(() => { alert("Level saved successfully!"); })
    .catch((error) => { alert("Error saving level: " + error.message); });
});

const libraryModal = document.getElementById('libraryModal');
const levelsList = document.getElementById('levelsList');
const closeLibraryButton = document.getElementById('closeLibraryButton');

libraryButton.addEventListener('click', () => {
  if (!currentUser) { alert("You must be logged in to view your library."); return; }
  firebase.database().ref('levels/' + currentUser.uid).once('value').then(snapshot => {
    levelsList.innerHTML = "";
    snapshot.forEach(childSnapshot => {
      const levelKey = childSnapshot.key;
      const level = childSnapshot.val();
      const levelDiv = document.createElement('div');
      levelDiv.style.border = "1px solid #000";
      levelDiv.style.margin = "5px";
      levelDiv.style.padding = "5px";
      levelDiv.innerHTML = `<strong>${level.name}</strong>`;
      const openButton = document.createElement('button');
      openButton.textContent = "Open";
      openButton.addEventListener('click', () => {
        mapDimensions = level.mapDimensions;
        goal1 = level.goal1;
        goal2 = level.goal2;
        obstacles = level.obstacles;
        socket.emit('updateMapDimensions', mapDimensions);
        socket.emit('updateGoals', { goal1, goal2 });
        libraryModal.style.display = "none";
      });
      const deleteButton = document.createElement('button');
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener('click', () => {
        if (confirm("Are you sure you want to delete this level?")) {
          firebase.database().ref('levels/' + currentUser.uid + '/' + levelKey).remove();
          levelDiv.remove();
        }
      });
      levelDiv.appendChild(openButton);
      levelDiv.appendChild(deleteButton);
      levelsList.appendChild(levelDiv);
    });
    libraryModal.style.display = "flex";
  });
});

closeLibraryButton.addEventListener('click', () => { libraryModal.style.display = "none"; });

const settingsModal = document.getElementById('settingsModal');
const closeSettingsButton = document.getElementById('closeSettingsButton');
const saveSettingsButton = document.getElementById('saveSettingsButton');

settingsButton.addEventListener('click', () => {
  document.getElementById('settingMapWidth').value = mapDimensions.width;
  document.getElementById('settingMapHeight').value = mapDimensions.height;
  document.getElementById('settingGoal1X').value = goal1.x;
  document.getElementById('settingGoal1Y').value = goal1.y;
  document.getElementById('settingGoal1Width').value = goal1.width;
  document.getElementById('settingGoal1Height').value = goal1.height;
  document.getElementById('settingGoal2X').value = goal2.x;
  document.getElementById('settingGoal2Y').value = goal2.y;
  document.getElementById('settingGoal2Width').value = goal2.width;
  document.getElementById('settingGoal2Height').value = goal2.height;
  settingsModal.style.display = "flex";
});

closeSettingsButton.addEventListener('click', () => { settingsModal.style.display = "none"; });

saveSettingsButton.addEventListener('click', () => {
  mapDimensions.width = Number(document.getElementById('settingMapWidth').value);
  mapDimensions.height = Number(document.getElementById('settingMapHeight').value);
  goal1.x = Number(document.getElementById('settingGoal1X').value);
  goal1.y = Number(document.getElementById('settingGoal1Y').value);
  goal1.width = Number(document.getElementById('settingGoal1Width').value);
  goal1.height = Number(document.getElementById('settingGoal1Height').value);
  goal2.x = Number(document.getElementById('settingGoal2X').value);
  goal2.y = Number(document.getElementById('settingGoal2Y').value);
  goal2.width = Number(document.getElementById('settingGoal2Width').value);
  goal2.height = Number(document.getElementById('settingGoal2Height').value);
  socket.emit('updateLevelSettings', { mapDimensions, goal1, goal2 });
  settingsModal.style.display = "none";
});
