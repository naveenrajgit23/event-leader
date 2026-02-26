/**
 * Event Leader – Main Application Logic (app.js)
 * Features: Admin phone login, per-admin events, Qualifier, Cumulative, Round 2 leaderboard
 */

// ─── Constants ─────────────────────────────────────────────
const RESET_DELAY_MS = 8 * 60 * 60 * 1000; // 8 hours
const LEADERBOARD_REFRESH_INTERVAL = 5000;  // 5 seconds

// ─── DevTools Detection & Block ───────────────────────────────
(function _devBlock() {
    const _threshold = 160;
    let _devOpen = false;

    function _check() {
        const widthDiff = window.outerWidth - window.innerWidth > _threshold;
        const heightDiff = window.outerHeight - window.innerHeight > _threshold;
        if (widthDiff || heightDiff) {
            if (!_devOpen) {
                _devOpen = true;
                document.body.innerHTML =
                    '<div style="display:grid;place-items:center;min-height:100vh;' +
                    'background:#05070f;font-family:Outfit,sans-serif;color:#ff5252;text-align:center;padding:40px">' +
                    '<div><div style="font-size:4rem;">🔒</div>' +
                    '<h1 style="font-size:2rem;margin:16px 0">Access Restricted</h1>' +
                    '<p style="color:#8892b0">Developer Tools are disabled on this platform.</p>' +
                    '<p style="color:#8892b0;margin-top:8px">Please close DevTools and refresh the page.</p>' +
                    '</div></div>';
            }
        } else {
            if (_devOpen) location.reload();
        }
    }
    setInterval(_check, 1000);

    document.addEventListener('keydown', function (e) {
        if (
            e.key === 'F12' ||
            (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) ||
            (e.ctrlKey && e.key === 'U')
        ) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
    }, true);

    document.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        return false;
    });
})();

// ─── State ────────────────────────────────────────────────
let currentAdmin = null;           // { id, name, phone }
let currentParticipantEventCode = null;
let currentParticipantTeam = null;
let currentParticipantEvents = [];  // All events this participant joined
let leaderboardInterval = null;
let adminDashboardEvent = null;
let adminDashboardInterval = null;
let resetTimerInterval = null;
let adminResetTimerInterval = null;
let confettiSpawned = false;

// ─── Session Persistence ───────────────────────────────────
function saveAdminSession(admin) {
    localStorage.setItem('el_admin', JSON.stringify(admin));
}
function clearAdminSession() {
    localStorage.removeItem('el_admin');
}
function getAdminSession() {
    try { return JSON.parse(localStorage.getItem('el_admin')); } catch { return null; }
}
function saveParticipantSession(data) {
    localStorage.setItem('el_participant', JSON.stringify(data));
}
function clearParticipantSession() {
    localStorage.removeItem('el_participant');
}
function getParticipantSession() {
    try { return JSON.parse(localStorage.getItem('el_participant')); } catch { return null; }
}

// ─── Initialization ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    document.querySelectorAll('.page').forEach(p => {
        p.style.display = 'none';
        p.classList.remove('active');
    });

    try {
        await initDB();
        console.log('Event Leader DB initialized successfully');
    } catch (err) {
        console.error('DB init error:', err);
        alert('Database initialization failed. Please refresh the page.');
        return;
    }

    // ── Restore Admin session if exists ──
    const savedAdmin = getAdminSession();
    if (savedAdmin) {
        // Verify admin still exists in DB
        const admin = await getAdminByPhone(savedAdmin.phone);
        if (admin) {
            currentAdmin = admin;
            document.getElementById('admin-display-name').textContent = admin.name;
            document.getElementById('admin-avatar').textContent = admin.name.charAt(0).toUpperCase();
            goto('admin-dashboard');
            showAdminTab('create-event-tab');
            loadAdminEvents();
            return;
        } else {
            clearAdminSession();
        }
    }

    // ── Restore Participant session if exists ──
    const savedParticipant = getParticipantSession();
    if (savedParticipant) {
        const event = await getEventByCode(savedParticipant.eventCode);
        if (event && event.isActive) {
            currentParticipantEventCode = savedParticipant.eventCode;
            currentParticipantTeam = savedParticipant.team;
            currentParticipantEvents = savedParticipant.allEvents || [{ code: savedParticipant.eventCode, team: savedParticipant.team }];
            showParticipantLeaderboard(event);
            return;
        } else {
            clearParticipantSession();
        }
    }

    // ── Check if opened via QR Code link ──
    const urlParams = new URLSearchParams(window.location.search);
    const joinCodeParams = urlParams.get('join');
    if (joinCodeParams) {
        // Pre-fill the input
        const codeInput = document.getElementById('p-code');
        if (codeInput) {
            codeInput.value = joinCodeParams.toUpperCase();
        }

        // Remove the parameter from the URL cleanly
        const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
        window.history.replaceState({ path: newUrl }, '', newUrl);

        goto('participation-form');
        return;
    }

    const landing = document.getElementById('landing-page');
    landing.style.display = 'flex';
    landing.classList.add('active');
});

// ─── Page Navigation ──────────────────────────────────────
function gotoParticipantBack() {
    if (currentParticipantEventCode) {
        goto('participant-leaderboard');
    } else {
        goto('landing-page');
    }
}

function goto(pageId) {
    document.querySelectorAll('.page').forEach(p => {
        p.style.display = 'none';
        p.classList.remove('active');
    });
    const target = document.getElementById(pageId);
    if (target) {
        target.style.display = 'flex';
        target.classList.add('active');
    }
    if (pageId !== 'participant-leaderboard') stopLeaderboardRefresh();
    if (pageId !== 'admin-dashboard') stopAdminDashboardRefresh();
}

// ─── Admin Login (Phone Number) ──────────────────────────
function togglePass() {
    const input = document.getElementById('admin-pass');
    input.type = input.type === 'password' ? 'text' : 'password';
}

