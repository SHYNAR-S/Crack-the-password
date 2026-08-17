/* ============================================================
   PASSWORDLE — game logic
   ============================================================ */

/* ---------------------------------------------------------
   CONFIG — change these values to tune the game
   --------------------------------------------------------- */

// Minimum and maximum length of the secret password.
// The actual length is chosen randomly within this range each game.
const MIN_LENGTH = 8;
const MAX_LENGTH = 12;

// Number of attempts per game.
const MAX_ATTEMPTS = 6;

// Character sets the password is built from.
const CHARSET = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  special: '!@#$%&*?',
};

const ALL_CHARS = CHARSET.upper + CHARSET.lower + CHARSET.digits + CHARSET.special;

/* ---------------------------------------------------------
   STATE
   --------------------------------------------------------- */

let secret = '';
let attemptsLeft = MAX_ATTEMPTS;
let gameOver = false;

// Ad-unlock state — watching the (simulated) ad flips this to true for
// the rest of the current round only. It resets on every new game.
let infiniteAttempts = false;

// Positions already revealed via the ad-gated hint button.
let revealedPositions = new Set();

/* ---------------------------------------------------------
   DOM
   --------------------------------------------------------- */

const boardEl = document.getElementById('board');
const lengthValueEl = document.getElementById('lengthValue');
const attemptsValueEl = document.getElementById('attemptsValue');
const statusValueEl = document.getElementById('statusValue');
const guessInput = document.getElementById('guessInput');
const guessButton = document.getElementById('guessButton');
const hintText = document.getElementById('hintText');

const overlay = document.getElementById('overlay');
const overlayIcon = document.getElementById('overlayIcon');
const overlayTitle = document.getElementById('overlayTitle');
const overlayDetail = document.getElementById('overlayDetail');
const overlaySecret = document.getElementById('overlaySecret');
const overlayButton = document.getElementById('overlayButton');
const overlayClose = document.getElementById('overlayClose');
const overlayCloseSecondary = document.getElementById('overlayCloseSecondary');

const watchAdBtn = document.getElementById('watchAdBtn');
const hintButton = document.getElementById('hintButton');
const hintsStrip = document.getElementById('hintsStrip');

const miniOverlay = document.getElementById('miniOverlay');
const miniOverlayLabel = document.getElementById('miniOverlayLabel');
const miniOverlayMessage = document.getElementById('miniOverlayMessage');

/* ---------------------------------------------------------
   SECRET GENERATION
   --------------------------------------------------------- */

