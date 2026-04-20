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
    console.error('firebase init error:', e);
}

// vars
let myName = '';
let myId = '';
let currentGameId = '';
let gameRef = null;
let isMyTurn = false;
let playerOrder = [];
let presenceRef = null;
let lastRenderedStatus = null;
let lastRenderedSwapTs = null;

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const MAX_PLAYERS = 8;
const CARDS_PER_HAND = 4;
const MAX_DECKS = 2;

function cardValue(card) {
    if (!card) return 0;
    if (card.rank === 'K') return 1;
    if (card.rank === 'A') return 0;
    if (card.rank === 'J' || card.rank === 'Q') return 10;
    return parseInt(card.rank, 10);
}

function genId() {
    return 'p_' + Math.random().toString(36).substr(2, 9);
}

// build the deck
function buildDeck() {
    const deck = [];
    for (const suit of SUITS)
        for (const rank of RANKS)
            deck.push({ rank, suit, id: rank + suit });
    return shuffle(deck);
}

function buildDoubleDeck() {
    const deck = [];
    for (let d = 0; d < 2; d++) {
        for (const suit of SUITS)
            for (const rank of RANKS)
                deck.push({ rank, suit, id: rank + suit + '_' + d });
    }
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

function isRed(c) { return c.suit === '♥' || c.suit === '♦'; }

document.addEventListener('DOMContentLoaded', () => {
    myId = genId();

    document.getElementById('createBtn').addEventListener('click', handleCreate);
    document.getElementById('joinBtn').addEventListener('click', handleJoin);
    document.getElementById('refreshBtn').addEventListener('click', loadgames);
    document.getElementById('leaveBtn').addEventListener('click', leavegame);
    document.getElementById('drawBtn').addEventListener('click', drawCard);
    document.getElementById('comboBtn').addEventListener('click', comboFunc);
    document.getElementById('startBtn').addEventListener('click', startGame);

    document.getElementById('playerName').addEventListener('keydown', e => {
        if (e.key === 'Enter') handleCreate();
    });
    document.getElementById('gameId').addEventListener('keydown', e => {
        if (e.key === 'Enter') handleJoin();
    });

    window.addEventListener('beforeunload', () => {
        if (!currentGameId || !myId) return;
        const url = `https://combo-7d1b6-default-rtdb.firebaseio.com/card_games/${currentGameId}/players/${myId}.json`;
        fetch(url, { method: 'DELETE', keepalive: true }).catch(() => {});
    });

    loadgames();
});

// i hate this
async function registerPresence() {
    if (!db || !currentGameId) return;

    const connectedRef = db.ref('.info/connected');

    connectedRef.on('value', async (snap) => {
        if (snap.val() === true) {
            presenceRef = db.ref(`card_games/${currentGameId}/players/${myId}`);

            try { await presenceRef.onDisconnect().cancel(); } catch(e) {}

            await presenceRef.set({
                id: myId,
                name: myName,
                joinedAt: Date.now()
            });

            presenceRef.onDisconnect().remove();
        }
    });
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
    myId = genId();

    // clean up ahh games
    try {
        const allSnap = await db.ref('card_games').once('value');
        const cleanups = [];
        allSnap.forEach(child => {
            const g = child.val();
            if (!g) return;
            if (g.status === 'waiting' && g.host === myName) {
                cleanups.push(db.ref('card_games/' + child.key).remove());
            }
        });
        await Promise.all(cleanups);
    } catch(e) {}

    await enterGame('game_' + Math.floor(1000 + Math.random() * 9000), true);
}

async function handleJoin() {
    const name = getName();
    if (!name) return;
    let gameId = document.getElementById('gameId').value.trim();
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
            await gameRef.set({
                host: myName,
                hostId: myId,
                status: 'waiting',
                createdAt: Date.now(),
                deck: [],
                pile: [],
                turnIndex: 0,
                playerOrder: [myId],
                decksUsed: 0,
                comboCalled: false,
                comboCallerId: null,
                roundsAfterCombo: 0,
                gameOver: false,
                players: {
                    [myId]: {
                        id: myId,
                        name: myName,
                        hand: {},
                        colorIndex: 0,
                        joinedAt: Date.now(),
                        score: 0
                    }
                }
            });
        } else {
            if (game.status !== 'waiting') { showError('Game already in progress'); return; }

            const players = game.players || {};
            const playerCount = Object.keys(players).length;
            const existing = Object.values(players).find(p => p.name === myName);

            if (existing) {
                myId = existing.id; // rejoin as same player in this specific game
            } else {
                if (playerCount >= MAX_PLAYERS) { showError('Game is full'); return; }
            }

            const currentOrder = game.playerOrder || [];
            const updates = {};
            updates[`players/${myId}`] = {
                id: myId,
                name: myName,
                hand: existing ? existing.hand : {},
                colorIndex: playerCount % MAX_PLAYERS,
                joinedAt: Date.now(),
                score: existing ? (existing.score || 0) : 0
            };
            if (!currentOrder.includes(myId)) {
                updates['playerOrder'] = [...currentOrder, myId];
            }
            await gameRef.update(updates);
        }

        await registerPresence();
        showGameScreen();
        listenToGame();

    } catch (err) {
        showError('Error: ' + err.message);
        console.error(err);
    }
}