async function adminLogin(e) {
    e.preventDefault();
    const name = document.getElementById('admin-name').value.trim();
    const phone = document.getElementById('admin-phone-login').value.trim();
    const password = document.getElementById('admin-pass').value.trim();
    const errEl = document.getElementById('login-error');

    if (!name || !phone || !password) {
        errEl.textContent = '❌ Please fill in all fields.';
        errEl.classList.remove('hidden');
        return;
    }

    // Fixed password check
    if (password !== 'MA230508@N') {
        errEl.textContent = '❌ Incorrect password.';
        errEl.classList.remove('hidden');
        return;
    }

    errEl.classList.add('hidden');

    // Register or fetch admin
    await registerAdmin(name, phone);
    const admin = await getAdminByPhone(phone);
    if (!admin) {
        errEl.textContent = '❌ Login failed. Please try again.';
        errEl.classList.remove('hidden');
        return;
    }

    currentAdmin = admin;
    saveAdminSession(admin);  // persist session
    document.getElementById('admin-display-name').textContent = admin.name;
    document.getElementById('admin-avatar').textContent = admin.name.charAt(0).toUpperCase();
    document.getElementById('admin-login-form').reset();
    goto('admin-dashboard');
    showAdminTab('create-event-tab');
    loadAdminEvents();
}

function adminLogout() {
    currentAdmin = null;
    adminDashboardEvent = null;
    clearAdminSession();  // clear session
    stopAdminDashboardRefresh();
    clearInterval(adminResetTimerInterval);
    document.getElementById('admin-login-form').reset();
    goto('landing-page');
}

// ─── Code Generator ──────────────────────────────────────
function generateCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    document.getElementById('event-code-display').value = code;
}

// ─── Admin Tab Switcher ──────────────────────────────────
function showAdminTab(tabId) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');

    const map = {
        'create-event-tab': 'nav-create',
        'events-tab': 'nav-events',
        'event-dashboard-tab': null
    };
    if (map[tabId]) {
        document.getElementById(map[tabId])?.classList.add('active');
    }
}

// ─── Create Event ─────────────────────────────────────────
async function handleCreateEvent(e) {
    e.preventDefault();
    const eventName = document.getElementById('event-name-input').value.trim();
    const code = document.getElementById('event-code-display').value.trim().toUpperCase();

    if (!code) { alert('Please generate a unique code first.'); return; }
    if (!eventName) { alert('Please enter an event name.'); return; }

    const unique = await isCodeUnique(code);
    if (!unique) { alert('This code already exists! Please generate a new one.'); return; }

    await createEvent(eventName, code, currentAdmin.phone);

    document.getElementById('create-event-form').reset();
    document.getElementById('event-code-display').value = '';

    // Automatically open the dashboard for the new event
    openEventDashboard(code);
    alert(`✅ Event "${eventName}" created! Code: ${code}`);
}

// ─── Load Admin Events (only THIS admin's events) ─────────
async function loadAdminEvents() {
    const container = document.getElementById('events-list');
    const events = await getEventsByAdmin(currentAdmin.phone);

    if (!events.length) {
        container.innerHTML = '<div class="empty-state-card">No events created yet. Go to "Create Event" to get started!</div>';
        return;
    }

    events.sort((a, b) => b.createdAt - a.createdAt);

    container.innerHTML = events.map(ev => {
        const date = new Date(ev.createdAt).toLocaleDateString('en-IN');
        const status = ev.isActive ? '🟢 Active' : '🔴 Reset';
        const winners = ev.winnersDeclaredAt ? `🏆 R1 Done` : '';
        const r2badge = ev.round2Active ? `<span class="r2-mini-badge">🔁 Round 2</span>` : '';
        return `
      <div class="event-card-item" onclick="openEventDashboard('${ev.code}')">
        <button class="event-card-delete" onclick="event.stopPropagation(); deleteEvent('${ev.code}')">🗑</button>
        <h3>${escHtml(ev.name)}</h3>
        <div class="event-card-code">📌 ${ev.code}</div>
        <div class="event-card-meta">
          <span>${status} ${winners} ${r2badge}</span>
          <span>${date}</span>
        </div>
      </div>
    `;
    }).join('');
}

async function deleteEvent(code) {
    if (!confirm('Delete this event? All participants and scores will be removed.')) return;
    await deleteEventByCode(code);
    loadAdminEvents();
}

// ─── Open Event Dashboard ─────────────────────────────────
async function openEventDashboard(code) {
    adminDashboardEvent = await getEventByCode(code);
    if (!adminDashboardEvent) return;

    document.getElementById('active-event-name').textContent = adminDashboardEvent.name;
    document.getElementById('active-event-code').textContent = adminDashboardEvent.code;

    updateEventStatusBadge();
    showAdminTab('event-dashboard-tab');
    refreshAdminDashboard();
    startAdminDashboardRefresh();

    // Generate QR Code
    const qrContainer = document.getElementById('event-qrcode');
    if (qrContainer) {
        qrContainer.innerHTML = '';
        const joinUrl = new URL(window.location.href);
        joinUrl.searchParams.set('join', code);
        new QRCode(qrContainer, {
            text: joinUrl.href,
            width: 128,
            height: 128,
            colorDark: "#05070f",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
        });
    }

    // Winners UI
    if (adminDashboardEvent.winnersDeclaredAt) {
        showWinnersDeclaredUI();
    } else {
        document.getElementById('winner-already-declared').classList.add('hidden');
        document.getElementById('winner-declare-form').classList.remove('hidden');
    }

    // Show/hide qualifier/cumulative buttons vs round 2 section
    renderRoundControlSection();
}

