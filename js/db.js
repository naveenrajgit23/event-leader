/**
 * Event Leader – Database Layer (db.js)
 * Supports both Local (IndexedDB) and Remote (Google Sheets)
 */

const DB_NAME = 'EventProDB';
const DB_VERSION = 3;
let db = null;

async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => { db = request.result; resolve(db); };
        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains('admins')) {
                const aStore = database.createObjectStore('admins', { keyPath: 'id', autoIncrement: true });
                aStore.createIndex('phone', 'phone', { unique: true });
            }
            if (!database.objectStoreNames.contains('events')) {
                const eventStore = database.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
                eventStore.createIndex('code', 'code', { unique: true });
                eventStore.createIndex('adminPhone', 'adminPhone', { unique: false });
            }
            if (!database.objectStoreNames.contains('participants')) {
                const pStore = database.createObjectStore('participants', { keyPath: 'id', autoIncrement: true });
                pStore.createIndex('eventCode', 'eventCode', { unique: false });
                pStore.createIndex('teamName_code', ['teamName', 'eventCode'], { unique: true });
            }
            if (!database.objectStoreNames.contains('scores')) {
                const sStore = database.createObjectStore('scores', { keyPath: 'id', autoIncrement: true });
                sStore.createIndex('eventCode', 'eventCode', { unique: false });
                sStore.createIndex('teamName_code', ['teamName', 'eventCode'], { unique: true });
            }
            if (!database.objectStoreNames.contains('scores_r2')) {
                const s2Store = database.createObjectStore('scores_r2', { keyPath: 'id', autoIncrement: true });
                s2Store.createIndex('eventCode', 'eventCode', { unique: false });
                s2Store.createIndex('teamName_code', ['teamName', 'eventCode'], { unique: true });
            }
        };
    });
}

// ─── Remote API Helper ───────────────────────────────────
async function callRemote(action, data = {}) {
    if (!CONFIG.SCRIPT_URL) return null;
    try {
        const url = `${CONFIG.SCRIPT_URL}?action=${action}`;
        const response = await fetch(url, {
            method: 'POST',
            body: JSON.stringify(data)
        });
        return await response.json();
    } catch (e) {
        console.error('Remote DB Error:', e);
        return null;
    }
}

// ─── Admin Operations ──────────────────────────────────────
async function registerAdmin(name, phone) {
    if (CONFIG.SCRIPT_URL) {
        return await callRemote('registerAdmin', { name, phone, createdAt: Date.now() });
    }
    const existing = await dbGetOneByIndex('admins', 'phone', phone);
    if (existing) return existing;
    return await dbAdd('admins', { name, phone, createdAt: Date.now() });
}

async function getAdminByPhone(phone) {
    if (CONFIG.SCRIPT_URL) return await callRemote('getAdmin', { phone });
    return await dbGetOneByIndex('admins', 'phone', phone);
}

// ─── Event Operations ──────────────────────────────────────
async function createEvent(eventName, code, adminPhone) {
    const data = {
        name: eventName, code: code, adminPhone: adminPhone, createdAt: Date.now(),
        isActive: true, winnersCount: 0, winnersDeclaredAt: null, resetAt: null,
        round2Mode: null, round2TopN: 0, round2Active: false,
        round2WinnersCount: 0, round2WinnersDeclaredAt: null, round2Teams: []
    };
    if (CONFIG.SCRIPT_URL) return await callRemote('createEvent', data);
    return await dbAdd('events', data);
}

async function getEventByCode(code) {
    if (CONFIG.SCRIPT_URL) return await callRemote('getEvent', { code });
    return await dbGetOneByIndex('events', 'code', code);
}

async function getEventsByAdmin(adminPhone) {
    if (CONFIG.SCRIPT_URL) return await callRemote('getAdminEvents', { phone: adminPhone });
    return await dbGetByIndex('events', 'adminPhone', adminPhone);
}

async function updateEvent(eventObj) {
    if (CONFIG.SCRIPT_URL) return await callRemote('updateEvent', eventObj);
    return await dbPut('events', eventObj);
}

