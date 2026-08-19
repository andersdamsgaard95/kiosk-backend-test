require('dotenv').config();
const express = require("express");
const path = require("path");
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { readJSON, writeJSON } = require("./helpers/jsonFileHelpers");

const app = express();
const PORT = 3000;

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const DEVICES_FILE = path.join(__dirname, 'data', 'devices.json');
const RETAILERS_FILE = path.join(__dirname, 'data', 'retailers.json');

/* ---------- Middleware ---------- */

app.use((req, res, next) => {
    console.log(`server tilgået fra ${req.url}`);
    next();
});

app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 hour login
}));

// Auth guard — use this on any route you want to protect
function requireLogin(req, res, next) {
    if (req.session && req.session.loggedIn) {
        return next();
    }
    res.redirect(`/login?redirect=${encodeURIComponent(req.originalUrl)}`);
}

/* ---------- Auth routes ---------- */

app.get('/login', (req, res) => {
    res.render('login', { error: null, redirect: req.query.redirect || '/' });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const redirect = req.body.redirect || '/';

    const validUser = username === process.env.ADMIN_USERNAME;
    const validPass = validUser && bcrypt.compareSync(password, process.env.ADMIN_PASSWORD_HASH);

    if (!validUser || !validPass) {
        return res.render('login', { error: 'Invalid username or password', redirect });
    }

    req.session.loggedIn = true;
    req.session.username = username;
    res.redirect(redirect);
});

app.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

/* ---------- Routes ---------- */

app.get('/api/config/:serial', (req, res) => {
    const devices = readJSON(DEVICES_FILE);
    const retailers = readJSON(RETAILERS_FILE);
    const device = devices[req.params.serial];

    if (!device || device.status !== 'active') {
        return res.json({ url: `${BASE_URL}/register?serial=${req.params.serial}` });
    }

    const retailer = retailers[device.retailer_id];
    if (!retailer) {
        return res.json({ url: `${BASE_URL}/register?serial=${req.params.serial}` });
    }

    res.json({ url: retailer.url });
});

// Protected — must be logged in to register a device
app.get('/register', requireLogin, (req, res) => {
    const { serial } = req.query;
    const retailers = readJSON(RETAILERS_FILE);
    res.render('register', { serial, retailers });
});

app.post('/register', requireLogin, (req, res) => {
    const { serial, retailer_id } = req.body;
    const retailers = readJSON(RETAILERS_FILE);

    if (!serial || !retailer_id || !retailers[retailer_id]) {
        return res.status(400).json({ error: 'invalid serial or retailer_id' });
    }

    const devices = readJSON(DEVICES_FILE);
    devices[serial] = { retailer_id, status: 'active' };
    writeJSON(DEVICES_FILE, devices);

    res.json({ success: true });
});

app.get('/registered', (req, res) => {
    res.render('registered-confirmation');
});

// Protected — device list is internal info
app.get('/api/devices', requireLogin, (req, res) => {
    res.json(readJSON(DEVICES_FILE));
});

/* ---------- Server ---------- */

app.listen(PORT, () => {
    console.log(`Server kører på http://localhost:${PORT}`);
});