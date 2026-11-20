require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const session = require('express-session');
const { Server: SocketIOServer } = require('socket.io');
const { io: ioClient } = require('socket.io-client');
const SQLiteStore = require('connect-sqlite3')(session);

const dbHelpers = require('./server/db');
const { attachGameServer } = require('./server/gameManager');

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server);

// Constants
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'your_secret_key';
const AUTH_URL = process.env.AUTH_URL || 'http://localhost:420';
const THIS_URL = process.env.THIS_URL || `http://localhost:${PORT}/login`;
const API_KEY = process.env.API_KEY || 'your_api_key';

// View engine & static assets
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Shared Express + Socket.IO session middleware
const sessionMiddleware = session({
  store: new SQLiteStore({ db: 'sessions.db', dir: './db' }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
});

app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

function isAuthenticated(req, res, next) {
  if (req.session && req.session.user && req.session.userId) {
    return next();
  }
  return res.redirect('/login');
}

function isAuthenticatedApi(req, res, next) {
  if (req.session && req.session.user && req.session.userId) {
    return next();
  }
  return res.status(401).json({ ok: false, error: 'Authentication required.' });
}

// Routes
app.get('/', isAuthenticated, (req, res) => {
  res.redirect('/games');
});

app.get('/login', async (req, res) => {
  if (req.query.token) {
    try {
      const tokenData = jwt.decode(req.query.token);
      if (!tokenData || (!tokenData.displayName && !tokenData.username)) {
        return res.status(400).send('Invalid Formbar login token.');
      }

      const displayName = tokenData.displayName || tokenData.username;
      const formbarId = tokenData.id ?? tokenData.userId ?? null;
      const userRecord = await dbHelpers.upsertUser({
        username: displayName,
        formbarId,
      });

      req.session.token = tokenData;
      req.session.user = userRecord.username;
      req.session.userId = userRecord.id;

      return req.session.save(() => {
        res.redirect('/games');
      });
    } catch (err) {
      console.error('Login error:', err);
      return res.status(500).send('Unable to complete Formbar login.');
    }
  }

  return res.redirect(`${AUTH_URL}/oauth?redirectURL=${encodeURIComponent(THIS_URL)}`);
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.get('/games', isAuthenticated, async (req, res) => {
  try {
    const profile = await dbHelpers.getUserById(req.session.userId);
    res.render('games', {
      user: req.session.user,
      userId: req.session.userId,
      profile: profile || {
        username: req.session.user,
        wins: 0,
        losses: 0,
        bot_wins: 0,
        bot_losses: 0,
      },
      activeNav: 'games',
    });
  } catch (err) {
    console.error('Error loading /games:', err);
    res.status(500).send('Failed to load games page.');
  }
});

app.get('/play', isAuthenticated, (req, res) => {
  const mode = req.query.mode === 'pvp' ? 'pvp' : 'bot';
  const matchId = typeof req.query.matchId === 'string' ? req.query.matchId : '';
  const archetype = typeof req.query.archetype === 'string' ? req.query.archetype : 'random';
  const grade = typeof req.query.grade === 'string' ? req.query.grade : 'medium';

  if (mode === 'pvp' && !matchId) {
    return res.redirect('/games');
  }

  res.render('play', {
    user: req.session.user,
    userId: req.session.userId,
    activeNav: 'games',
    mode,
    matchId,
    archetype,
    grade,
  });
});

app.get('/inventory', isAuthenticated, async (req, res) => {
  try {
    await dbHelpers.ensureStarterInventory(req.session.userId);
    const profile = await dbHelpers.getUserById(req.session.userId);
    if (!profile) {
      return res.redirect('/logout');
    }
    const inventory = await dbHelpers.getUserInventoryMap(profile.id);
    res.render('inventory', {
      user: req.session.user,
      userId: req.session.userId,
      activeNav: 'inventory',
      profile,
      inventory,
      chestWeights: dbHelpers.CHEST_GRADE_WEIGHTS,
    });
  } catch (err) {
    console.error('Error loading /inventory:', err);
    res.status(500).send('Failed to load inventory.');
  }
});

app.get('/api/inventory', isAuthenticatedApi, async (req, res) => {
  try {
    await dbHelpers.ensureStarterInventory(req.session.userId);
    const profile = await dbHelpers.getUserById(req.session.userId);
    if (!profile) {
      return res.status(404).json({ ok: false, error: 'User not found.' });
    }
    const inventory = await dbHelpers.getUserInventoryMap(profile.id);
    return res.json({
      ok: true,
      chests: profile.chests ?? 0,
      inventory,
    });
  } catch (err) {
    console.error('Error loading /api/inventory:', err);
    return res.status(500).json({ ok: false, error: 'Failed to load inventory.' });
  }
});

app.post('/api/chests/open', isAuthenticatedApi, async (req, res) => {
  try {
    const result = await dbHelpers.openChest(req.session.userId);
    if (!result.ok) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (err) {
    console.error('Error opening chest:', err);
    return res.status(500).json({ ok: false, error: 'Failed to open chest.' });
  }
});

app.get('/profile', isAuthenticated, async (req, res) => {
  try {
    const profile = await dbHelpers.getUserById(req.session.userId);
    if (!profile) {
      return res.redirect('/logout');
    }
    const matches = await dbHelpers.getRecentMatches(profile.id, 25);
    const totalPvp = profile.wins + profile.losses;
    const winRate = totalPvp > 0 ? Math.round((profile.wins / totalPvp) * 100) : 0;

    res.render('profile', {
      user: req.session.user,
      userId: req.session.userId,
      activeNav: 'profile',
      profile,
      totalPvp,
      winRate,
      matches,
      tokenData: req.session.token || {},
    });
  } catch (err) {
    console.error('Error loading /profile:', err);
    res.status(500).send('Failed to load profile.');
  }
});

// Socket.IO client to Formbar auth server (from formbarboilerplate)
if (AUTH_URL) {
  const formbarSocket = ioClient(AUTH_URL, {
    extraHeaders: {
      api: API_KEY,
    },
    reconnectionAttempts: 5,
  });

  formbarSocket.on('connect', () => {
    console.log('Connected to Formbar auth server');
    formbarSocket.emit('getActiveClass');
  });

  formbarSocket.on('disconnect', () => {
    console.log('Disconnected from Formbar auth server');
  });

  formbarSocket.on('connect_error', (err) => {
    console.warn('Formbar auth socket connection warning:', err.message);
  });

  formbarSocket.on('setClass', (classData) => {
    console.log('Received Formbar class data:', classData?.className || classData);
    formbarSocket.emit('classUpdate');
  });
}

// Start server after DB schema and game manager initialize
async function start() {
  await dbHelpers.initSchema();
  await attachGameServer(io, dbHelpers);

  server.listen(PORT, () => {
    console.log(`Art of the Blade server running at http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
