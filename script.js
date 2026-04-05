const firebaseConfig = {
    apiKey: "AIzaSyBzl5u8OZoBkE5l0qdgzlHHTP0W66ulJYQ",
    authDomain: "combo-7d1b6.firebaseapp.com",
    databaseURL: "https://combo-7d1b6-default-rtdb.firebaseio.com",
    projectId: "combo-7d1b6",
    storageBucket: "combo-7d1b6.firebasestorage.app",
    messagingSenderId: "238386732829",
    appId: "1:238386732829:web:5bcf4a58ac652a80eecbf4"
};

let db;
try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
} catch (e) {
    console.error('Firebase init error:', e);
}

// init stuff
let myName = '';
let myId = '';
let currentGameId = '';
let gameRef = null;
let isMyTurn = false;
let playerOrder = [];
let presenceRef = null;

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const MAX_PLAYERS = 8;

function genId() {
    return 'p_' + Math.random().toString(36).substr(2, 9);
}

// building deck
function buildDeck() {
    const deck = [];
    for (const suit of SUITS)
        for (const rank of RANKS)
            deck.push({ rank, suit, id: rank + suit });
    return shuffle(deck);
}

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function cardLabel(c) { return `${c.rank}${c.suit}`; }
function isRed(c) { return c.suit === '♥' || c.suit === '♦'; }

// on start
document.addEventListener('DOMContentLoaded', () => {
    myId = genId();

    document.getElementById('createBtn').addEventListener('click', handleCreate);
    document.getElementById('joinBtn').addEventListener('click', handleJoin);
    document.getElementById('refreshBtn').addEventListener('click', loadgames);
    document.getElementById('leaveBtn').addEventListener('click', leavegame);
    document.getElementById('drawBtn').addEventListener('click', drawCard);
    document.getElementById('comboBtn').addEventListener('click', comboFunc);

    document.getElementById('playerName').addEventListener('keydown', e => {
        if (e.key === 'Enter') handleCreate();
    });
    document.getElementById('gameId').addEventListener('keydown', e => {
        if (e.key === 'Enter') handleJoin();
    });

    // buncha weird stuff
    window.addEventListener('beforeunload', () => {
        if (!currentGameId || !myId) return;
        const url = `https://combo-7d1b6-default-rtdb.firebaseio.com/card_games/${currentGameId}/players/${myId}.json`;
        fetch(url, { method: 'DELETE', keepalive: true }).catch(() => {});
    });

    loadgames();
});

async function registerPresence() {
    if (!db || !currentGameId) return;
    presenceRef = db.ref(`card_games/${currentGameId}/players/${myId}`);
    await presenceRef.onDisconnect().remove();
}

async function cleanupIfEmpty() {
    if (!currentGameId) return;
    try {
        const ref = db.ref(`card_games/${currentGameId}/players`);
        const snap = await ref.once('value');
        if (!snap.exists() || Object.keys(snap.val() || {}).length === 0) {
            await db.ref(`card_games/${currentGameId}`).remove();
        }
    } catch(e) {}
}

// lobby

function loadgames() {
    if (!db) return;
    const list = document.getElementById('gamesList');
    list.innerHTML = '<div class="no-games">Looking for open games…</div>';

    db.ref('card_games').limitToLast(20).once('value').then(snap => {
        list.innerHTML = '';
        const items = [];
        snap.forEach(child => {
            const g = child.val();
            if (!g || !g.players) return;
            const count = Object.keys(g.players).length;
            if (count < MAX_PLAYERS && g.status === 'waiting') {
                console.log("waiting game")
                items.push({ key: child.key, game: g, count });
            }
        });

        if (items.length === 0) {
            list.innerHTML = '<div class="no-games">No open games</div>';
            return;
        }

        items.reverse().forEach(({ key, game, count }) => {
            const div = document.createElement('div');
            div.className = 'game-item';
            div.innerHTML = `
                <div class="game-item-info">
                    <div class="game-item-name">${key.replace('game_', 'Game ')}</div>
                    <div class="game-item-meta">Host: ${game.host} · ${count}/${MAX_PLAYERS} players</div>
                </div>
                <div class="game-item-join">Join →</div>
            `;
            div.addEventListener('click', () => {
                document.getElementById('gameId').value = key.replace("game_", "");
                handleJoin();
            });
            list.appendChild(div);
        });
    }).catch(err => showError('Could not load games: ' + err.message));
}

