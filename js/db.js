/**
 * EventPro – IndexedDB Database Layer (db.js)
 * Acts as a real client-side database (NOT localStorage)
 * Stores: Events, Participants, Scores (Round 1 & Round 2), Admins
 */

const DB_NAME = 'EventProDB';
const DB_VERSION = 3;

let db = null;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (e) => {
            const database = e.target.result;

            // Admins store
            if (!database.objectStoreNames.contains('admins')) {
                const aStore = database.createObjectStore('admins', { keyPath: 'id', autoIncrement: true });
                aStore.createIndex('phone', 'phone', { unique: true });
            }

            // Events store
            if (!database.objectStoreNames.contains('events')) {
                const eventStore = database.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
                eventStore.createIndex('code', 'code', { unique: true });
                eventStore.createIndex('name', 'name', { unique: false });
                eventStore.createIndex('adminPhone', 'adminPhone', { unique: false });
            } else {
                // Upgrade: add adminPhone index if not exists
                const tx = e.target.transaction;
                const store = tx.objectStore('events');
                if (!store.indexNames.contains('adminPhone')) {
                    store.createIndex('adminPhone', 'adminPhone', { unique: false });
                }
            }

            // Participants store
            if (!database.objectStoreNames.contains('participants')) {
                const pStore = database.createObjectStore('participants', { keyPath: 'id', autoIncrement: true });
                pStore.createIndex('eventCode', 'eventCode', { unique: false });
                pStore.createIndex('teamName_code', ['teamName', 'eventCode'], { unique: true });
            }

            // Round 1 Scores store
            if (!database.objectStoreNames.contains('scores')) {
                const sStore = database.createObjectStore('scores', { keyPath: 'id', autoIncrement: true });
                sStore.createIndex('eventCode', 'eventCode', { unique: false });
                sStore.createIndex('teamName_code', ['teamName', 'eventCode'], { unique: true });
            }

            // Round 2 Scores store
            if (!database.objectStoreNames.contains('scores_r2')) {
                const s2Store = database.createObjectStore('scores_r2', { keyPath: 'id', autoIncrement: true });
                s2Store.createIndex('eventCode', 'eventCode', { unique: false });
                s2Store.createIndex('teamName_code', ['teamName', 'eventCode'], { unique: true });
            }
        };
    });
}

// ─── Generic DB helpers ───────────────────────────────────

function dbGetAll(storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function dbGetByIndex(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readonly');
        const store = tx.objectStore(storeName);
        const idx = store.index(indexName);
        const req = idx.getAll(value);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function dbGetOneByIndex(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readonly');
        const store = tx.objectStore(storeName);
        const idx = store.index(indexName);
        const req = idx.get(value);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

function dbAdd(storeName, data) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.add(data);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function dbPut(storeName, data) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(data);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function dbDelete(storeName, id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

// ─── Admin Operations ──────────────────────────────────────

async function registerAdmin(name, phone) {
    // Check if phone already registered
    const existing = await dbGetOneByIndex('admins', 'phone', phone);
    if (existing) return existing; // already exists, return it
    return await dbAdd('admins', { name, phone, createdAt: Date.now() });
}

async function getAdminByPhone(phone) {
    return await dbGetOneByIndex('admins', 'phone', phone);
}

// ─── Event Operations ──────────────────────────────────────

async function createEvent(eventName, code, adminPhone) {
    const now = Date.now();
    return await dbAdd('events', {
        name: eventName,
        code: code,
        adminPhone: adminPhone,
        createdAt: now,
        isActive: true,
        winnersCount: 0,
        winnersDeclaredAt: null,
        resetAt: null,
        // Round 2 fields
        round2Mode: null,           // 'qualifier' | 'cumulative' | null
        round2TopN: 0,              // top N selected for qualifier
        round2Active: false,        // is round 2 active
        round2WinnersCount: 0,
        round2WinnersDeclaredAt: null,
        round2Teams: [],            // teams eligible for round 2
    });
}

async function getEventByCode(code) {
    return await dbGetOneByIndex('events', 'code', code);
}

async function getAllEvents() {
    return await dbGetAll('events');
}

async function getEventsByAdmin(adminPhone) {
    return await dbGetByIndex('events', 'adminPhone', adminPhone);
}

async function updateEvent(eventObj) {
    return await dbPut('events', eventObj);
}

async function deleteEventByCode(code) {
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

    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function isCodeUnique(code) {
    const existing = await getEventByCode(code);
    return existing === null;
}

// ─── Participant Operations ────────────────────────────────

async function addParticipant(name, phone, teamName, eventCode) {
    const now = Date.now();
    return await dbAdd('participants', {
        name, phone, teamName, eventCode,
        joinedAt: now
    });
}

async function getParticipantsByEvent(eventCode) {
    return await dbGetByIndex('participants', 'eventCode', eventCode);
}

async function isTeamRegistered(teamName, eventCode) {
    try {
        const result = await dbGetOneByIndex('participants', 'teamName_code', [teamName, eventCode]);
        return result !== null;
    } catch {
        return false;
    }
}

// ─── Round 1 Score Operations ──────────────────────────────

async function getScoresByEvent(eventCode) {
    return await dbGetByIndex('scores', 'eventCode', eventCode);
}

async function setScore(teamName, eventCode, score) {
    let existing = null;
    try {
        existing = await dbGetOneByIndex('scores', 'teamName_code', [teamName, eventCode]);
    } catch (e) { }

    if (existing) {
        existing.score = score;
        existing.updatedAt = Date.now();
        return await dbPut('scores', existing);
    } else {
        return await dbAdd('scores', {
            teamName, eventCode, score,
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
    }
}

async function getLeaderboard(eventCode) {
    const scores = await getScoresByEvent(eventCode);
    return scores.sort((a, b) => b.score - a.score);
}

// ─── Round 2 Score Operations ──────────────────────────────

async function getScoresR2ByEvent(eventCode) {
    return await dbGetByIndex('scores_r2', 'eventCode', eventCode);
}

async function setScoreR2(teamName, eventCode, score) {
    let existing = null;
    try {
        existing = await dbGetOneByIndex('scores_r2', 'teamName_code', [teamName, eventCode]);
    } catch (e) { }

    if (existing) {
        existing.score = score;
        existing.updatedAt = Date.now();
        return await dbPut('scores_r2', existing);
    } else {
        return await dbAdd('scores_r2', {
            teamName, eventCode, score,
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
    }
}

async function getLeaderboardR2(eventCode) {
    const scores = await getScoresR2ByEvent(eventCode);
    return scores.sort((a, b) => b.score - a.score);
}

// ─── Reset Event ──────────────────────────────────────────

async function resetEvent(eventCode) {
    const event = await getEventByCode(eventCode);
    if (!event) return;

    const participants = await dbGetByIndex('participants', 'eventCode', eventCode);
    const scoresList = await dbGetByIndex('scores', 'eventCode', eventCode);
    const scoresR2List = await dbGetByIndex('scores_r2', 'eventCode', eventCode);

    const tx = db.transaction(['events', 'participants', 'scores', 'scores_r2'], 'readwrite');

    // Completely delete the event record instead of marking inactive
    tx.objectStore('events').delete(event.id);

    participants.forEach(p => tx.objectStore('participants').delete(p.id));
    scoresList.forEach(s => tx.objectStore('scores').delete(s.id));
    scoresR2List.forEach(s => tx.objectStore('scores_r2').delete(s.id));

    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
