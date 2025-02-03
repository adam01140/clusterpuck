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

// --- Global Variables ---
// Declare mapDimensions before use.
let mapDimensions = { width: 0, height: 0 };

function resizeCanvas() {
  // Make the canvas a little less wide than the screen:
  canvas.width = window.innerWidth - 150;
  canvas.height = window.innerHeight - 150;
  mapDimensions.width = canvas.width;
  mapDimensions.height = canvas.height;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// --- Game State ---
let players = {};
let puck = { x: mapDimensions.width/2, y: mapDimensions.height/2, radius: 10 };
let localPlayerId = null;
let mousePos = { x: 0, y: 0 };
let isPlaying = false;
let score = { player1: 0, player2: 0 };

// --- Level Editor State ---
let obstacles = []; // set from server
let draggingNewObstacle = null;
let contextMenuObstacle = null;
let draggedObstacle = null;
let draggedGoal = null;  // for dragging goals

// --- Save/Load behavior ---
let currentLevelKey = null; // if opened from library, update that level

// --- Palette Settings (defaults for new obstacles) ---
let paletteSettings = {
  spikeRadius: 20,
  bumperRadius: 20,
  boosterWidth: 50,
  boosterHeight: 50
};

let zoom = 1;
let offsetX = 0;
let offsetY = 0;
let isPanning = false;
let panStart = { x: 0, y: 0 };
let initialOffset = { x: 0, y: 0 };

// --- Grid Settings ---
const gridSpacing = 20;
let gridVisible = true; // Toggle via settings

// --- Goal Settings (movable red/blue goals) ---
let goal1 = { x: 0, y: Math.round((mapDimensions.height - 120)/2), width: 10, height: 120, color: 'red' };
let goal2 = { x: mapDimensions.width - 10, y: Math.round((mapDimensions.height - 120)/2), width: 10, height: 120, color: 'blue' };

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

// --- Load Player Sprites ---
const playerImg = new Image();
playerImg.src = "player.png";      // for player1
const player2Img = new Image();
player2Img.src = "player2.png";      // for player2

// --- Create a Checkered Pattern for the Puck ---
const patternCanvas = document.createElement('canvas');
patternCanvas.width = 10;
patternCanvas.height = 10;
const pctx = patternCanvas.getContext('2d');
pctx.fillStyle = 'white';
pctx.fillRect(0, 0, 10, 10);
pctx.fillStyle = 'black';
pctx.fillRect(0, 0, 5, 5);
pctx.fillRect(5, 5, 5, 5);
const puckPattern = ctx.createPattern(patternCanvas, 'repeat');

// --- Palette Setup ---
const paletteSpike = document.getElementById('palette-spike');
const paletteBounce = document.getElementById('palette-bounce');
const paletteBoost = document.getElementById('palette-boost');
const paletteWall = document.getElementById('palette-wall');

if (paletteSpike) {
  paletteSpike.addEventListener('mousedown', () => {
    draggingNewObstacle = { type: 'spike', radius: paletteSettings.spikeRadius, x: 0, y: 0 };
  });
  paletteSpike.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    let newRadius = prompt("Enter new default spike radius:", paletteSettings.spikeRadius);
    if (newRadius !== null) paletteSettings.spikeRadius = Math.round(Number(newRadius));
  });
}
if (paletteBounce) {
  paletteBounce.addEventListener('mousedown', () => {
    draggingNewObstacle = { type: 'bumper', radius: paletteSettings.bumperRadius, x: 0, y: 0 };
  });
  paletteBounce.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    let newRadius = prompt("Enter new default bumper radius:", paletteSettings.bumperRadius);
    if (newRadius !== null) paletteSettings.bumperRadius = Math.round(Number(newRadius));
  });
}
if (paletteBoost) {
  paletteBoost.addEventListener('mousedown', () => {
    draggingNewObstacle = { type: 'booster', width: paletteSettings.boosterWidth, height: paletteSettings.boosterHeight, x: 0, y: 0 };
  });
  paletteBoost.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    let newWidth = prompt("Enter new default booster width:", paletteSettings.boosterWidth);
    let newHeight = prompt("Enter new default booster height:", paletteSettings.boosterHeight);
    if (newWidth !== null && newHeight !== null) {
      paletteSettings.boosterWidth = Math.round(Number(newWidth));
      paletteSettings.boosterHeight = Math.round(Number(newHeight));
    }
  });
}
if (paletteWall) {
  paletteWall.addEventListener('mousedown', () => {
    // Wall: one grid unit long and very thin.
    draggingNewObstacle = { type: 'wall', width: gridSpacing, height: 5, rotation: 0, x: 0, y: 0 };
  });
  paletteWall.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (draggingNewObstacle && draggingNewObstacle.type === 'wall') {
      const temp = draggingNewObstacle.width;
      draggingNewObstacle.width = draggingNewObstacle.height;
      draggingNewObstacle.height = temp;
      draggingNewObstacle.rotation = (draggingNewObstacle.rotation + 90) % 180;
    }
  });
}