// start game
async function startGame() {
    const snap = await gameRef.once('value');
    const game = snap.val();
    if (!game) return;
    if (game.hostId !== myId) { showError('Only the host can start the game'); return; }
    if (Object.keys(game.players || {}).length < 2) { showError('Need at least 2 players to start'); return; }

    const deck = buildDoubleDeck();
    const players = game.players;
    const order = game.playerOrder || Object.keys(players);
    const updates = {};

    let deckCopy = [...deck];
    for (const pid of order) {
        const hand = {};
        for (let i = 0; i < CARDS_PER_HAND; i++) {
            hand[i] = deckCopy.pop();
        }
        updates[`players/${pid}/hand`] = hand;
        updates[`players/${pid}/peekedSlots`] = { 0: true, 1: true };
        updates[`players/${pid}/hasActed`] = false;
    }

    updates['deck'] = deckCopy;
    updates['pile'] = [];
    updates['turnIndex'] = 0;
    updates['status'] = 'playing';
    updates['comboCalled'] = false;
    updates['comboCallerId'] = null;
    updates['roundsAfterCombo'] = 0;
    updates['gameOver'] = false;

    await gameRef.update(updates);
}

// inits
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
    lastRenderedStatus = null;
}

function listenToGame() {
    gameRef.on('value', snap => {
        const game = snap.val();
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

// render
function renderGame(game) {
    const players = game.players || {};
    playerOrder = game.playerOrder || Object.keys(players).sort((a, b) =>
        (players[a].joinedAt || 0) - (players[b].joinedAt || 0)
    );

    const currentTurnId = playerOrder[game.turnIndex % playerOrder.length];
    isMyTurn = currentTurnId === myId;

    const me = players[myId];

    renderPlayers(players, currentTurnId, game);
    renderPile(game.pile || [], game);

    if (game.status === 'waiting') {
        renderWaitingHand();
    } else {
        renderHand(me ? (me.hand || {}) : {}, me ? (me.peekedSlots || {}) : {}, game.status, game);
    }

    renderTurnBadge(players, currentTurnId, game);
    updateButtons(game);

    const startBtn = document.getElementById('startBtn');
    startBtn.style.display = (game.status === 'waiting' && game.hostId === myId) ? 'block' : 'none';

    if (game.status === 'gameover' && lastRenderedStatus !== 'gameover') {
        showGameOver(game);
    }

    // swap notifs
    if (game.lastSwap && game.lastSwap.ts !== lastRenderedSwapTs) {
        lastRenderedSwapTs = game.lastSwap.ts;
        showSwapNotification(game.lastSwap, game.players || {});
    }

    lastRenderedStatus = game.status;
}

function renderWaitingHand() {
    const container = document.getElementById('handCards');
    container.innerHTML = '';
    container.innerHTML = '<div class="waiting-message">Waiting for host to start the game…</div>';
}

function renderPlayers(players, currentTurnId, game) {
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
            const comboTag = (game.comboCalled && game.comboCallerId === p.id)
                ? '<span class="combo-tag">COMBO!</span>' : '';

            chip.innerHTML = `
                <div class="player-avatar color-${p.colorIndex || 0}">${p.name[0].toUpperCase()}</div>
                <div>
                    <div class="player-name">${p.name}${p.id === myId ? ' (You)' : ''} ${comboTag}</div>
                    <div class="player-cards-count">${count} card${count !== 1 ? 's' : ''}</div>
                </div>
            `;
            ring.appendChild(chip);
        });
}

function renderPile(pile, game) {
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

// render hand
function renderHand(hand, peekedSlots, status, game) {
    const container = document.getElementById('handCards');
    container.innerHTML = '';

    const pile = game ? (game.pile || []) : [];
    const topCard = pile.length > 0 ? pile[pile.length - 1] : null;
    const snapRank = topCard ? topCard.rank : null;

    const allKeys = Object.keys(hand).map(Number);
    const numSlots = allKeys.length === 0 ? CARDS_PER_HAND : Math.max(...allKeys) + 1;

    for (let i = 0; i < numSlots; i++) {
        const slot = document.createElement('div');
        slot.className = 'card-slot';

        const card = hand[i] || null;
        if (card) {
            const isPeeked = !!(peekedSlots && peekedSlots[i]);
            const el = buildCard(card, false, !isPeeked);
            if (status === 'playing') {
                slot.style.cursor = 'pointer';
                slot.addEventListener('click', () => attemptSnap(i, hand, game));
            }

            slot.appendChild(el);
        }

        container.appendChild(slot);
    }
}

// slap
async function attemptSnap(slotIndex, localHand, localGame) {
    if (snapLocked) return;
    if (document.getElementById('popup-container')) return;
    if (!gameRef) return;

    snapLocked = true;
    try {
        const snap = await gameRef.once('value');
        const game = snap.val();
        if (!game || game.status !== 'playing') return;

        const me = (game.players || {})[myId];
        if (!me) return;
        const hand = me.hand || {};
        const card = hand[slotIndex];
        if (!card) return;

        const pile = game.pile || [];
        const topCard = pile.length > 0 ? pile[pile.length - 1] : null;

        if (topCard && card.rank === topCard.rank) {
            // good slap
            const newHand = { ...hand };
            delete newHand[slotIndex];
            const newPile = [...pile, card];

            const updates = {
                [`players/${myId}/hand`]: newHand,
                pile: newPile
            };
            await gameRef.update(updates);
            showSnapFeedback(true, card);
        } else {
            // bad slap
            const deck = game.deck || [];
            if (deck.length === 0) {
                showSnapFeedback(false, card);
                return;
            }
            const penaltyCard = deck[deck.length - 1];
            const newDeck = deck.slice(0, -1);

            const existingSlots = Object.keys(hand).map(Number);
            const newSlot = existingSlots.length > 0 ? Math.max(...existingSlots) + 1 : 0;
            const updates = {
                [`players/${myId}/hand/${newSlot}`]: penaltyCard,
                deck: newDeck
            };
            await gameRef.update(updates);
            showSnapFeedback(false, card);
        }
    } finally {
        snapLocked = false;
    }
}

function showSnapFeedback(success, card) {
    const existing = document.getElementById('snap-feedback');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.id = 'snap-feedback';
    el.className = 'snap-feedback ' + (success ? 'snap-success' : 'snap-fail');
    el.textContent = success
        ? `✓ Snapped ${card.rank}!`
        : `✗ Wrong! Penalty card drawn`;

    document.getElementById('centerZone').appendChild(el);
    setTimeout(() => el.remove(), 2000);
}

function buildCard(card, disabled, faceDown) {
    const el = document.createElement('div');
    el.className = 'playing-card' + (disabled ? ' disabled' : '') + (faceDown ? ' face-down' : '');
    el.dataset.rank = card.rank;
    el.dataset.suit = card.suit;

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

function renderTurnBadge(players, currentTurnId, game) {
    const badge = document.getElementById('turnBadge');
    if (game.status === 'waiting') {
        badge.textContent = 'Waiting for host…';
        badge.classList.remove('your-turn');
        return;
    }
    if (game.status === 'gameover') {
        badge.textContent = 'Game Over!';
        badge.classList.remove('your-turn');
        return;
    }
    const p = players[currentTurnId];
    if (!p) { badge.textContent = 'Waiting for players…'; badge.classList.remove('your-turn'); return; }
    if (currentTurnId === myId) {
        badge.textContent = game.comboCalled ? 'Your Turn! (Last round)' : 'Your Turn!';
        badge.classList.add('your-turn');
    } else {
        badge.textContent = game.comboCalled ? `${p.name}'s Turn (Last round)` : `${p.name}'s Turn`;
        badge.classList.remove('your-turn');
    }
}

function updateButtons(game) {
    const deck = game.deck || [];
    const drawBtn = document.getElementById('drawBtn');
    const comboBtn = document.getElementById('comboBtn');
    const playing = game.status === 'playing';

    drawBtn.disabled = !playing || !isMyTurn || deck.length === 0;
    comboBtn.disabled = !playing || !isMyTurn || !!game.comboCalled;

    drawBtn.textContent = (deck.length === 0 && playing) ? 'Deck Empty' : 'Draw Card';
    comboBtn.textContent = game.comboCalled ? 'Combo Called!' : 'Call Combo';
}

// turn stuff
function nextTurnIndex(game) {
    return (game.turnIndex + 1) % playerOrder.length;
}

function clearPeekIfNeeded(game, updates) {
    const me = (game.players || {})[myId];
    if (me && !me.hasActed) {
        updates[`players/${myId}/peekedSlots`] = null;
        updates[`players/${myId}/hasActed`] = true;
    }
}

// draw card
async function drawCard() {
    if (!isMyTurn) return;
    const snap = await gameRef.once('value');
    const game = snap.val();
    if (!game || game.status !== 'playing') return;

    const deck = game.deck || [];
    if (deck.length === 0) { showError('The deck is empty!'); return; }

    const card = deck[deck.length - 1];
    const newDeck = deck.slice(0, -1);

    const deckUpdate = { deck: newDeck };
    clearPeekIfNeeded(game, deckUpdate);
    await gameRef.update(deckUpdate);

    const me = (game.players || {})[myId];
    const hand = me ? (me.hand || {}) : {};

    showDrawnCard(card, hand, game);
}

// drawn card popup
function showDrawnCard(card, hand, game) {
    document.getElementById('drawBtn').disabled = true;
    document.getElementById('comboBtn').disabled = true;

    const centerZone = document.getElementById('centerZone');

    const existing = document.getElementById('popup-container');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.classList.add('popup-container');
    container.id = 'popup-container';

    const specialLabel = getSpecialCardLabel(card);
    if (specialLabel) {
        const label = document.createElement('div');
        label.className = 'special-card-label';
        label.textContent = specialLabel;
        container.appendChild(label);
    }

    const popupCard = buildCard(card, false, false);
    popupCard.classList.add('popup-card');
    container.appendChild(popupCard);

    const btnRow = document.createElement('div');
    btnRow.className = 'popup-btn-row';

    const discardBtn = document.createElement('button');
    discardBtn.classList.add('btn-discard', 'btn-primary');
    discardBtn.innerHTML = 'Discard <span style="margin-left:8px;"><i class="fa fa-trash"></i></span>';
    discardBtn.addEventListener('click', async () => {
        container.remove();
        await discardDrawnCard(card, game);
    });

    btnRow.appendChild(discardBtn);
    container.appendChild(btnRow);
    centerZone.appendChild(container);

    const rank = card.rank;
    if (rank === 'J') {
        showJackOptions(card, hand, container, game);
    } else if (rank === 'Q') {
        showQueenOptions(card, hand, container, game);
    } else if (rank === '7' || rank === '8') {
        showSpecialCardChoice(card, hand, container, game, 'own');
    } else if (rank === '9' || rank === '10') {
        showSpecialCardChoice(card, hand, container, game, 'opp');
    } else {
        highlightHandForSwap(card, hand, container, false, game);
    }
}

function getSpecialCardLabel(card) {
    switch(card.rank) {
        case 'J': return 'Jack — Blind swap with any player';
        case 'Q': return 'Queen — Peek at any card, then optionally swap';
        case '7': return '7/8 — Peek at one of your own cards';
        case '8': return '7/8 — Peek at one of your own cards';
        case '9': return '9/10 — Peek at an opponent\'s card';
        case '10': return '9/10 — Peek at an opponent\'s card';
        default: return null;
    }
}

// discard func
async function discardDrawnCard(card, game) {
    await gameRef.child('pile').transaction(current => {
        return [...(current || []), card];
    });

    const snap = await gameRef.once('value');
    const g = snap.val();
    const next = nextTurnIndex(g);
    const updates = { turnIndex: next };

    if (g.comboCalled) {
        const newRounds = (g.roundsAfterCombo || 0) + 1;
        updates['roundsAfterCombo'] = newRounds;
        if (newRounds >= playerOrder.length - 1) {
            updates['status'] = 'gameover';
        }
    }

    await gameRef.update(updates);
}

// highlight swaps
function highlightHandForSwap(drawnCard, hand, container, isBlind, game) {
    const slots = document.querySelectorAll('#handCards .card-slot');
    Object.keys(hand).filter(k => hand[k]).forEach(k => {
        const originalCard = hand[k];
        const slot = slots[Number(k)];
        if (!slot) return;
        slot.classList.add('swap-target');
        slot.addEventListener('click', async function onSwap() {
            slot.classList.remove('swap-target');
            container.remove();

            const snap = await gameRef.once('value');
            const g = snap.val();
            const currentPile = g.pile || [];
            const pile = [...currentPile, originalCard];
            const next = nextTurnIndex(g);

            const updates = {
                [`players/${myId}/hand/${k}`]: drawnCard,
                pile,
                turnIndex: next,
                lastSwap: {
                    type: 'self',
                    actorId: myId,
                    actorName: myName,
                    actorSlot: parseInt(k),
                    drawnCard: drawnCard,
                    discardedCard: originalCard,
                    ts: Date.now()
                }
            };

            if (g.comboCalled) {
                const newRounds = (g.roundsAfterCombo || 0) + 1;
                updates['roundsAfterCombo'] = newRounds;
                if (newRounds >= playerOrder.length - 1) {
                    updates['status'] = 'gameover';
                }
            }

            await gameRef.update(updates);
            document.querySelectorAll('#handCards .card-slot.swap-target').forEach(s => s.classList.remove('swap-target'));
        }, { once: true });
    });
}

// jack funcs
function showJackOptions(drawnCard, myHand, container, game) {
    const opponents = Object.entries(game.players || {}).filter(([pid]) => pid !== myId);
    if (opponents.length === 0) return;

    const area = document.createElement('div');
    area.className = 'swap-picker';
    container.appendChild(area);

    let selectedOpp = null;  // { pid, slot }
    let selectedMine = null; // slot index

    function render() {
        area.innerHTML = '';

        // ── Their cards ──
        const theirLabel = document.createElement('div');
        theirLabel.className = 'swap-section-label';
        theirLabel.textContent = 'Swap one of their cards…';
        area.appendChild(theirLabel);

        const theirGrid = document.createElement('div');
        theirGrid.className = 'swap-grid';

        opponents.forEach(([pid, p]) => {
            const oppHand = p.hand || {};
            Object.keys(oppHand).filter(k => oppHand[k]).forEach(k => {
                const btn = document.createElement('div');
                btn.className = 'swap-chip' + (selectedOpp && selectedOpp.pid === pid && selectedOpp.slot == k ? ' selected' : '');
                btn.innerHTML = `<span class="swap-chip-player">${p.name}</span><span class="swap-chip-slot">Slot ${parseInt(k)+1}</span>`;
                btn.addEventListener('click', () => {
                    selectedOpp = { pid, slot: parseInt(k) };
                    render();
                });
                theirGrid.appendChild(btn);
            });
        });
        area.appendChild(theirGrid);

        const myLabel = document.createElement('div');
        myLabel.className = 'swap-section-label';
        myLabel.textContent = '…with one of yours';
        area.appendChild(myLabel);

        const myGrid = document.createElement('div');
        myGrid.className = 'swap-grid';

        Object.keys(myHand).filter(k => myHand[k]).forEach(k => {
            const btn = document.createElement('div');
            btn.className = 'swap-chip mine' + (selectedMine == k ? ' selected' : '');
            btn.innerHTML = `<span class="swap-chip-player">You</span><span class="swap-chip-slot">Slot ${parseInt(k)+1}</span>`;
            btn.addEventListener('click', () => {
                selectedMine = k;
                render();
            });
            myGrid.appendChild(btn);
        });
        area.appendChild(myGrid);

        // ── Confirm ──
        if (selectedOpp !== null && selectedMine !== null) {
            const confirmBtn = document.createElement('button');
            confirmBtn.className = 'btn-confirm-swap';
            confirmBtn.textContent = '⇄ Swap';
            confirmBtn.addEventListener('click', async () => {
                container.remove();
                await executeJackSwap(drawnCard, parseInt(selectedMine), selectedOpp);
            });
            area.appendChild(confirmBtn);
        }
    }

    render();
}

async function executeJackSwap(drawnCard, mySlot, oppChoice) {
    const snap = await gameRef.once('value');
    const g = snap.val();
    const myCard = g.players[myId].hand[mySlot];
    const oppCard = g.players[oppChoice.pid].hand[oppChoice.slot];
    const pile = [...(g.pile || []), drawnCard];
    const next = nextTurnIndex(g);

    const updates = {
        [`players/${myId}/hand/${mySlot}`]: oppCard,
        [`players/${oppChoice.pid}/hand/${oppChoice.slot}`]: myCard,
        pile,
        turnIndex: next,
        lastSwap: {
            type: 'jack',
            actorId: myId,
            actorName: myName,
            actorSlot: mySlot,
            targetId: oppChoice.pid,
            targetName: (g.players[oppChoice.pid] || {}).name || '?',
            targetSlot: oppChoice.slot,
            ts: Date.now()
        }
    };
    if (g.comboCalled) {
        const r = (g.roundsAfterCombo || 0) + 1;
        updates['roundsAfterCombo'] = r;
        if (r >= playerOrder.length - 1) updates['status'] = 'gameover';
    }
    await gameRef.update(updates);
}

// queen mechs (make this a little sooner)
function showQueenOptions(drawnCard, myHand, container, game) {
    const opponents = Object.entries(game.players || {}).filter(([pid]) => pid !== myId);
    if (opponents.length === 0) return;

    const area = document.createElement('div');
    area.className = 'swap-picker';
    container.appendChild(area);

    let peekedInfo = null;   // { pid, slot, card }
    let selectedMine = null;

    function render() {
        area.innerHTML = '';

        if (!peekedInfo) {
            const label = document.createElement('div');
            label.className = 'swap-section-label';
            label.textContent = 'Peek at which card?';
            area.appendChild(label);

            const grid = document.createElement('div');
            grid.className = 'swap-grid';

            opponents.forEach(([pid, p]) => {
                const oppHand = p.hand || {};
                Object.keys(oppHand).filter(k => oppHand[k]).forEach(k => {
                    const btn = document.createElement('div');
                    btn.className = 'swap-chip';
                    btn.innerHTML = `<span class="swap-chip-player">${p.name}</span><span class="swap-chip-slot">Slot ${parseInt(k)+1}</span>`;
                    btn.addEventListener('click', () => {
                        peekedInfo = { pid, slot: parseInt(k), card: game.players[pid].hand[k] };
                        render();
                    });
                    grid.appendChild(btn);
                });
            });
            area.appendChild(grid);

        } else {
            // Step 2: show the peeked card + let them choose to swap or not
            const peekRow = document.createElement('div');
            peekRow.className = 'queen-peek-row';

            const peekInfo = document.createElement('div');
            const oppName = (game.players[peekedInfo.pid] || {}).name || '?';
            peekInfo.className = 'swap-section-label';
            peekInfo.textContent = `${oppName}'s slot ${peekedInfo.slot + 1}:`;
            peekRow.appendChild(peekInfo);

            const cardEl = buildCard(peekedInfo.card, false, false);
            cardEl.style.width = '72px';
            cardEl.style.height = '100px';
            cardEl.style.cursor = 'default';
            peekRow.appendChild(cardEl);
            area.appendChild(peekRow);

            const myLabel = document.createElement('div');
            myLabel.className = 'swap-section-label';
            myLabel.textContent = 'Swap with one of yours? (or discard Queen)';
            area.appendChild(myLabel);

            const myGrid = document.createElement('div');
            myGrid.className = 'swap-grid';

            Object.keys(myHand).filter(k => myHand[k]).forEach(k => {
                const btn = document.createElement('div');
                btn.className = 'swap-chip mine' + (selectedMine == k ? ' selected' : '');
                btn.innerHTML = `<span class="swap-chip-player">You</span><span class="swap-chip-slot">Slot ${parseInt(k)+1}</span>`;
                btn.addEventListener('click', () => {
                    selectedMine = k;
                    render();
                });
                myGrid.appendChild(btn);
            });
            area.appendChild(myGrid);

            const actionRow = document.createElement('div');
            actionRow.className = 'queen-action-row';

            if (selectedMine !== null) {
                const swapBtn = document.createElement('button');
                swapBtn.className = 'btn-confirm-swap';
                swapBtn.textContent = '⇄ Swap';
                swapBtn.addEventListener('click', async () => {
                    container.remove();
                    await executeQueenSwap(drawnCard, parseInt(selectedMine), peekedInfo.pid, peekedInfo.slot);
                });
                actionRow.appendChild(swapBtn);
            }

            const discardQueenBtn = document.createElement('button');
            discardQueenBtn.className = 'btn-discard-queen';
            discardQueenBtn.textContent = 'Discard Queen';
            discardQueenBtn.addEventListener('click', async () => {
                container.remove();
                await discardDrawnCard(drawnCard, game);
            });
            actionRow.appendChild(discardQueenBtn);

            const backBtn = document.createElement('button');
            backBtn.className = 'btn-discard-queen';
            backBtn.textContent = '← Back';
            backBtn.addEventListener('click', () => {
                peekedInfo = null;
                selectedMine = null;
                render();
            });
            actionRow.appendChild(backBtn);

            area.appendChild(actionRow);
        }
    }

    render();
}

async function executeQueenSwap(drawnCard, mySlot, oppPid, oppSlot) {
    const snap = await gameRef.once('value');
    const g = snap.val();
    const myCard = g.players[myId].hand[mySlot];
    const oppCard = g.players[oppPid].hand[oppSlot];
    const pile = [...(g.pile || []), drawnCard];
    const next = nextTurnIndex(g);

    const updates = {
        [`players/${myId}/hand/${mySlot}`]: oppCard,
        [`players/${oppPid}/hand/${oppSlot}`]: myCard,
        pile,
        turnIndex: next,
        lastSwap: {
            type: 'queen',
            actorId: myId,
            actorName: myName,
            actorSlot: mySlot,
            targetId: oppPid,
            targetName: (g.players[oppPid] || {}).name || '?',
            targetSlot: oppSlot,
            ts: Date.now()
        }
    };
    if (g.comboCalled) {
        const r = (g.roundsAfterCombo || 0) + 1;
        updates['roundsAfterCombo'] = r;
        if (r >= playerOrder.length - 1) updates['status'] = 'gameover';
    }
    await gameRef.update(updates);
}

// 78910 mechs
// own = peek your own card (7/8), opp = peek opponent's card (9/10)
function showSpecialCardChoice(drawnCard, myHand, container, game, mode) {
    const area = document.createElement('div');
    area.className = 'special-choice-area';
    container.appendChild(area);

    function showChoice() {
        area.innerHTML = '';

        const useBtn = document.createElement('button');
        useBtn.className = 'jack-slot-btn special-choice-btn';
        useBtn.textContent = mode === 'own' ? 'Peek at your card' : 'Peek at opponent\'s card';
        useBtn.addEventListener('click', () => {
            area.innerHTML = '';
            if (mode === 'own') {
                showPeekOwnThenDiscard(drawnCard, myHand, area, container, game);
            } else {
                showPeekOppThenDiscard(drawnCard, myHand, area, container, game);
            }
        });

        const swapBtn = document.createElement('button');
        swapBtn.className = 'jack-slot-btn special-choice-btn';
        swapBtn.textContent = 'Swap with hand';
        swapBtn.addEventListener('click', () => {
            area.remove();
            highlightHandForSwap(drawnCard, myHand, container, false, game);
        });

        area.appendChild(useBtn);
        area.appendChild(swapBtn);
    }

    showChoice();
}

// discard after use
function showPeekOwnThenDiscard(drawnCard, myHand, area, container, game) {
    const myPeeked = (game.players[myId] || {}).peekedSlots || {};
    const slots = Object.keys(myHand).filter(k => myHand[k] && !myPeeked[k]);

    const label = document.createElement('div');
    label.className = 'special-action-label';
    label.textContent = 'Pick one of your face-down cards to peek at:';
    area.appendChild(label);

    const row = document.createElement('div');
    row.className = 'jack-row';

    slots.forEach(k => {
        const btn = document.createElement('button');
        btn.className = 'jack-slot-btn';
        btn.textContent = `Slot ${parseInt(k)+1}`;
        btn.addEventListener('click', () => {
            showTempPeek(myHand[k], `Your slot ${parseInt(k)+1}`, async () => {
                container.remove();
                await discardDrawnCard(drawnCard, game);
            });
        });
        row.appendChild(btn);
    });

    if (slots.length === 0) {
        label.textContent = 'No face-down cards to peek at';
    }

    area.appendChild(row);
}

function showPeekOppThenDiscard(drawnCard, myHand, area, container, game) {
    const opponents = Object.entries(game.players || {}).filter(([pid]) => pid !== myId);

    const label = document.createElement('div');
    label.className = 'special-action-label';
    label.textContent = 'Pick an opponent\'s card to peek at:';
    area.appendChild(label);

    const row = document.createElement('div');
    row.className = 'jack-row';

    opponents.forEach(([pid, p]) => {
        const oppHand = p.hand || {};
        Object.keys(oppHand).filter(k => oppHand[k]).forEach(k => {
            const btn = document.createElement('button');
            btn.className = 'jack-slot-btn';
            btn.textContent = `${p.name} #${parseInt(k)+1}`;
            btn.addEventListener('click', () => {
                showTempPeek(oppHand[k], `${p.name}'s slot ${parseInt(k)+1}`, async () => {
                    container.remove();
                    await discardDrawnCard(drawnCard, game);
                });
            });
            row.appendChild(btn);
        });
    });

    area.appendChild(row);
}

// peek overlay
function showTempPeek(card, labelText, onClose) {
    const existing = document.getElementById('temp-peek');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'temp-peek';
    overlay.className = 'peek-overlay';
    overlay.innerHTML = `<div class="peek-label">👁 ${labelText}</div>`;
    const cardEl = buildCard(card, false, false);
    cardEl.style.width = '90px';
    cardEl.style.height = '126px';
    overlay.appendChild(cardEl);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-discard btn-primary';
    closeBtn.textContent = 'Got it';
    closeBtn.addEventListener('click', () => {
        overlay.remove();
        onClose();
    });
    overlay.appendChild(closeBtn);

    setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 5000);
    document.getElementById('centerZone').appendChild(overlay);
}

// combo
async function comboFunc() {
    if (!isMyTurn) return;
    const snap = await gameRef.once('value');
    const game = snap.val();
    if (!game || game.status !== 'playing' || game.comboCalled) return;

    const next = nextTurnIndex(game);
    const updates = {
        comboCalled: true,
        comboCallerId: myId,
        roundsAfterCombo: 0,
        turnIndex: next
    };
    clearPeekIfNeeded(game, updates);
    await gameRef.update(updates);
}

// swap notifs
function showSwapNotification(swap, players) {
    const existing = document.getElementById('swap-notification');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.id = 'swap-notification';
    el.className = 'swap-notification';

    let msg = '';
    const isMe = swap.actorId === myId;
    const actorLabel = isMe ? 'You' : swap.actorName;

    if (swap.type === 'self') {
        // swap card
        msg = `${actorLabel} swapped slot ${swap.actorSlot + 1} `;
    } else {
        // two player swap
        const targetIsMe = swap.targetId === myId;
        const targetLabel = targetIsMe ? 'you' : swap.targetName;
        msg = `${actorLabel} swapped their slot ${swap.actorSlot + 1} with ${targetLabel}'s slot ${swap.targetSlot + 1}`;
    }

    el.innerHTML = `<span class="sn-icon">⇄</span> ${msg}`;
    document.getElementById('centerZone').appendChild(el);

    setTimeout(() => { if (el.parentNode) el.remove(); }, 3500);
}

// game done
function showGameOver(game) {
    const players = game.players || {};
    const overlay = document.createElement('div');
    overlay.id = 'gameover-overlay';
    overlay.className = 'gameover-overlay';

    const scores = Object.values(players).map(p => {
        const hand = p.hand || {};
        const total = Object.keys(hand).filter(k => hand[k]).reduce((sum, k) => sum + cardValue(hand[k]), 0);
        return { name: p.name, id: p.id, total };
    }).sort((a, b) => a.total - b.total);

    const winner = scores[0];

    let scoreRows = scores.map((s, i) => {
        const tag = i === 0 ? ' <i class="fa fa-trophy"></i>' : '';
        const isCaller = s.id === game.comboCallerId ? ' (called combo)' : '';
        const isYou = s.id === myId ? ' <em>(you)</em>' : '';
        return `<tr class="${i === 0 ? 'winner-row' : ''}">
            <td>${i+1}</td>
            <td>${s.name}${isYou}${isCaller}</td>
            <td>${s.total} pts${tag}</td>
        </tr>`;
    }).join('');

    overlay.innerHTML = `
        <div class="gameover-card">
            <div class="gameover-title">Game Over!</div>
            <div class="gameover-winner">${winner.name} wins with ${winner.total} points!!</div>
            <table class="score-table">
                <thead><tr><th>#</th><th>Player</th><th>Score</th></tr></thead>
                <tbody>${scoreRows}</tbody>
            </table>
            <div class="gameover-hands">${renderAllHandsHTML(players)}</div>
            <button class="btn-primary gameover-leave" id="gameoverLeaveBtn">Back to Lobby</button>
        </div>
    `;

    document.getElementById('gameScreen').appendChild(overlay);
    document.getElementById('gameoverLeaveBtn').addEventListener('click', leavegame);
}

function renderAllHandsHTML(players) {
    return Object.values(players).map(p => {
        const hand = p.hand || {};
        const cards = Object.keys(hand).filter(k => hand[k]).map(k => {
            const c = hand[k];
            const color = isRed(c) ? 'red' : 'black';
            return `<span class="hand-card-chip ${color}">${c.rank}${c.suit}</span>`;
        }).join('');
        const total = Object.keys(hand).filter(k => hand[k]).reduce((sum, k) => sum + cardValue(hand[k]), 0);
        return `<div class="reveal-player"><strong>${p.name}</strong>: ${cards} = <strong>${total} pts</strong></div>`;
    }).join('');
}

// leave game
async function leavegame() {
    if (!gameRef || !currentGameId) return;

    try {
        if (presenceRef) await presenceRef.onDisconnect().cancel();
        gameRef.off();
        await db.ref(`card_games/${currentGameId}/players/${myId}`).remove();
        await cleanupIfEmpty();
    } catch(e) {
        console.error('leavegame error:', e);
    }

    gameRef = null;
    presenceRef = null;
    currentGameId = '';
    isMyTurn = false;
    playerOrder = [];
    lastRenderedSwapTs = null;
    myId = genId();
    document.getElementById('gameId').value = '';

    const go = document.getElementById('gameover-overlay');
    if (go) go.remove();

    showLobbyScreen();
    loadgames();
}

// error
function showError(msg) {
    const el = document.getElementById('error');
    el.textContent = msg;
    setTimeout(() => el.textContent = '', 3500);
}