function updateEventStatusBadge() {
    const badge = document.getElementById('event-status-badge');
    if (!adminDashboardEvent) return;
    if (!adminDashboardEvent.isActive) {
        badge.textContent = 'Reset';
        badge.style.cssText = 'background:rgba(255,82,82,0.15);border-color:rgba(255,82,82,0.3);color:#ff5252;padding:8px 18px;border-radius:100px;font-weight:600;font-size:0.85rem;';
    } else if (adminDashboardEvent.round2Active) {
        badge.textContent = '🔁 Round 2 Active';
        badge.style.cssText = 'background:rgba(108,99,255,0.15);border-color:rgba(108,99,255,0.3);color:#6c63ff;padding:8px 18px;border-radius:100px;font-weight:600;font-size:0.85rem;';
    } else if (adminDashboardEvent.winnersDeclaredAt) {
        badge.textContent = '🏆 R1 Winners Set';
        badge.style.cssText = 'background:rgba(245,200,66,0.15);border-color:rgba(245,200,66,0.3);color:#f5c842;padding:8px 18px;border-radius:100px;font-weight:600;font-size:0.85rem;';
    } else {
        badge.textContent = '🟢 Active';
        badge.style.cssText = 'background:rgba(34,201,122,0.15);border-color:rgba(34,201,122,0.3);color:#22c97a;padding:8px 18px;border-radius:100px;font-weight:600;font-size:0.85rem;';
    }
}

// ─── Render Round Control Section ─────────────────────────
async function renderRoundControlSection() {
    const ev = adminDashboardEvent;
    if (!ev) return;

    const setupSection = document.getElementById('r2-setup-section');
    const activeSection = document.getElementById('r2-active-section');
    const waitingSection = document.getElementById('r2-waiting-section');

    // Reset visibility
    setupSection.classList.add('hidden');
    activeSection.classList.add('hidden');
    waitingSection.classList.add('hidden');

    if (ev.round2Active) {
        activeSection.classList.remove('hidden');
        updateRound2ActiveUI(ev);
    } else if (ev.winnersDeclaredAt) {
        setupSection.classList.remove('hidden');
    } else {
        waitingSection.classList.remove('hidden');
    }
}

function showQualifierSetup() {
    document.getElementById('qualifier-setup-ui').classList.remove('hidden');
    document.getElementById('cumulative-setup-ui').classList.add('hidden');

    // Update count display
    getParticipantsByEvent(adminDashboardEvent.code).then(list => {
        const el = document.getElementById('qualifier-total-count-display');
        if (el) el.textContent = list.length;
    });
}

async function showCumulativeSetup() {
    document.getElementById('cumulative-setup-ui').classList.remove('hidden');
    document.getElementById('qualifier-setup-ui').classList.add('hidden');

    const participants = await getParticipantsByEvent(adminDashboardEvent.code);
    const el = document.getElementById('cumulative-all-count-display');
    if (el) el.textContent = participants.length;
}

async function updateRound2ActiveUI(ev) {
    const modeBadge = document.getElementById('r2-mode-badge-display');
    const teamsList = document.getElementById('r2-teams-list-display');
    const scoreEntryTable = document.getElementById('r2-team-dropdown');

    modeBadge.textContent = ev.round2Mode === 'qualifier'
        ? `🎯 Qualifier (Top ${ev.round2TopN} from R1)`
        : `📊 Cumulative (All Participants)`;

    teamsList.textContent = ev.round2Teams.join(', ') || 'None';

    // Update Team Dropdown only if changed
    if (scoreEntryTable.options.length <= 1) {
        scoreEntryTable.innerHTML = '<option value="">-- Select Team --</option>' +
            ev.round2Teams.map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join('');
    }

    // Locked notice
    const lockedNotice = document.getElementById('r2-locked-notice');
    const entryControls = document.getElementById('r2-score-entry-controls');
    const winnersForm = document.getElementById('r2-winners-form');
    const winnersMsg = document.getElementById('r2-winners-set-msg');

    if (ev.round2WinnersDeclaredAt) {
        lockedNotice.classList.remove('hidden');
        entryControls.style.opacity = '0.4';
        entryControls.style.pointerEvents = 'none';
        winnersForm.classList.add('hidden');
        winnersMsg.classList.remove('hidden');
    } else {
        lockedNotice.classList.add('hidden');
        entryControls.style.opacity = '1';
        entryControls.style.pointerEvents = 'auto';
        winnersForm.classList.remove('hidden');
        winnersMsg.classList.add('hidden');
    }

    // Always refresh leaderboard data
    refreshR2Leaderboard();
}

// ─── Start Qualifier Round 2 ──────────────────────────────
async function startQualifierRound2() {
    const topN = parseInt(document.getElementById('qualifier-topn-input').value);
    if (!topN || topN < 1) {
        alert('Please enter a valid number for top N.');
        return;
    }

    const lb = await getLeaderboard(adminDashboardEvent.code);
    if (!lb.length) {
        alert('No scores recorded for Round 1. Please add scores first.');
        return;
    }

    const qualifiedTeams = lb.slice(0, topN).map(s => s.teamName);
    if (!confirm(`Advance Top ${topN} teams to Round 2?\n\nTeams: ${qualifiedTeams.join(', ')}`)) return;

    adminDashboardEvent.round2Mode = 'qualifier';
    adminDashboardEvent.round2TopN = topN;
    adminDashboardEvent.round2Active = true;
    adminDashboardEvent.round2WinnersCount = 0;
    adminDashboardEvent.round2WinnersDeclaredAt = null;
    adminDashboardEvent.round2Teams = qualifiedTeams;
    await updateEvent(adminDashboardEvent);

    updateEventStatusBadge();
    renderRoundControlSection();
    await refreshAdminDashboard();
}

// ─── Start Cumulative Round 2 ─────────────────────────────
async function startCumulativeRound2() {
    const participants = await getParticipantsByEvent(adminDashboardEvent.code);
    if (!participants.length) {
        alert('No participants found.');
        return;
    }
    const allTeams = [...new Set(participants.map(p => p.teamName))];
    if (!confirm(`Start Cumulative Round 2 for all ${allTeams.length} teams?`)) return;

    adminDashboardEvent.round2Mode = 'cumulative';
    adminDashboardEvent.round2TopN = 0;
    adminDashboardEvent.round2Active = true;
    adminDashboardEvent.round2WinnersCount = 0;
    adminDashboardEvent.round2WinnersDeclaredAt = null;
    adminDashboardEvent.round2Teams = allTeams;
    await updateEvent(adminDashboardEvent);

    updateEventStatusBadge();
    renderRoundControlSection();
    await refreshAdminDashboard();
    alert(`✅ Round 2 started (Cumulative mode)! All ${allTeams.length} teams advanced.`);
}