function getName() {
    const name = document.getElementById('playerName').value.trim();
    if (!name) { showError('Enter your name first'); return null; }
    return name;
}

async function handleCreate() {
    const name = getName();
    if (!name) return;
    myName = name;
    await enterGame('game_' + Math.floor(1000 + Math.random() * 9000), true);
}

async function handleJoin() {
    const name = getName();
    if (!name) return;
    let gameId = document.getElementById('gameId').value.trim();
    console.log("handleJoin game id " + gameId);
    if (!gameId || gameId.toString().length != 4) { showError('Paste a game ID to join or create a new game'); return; }
    myName = name;
    gameId = "game_" + gameId;
    await enterGame(gameId, false);
}

async function enterGame(gameId, isNew) {
    if (!db) { showError('Firebase not connected'); return; }

    currentGameId = gameId;
    gameRef = db.ref('card_games/' + currentGameId);

    try {
        const snap = await gameRef.once('value');
        const game = snap.val();

        if (isNew || !game) {
            const deck = buildDeck();
            await gameRef.set({
                host: myName,
                status: 'waiting',
                createdAt: Date.now(),
                deck,
                pile: [],
                turnIndex: 0,
                playerOrder: [myId],
                players: {
                    [myId]: {
                        id: myId,
                        name: myName,
                        hand: {},
                        colorIndex: 0,
                        joinedAt: Date.now()
                    }
                }
            });
        } else {
            const players = game.players || {};
            const playerCount = Object.keys(players).length;
            const existing = Object.values(players).find(p => p.name === myName);

            if (existing) {
                myId = existing.id;
            } else {
                if (playerCount >= MAX_PLAYERS) { showError('game is full'); return; }
            }

            const currentOrder = game.playerOrder || [];
            const updates = {};
            updates[`players/${myId}`] = {
                id: myId,
                name: myName,
                hand: existing ? existing.hand : {},
                colorIndex: playerCount % MAX_PLAYERS,
                joinedAt: Date.now()
            };
            if (!currentOrder.includes(myId)) {
                updates['playerOrder'] = [...currentOrder, myId];
            }
            await gameRef.update(updates);
        }

        await registerPresence();

        dealCards();
        showGameScreen();
        listenToGame();

    } catch (err) {
        showError('Error: ' + err.message);
        console.error(err);
    }
}

// actual game screen

function showGameScreen() {
    document.getElementById('lobbyScreen').classList.remove('active');
    document.getElementById('lobbyScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
    document.getElementById('gameScreen').classList.add('active');
    document.getElementById('gameIdDisplay').textContent = `game ID: ${currentGameId.replace("game_", "")}`;
}

function showLobbyScreen() {
    document.getElementById('gameScreen').classList.remove('active');
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('lobbyScreen').classList.remove('hidden');
    document.getElementById('lobbyScreen').classList.add('active');
}

function listenToGame() {
    gameRef.on('value', snap => {
        const game = snap.val();
        // delete game if all players leave
        if (!game) {
            gameRef.off();
            gameRef = null;
            currentGameId = '';
            presenceRef = null;
            showLobbyScreen();
            loadgames();
            return;
        }
        renderGame(game);
    });
}

function renderGame(game) {
    const players = game.players || {};
    playerOrder = game.playerOrder || Object.keys(players).sort((a, b) =>
        (players[a].joinedAt || 0) - (players[b].joinedAt || 0)
    );

    const currentTurnId = playerOrder[game.turnIndex % playerOrder.length];
    isMyTurn = currentTurnId === myId;

    const me = players[myId];
    const myHand = me ? (me.hand || []) : [];

    renderPlayers(players, currentTurnId);
    renderPile(game.pile || []);
    renderHand(myHand);
    renderTurnBadge(players, currentTurnId);
    updateButtons(game);
}

function renderPlayers(players, currentTurnId) {
    const ring = document.getElementById('playersRing');
    ring.innerHTML = '';
    Object.values(players)
        .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))
        .forEach(p => {
            const chip = document.createElement('div');
            chip.className = 'player-chip'
                + (p.id === currentTurnId ? ' active-turn' : '')
                + (p.id === myId ? ' is-me' : '');
            const count = Object.keys(p.hand || {}).filter(k => p.hand[k]).length;
            chip.innerHTML = `
                <div class="player-avatar color-${p.colorIndex || 0}">${p.name[0].toUpperCase()}</div>
                <div>
                    <div class="player-name">${p.name}${p.id === myId ? ' (You)' : ''}</div>
                    <div class="player-cards-count">${count} card${count !== 1 ? 's' : ''}</div>
                </div>
            `;
            ring.appendChild(chip);
        });
}

