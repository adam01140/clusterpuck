const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const playButton = document.getElementById('playButton');
const scoreboard = document.getElementById('scoreboard');

// Game Constants (Must match server.js)
const GAME_WIDTH = 600;
const GAME_HEIGHT = 400;
const GOAL_HEIGHT = 100;

// Game State
let players = {};
let puck = { x: 300, y: 200, radius: 10 };
let localPlayerId = null;
let mousePos = { x: 0, y: 0 };
let isPlaying = false;
let score = { player1: 0, player2: 0 };

let canJolt = true; // Tracks if the player can jolt
let speedModifier = 1; // Modifies the player's speed (reduced after jolting)

// Input handling
const keys = {};
document.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
});

document.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
});

// Track mouse position and send it to the server
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mousePos.x = e.clientX - rect.left;
    mousePos.y = e.clientY - rect.top;

    if (isPlaying) {
        socket.emit('mouseMove', { x: mousePos.x, y: mousePos.y });
    }
});

// Handle mouse click for shooting or jolting
canvas.addEventListener('click', () => {
    const player = players[localPlayerId];

    if (player) {
        if (player.hasPuck) {
            // Shoot the puck
            const dx = mousePos.x - player.x;
            const dy = mousePos.y - player.y;
            const angle = Math.atan2(dy, dx);
            const speed = 7;
            const vx = speed * Math.cos(angle);
            const vy = speed * Math.sin(angle);

            socket.emit('shootPuck', { vx, vy });
            console.log(`Player ${player.number.replace('player', '')} is shooting the puck.`);
        } else if (canJolt) {
            // Perform a jolt
            socket.emit('jolt', { mousePos });
            canJolt = false;

            // Start cooldown timer (1 second)
            setTimeout(() => {
                canJolt = true;
            }, 1000); // 1 second cooldown
            console.log(`Player ${player.number.replace('player', '')} performed a jolt.`);
        }
    }
});

// Handle play button click
playButton.addEventListener('click', () => {
    socket.emit('joinGame');
    console.log('Join game requested.');
});

// Handle game join confirmation
socket.on('playerJoined', (data) => {
    if (data.success) {
        localPlayerId = socket.id;
        playButton.style.display = 'none';
        canvas.style.display = 'block';
        alert(data.message);
        isPlaying = true;
        console.log(`Joined the game as ${data.message}`);
    } else {
        alert(data.message);
        console.log(`Join game failed: ${data.message}`);
    }
});

// Listen for puck possession updates from the server
socket.on('puckPossession', (data) => {
    const player = players[localPlayerId];
    if (player) {
        player.hasPuck = data.hasPuck;
        console.log(`Puck possession updated: ${data.hasPuck ? 'Has Puck' : 'Does not have Puck'}`);
    }
});

// Listen for game state updates from server
socket.on('currentPlayers', (serverPlayers) => {
    players = serverPlayers;
    if (!localPlayerId) {
        localPlayerId = socket.id;
    }
    console.log('Current players:', players);
});

// Listen for a new player joining
socket.on('newPlayer', (newPlayer) => {
    players[newPlayer.id] = {
        socketId: newPlayer.socketId,
        id: newPlayer.id,
        number: newPlayer.number,
        x: newPlayer.x,
        y: newPlayer.y,
        radius: newPlayer.radius,
        hasPuck: newPlayer.hasPuck
    };
    console.log(`New player joined: ${newPlayer.number.replace('player', 'Player ')}`);
});

// Listen for player movements
socket.on('playerMoved', (playerData) => {
    if (players[playerData.id]) {
        players[playerData.id].x = playerData.x;
        players[playerData.id].y = playerData.y;
        console.log(`Player ${players[playerData.id].number.replace('player', '')} moved to (${playerData.x}, ${playerData.y})`);
    }
});

// Listen for player disconnections
socket.on('playerDisconnected', (playerId) => {
    if (players[playerId]) {
        console.log(`Player ${players[playerId].number.replace('player', '')} disconnected.`);
        delete players[playerId];
    }
});

// Listen for puck data
socket.on('puckData', (serverPuck) => {
    puck = serverPuck;
    console.log('Initial puck data received:', puck);
});

// Listen for puck shots
socket.on('puckShot', (serverPuck) => {
    puck = serverPuck;
    console.log('Puck has been shot:', puck);
});

// Listen for puck updates
socket.on('puckUpdate', (updatedPuck) => {
    puck = updatedPuck;
    // Optional: You can log puck updates if needed
    // console.log('Puck updated:', puck);
});

// Update score and display it
socket.on('updateScore', (newScore) => {
    score = newScore;
    scoreboard.textContent = `Player 1: ${score.player1} | Player 2: ${score.player2}`;
    console.log('Score updated:', score);
});

// Listen for game win notification
socket.on('gameOver', (winner) => {
    alert(`${winner} won the game!`);
    console.log(`Game over! ${winner} won.`);
    location.reload(); // Reload the page to reset the game
});

// Listen for speed modification after jolting
socket.on('modifySpeed', (modifier) => {
    speedModifier = modifier;
    console.log(`Speed modifier updated: ${speedModifier}`);
});

// Player movement logic with WASD controls
function handleMovement() {
    let dx = 0, dy = 0;
    const speed = 1 * speedModifier; // Base speed

    if (keys['w']) dy = -speed;
    if (keys['s']) dy = speed;
    if (keys['a']) dx = -speed;
    if (keys['d']) dx = speed;

    if (dx || dy) {
        socket.emit('playerMovement', { dx, dy });
    }
}

// Draw loop
function draw() {
    ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Draw border
    ctx.strokeStyle = 'black';
    ctx.strokeRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Draw goals
    ctx.fillStyle = 'black';
    // Left goal
    ctx.fillRect(0, (GAME_HEIGHT - GOAL_HEIGHT) / 2, 10, GOAL_HEIGHT);
    // Right goal
    ctx.fillRect(GAME_WIDTH - 10, (GAME_HEIGHT - GOAL_HEIGHT) / 2, 10, GOAL_HEIGHT);

    // Draw players
    for (let id in players) {
        const player = players[id];
        ctx.fillStyle = player.id === localPlayerId ? 'green' : 'blue'; // Local player in green
        ctx.beginPath();
        ctx.arc(player.x, player.y, player.radius, 0, 2 * Math.PI);
        ctx.fill();

        // Optional: Display player numbers
        ctx.fillStyle = 'white';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(player.number.replace('player', 'P'), player.x, player.y);
    }

    // Draw puck
    ctx.fillStyle = 'red';
    ctx.beginPath();
    ctx.arc(puck.x, puck.y, puck.radius, 0, 2 * Math.PI);
    ctx.fill();
}

function gameLoop() {
    if (isPlaying) {
        handleMovement();
        draw();
    }
    requestAnimationFrame(gameLoop);
}

gameLoop();
