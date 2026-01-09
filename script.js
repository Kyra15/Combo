// Firebase Configuration
// Replace with your Firebase config from Firebase Console
// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-analytics.js";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
apiKey: "AIzaSyADWlsL5G6-f6dblwT5rHGuetF9u15PkvA",
authDomain: "test-tictactoe-96be2.firebaseapp.com",
databaseURL: "https://test-tictactoe-96be2-default-rtdb.firebaseio.com",
projectId: "test-tictactoe-96be2",
storageBucket: "test-tictactoe-96be2.firebasestorage.app",
messagingSenderId: "1013893533392",
appId: "1:1013893533392:web:e7ba0695435c7b4ead18d5",
measurementId: "G-P1KQ4V04XH"
};

// Initialize Firebase
let db;
try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    console.log('Firebase initialized successfully');
} catch (error) {
    console.error('Firebase initialization error:', error);
}

// Game variables
let currentPlayer = '';
let currentGameId = '';
let playerSymbol = '';
let gameRef = null;

// Initialize
loadAvailableGames();

function startGame() {
    const name = document.getElementById('playerName').value.trim();
    const gameId = document.getElementById('gameId').value.trim();

    if (!name) {
        showError('Please enter your name');
        return;
    }

    if (!db) {
        showError('Firebase not configured. Please check script.js');
        return;
    }

    currentPlayer = name;
    currentGameId = gameId || 'game_' + Date.now();
    gameRef = db.ref('games/' + currentGameId);

    // Check if game exists
    gameRef.once('value').then((snapshot) => {
        const game = snapshot.val();

        if (game) {
            // Game exists - join as player 2
            if (game.player2 && game.player2 !== name) {
                showError('This game is full');
                return;
            }
            if (!game.player2) {
                playerSymbol = 'O';
                gameRef.update({ player2: name });
            } else {
                playerSymbol = game.player1 === name ? 'X' : 'O';
            }
        } else {
            // Create new game
            playerSymbol = 'X';
            gameRef.set({
                player1: name,
                player2: null,
                board: ['', '', '', '', '', '', '', '', ''],
                currentTurn: 'X',
                winner: null,
                createdAt: Date.now()
            });
        }

        showGameScreen();
        listenToGame();
    }).catch((error) => {
        showError('Error starting game: ' + error.message);
    });
}

function listenToGame() {
    gameRef.on('value', (snapshot) => {
        const game = snapshot.val();
        if (game) {
            renderBoard(game);
            updateStatus(game);
        }
    });
}

function makeMove(index) {
    gameRef.once('value').then((snapshot) => {
        const game = snapshot.val();
        
        if (!game) return;
        if (game.board[index] !== '') return;
        if (game.winner) return;
        if (game.currentTurn !== playerSymbol) {
            showError('Not your turn!');
            return;
        }
        if (!game.player2) {
            showError('Waiting for opponent to join...');
            return;
        }

        const newBoard = [...game.board];
        newBoard[index] = playerSymbol;
        const winner = checkWinner(newBoard);
        const nextTurn = playerSymbol === 'X' ? 'O' : 'X';

        gameRef.update({
            board: newBoard,
            currentTurn: nextTurn,
            winner: winner
        });
    });
}

function checkWinner(board) {
    const lines = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6]
    ];

    for (let line of lines) {
        const [a, b, c] = line;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }

    if (board.every(cell => cell !== '')) {
        return 'draw';
    }

    return null;
}

function renderBoard(game) {
    const boardDiv = document.getElementById('board');
    boardDiv.innerHTML = '';

    for (let i = 0; i < 9; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.textContent = game.board[i];
        
        if (game.board[i]) {
            cell.classList.add('filled');
            cell.classList.add(game.board[i].toLowerCase());
        }
        
        cell.onclick = () => makeMove(i);
        boardDiv.appendChild(cell);
    }
}

function updateStatus(game) {
    const statusDiv = document.getElementById('status');
    const gameIdDiv = document.getElementById('gameIdDisplay');
    
    gameIdDiv.textContent = `Game ID: ${currentGameId}`;

    if (!game.player2) {
        statusDiv.textContent = 'Waiting for opponent to join...';
    } else if (game.winner === 'draw') {
        statusDiv.textContent = "It's a draw!";
    } else if (game.winner) {
        const winnerName = game.winner === 'X' ? game.player1 : game.player2;
        statusDiv.textContent = `${winnerName} wins! 🎉`;
        statusDiv.classList.add('winner-animation');
    } else {
        const currentTurnName = game.currentTurn === 'X' ? game.player1 : game.player2;
        statusDiv.textContent = `${currentTurnName}'s turn (${game.currentTurn})`;
    }
}

function showGameScreen() {
    document.getElementById('setupScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
}

function newGame() {
    if (gameRef) {
        gameRef.off();
    }
    document.getElementById('setupScreen').classList.remove('hidden');
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('gameId').value = '';
    currentGameId = '';
    loadAvailableGames();
}

function showError(message) {
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = message;
    setTimeout(() => errorDiv.textContent = '', 3000);
}

function loadAvailableGames() {
    if (!db) return;

    const gamesListDiv = document.getElementById('gamesList');
    gamesListDiv.innerHTML = '<h3 style="margin-top: 20px; color: #667eea;">Available Games</h3>';

    db.ref('games').limitToLast(10).once('value').then((snapshot) => {
        snapshot.forEach((childSnapshot) => {
            const game = childSnapshot.val();
            const key = childSnapshot.key;

            if (!game.player2 || Date.now() - game.createdAt < 3600000) {
                const gameItem = document.createElement('div');
                gameItem.className = 'game-item';
                gameItem.onclick = () => {
                    document.getElementById('gameId').value = key;
                };
                
                const status = game.player2 ? 'In Progress' : 'Waiting for player';
                gameItem.innerHTML = `
                    <h4>${key}</h4>
                    <p>Host: ${game.player1} | Status: ${status}</p>
                `;
                gamesListDiv.appendChild(gameItem);
            }
        });
    }).catch((error) => {
        console.error('Error loading games:', error);
    });
}