function renderPile(pile) {
    const stack = document.getElementById('pileStack');
    stack.innerHTML = '';

    if (pile.length === 0) {
        stack.innerHTML = '<div class="pile-empty">No cards yet</div>';
        return;
    }

    pile.slice(-3).forEach((card, i, arr) => {
        const el = buildCard(card, false, false);
        el.classList.add('pile-card');
        el.style.top = `${i * -3}px`;
        el.style.left = `${i * 2}px`;
        el.style.zIndex = i;
        el.style.cursor = 'default';
        el.style.transform = `rotate(${(i - 1) * 4}deg)`;
        if (i < arr.length - 1) el.style.opacity = '0.7';
        stack.appendChild(el);
    });

}

function renderHand(hand) {
    console.log('renderHand:', hand);
    const container = document.getElementById('handCards');
    container.innerHTML = '';

    const filledKeys = Object.keys(hand).filter(k => hand[k]).map(Number);
    const numSlots = Math.max(...filledKeys) < 4 ? 4 : Math.max(...filledKeys) + 1;

    for (let i = 0; i < numSlots; i++) {
        const slot = document.createElement('div');
        slot.className = 'card-slot';

        const card = hand[i] || null;
        if (card) {
            const el = buildCard(card, false, true);
            el.addEventListener('click', () => { if (isMyTurn) playCard(i); });
            slot.appendChild(el);
        }

        container.appendChild(slot);
    }
}

function buildCard(card, disabled, faceDown) {
    const el = document.createElement('div');
    el.className = 'playing-card' + (disabled ? ' disabled' : '') + (faceDown ? ' face-down' : '');
    el.dataset.rank = card.rank;
    el.dataset.suit = card.suit;
    el.dataset.isRed = isRed(card);

    const c = isRed(card) ? 'red' : 'black';

    el.innerHTML = `
        <div class="card-corner">
            <div class="card-rank ${c}">${card.rank}</div>
            <div class="card-suit-small ${c}">${card.suit}</div>
        </div>
        <div class="card-center-suit ${c}">${card.suit}</div>
        <div class="card-corner bottom">
            <div class="card-rank ${c}">${card.rank}</div>
            <div class="card-suit-small ${c}">${card.suit}</div>
        </div>
        <div class="card-back">
            <div class="card-back-pattern"></div>
        </div>
    `;
    return el;
}

function renderTurnBadge(players, currentTurnId) {
    const badge = document.getElementById('turnBadge');
    const p = players[currentTurnId];
    if (!p) { badge.textContent = 'Waiting for players…'; badge.classList.remove('your-turn'); return; }
    if (currentTurnId === myId) {
        badge.textContent = '🌟 Your Turn!';
        badge.classList.add('your-turn');
    } else {
        badge.textContent = `${p.name}'s Turn`;
        badge.classList.remove('your-turn');
    }
}

function updateButtons(game) {
    const deck = game.deck || [];
    const drawBtn = document.getElementById('drawBtn');
    const comboBtn = document.getElementById('comboBtn');
    drawBtn.disabled = !isMyTurn || deck.length === 0;
    comboBtn.disabled = !isMyTurn;
    // drawBtn.textContent = deck.length > 0 ? `Draw Card (${deck.length} left)` : 'Deck Empty';
}

// actions

async function dealCards() {
    // draw 4 random cards per player
    // update database 
    const snap = await gameRef.once('value');
    const game = snap.val();
    if (!game) return;

    let deck = [...game.deck];
    const players = game.players;
    let updates = {};

    for (const playerID in players) {
        const existingHand = players[playerID].hand || {};
        if (Object.keys(existingHand).length > 0) continue;
        const hand = {};
        for (let i=0; i < 4; i++) {
            hand[i] = deck.pop()
        }
        updates[`players/${playerID}/hand`] = hand;
    }
    updates['deck'] = deck;

    await gameRef.update(updates)
}


async function playCard(idx) {
    if (!isMyTurn) return;
    const snap = await gameRef.once('value');
    const game = snap.val();
    if (!game) return;
    const me = (game.players || {})[myId];
    if (!me) return;
    const hand = me.hand || {};

    const card = hand[idx];
    if (!card) return; // slot is empty

    const pile = [...(game.pile || []), card];
    const next = (game.turnIndex + 1) % playerOrder.length;

    await gameRef.update({
        [`players/${myId}/hand/${idx}`]: null, // null = remove slot
        pile,
        turnIndex: next
    });
}