// Removed buildRound2ActiveUI as it is now static ─────────────────


// ─── Submit Round 2 Score ─────────────────────────────────
async function submitScoreR2() {
    const team = document.getElementById('r2-team-dropdown').value;
    const scoreVal = document.getElementById('r2-score-val-input').value;

    if (adminDashboardEvent && adminDashboardEvent.round2WinnersDeclaredAt) {
        showR2ScoreFeedback('🔒 R2 scores locked.', 'error');
        return;
    }
    if (!team) { showR2ScoreFeedback('Please select a team.', 'error'); return; }
    if (scoreVal === '' || isNaN(scoreVal) || Number(scoreVal) < 0) {
        showR2ScoreFeedback('Please enter a valid score.', 'error'); return;
    }

    await setScoreR2(team, adminDashboardEvent.code, Number(scoreVal));
    document.getElementById('r2-score-val-input').value = '';
    showR2ScoreFeedback(`✅ R2 Score ${scoreVal} saved for ${team}`, 'success');
    await refreshR2Leaderboard();
}

function showR2ScoreFeedback(msg, type) {
    const el = document.getElementById('r2-score-msg-feedback');
    if (!el) return;
    el.textContent = msg;
    el.className = `score-feedback ${type}`;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
}

// ─── Declare Round 2 Winners ──────────────────────────────
async function declareWinnersR2() {
    const countInput = document.getElementById('r2-winner-count-final');
    const count = parseInt(countInput.value);
    if (!count || count < 1) { alert('Please enter a valid number of winners.'); return; }

    const lbR2 = await getLeaderboardR2(adminDashboardEvent.code);
    if (!lbR2.length) { alert('No Round 2 scores recorded yet.'); return; }

    const mode = adminDashboardEvent.round2Mode;
    const msg = mode === 'cumulative'
        ? `Declare Top ${count} winners by Cumulative score (R1 + R2)?\nThis starts the 8-hour reset countdown.`
        : `Declare Top ${count} winners by Round 2 score? This starts the 8-hour reset countdown.`;

    if (!confirm(msg)) return;

    adminDashboardEvent.round2WinnersCount = count;
    adminDashboardEvent.round2WinnersDeclaredAt = Date.now();
    await updateEvent(adminDashboardEvent);

    renderRoundControlSection();
    await refreshAdminDashboard();
    startAdminR2ResetTimer();
    updateEventStatusBadge();
    alert(`✅ Round 2 winners declared! Top ${count} teams.`);
}

// ─── R2 Leaderboard Render ────────────────────────────────
async function refreshR2Leaderboard() {
    if (!adminDashboardEvent || !adminDashboardEvent.round2Active) return;

    const ev = adminDashboardEvent;
    const tbody = document.getElementById('r2-leaderboard-body');
    if (!tbody) return;

    const lbR1 = await getLeaderboard(ev.code);
    const lbR2 = await getLeaderboardR2(ev.code);

    const participants = await getParticipantsByEvent(ev.code);
    const teamMembersMap = {};
    participants.forEach(p => {
        if (!teamMembersMap[p.teamName]) teamMembersMap[p.teamName] = [];
        teamMembersMap[p.teamName].push(p.name);
    });

    // Build map of R1 scores
    const r1Map = {};
    lbR1.forEach(s => { r1Map[s.teamName] = s.score; });

    // Build merged list for round 2 teams
    const mergedList = ev.round2Teams.map(team => {
        const r1 = r1Map[team] || 0;
        const r2Entry = lbR2.find(s => s.teamName === team);
        const r2 = r2Entry ? r2Entry.score : null;
        const final = (ev.round2Mode === 'cumulative' && r2 !== null)
            ? (r1 + r2)
            : (r2 !== null ? r2 : null);
        return { team, r1, r2, final };
    });

    // Sort by final score desc (null = unscored goes last)
    mergedList.sort((a, b) => {
        if (a.final === null && b.final === null) return 0;
        if (a.final === null) return 1;
        if (b.final === null) return -1;
        return b.final - a.final;
    });

    const winCount = ev.round2WinnersDeclaredAt ? ev.round2WinnersCount : 0;
    const isCumulative = ev.round2Mode === 'cumulative';

    if (!mergedList.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No teams in Round 2</td></tr>';
        return;
    }

    tbody.innerHTML = mergedList.map((entry, idx) => {
        const rank = idx + 1;
        const isWinner = winCount > 0 && rank <= winCount && entry.final !== null;
        const badge = getRankBadge(rank);
        const r2Display = entry.r2 !== null ? entry.r2 : '<span style="color:#666;">—</span>';
        const finalDisplay = entry.final !== null
            ? `<strong style="color:${isWinner ? '#f5c842' : '#6c63ff'};">${entry.final.toFixed(1)}</strong>`
            : '<span style="color:#666;">—</span>';

        // Final column header visibility
        const finalCol = document.getElementById('r2-final-col-header');
        if (finalCol) {
            if (isCumulative) finalCol.classList.remove('hidden');
            else finalCol.classList.add('hidden');
        }

        const membersDisp = teamMembersMap[entry.team] ? teamMembersMap[entry.team].join(', ') : '';
        return `
      <tr class="${rank <= 3 ? 'rank-' + rank : ''} ${isWinner ? 'winner-row' : ''}">
        <td>${badge}</td>
        <td>
          <div>${escHtml(entry.team)} ${isWinner ? '🏆' : ''}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${escHtml(membersDisp)}</div>
        </td>
        <td class="score-val" style="color:#8892b0;">${entry.r1}</td>
        <td class="score-val">${r2Display}</td>
        ${isCumulative ? `<td class="score-val">${finalDisplay}</td>` : ''}
        <td>
          <div class="status-indicator ${isWinner ? 'active' : ''}">
            ${isWinner ? 'Winner' : (entry.final !== null ? 'Scored' : 'Unscored')}
          </div>
        </td>
      </tr>
    `;
    }).join('');
}