// --- Charge Shot Variables ---
let isChargingShot = false;
let shotChargeStartTime = null;

// --- Prevent Immediate Pickup After Shooting ---
let justShot = false;

// --- Utility Functions ---
function toWorldCoords(x, y) {
  return { x: (x - offsetX) / zoom, y: (y - offsetY) / zoom };
}
function snapToGrid(val) {
  return Math.round(val / gridSpacing) * gridSpacing;
}
function distance(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// --------------------------
// Draw Grid Function
// --------------------------
function drawGrid() {
  ctx.save();
  ctx.strokeStyle = "#ddd";
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= mapDimensions.width; x += gridSpacing) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, mapDimensions.height);
    ctx.stroke();
  }
  for (let y = 0; y <= mapDimensions.height; y += gridSpacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(mapDimensions.width, y);
    ctx.stroke();
  }
  ctx.restore();
}

// --------------------------
// Unified Mousedown Handler
// --------------------------
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX;
  const mouseY = e.clientY;
  const worldPos = toWorldCoords(mouseX - rect.left, mouseY - rect.top);
  
  if (players[localPlayerId] && players[localPlayerId].hasPuck) {
    isChargingShot = true;
    shotChargeStartTime = Date.now();
    return;
  }
  
  if (players[localPlayerId]) {
    const local = players[localPlayerId];
    if (distance(worldPos, { x: local.x, y: local.y }) < local.radius * 1.5) {
      socket.emit('jolt', { mousePos });
      return;
    }
  }
  
  isPanning = true;
  panStart = { x: e.clientX, y: e.clientY };
  initialOffset = { x: offsetX, y: offsetY };
});