async function drawCard() {
    if (!isMyTurn) return;
    const snap = await gameRef.once('value');
    const game = snap.val();
    if (!game) return;
    const deck = game.deck || [];
    if (deck.length === 0) { showError('The deck is empty!'); return; }

    const me = (game.players || {})[myId];
    const hand = me.hand || {};
    const card = deck[deck.length - 1];
    const newDeck = deck.slice(0, -1);

    await gameRef.update({ deck: newDeck });

    showDrawnCard(card, hand);
}

function showDrawnCard(card, hand) {

    document.getElementById('drawBtn').disabled = true;
    document.getElementById('comboBtn').disabled = true;

    const centerZone = document.getElementById('centerZone');
    const container = document.createElement('div');
    container.classList.add('popup-container');
    container.id = 'popup-container';

    const popupCard = buildCard(card, false, false);
    popupCard.classList.add('popup-card');

    const discardBtn = document.createElement('button');
    discardBtn.classList.add('btn-discard');
    discardBtn.classList.add('btn-primary');

    discardBtn.innerHTML = 'Discard <br><i class="fa fa-trash"></i>';
    discardBtn.addEventListener('click', async () => {
        container.remove();
        document.getElementById('drawBtn').disabled = false;
        document.getElementById('comboBtn').disabled = false;
        
        // i can't believe this worked but this needs to be a transaction otherwise i double count cards in the pile
        await gameRef.child('pile').transaction(current => {
            const arr = current || [];
            return [...arr, oldCard];
        });
    });

    container.appendChild(popupCard);
    container.appendChild(discardBtn);
    centerZone.appendChild(container);

    highlightHandForSwap(card, hand, container);
}

function highlightHandForSwap(drawnCard, hand, container) {
    const slots = document.querySelectorAll('#handCards .card-slot');
    Object.keys(hand).filter(k => hand[k]).forEach(k => {
        // this is so weird but timing is off so i have to capture the card out here first
        const originalCard = hand[k];
        const slot = slots[Number(k)];
        if (!slot) return;
        slot.classList.add('swap-target');
        slot.addEventListener('click', async function onSwap() {
            container.remove();
            document.getElementById('drawBtn').disabled = false;
            document.getElementById('comboBtn').disabled = false;

            const snap = await gameRef.once('value');
            const game = snap.val();
            const oldCard = originalCard;

            // console.log("hand " + game.players[myId].hand);
            // console.log("k " + k);
            // console.log("old card " + oldCard);

            // console.log("pile???" + game.pile);
            const currentPile = game.pile || [];
            // console.log("current pile "+ currentPile);
            // console.log("pile before:", currentPile.length);
            const pile = [...currentPile, oldCard];
            const next = (game.turnIndex + 1) % playerOrder.length;

            await gameRef.update({
                [`players/${myId}/hand/${k}`]: drawnCard,
                turnIndex: next
            });
        }, { once: true });
    });
}

async function comboFunc() {
    // if (!isMyTurn) return;
    // const snap = await gameRef.once('value');
    // const game = snap.val();
    // if (!game) return;
    // const me = (game.players || {})[myId];
    // const next = (game.turnIndex + 1) % playerOrder.length;
    // const log = [...(game.log || []),
    //     `<span class="log-name">${me ? me.name : 'Someone'}</span> passed`];
    // await gameRef.update({ turnIndex: next, log });
    console.log("combo!")
}


// ── Leave game (button) ────────────────────────────
async function leavegame() {
    if (!gameRef || !currentGameId) return;

    try {
        // Cancel the onDisconnect since we're leaving intentionally
        if (presenceRef) await presenceRef.onDisconnect().cancel();

        // Stop listening first
        gameRef.off();

        // Remove this player
        await db.ref(`card_games/${currentGameId}/players/${myId}`).remove();

        // Delete the game if no players remain
        await cleanupIfEmpty();
    } catch(e) {
        console.error('leavegame error:', e);
    }

    // Reset and go back to lobby
    gameRef = null;
    presenceRef = null;
    currentGameId = '';
    isMyTurn = false;
    playerOrder = [];
    document.getElementById('gameId').value = '';

    showLobbyScreen();
    loadgames();
}

function showError(msg) {
    const el = document.getElementById('error');
    el.textContent = msg;
    setTimeout(() => el.textContent = '', 3500);
}