// ─── Admin Dashboard Refresh ──────────────────────────────
async function refreshAdminDashboard() {
    if (!adminDashboardEvent) return;
    const code = adminDashboardEvent.code;

    adminDashboardEvent = await getEventByCode(code);

    // Participants
    const participants = await getParticipantsByEvent(code);
    document.getElementById('participant-count').textContent = participants.length;

    const pBody = document.getElementById('participants-list-body');
    if (!participants.length) {
        pBody.innerHTML = '<tr><td colspan="5" class="empty-state">No participants yet</td></tr>';
    } else {
        const sorted = [...participants].sort((a, b) => a.joinedAt - b.joinedAt);
        pBody.innerHTML = sorted.map((p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escHtml(p.name)}</td>
        <td>${escHtml(p.teamName)}</td>
        <td>${escHtml(p.phone)}</td>
        <td>${new Date(p.joinedAt).toLocaleTimeString('en-IN')}</td>
      </tr>
    `).join('');
    }

    // Team select for R1 scores
    const teamSelect = document.getElementById('team-select');
    const teamsInLb = await getLeaderboard(code);
    const teamsWithScores = new Set(teamsInLb.map(s => s.teamName));
    const allTeams = [...new Set(participants.map(p => p.teamName))];

    let newOptionsHtml = '<option value="">-- Select Team --</option>';
    allTeams.forEach(t => {
        const scoreDisp = teamsWithScores.has(t) ? ` (${teamsInLb.find(s => s.teamName === t)?.score ?? 0} pts)` : ' (no score)';
        newOptionsHtml += `<option value="${escHtml(t)}">${escHtml(t + scoreDisp)}</option>`;
    });

    if (teamSelect.getAttribute('data-last-html') !== newOptionsHtml) {
        const currentVal = teamSelect.value;
        teamSelect.innerHTML = newOptionsHtml;
        if (currentVal) teamSelect.value = currentVal;
        teamSelect.setAttribute('data-last-html', newOptionsHtml);
    }

    // Admin R1 leaderboard
    const lb = await getLeaderboard(code);
    const aLbBody = document.getElementById('admin-leaderboard-body');
    const winCount = adminDashboardEvent.winnersDeclaredAt ? adminDashboardEvent.winnersCount : 0;

    if (!lb.length) {
        aLbBody.innerHTML = '<tr><td colspan="4" class="empty-state">No scores yet</td></tr>';
    } else {
        const teamMembersMap = {};
        participants.forEach(p => {
            if (!teamMembersMap[p.teamName]) teamMembersMap[p.teamName] = [];
            teamMembersMap[p.teamName].push(p.name);
        });

        aLbBody.innerHTML = lb.map((entry, idx) => {
            const rank = idx + 1;
            const isWinner = winCount > 0 && rank <= winCount;
            const badge = getRankBadge(rank);
            const membersDisp = teamMembersMap[entry.teamName] ? teamMembersMap[entry.teamName].join(', ') : '';
            return `
        <tr class="${rank <= 3 ? 'rank-' + rank : ''} ${isWinner ? 'winner-row' : ''}">
          <td>${badge}</td>
          <td>
            <div>${escHtml(entry.teamName)} ${isWinner ? '🏆' : ''}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">${escHtml(membersDisp)}</div>
          </td>
          <td class="score-val">${entry.score}</td>
          <td>${isWinner ? '<span style="color:#f5c842;font-weight:600;">R1 Winner</span>' : '—'}</td>
        </tr>
      `;
        }).join('');
    }

    // Lock/unlock R1 score entry
    const lockNotice = document.getElementById('score-locked-notice');
    const entryControls = document.getElementById('score-entry-controls');
    if (adminDashboardEvent && adminDashboardEvent.winnersDeclaredAt) {
        if (lockNotice) lockNotice.classList.remove('hidden');
        if (entryControls) { entryControls.style.opacity = '0.4'; entryControls.style.pointerEvents = 'none'; }
    } else {
        if (lockNotice) lockNotice.classList.add('hidden');
        if (entryControls) { entryControls.style.opacity = '1'; entryControls.style.pointerEvents = 'auto'; }
    }

    // Reset countdown admin
    if (adminDashboardEvent.winnersDeclaredAt) {
        const elapsed = Date.now() - adminDashboardEvent.winnersDeclaredAt;
        const remaining = RESET_DELAY_MS - elapsed;
        if (remaining <= 0) {
            await resetEvent(adminDashboardEvent.code);
            showAdminTab('events-tab');
            loadAdminEvents();
            alert('This event has expired (8 hours) and been automatically removed.');
        }
    }

    // Refresh R2 leaderboard if active
    if (adminDashboardEvent.round2Active) {
        await refreshR2Leaderboard();
    }

    // Update round control section
    renderRoundControlSection();

    // Participant count for setup forms
    const qTotal = document.getElementById('qualifier-total-count-display');
    if (qTotal) qTotal.textContent = participants.length;
    const cTotal = document.getElementById('cumulative-all-count-display');
    if (cTotal) cTotal.textContent = participants.length;
}

function startAdminDashboardRefresh() {
    stopAdminDashboardRefresh();
    adminDashboardInterval = setInterval(refreshAdminDashboard, LEADERBOARD_REFRESH_INTERVAL);
}
function stopAdminDashboardRefresh() {
    if (adminDashboardInterval) { clearInterval(adminDashboardInterval); adminDashboardInterval = null; }
}

// ─── Score Entry (Round 1) ────────────────────────────────
async function submitScore() {
    const team = document.getElementById('team-select').value;
    const scoreVal = document.getElementById('score-input').value;
    const btn = document.getElementById('score-save-btn');
    const loader = document.getElementById('score-save-loader');
    const span = btn.querySelector('span');

    if (adminDashboardEvent && adminDashboardEvent.winnersDeclaredAt) {
        showScoreFeedback('🔒 Cannot change scores — Round 1 winners already declared.', 'error');
        return;
    }
    if (!team) { showScoreFeedback('Please select a team.', 'error'); return; }
    if (scoreVal === '' || isNaN(scoreVal) || Number(scoreVal) < 0) {
        showScoreFeedback('Please enter a valid score.', 'error'); return;
    }

    // Performance fix: Show feedback immediately and don't block
    btn.disabled = true;
    loader.classList.remove('hidden');
    span.style.opacity = '0';

    try {
        await setScore(team, adminDashboardEvent.code, Number(scoreVal));
        document.getElementById('score-input').value = '';
        showScoreFeedback(`✅ Score ${scoreVal} saved for ${team}`, 'success');
        // Refresh table silently in background
        refreshAdminDashboard();
    } catch (err) {
        showScoreFeedback('❌ Failed to save. Check your connection.', 'error');
    } finally {
        btn.disabled = false;
        loader.classList.add('hidden');
        span.style.opacity = '1';
    }
}

function showScoreFeedback(msg, type) {
    const el = document.getElementById('score-msg');
    el.textContent = msg;
    el.className = `score-feedback ${type}`;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
}

// ─── Declare Round 1 Winners ──────────────────────────────
async function declareWinners() {
    const countInput = document.getElementById('winner-count');
    const count = parseInt(countInput.value);

    if (!count || count < 1) { alert('Please enter a valid number of winners.'); return; }

    const lb = await getLeaderboard(adminDashboardEvent.code);
    if (!lb.length) { alert('No scores recorded yet. Cannot declare winners.'); return; }

    if (!confirm(`Declare Top ${count} teams as Round 1 Winners? This will start the 8-hour reset countdown.`)) return;

    adminDashboardEvent.winnersDeclaredAt = Date.now();
    adminDashboardEvent.winnersCount = count;
    await updateEvent(adminDashboardEvent);

    showWinnersDeclaredUI();
    startAdminResetTimer();
    await refreshAdminDashboard();
    updateEventStatusBadge();

    const badge = document.getElementById('event-status-badge');
    badge.textContent = '🏆 R1 Winners Set';
    badge.style.cssText = 'background:rgba(245,200,66,0.15);border-color:rgba(245,200,66,0.3);color:#f5c842;padding:8px 18px;border-radius:100px;font-weight:600;font-size:0.85rem;';
}

function showWinnersDeclaredUI() {
    document.getElementById('winner-already-declared').classList.remove('hidden');
    document.getElementById('winner-declare-form').classList.add('hidden');
    startAdminResetTimer();
}

function startAdminResetTimer() {
    clearInterval(adminResetTimerInterval);
    function updateTimer() {
        if (!adminDashboardEvent) return;
        const declaredAt = adminDashboardEvent.round2WinnersDeclaredAt || adminDashboardEvent.winnersDeclaredAt;
        if (!declaredAt) return;

        const elapsed = Date.now() - declaredAt;
        const remaining = Math.max(0, RESET_DELAY_MS - elapsed);
        const el = document.getElementById('admin-reset-timer');
        if (el) el.textContent = formatTime(remaining);
        if (remaining === 0) {
            clearInterval(adminResetTimerInterval);
            resetEvent(adminDashboardEvent.code).then(() => {
                showAdminTab('events-tab');
                loadAdminEvents();
            });
        }
    }
    updateTimer();
    adminResetTimerInterval = setInterval(updateTimer, 1000);
}

function startAdminR2ResetTimer() {
    // R2 shares the same 8h reset clock from R1 winner declaration
    startAdminResetTimer();
}

// ─── Participant Registration ─────────────────────────────
async function registerParticipant(e) {
    e.preventDefault();

    const name = document.getElementById('p-name').value.trim();
    const phone = document.getElementById('p-phone').value.trim();
    const team = document.getElementById('p-team').value.trim();
    const code = document.getElementById('p-code').value.trim().toUpperCase();

    const errEl = document.getElementById('reg-error');
    const dupEl = document.getElementById('reg-dup-error');
    errEl.classList.add('hidden');
    dupEl.classList.add('hidden');

    const submitBtn = document.getElementById('reg-submit-btn');
    submitBtn.disabled = true;
    submitBtn.querySelector('span').textContent = 'Validating...';

    const event = await getEventByCode(code);
    if (!event || !event.isActive) {
        errEl.textContent = '❌ Invalid Event Code. Please check and try again.';
        errEl.classList.remove('hidden');
        submitBtn.disabled = false;
        submitBtn.querySelector('span').textContent = 'Join Event';
        return;
    }

    const isDup = await isParticipantRegistered(phone, code);
    if (isDup) {
        dupEl.classList.remove('hidden');
        submitBtn.disabled = false;
        submitBtn.querySelector('span').textContent = 'Join Event';
        return;
    }

    await addParticipant(name, phone, team, code);

    currentParticipantEventCode = code;
    currentParticipantTeam = team;

    // Multi-event logic
    if (!currentParticipantEvents.some(ex => ex.code === code)) {
        currentParticipantEvents.push({ code: code, name: event.name, team: team });
    }

    saveParticipantSession({
        eventCode: code,
        team: team,
        allEvents: currentParticipantEvents
    });

    document.getElementById('participant-register-form').reset();
    submitBtn.disabled = false;
    submitBtn.querySelector('span').textContent = 'Join Event';

    showParticipantLeaderboard(event);
}

// ─── Participant Leaderboard ──────────────────────────────
function showParticipantLeaderboard(event) {
    document.getElementById('lb-event-name').textContent = event.name;
    document.getElementById('lb-team-name').querySelector('strong').textContent = currentParticipantTeam;

    // Populate switcher if multiple events
    const switcherContainer = document.getElementById('event-switcher-container');
    const switcher = document.getElementById('event-switcher');

    switcherContainer.classList.remove('hidden');
    if (currentParticipantEvents.length > 1) {
        switcher.disabled = false;
        switcher.innerHTML = currentParticipantEvents.map(ev =>
            `<option value="${ev.code}" ${ev.code === currentParticipantEventCode ? 'selected' : ''}>${escHtml(ev.name)} (${ev.code})</option>`
        ).join('');
    } else {
        switcher.disabled = true;
        switcher.innerHTML = `<option value="${event.code}">${escHtml(event.name)} (${event.code})</option>`;
    }

    goto('participant-leaderboard');
    renderParticipantLeaderboard();
    startLeaderboardRefresh();
}

async function switchParticipantEvent(code) {
    const eventData = currentParticipantEvents.find(e => e.code === code);
    if (!eventData) return;

    const event = await getEventByCode(code);
    if (!event) {
        alert('This event is no longer active.');
        // Remove from list
        currentParticipantEvents = currentParticipantEvents.filter(e => e.code !== code);
        saveParticipantSession({
            eventCode: currentParticipantEvents[0]?.code || null,
            team: currentParticipantEvents[0]?.team || null,
            allEvents: currentParticipantEvents
        });
        if (currentParticipantEvents.length === 0) exitLeaderboard();
        else switchParticipantEvent(currentParticipantEvents[0].code);
        return;
    }

    currentParticipantEventCode = code;
    currentParticipantTeam = eventData.team;

    saveParticipantSession({
        eventCode: code,
        team: eventData.team,
        allEvents: currentParticipantEvents
    });

    showParticipantLeaderboard(event);
}

async function renderParticipantLeaderboard() {
    if (!currentParticipantEventCode) return;

    const event = await getEventByCode(currentParticipantEventCode);
    if (!event) {
        exitLeaderboard();
        alert('This event has ended and is no longer available.');
        return;
    }

    const isRound2 = event.round2Active;
    const round2ModeLabel = isRound2
        ? (event.round2Mode === 'cumulative' ? '📊 Cumulative' : '🎯 Qualifier')
        : '';

    // Update round label in header
    const roundLabel = document.getElementById('lb-round-label');
    if (roundLabel) {
        if (isRound2) {
            roundLabel.textContent = `Round 2 – ${round2ModeLabel}`;
            roundLabel.classList.remove('hidden');
        } else {
            roundLabel.classList.add('hidden');
        }
    }

    // Determine which leaderboard to show
    const lbR1 = await getLeaderboard(currentParticipantEventCode);
    const lbR2 = isRound2 ? await getLeaderboardR2(currentParticipantEventCode) : [];
    const tbody = document.getElementById('leaderboard-body');

    const participants = await getParticipantsByEvent(currentParticipantEventCode);
    const teamMembersMap = {};
    participants.forEach(p => {
        if (!teamMembersMap[p.teamName]) teamMembersMap[p.teamName] = [];
        teamMembersMap[p.teamName].push(p.name);
    });

    let displayList;

    if (isRound2) {
        const r2Teams = event.round2Teams || [];
        const r1Map = {};
        lbR1.forEach(s => { r1Map[s.teamName] = s.score; });

        const r2Map = {};
        lbR2.forEach(s => { r2Map[s.teamName] = s.score; });

        displayList = r2Teams.map(team => {
            const r1 = r1Map[team] || 0;
            const r2 = r2Map.hasOwnProperty(team) ? r2Map[team] : null;
            const final = (event.round2Mode === 'cumulative' && r2 !== null)
                ? (r1 + r2)
                : (r2 !== null ? r2 : null);
            return { teamName: team, score: final, r1, r2 };
        });

        displayList.sort((a, b) => {
            if (a.score === null && b.score === null) return 0;
            if (a.score === null) return 1;
            if (b.score === null) return -1;
            return b.score - a.score;
        });
    } else {
        displayList = lbR1.map(e => ({ teamName: e.teamName, score: e.score }));
    }

    const winCount = isRound2
        ? (event.round2WinnersDeclaredAt ? event.round2WinnersCount : 0)
        : (event.winnersDeclaredAt ? event.winnersCount : 0);

    // Update leaderboard table header
    const lbHead = document.getElementById('leaderboard-thead');
    if (lbHead) {
        if (isRound2 && event.round2Mode === 'cumulative') {
            lbHead.innerHTML = '<tr><th>Rank</th><th>Team</th><th>R1 Score</th><th>R2 Score</th><th>Final Score</th><th>Status</th></tr>';
        } else if (isRound2) {
            lbHead.innerHTML = '<tr><th>Rank</th><th>Team</th><th>R1 Qualification</th><th>Round 2 Score</th><th>Status</th></tr>';
        } else {
            lbHead.innerHTML = '<tr><th>Rank</th><th>Team</th><th>Score</th><th>Status</th></tr>';
        }
    }

    if (!displayList.length) {
        const cols = (isRound2 && event.round2Mode === 'cumulative') ? 6 : (isRound2 ? 5 : 4);
        tbody.innerHTML = `<tr><td colspan="${cols}" class="empty-state">No scores yet – check back soon!</td></tr>`;
    } else {
        tbody.innerHTML = displayList.map((entry, idx) => {
            const rank = idx + 1;
            const isWinner = winCount > 0 && rank <= winCount && entry.score !== null;
            const isMyTeam = entry.teamName === currentParticipantTeam;
            const badge = getRankBadge(rank);
            const scoreDisp = entry.score !== null ? entry.score.toFixed(entry.score % 1 === 0 ? 0 : 1) : '—';
            const membersDisp = teamMembersMap[entry.teamName] ? teamMembersMap[entry.teamName].join(', ') : '';

            if (isRound2 && event.round2Mode === 'cumulative') {
                return `
          <tr class="${rank <= 3 ? 'rank-' + rank : ''} ${isWinner ? 'winner-row' : ''}" 
              style="${isMyTeam ? 'outline:2px solid var(--accent);outline-offset:-1px;' : ''}">
            <td>${badge}</td>
            <td>
              <div>${escHtml(entry.teamName)} ${isMyTeam ? '<span style="color:var(--accent);font-size:0.75rem;">(You)</span>' : ''} ${isWinner ? '🏆' : ''}</div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">${escHtml(membersDisp)}</div>
            </td>
            <td style="color:#8892b0;">${entry.r1 ?? '—'}</td>
            <td>${entry.r2 !== null ? entry.r2 : '—'}</td>
            <td class="score-val">${scoreDisp}</td>
            <td>${isWinner ? '<span style="color:#f5c842;font-weight:600;">Winner! 🥇</span>' : (rank === 1 && entry.score !== null ? '<span style="color:#f5c842;">Leading</span>' : '—')}</td>
          </tr>`;
            } else if (isRound2) {
                return `
          <tr class="${rank <= 3 ? 'rank-' + rank : ''} ${isWinner ? 'winner-row' : ''}" 
              style="${isMyTeam ? 'outline:2px solid var(--accent);outline-offset:-1px;' : ''}">
            <td>${badge}</td>
            <td>
              <div>${escHtml(entry.teamName)} ${isMyTeam ? '<span style="color:var(--accent);font-size:0.75rem;">(You)</span>' : ''} ${isWinner ? '🏆' : ''}</div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">${escHtml(membersDisp)}</div>
            </td>
            <td style="color:#8892b0;">${entry.r1 ?? '—'}</td>
            <td class="score-val">${entry.r2 !== null ? entry.r2 : '—'}</td>
            <td>${isWinner ? '<span style="color:#f5c842;font-weight:600;">Winner! 🥇</span>' : (rank === 1 && entry.score !== null ? '<span style="color:#f5c842;">Leading</span>' : '—')}</td>
          </tr>`;
            } else {
                return `
          <tr class="${rank <= 3 ? 'rank-' + rank : ''} ${isWinner ? 'winner-row' : ''}" 
              style="${isMyTeam ? 'outline:2px solid var(--accent);outline-offset:-1px;' : ''}">
            <td>${badge}</td>
            <td>
              <div>${escHtml(entry.teamName)} ${isMyTeam ? '<span style="color:var(--accent);font-size:0.75rem;">(You)</span>' : ''} ${isWinner ? '🏆' : ''}</div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">${escHtml(membersDisp)}</div>
            </td>
            <td class="score-val">${scoreDisp}</td>
            <td>${isWinner ? '<span style="color:#f5c842;font-weight:600;">Winner! 🥇</span>' : (rank === 1 ? '<span style="color:#f5c842;">Leading</span>' : '—')}</td>
          </tr>`;
            }
        }).join('');
    }

    // Winner banner
    const finalWinnersDeclared = isRound2
        ? (event.round2WinnersDeclaredAt && event.round2WinnersCount > 0)
        : (event.winnersDeclaredAt && event.winnersCount > 0);

    const bannerEl = document.getElementById('winner-banner');
    if (finalWinnersDeclared) {
        bannerEl.classList.remove('hidden');
        const wCount = isRound2 ? event.round2WinnersCount : event.winnersCount;
        const roundTxt = isRound2 ? 'Round 2 ' : '';
        document.getElementById('winner-desc').textContent = `Congratulations to the ${roundTxt}Top ${wCount} Teams!`;
        spawnConfetti();

        const resetBanner = document.getElementById('reset-countdown-banner');
        resetBanner.classList.remove('hidden');
        const latestDeclaration = event.round2WinnersDeclaredAt || event.winnersDeclaredAt;
        updateParticipantResetTimer(latestDeclaration);
    } else {
        bannerEl.classList.add('hidden');
    }

    leaderboardCountdown = 5;
    const cdEl = document.getElementById('refresh-countdown');
    if (cdEl) cdEl.textContent = '5s';
}

function startLeaderboardRefresh() {
    stopLeaderboardRefresh();
    leaderboardInterval = setInterval(async () => {
        await renderParticipantLeaderboard();
    }, LEADERBOARD_REFRESH_INTERVAL);
}

function stopLeaderboardRefresh() {
    if (leaderboardInterval) { clearInterval(leaderboardInterval); leaderboardInterval = null; }
    if (resetTimerInterval) { clearInterval(resetTimerInterval); resetTimerInterval = null; }
}

let leaderboardCountdown = 5;

function exitLeaderboard() {
    stopLeaderboardRefresh();
    currentParticipantEventCode = null;
    currentParticipantTeam = null;
    currentParticipantEvents = [];
    clearParticipantSession();  // clear session on explicit exit
    document.getElementById('winner-banner').classList.add('hidden');
    document.getElementById('reset-countdown-banner').classList.add('hidden');
    goto('landing-page');
}

function updateParticipantResetTimer(declaredAt) {
    clearInterval(resetTimerInterval);
    function tick() {
        const elapsed = Date.now() - declaredAt;
        const remaining = Math.max(0, RESET_DELAY_MS - elapsed);
        const el = document.getElementById('reset-timer-display');
        if (el) el.textContent = formatTime(remaining);
        if (remaining === 0) clearInterval(resetTimerInterval);
    }
    tick();
    resetTimerInterval = setInterval(tick, 1000);
}

// ─── Confetti ────────────────────────────────────────────
function spawnConfetti() {
    if (confettiSpawned) return;
    confettiSpawned = true;
    const area = document.getElementById('confetti-area');
    if (!area) return;
    const colors = ['#f5c842', '#6c63ff', '#ff6b9d', '#22c97a', '#fff', '#ff5252'];
    for (let i = 0; i < 60; i++) {
        const el = document.createElement('div');
        el.className = 'confetti-piece';
        el.style.cssText = `
      left:${Math.random() * 100}%;
      background:${colors[Math.floor(Math.random() * colors.length)]};
      width:${6 + Math.random() * 8}px;
      height:${6 + Math.random() * 8}px;
      animation-duration:${2 + Math.random() * 4}s;
      animation-delay:${Math.random() * 3}s;
      border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
    `;
        area.appendChild(el);
    }
}

// ─── Utilities ────────────────────────────────────────────
function getRankBadge(rank) {
    if (rank === 1) return '<span class="rank-badge r1">🥇</span>';
    if (rank === 2) return '<span class="rank-badge r2">🥈</span>';
    if (rank === 3) return '<span class="rank-badge r3">🥉</span>';
    return `<span class="rank-badge rn">${rank}</span>`;
}

function formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function escHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}