function randomInt(min, max) {
  // inclusive of both min and max
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateSecret() {
  const length = randomInt(MIN_LENGTH, MAX_LENGTH);
  let result = '';
  for (let i = 0; i < length; i++) {
    const idx = randomInt(0, ALL_CHARS.length - 1);
    result += ALL_CHARS[idx];
  }
  return result;
}

/* ---------------------------------------------------------
   GREEN / YELLOW / GRAY ALGORITHM
   ---------------------------------------------------------
   1. First pass: find all exact matches (green) and "subtract"
      those characters from the secret.
   2. Second pass: for the remaining guessed characters, check
      whether that character is still left in the "unused"
      secret — if yes, it's yellow and we subtract it too;
      if not, it's gray.
   This guarantees that duplicate letters never get marked
   green/yellow more times than they actually appear in the
   secret.
   --------------------------------------------------------- */

function evaluateGuess(secretStr, guessStr) {
  const length = secretStr.length;
  const result = new Array(length).fill('gray');
  const secretChars = secretStr.split('');
  const guessChars = guessStr.split('');

  // remaining[] — count of secret characters not yet "explained"
  const remaining = {};

  // Pass 1: green
  for (let i = 0; i < length; i++) {
    if (guessChars[i] === secretChars[i]) {
      result[i] = 'green';
    } else {
      remaining[secretChars[i]] = (remaining[secretChars[i]] || 0) + 1;
    }
  }

  // Pass 2: yellow / gray
  for (let i = 0; i < length; i++) {
    if (result[i] === 'green') continue;
    const ch = guessChars[i];
    if (remaining[ch] > 0) {
      result[i] = 'yellow';
      remaining[ch]--;
    } else {
      result[i] = 'gray';
    }
  }

  return result;
}

/* ---------------------------------------------------------
   RENDERING
   --------------------------------------------------------- */

function renderStatus() {
  lengthValueEl.textContent = secret.length;
  attemptsValueEl.textContent = infiniteAttempts ? '∞' : attemptsLeft;
  statusValueEl.textContent = gameOver ? 'DONE' : 'SCANNING';
}

function renderGuessRow(guess, states) {
  const row = document.createElement('div');
  row.className = 'board__row';

  guess.split('').forEach((char, i) => {
    const tile = document.createElement('span');
    tile.className = `tile tile--${states[i]}`;
    tile.style.animationDelay = `${i * 60}ms`;
    tile.textContent = char;
    row.appendChild(tile);
  });

  boardEl.appendChild(row);
  boardEl.scrollTop = boardEl.scrollHeight;
}

function setHint(message, isError = false) {
  hintText.textContent = message;
  hintText.classList.toggle('composer__hint--error', isError);
}

/* ---------------------------------------------------------
   GAME FLOW
   --------------------------------------------------------- */

function startNewGame() {
  secret = generateSecret();
  attemptsLeft = MAX_ATTEMPTS;
  gameOver = false;

  // Any ad-unlocked unlimited attempts only ever applied to the round
  // that just ended — every new round starts limited again.
  infiniteAttempts = false;

  revealedPositions = new Set();
  hintsStrip.innerHTML = '';
  hintButton.disabled = false;
  syncUpgradeButtons();

  boardEl.innerHTML = '';
  guessInput.value = '';
  guessInput.maxLength = secret.length;
  guessInput.disabled = false;
  guessButton.disabled = false;

  setHint(`Your guess must be exactly ${secret.length} characters long.`);
  renderStatus();
  overlay.classList.remove('overlay--visible');
  guessInput.focus();
}

function endGame(won, attemptsUsed) {
  gameOver = true;
  guessInput.disabled = true;
  guessButton.disabled = true;
  hintButton.disabled = true;
  renderStatus();

  if (won) {
    overlayIcon.textContent = '🎉';
    overlayTitle.textContent = 'PASSWORD CRACKED!';
    overlayTitle.classList.remove('overlay__title--fail');
    overlayDetail.textContent = `Attempts used: ${attemptsUsed}`;
    overlaySecret.textContent = '';
    overlayButton.textContent = 'PLAY AGAIN';
  } else {
    overlayIcon.textContent = '💀';
    overlayTitle.textContent = 'PASSWORD NOT CRACKED';
    overlayTitle.classList.add('overlay__title--fail');
    overlayDetail.textContent = '';
    overlaySecret.textContent = `The password was: ${secret}`;
    overlayButton.textContent = 'TRY AGAIN';
  }

  overlay.classList.add('overlay--visible');
}

function submitGuess() {
  if (gameOver) return;

  const guess = guessInput.value;

  if (guess.length !== secret.length) {
    setHint(`Needs exactly ${secret.length} characters (currently ${guess.length}).`, true);
    return;
  }

  const states = evaluateGuess(secret, guess);
  renderGuessRow(guess, states);

  const attemptsUsed = infiniteAttempts
    ? boardEl.children.length
    : MAX_ATTEMPTS - attemptsLeft + 1;
  const won = guess === secret;

  if (!infiniteAttempts) {
    attemptsLeft--;
  }
  guessInput.value = '';
  setHint(`Your guess must be exactly ${secret.length} characters long.`);
  renderStatus();

  if (won) {
    endGame(true, attemptsUsed);
    return;
  }

  if (!infiniteAttempts && attemptsLeft <= 0) {
    endGame(false, attemptsUsed);
  }
}

/* ---------------------------------------------------------
   MINI OVERLAY — shared modal for the simulated ad and the
   simulated payment step. Demo only: no real ad SDK or
   payment processor is connected in this build.
   --------------------------------------------------------- */

function showMiniOverlay(label, message, durationMs, onDone) {
  miniOverlayLabel.textContent = label;
  miniOverlayMessage.textContent = message;
  miniOverlay.classList.add('mini-overlay--visible');

  setTimeout(() => {
    miniOverlay.classList.remove('mini-overlay--visible');
    if (onDone) onDone();
  }, durationMs);
}

/* ---------------------------------------------------------
   REWARDED AD — SIMULATED.
   This is the ONE function to replace when you wire up a real
   ad SDK. Right now it just shows the mini overlay for a few
   seconds and then calls onReward(). A real integration would:
     1. Request/load a rewarded ad from the SDK ahead of time.
     2. Show it when the user taps the button.
     3. Only call onReward() from the SDK's "user earned reward"
        callback — never on a plain timer — so people can't get
        the reward by skipping or closing the ad early.
   See the chat response for SDK options and setup notes.
   --------------------------------------------------------- */
function showRewardedAd(onReward) {
  showMiniOverlay('ADVERTISEMENT', 'Ad playing... reward in 3s', 3000, onReward);
}

/* ---------------------------------------------------------
   UPGRADES — "unlimited attempts" unlocked by watching a
   rewarded ad. See showRewardedAd() below for where a real
   ad SDK call would replace the simulated timeout.
   --------------------------------------------------------- */

function syncUpgradeButtons() {
  if (infiniteAttempts) {
    watchAdBtn.textContent = 'ACTIVE';
    watchAdBtn.disabled = true;
  } else {
    watchAdBtn.textContent = '▶ WATCH AD';
    watchAdBtn.disabled = false;
  }
}

function unlockUnlimitedAttempts() {
  if (gameOver || infiniteAttempts) return;

  watchAdBtn.disabled = true;
  showRewardedAd(() => {
    infiniteAttempts = true;
    renderStatus();
    syncUpgradeButtons();
    setHint('Unlimited attempts unlocked for this round.');
  });
}

/* ---------------------------------------------------------
   HINT — watch a (simulated) ad to reveal one random
   correct letter and its position.
   --------------------------------------------------------- */

function renderHintChip(position, char) {
  const chip = document.createElement('span');
  chip.className = 'hint-chip';
  chip.innerHTML = `<span class="hint-chip__pos">#${position + 1}</span><span>${char}</span>`;
  hintsStrip.appendChild(chip);
}

function requestHint() {
  if (gameOver) return;
  if (revealedPositions.size >= secret.length) return;

  hintButton.disabled = true;

  showRewardedAd(() => {
    let index;
    do {
      index = randomInt(0, secret.length - 1);
    } while (revealedPositions.has(index));

    revealedPositions.add(index);
    renderHintChip(index, secret[index]);

    hintButton.disabled = revealedPositions.size >= secret.length;
  });
}

/* ---------------------------------------------------------
   EVENTS
   --------------------------------------------------------- */

guessButton.addEventListener('click', submitGuess);

guessInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    submitGuess();
  }
});

overlayButton.addEventListener('click', startNewGame);

function dismissOverlay() {
  // Just hide the overlay without resetting the game — the board
  // with all attempts stays visible for review.
  overlay.classList.remove('overlay--visible');
}

overlayClose.addEventListener('click', dismissOverlay);
overlayCloseSecondary.addEventListener('click', dismissOverlay);

watchAdBtn.addEventListener('click', unlockUnlimitedAttempts);
hintButton.addEventListener('click', requestHint);

/* ---------------------------------------------------------
   INIT
   --------------------------------------------------------- */

startNewGame();