async function deleteEventByCode(code) {
    if (CONFIG.SCRIPT_URL) return await callRemote('deleteEvent', { code });
    const event = await getEventByCode(code);
    if (!event) return;
    const participants = await dbGetByIndex('participants', 'eventCode', code);
    const scores = await dbGetByIndex('scores', 'eventCode', code);
    const scoresR2 = await dbGetByIndex('scores_r2', 'eventCode', code);
    const tx = db.transaction(['events', 'participants', 'scores', 'scores_r2'], 'readwrite');
    tx.objectStore('events').delete(event.id);
    participants.forEach(p => tx.objectStore('participants').delete(p.id));
    scores.forEach(s => tx.objectStore('scores').delete(s.id));
    scoresR2.forEach(s => tx.objectStore('scores_r2').delete(s.id));
}

async function isCodeUnique(code) {
    const existing = await getEventByCode(code);
    return existing === null;
}

// ─── Participant Operations ────────────────────────────────
async function addParticipant(name, phone, teamName, eventCode) {
    const data = { name, phone, teamName, eventCode, joinedAt: Date.now() };
    if (CONFIG.SCRIPT_URL) return await callRemote('addParticipant', data);
    return await dbAdd('participants', data);
}

async function getParticipantsByEvent(eventCode) {
    if (CONFIG.SCRIPT_URL) return await callRemote('getParticipants', { code: eventCode });
    return await dbGetByIndex('participants', 'eventCode', eventCode);
}

async function isTeamRegistered(teamName, eventCode) {
    const list = await getParticipantsByEvent(eventCode);
    return list.some(p => p.teamName === teamName);
}

// ─── Score Operations ──────────────────────────────
async function setScore(teamName, eventCode, score) {
    const data = { teamName, eventCode, score, updatedAt: Date.now() };
    if (CONFIG.SCRIPT_URL) return await callRemote('setScore', data);
    let existing = await dbGetOneByIndex('scores', 'teamName_code', [teamName, eventCode]);
    if (existing) {
        existing.score = score; existing.updatedAt = Date.now();
        return await dbPut('scores', existing);
    }
    return await dbAdd('scores', data);
}

async function getLeaderboard(eventCode) {
    if (CONFIG.SCRIPT_URL) return await callRemote('getLeaderboard', { code: eventCode });
    const scores = await dbGetByIndex('scores', 'eventCode', eventCode);
    return scores.sort((a, b) => b.score - a.score);
}

async function setScoreR2(teamName, eventCode, score) {
    const data = { teamName, eventCode, score, updatedAt: Date.now() };
    if (CONFIG.SCRIPT_URL) return await callRemote('setScoreR2', data);
    let existing = await dbGetOneByIndex('scores_r2', 'teamName_code', [teamName, eventCode]);
    if (existing) {
        existing.score = score; existing.updatedAt = Date.now();
        return await dbPut('scores_r2', existing);
    }
    return await dbAdd('scores_r2', data);
}

async function getLeaderboardR2(eventCode) {
    if (CONFIG.SCRIPT_URL) return await callRemote('getLeaderboardR2', { code: eventCode });
    const scores = await dbGetByIndex('scores_r2', 'eventCode', eventCode);
    return scores.sort((a, b) => b.score - a.score);
}

async function resetEvent(eventCode) {
    if (CONFIG.SCRIPT_URL) return await callRemote('resetEvent', { code: eventCode });
    return await deleteEventByCode(eventCode);
}

// ─── Local DB Helpers ───────────────────────────────────
function dbGetByIndex(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readonly');
        const idx = tx.objectStore(storeName).index(indexName);
        const req = idx.getAll(value);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
function dbGetOneByIndex(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readonly');
        const idx = tx.objectStore(storeName).index(indexName);
        const req = idx.get(value);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}
function dbAdd(storeName, data) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readwrite');
        const req = tx.objectStore(storeName).add(data);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
function dbPut(storeName, data) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readwrite');
        const req = tx.objectStore(storeName).put(data);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