// --------------------------
// Mouseup Handler
// --------------------------
canvas.addEventListener('mouseup', (e) => {
  if (draggingNewObstacle) {
    // Snap the new obstacle position to the grid.
    draggingNewObstacle.x = snapToGrid(draggingNewObstacle.x);
    draggingNewObstacle.y = snapToGrid(draggingNewObstacle.y);
    socket.emit('addObstacle', draggingNewObstacle);
    // Do NOT clear draggingNewObstacle so the user may place more instances.
  }
  if (isPanning) {
    offsetX = snapToGrid(offsetX);
    offsetY = snapToGrid(offsetY);
    isPanning = false;
  }
  if (draggedObstacle) {
    draggedObstacle.x = snapToGrid(draggedObstacle.x);
    draggedObstacle.y = snapToGrid(draggedObstacle.y);
    socket.emit('updateObstacle', draggedObstacle);
    draggedObstacle = null;
  }
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
      justShot = true;
      setTimeout(() => { justShot = false; }, 1000);
    }
    isChargingShot = false;
    shotChargeStartTime = null;
  }
  if (draggedGoal) {
    if (draggedGoal === 'goal1') {
      goal1.x = snapToGrid(goal1.x);
      goal1.y = snapToGrid(goal1.y);
    } else if (draggedGoal === 'goal2') {
      goal2.x = snapToGrid(goal2.x);
      goal2.y = snapToGrid(goal2.y);
    }
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
  
  if (draggingNewObstacle) {
    draggingNewObstacle.x = snapToGrid(worldPos.x);
    draggingNewObstacle.y = snapToGrid(worldPos.y);
  }
  if (draggedObstacle) {
    draggedObstacle.x = snapToGrid(worldPos.x);
    draggedObstacle.y = snapToGrid(worldPos.y);
  }
  if (draggedGoal) {
    if (draggedGoal === 'goal1') {
      goal1.x = snapToGrid(worldPos.x - goal1.width / 2);
      goal1.y = snapToGrid(worldPos.y - goal1.height / 2);
    } else if (draggedGoal === 'goal2') {
      goal2.x = snapToGrid(worldPos.x - goal2.width / 2);
      goal2.y = snapToGrid(worldPos.y - goal2.height / 2);
    }
  }
  
  mousePos = worldPos;
  if (isPlaying) socket.emit('mouseMove', { x: worldPos.x, y: worldPos.y });
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
canvas.addEventListener('dblclick', (e) => {
  const rect = canvas.getBoundingClientRect();
  const worldPos = toWorldCoords(e.clientX - rect.left, e.clientY - rect.top);
  if (worldPos.x >= goal1.x && worldPos.x <= goal1.x + goal1.width &&
      worldPos.y >= goal1.y && worldPos.y <= goal1.y + goal1.height) {
    draggedGoal = 'goal1';
    return;
  }
  if (worldPos.x >= goal2.x && worldPos.x <= goal2.x + goal2.width &&
      worldPos.y >= goal2.y && worldPos.y <= goal2.y + goal2.height) {
    draggedGoal = 'goal2';
    return;
  }
  for (let obs of obstacles) {
    if (obs.type === 'booster') {
      if (worldPos.x >= obs.x && worldPos.x <= obs.x + obs.width &&
          worldPos.y >= obs.y && worldPos.y <= obs.y + obs.height) { draggedObstacle = obs; return; }
    } else {
      if (distance(worldPos, obs) < obs.radius) { draggedObstacle = obs; return; }
    }
  }
});

// ---- Draw Function ----
function draw() {
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  if (gridVisible) drawGrid();
  
  ctx.translate(offsetX, offsetY);
  ctx.scale(zoom, zoom);

  ctx.lineWidth = 5;
  ctx.strokeStyle = 'black';
  ctx.strokeRect(0, 0, mapDimensions.width, mapDimensions.height);
  
  ctx.fillStyle = goal1.color;
  ctx.fillRect(goal1.x, goal1.y, goal1.width, goal1.height);
  ctx.fillStyle = goal2.color;
  ctx.fillRect(goal2.x, goal2.y, goal2.width, goal2.height);
  
  obstacles.forEach((obs) => {
    if (obs.type === 'spike') {
      ctx.drawImage(spikeImg, obs.x - obs.radius, obs.y - obs.radius, obs.radius * 2, obs.radius * 2);
    } else if (obs.type === 'bumper') {
      ctx.drawImage(bounceImg, obs.x - obs.radius, obs.y - obs.radius, obs.radius * 2, obs.radius * 2);
    } else if (obs.type === 'booster') {
      ctx.drawImage(boostImg, obs.x, obs.y, obs.width, obs.height);
    } else if (obs.type === 'wall') {
      ctx.save();
      ctx.translate(obs.x + obs.width/2, obs.y + obs.height/2);
      ctx.rotate(obs.rotation * Math.PI/180);
      ctx.fillStyle = 'gray';
      ctx.fillRect(-obs.width/2, -obs.height/2, obs.width, obs.height);
      ctx.restore();
    }
  });

  if (draggedObstacle) {
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 3;
    if (draggedObstacle.type === 'booster') {
      ctx.strokeRect(draggedObstacle.x, draggedObstacle.y, draggedObstacle.width, draggedObstacle.height);
    } else if (draggedObstacle.type === 'wall') {
      ctx.save();
      ctx.translate(draggedObstacle.x + draggedObstacle.width/2, draggedObstacle.y + draggedObstacle.height/2);
      ctx.rotate(draggedObstacle.rotation * Math.PI/180);
      ctx.strokeRect(-draggedObstacle.width/2, -draggedObstacle.height/2, draggedObstacle.width, draggedObstacle.height);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(draggedObstacle.x, draggedObstacle.y, draggedObstacle.radius, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }

  for (let id in players) {
    const player = players[id];
    if (player.number === "player1") {
      ctx.drawImage(playerImg, player.x - player.radius, player.y - player.radius, player.radius*2, player.radius*2);
    } else if (player.number === "player2") {
      ctx.drawImage(player2Img, player.x - player.radius, player.y - player.radius, player.radius*2, player.radius*2);
    } else {
      ctx.fillStyle = (player.id === localPlayerId) ? 'green' : 'blue';
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.radius, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.fillStyle = 'white';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(player.number.replace('player', 'P'), player.x, player.y);
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(puck.x, puck.y, puck.radius, 0, 2 * Math.PI);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = puckPattern;
  ctx.fillRect(puck.x - puck.radius, puck.y - puck.radius, puck.radius*2, puck.radius*2);
  ctx.restore();
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(puck.x, puck.y, puck.radius, 0, 2 * Math.PI);
  ctx.stroke();

  if (isChargingShot && players[localPlayerId]) {
    const player = players[localPlayerId];
    const elapsed = Date.now() - shotChargeStartTime;
    const maxChargeTime = 2000;
    const maxRingRadius = player.radius + 10;
    const ringRadius = Math.min((elapsed / maxChargeTime) * maxRingRadius, maxRingRadius);
    let ringColor = 'black';
    if (player.number === 'player1') ringColor = 'darkred';
    else if (player.number === 'player2') ringColor = 'darkblue';
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(player.x, player.y, ringRadius, 0, 2 * Math.PI);
    ctx.stroke();
  }

  if (!justShot && localPlayerId && players[localPlayerId]) {
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
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(baseLeft.x, baseLeft.y);
    ctx.lineTo(baseRight.x, baseRight.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.stroke();
    
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
    } else if (draggingNewObstacle.type === 'wall') {
      ctx.save();
      ctx.translate(draggingNewObstacle.x + draggingNewObstacle.width/2, draggingNewObstacle.y + draggingNewObstacle.height/2);
      ctx.rotate(draggingNewObstacle.rotation * Math.PI/180);
      ctx.fillStyle = 'gray';
      ctx.fillRect(-draggingNewObstacle.width/2, -draggingNewObstacle.height/2, draggingNewObstacle.width, draggingNewObstacle.height);
      ctx.restore();
    }
  }
  
  ctx.restore();
}

function gameLoop() {
  if (isPlaying) { 
    handleMovement();
    draw(); 
  }
  requestAnimationFrame(gameLoop);
}
gameLoop();

function handleMovement() {
  let dx = 0, dy = 0;
  const speed = 1;
  if (keys['w']) dy = -speed;
  if (keys['s']) dy = speed;
  if (keys['a']) dx = -speed;
  if (keys['d']) dx = speed;
  if (dx || dy) socket.emit('playerMovement', { dx, dy });
}

// ---- Context Menu for Delete, Transform & Rotate ----
const contextMenu = document.createElement('div');
contextMenu.style.position = 'absolute';
contextMenu.style.background = '#fff';
contextMenu.style.border = '1px solid #000';
contextMenu.style.padding = '5px';
contextMenu.style.display = 'none';
contextMenu.style.borderRadius = '4px';
contextMenu.innerHTML = 
  '<div id="deleteOption" style="padding:4px;cursor:pointer;">Delete</div>' +
  '<div id="transformOption" style="padding:4px;cursor:pointer;">Transform</div>' +
  '<div id="rotateOption" style="padding:4px;cursor:pointer;display:none;">Rotate</div>';
document.body.appendChild(contextMenu);

function showContextMenu(x, y) {
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.style.display = 'block';
}
function hideContextMenu() { contextMenu.style.display = 'none'; }

const deleteOption = document.getElementById('deleteOption');
const transformOption = document.getElementById('transformOption');
const rotateOption = document.getElementById('rotateOption');

deleteOption.addEventListener('click', () => {
  if (contextMenuObstacle) {
    if (contextMenuObstacle.type === 'goal') {
      if (contextMenuObstacle.id === 'goal1') {
        goal1 = { x: 0, y: Math.round((mapDimensions.height - 120)/2), width: 10, height: 120, color: 'red' };
      } else if (contextMenuObstacle.id === 'goal2') {
        goal2 = { x: mapDimensions.width - 10, y: Math.round((mapDimensions.height - 120)/2), width: 10, height: 120, color: 'blue' };
      }
      socket.emit('updateLevelSettings', { mapDimensions, goal1, goal2 });
    } else {
      socket.emit('deleteObstacle', contextMenuObstacle.id);
      obstacles = obstacles.filter((obs) => obs.id !== contextMenuObstacle.id);
    }
    contextMenuObstacle = null;
    hideContextMenu();
  }
});

transformOption.addEventListener('click', () => {
  if (contextMenuObstacle) {
    if (contextMenuObstacle.type === 'booster' || contextMenuObstacle.type === 'goal') {
      let newWidth = prompt("Enter new width:", contextMenuObstacle.width);
      let newHeight = prompt("Enter new height:", contextMenuObstacle.height);
      if (newWidth !== null && newHeight !== null) {
        if (contextMenuObstacle.type === 'booster') {
          contextMenuObstacle.width = Math.round(Number(newWidth));
          contextMenuObstacle.height = Math.round(Number(newHeight));
        } else {
          if (contextMenuObstacle.id === 'goal1') {
            goal1.width = Math.round(Number(newWidth));
            goal1.height = Math.round(Number(newHeight));
          } else if (contextMenuObstacle.id === 'goal2') {
            goal2.width = Math.round(Number(newWidth));
            goal2.height = Math.round(Number(newHeight));
          }
          socket.emit('updateLevelSettings', { mapDimensions, goal1, goal2 });
          hideContextMenu();
          return;
        }
      }
    } else {
      let newRadius = prompt("Enter new radius:", contextMenuObstacle.radius);
      if (newRadius !== null) {
        contextMenuObstacle.radius = Math.round(Number(newRadius));
      }
    }
    socket.emit('updateObstacle', contextMenuObstacle);
    hideContextMenu();
  }
});

rotateOption.addEventListener('click', () => {
  if (contextMenuObstacle && contextMenuObstacle.type === 'wall') {
    const temp = contextMenuObstacle.width;
    contextMenuObstacle.width = contextMenuObstacle.height;
    contextMenuObstacle.height = temp;
    contextMenuObstacle.rotation = (contextMenuObstacle.rotation + 90) % 180;
    socket.emit('updateObstacle', contextMenuObstacle);
    hideContextMenu();
  }
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const worldPos = toWorldCoords(e.clientX - rect.left, e.clientY - rect.top);
  for (let obs of obstacles) {
    if (obs.type === 'booster') {
      if (worldPos.x >= obs.x && worldPos.x <= obs.x + obs.width &&
          worldPos.y >= obs.y && worldPos.y <= obs.y + obs.height) {
        contextMenuObstacle = obs;
        break;
      }
    } else if (obs.type === 'wall') {
      if (worldPos.x >= obs.x && worldPos.x <= obs.x + obs.width &&
          worldPos.y >= obs.y && worldPos.y <= obs.y + obs.height) {
        contextMenuObstacle = obs;
        break;
      }
    } else {
      if (distance(worldPos, obs) < obs.radius) {
        contextMenuObstacle = obs;
        break;
      }
    }
  }
  if (!contextMenuObstacle) {
    if (worldPos.x >= goal1.x && worldPos.x <= goal1.x + goal1.width &&
        worldPos.y >= goal1.y && worldPos.y <= goal1.y + goal1.height) {
      contextMenuObstacle = { type: 'goal', id: 'goal1', width: goal1.width, height: goal1.height };
    } else if (worldPos.x >= goal2.x && worldPos.x <= goal2.x + goal2.width &&
               worldPos.y >= goal2.y && worldPos.y <= goal2.y + goal2.height) {
      contextMenuObstacle = { type: 'goal', id: 'goal2', width: goal2.width, height: goal2.height };
    }
  }
  if (contextMenuObstacle && contextMenuObstacle.type === 'wall') {
    rotateOption.style.display = 'block';
  } else {
    rotateOption.style.display = 'none';
  }
  showContextMenu(e.clientX, e.clientY);
});

// --------------------
// Play Button Handler
// --------------------
playButton.addEventListener('click', () => {
  socket.emit('joinGame');
  console.log("Join game requested.");
});

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
socket.on('openLevel', (data) => {
  mapDimensions = data.mapDimensions;
  goal1 = data.goal1;
  goal2 = data.goal2;
  obstacles = data.obstacles;
  io.emit('mapDimensions', { width: mapDimensions.width, height: mapDimensions.height });
  io.emit('updateGoals', { goal1, goal2 });
  io.emit('currentObstacles', obstacles);
  console.log("Server state updated from opened level:", data);
});

// ---- Save, Library, and Settings Functionality ----
const saveButton = document.getElementById('saveButton');
const libraryButton = document.getElementById('libraryButton');
const settingsButton = document.getElementById('settingsButton');

saveButton.addEventListener('click', () => {
  if (!currentUser) { alert("You must be logged in to save levels."); return; }
  const levelData = { name: "", mapDimensions, goal1, goal2, obstacles };
  if (currentLevelKey) {
    firebase.database().ref('levels/' + currentUser.uid + '/' + currentLevelKey).set(levelData)
      .then(() => { alert("Level updated successfully!"); })
      .catch((error) => { alert("Error updating level: " + error.message); });
  } else {
    const levelName = prompt("Enter a name for your level:");
    if (!levelName) return;
    levelData.name = levelName;
    firebase.database().ref('levels/' + currentUser.uid).push(levelData)
      .then(() => { alert("Level saved successfully!"); })
      .catch((error) => { alert("Error saving level: " + error.message); });
  }
});

const libraryModal = document.getElementById('libraryModal');
const levelsList = document.getElementById('levelsList');
const closeLibraryButton = document.getElementById('closeLibraryButton');

libraryButton.addEventListener('click', () => {
  if (!currentUser) { alert("You must be logged in to view your library."); return; }
  firebase.database().ref('levels/' + currentUser.uid).once('value').then(snapshot => {
    levelsList.innerHTML = "<h3>Your Levels</h3>";
    snapshot.forEach(childSnapshot => {
      const levelKey = childSnapshot.key;
      const level = childSnapshot.val();
      const levelDiv = document.createElement('div');
      levelDiv.innerHTML = `<strong>${level.name}</strong>`;
      const openButton = document.createElement('button');
      openButton.textContent = "Open";
      openButton.addEventListener('click', () => {
        mapDimensions = level.mapDimensions;
        goal1 = level.goal1;
        goal2 = level.goal2;
        obstacles = level.obstacles;
        socket.emit('openLevel', { mapDimensions, goal1, goal2, obstacles });
        socket.emit('updateMapDimensions', mapDimensions);
        socket.emit('updateGoals', { goal1, goal2 });
        currentLevelKey = levelKey;
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
      levelDiv.style.margin = "8px 0";
      levelDiv.style.padding = "8px";
      levelDiv.style.border = "1px solid #ccc";
      levelDiv.style.borderRadius = "4px";
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
  document.getElementById('settingSpikeRadius').value = paletteSettings.spikeRadius;
  document.getElementById('settingBumperRadius').value = paletteSettings.bumperRadius;
  document.getElementById('settingBoosterWidth').value = paletteSettings.boosterWidth;
  document.getElementById('settingBoosterHeight').value = paletteSettings.boosterHeight;
  document.getElementById('settingGrid').checked = gridVisible;
  settingsModal.style.display = "flex";
});

closeSettingsButton.addEventListener('click', () => { settingsModal.style.display = "none"; });

saveSettingsButton.addEventListener('click', () => {
  mapDimensions.width = Math.round(Number(document.getElementById('settingMapWidth').value));
  mapDimensions.height = Math.round(Number(document.getElementById('settingMapHeight').value));
  goal1.x = Math.round(Number(document.getElementById('settingGoal1X').value));
  goal1.y = Math.round(Number(document.getElementById('settingGoal1Y').value));
  goal1.width = Math.round(Number(document.getElementById('settingGoal1Width').value));
  goal1.height = Math.round(Number(document.getElementById('settingGoal1Height').value));
  goal2.x = Math.round(Number(document.getElementById('settingGoal2X').value));
  goal2.y = Math.round(Number(document.getElementById('settingGoal2Y').value));
  goal2.width = Math.round(Number(document.getElementById('settingGoal2Width').value));
  goal2.height = Math.round(Number(document.getElementById('settingGoal2Height').value));
  paletteSettings.spikeRadius = Math.round(Number(document.getElementById('settingSpikeRadius').value));
  paletteSettings.bumperRadius = Math.round(Number(document.getElementById('settingBumperRadius').value));
  paletteSettings.boosterWidth = Math.round(Number(document.getElementById('settingBoosterWidth').value));
  paletteSettings.boosterHeight = Math.round(Number(document.getElementById('settingBoosterHeight').value));
  gridVisible = document.getElementById('settingGrid').checked;
  socket.emit('updateLevelSettings', { mapDimensions, goal1, goal2 });
  settingsModal.style.display = "none";
});
