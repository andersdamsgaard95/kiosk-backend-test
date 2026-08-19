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

// Called by the Pi on every boot
app.get('/api/config/:serial', (req, res) => {
    const devices = readJSON(DEVICES_FILE);
    const retailers = readJSON(RETAILERS_FILE); // array now
    const device = devices[req.params.serial];

    if (!device || device.status !== 'active') {
        return res.json({ url: `${BASE_URL}/register?serial=${req.params.serial}` });
    }

    const retailer = retailers.find(r => r.name === device.retailer_name);
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
    const { serial, retailer_name } = req.body;
    const retailers = readJSON(RETAILERS_FILE);

    if (!serial || !retailer_name || !retailers.find(r => r.name === retailer_name)) {
        return res.status(400).json({ error: 'invalid serial or retailer_name' });
    }

    const devices = readJSON(DEVICES_FILE);
    devices[serial] = { retailer_name, status: 'active' };
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

//------------- ADMIN ROUTES ----------------- //

// Dashboard — list all devices + retailers
app.get('/admin', requireLogin, (req, res) => {
    const devices = readJSON(DEVICES_FILE);
    const retailers = readJSON(RETAILERS_FILE);
    res.render('admin', { devices, retailers });
});

// Update a device's retailer assignment
app.post('/admin/devices/:serial', requireLogin, (req, res) => {
    const { retailer_name } = req.body;
    const devices = readJSON(DEVICES_FILE);
    if (!devices[req.params.serial]) return res.status(404).send('not found');
    devices[req.params.serial].retailer_name = retailer_name;
    writeJSON(DEVICES_FILE, devices);
    res.redirect('/admin');
});

// Delete a device
app.post('/admin/devices/:serial/delete', requireLogin, (req, res) => {
    const devices = readJSON(DEVICES_FILE);
    delete devices[req.params.serial];
    writeJSON(DEVICES_FILE, devices);
    res.redirect('/admin');
});

// Add a new retailer
app.post('/admin/retailers', requireLogin, (req, res) => {
    const { name, url } = req.body;
    const retailers = readJSON(RETAILERS_FILE);

    if (retailers.find(r => r.name === name)) {
        return res.status(400).send('En retailer med dette navn findes allerede');
    }

    retailers.push({ name, url });
    writeJSON(RETAILERS_FILE, retailers);
    res.redirect('/admin');
});

// Edit a retailer (identified by its current name)
app.post('/admin/retailers/:name/edit', requireLogin, (req, res) => {
    const oldName = req.params.name;
    const { name, url } = req.body;
    const retailers = readJSON(RETAILERS_FILE);

    const retailer = retailers.find(r => r.name === oldName);
    if (!retailer) return res.status(404).send('not found');

    retailer.name = name;
    retailer.url = url;
    writeJSON(RETAILERS_FILE, retailers);

    // Hvis navnet ændres, opdater alle devices der peger på det gamle navn
    if (oldName !== name) {
        const devices = readJSON(DEVICES_FILE);
        Object.values(devices).forEach(d => {
            if (d.retailer_name === oldName) d.retailer_name = name;
        });
        writeJSON(DEVICES_FILE, devices);
    }

    res.redirect('/admin');
});

// Delete a retailer
app.post('/admin/retailers/:name/delete', requireLogin, (req, res) => {
    const retailers = readJSON(RETAILERS_FILE);
    const filtered = retailers.filter(r => r.name !== req.params.name);
    writeJSON(RETAILERS_FILE, filtered);
    res.redirect('/admin');
});

/* ---------- Server ---------- */

app.listen(PORT, () => {
    console.log(`Server kører på http://localhost:${PORT}`);
});