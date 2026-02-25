/**
 * Event Leader - Google Apps Script Backend (Database)
 * 
 * Instructions:
 * 1. Open Google Sheets (sheets.google.com).
 * 2. Create a new Sheet and name it "EventLeaderDB".
 * 3. Go to Extensions > Apps Script.
 * 4. Paste this code.
 * 5. Click "Deploy" > "New Deployment".
 * 6. Select Type: "Web App".
 * 7. Set "Execute as": Me.
 * 8. Set "Who has access": Everyone.
 * 9. Copy the Web App URL and paste it into the app's config.
 */

const SCRIPT_PROP = PropertiesService.getScriptProperties();

function doGet(e) {
    return handleRequest(e);
}

function doPost(e) {
    return handleRequest(e);
}

function handleRequest(e) {
    var action = e.parameter.action;
    var payload = e.postData ? JSON.parse(e.postData.contents) : e.parameter;

    try {
        switch (action) {
            case 'getEvent':
                return reply(getData('events', 'code', payload.code));
            case 'getAdminEvents':
                return reply(getDataList('events', 'adminPhone', payload.phone));
            case 'createEvent':
                return reply(addData('events', payload));
            case 'updateEvent':
                return reply(updateData('events', 'code', payload.code, payload));
            case 'deleteEvent':
                return reply(deleteEventData(payload.code));
            case 'registerAdmin':
                return reply(registerAdmin(payload));
            case 'getAdmin':
                return reply(getData('admins', 'phone', payload.phone));
            case 'addParticipant':
                return reply(addData('participants', payload));
            case 'getParticipants':
                return reply(getDataList('participants', 'eventCode', payload.code));
            case 'setScore':
                return reply(setScoreData('scores', payload));
            case 'setScoreR2':
                return reply(setScoreData('scores_r2', payload));
            case 'getLeaderboard':
                return reply(getLeaderboardData('scores', payload.code));
            case 'getLeaderboardR2':
                return reply(getLeaderboardData('scores_r2', payload.code));
            case 'resetEvent':
                return reply(resetEventData(payload.code));
            default:
                return reply({ error: 'Invalid action' });
        }
    } catch (err) {
        return reply({ error: err.toString() });
    }
}

function reply(data) {
    return ContentService.createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
}

// --- DB Logic ---

function getSheet(name) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
        sheet = ss.insertSheet(name);
        // Add headers if new
        var headers = {
            'admins': ['phone', 'name', 'createdAt'],
            'events': ['code', 'name', 'adminPhone', 'createdAt', 'isActive', 'winnersCount', 'winnersDeclaredAt', 'round2Mode', 'round2TopN', 'round2Active', 'round2WinnersCount', 'round2WinnersDeclaredAt', 'round2Teams'],
            'participants': ['eventCode', 'teamName', 'name', 'phone', 'joinedAt'],
            'scores': ['eventCode', 'teamName', 'score', 'updatedAt'],
            'scores_r2': ['eventCode', 'teamName', 'score', 'updatedAt']
        };
        sheet.appendRow(headers[name]);
    }
    return sheet;
}

function getData(sheetName, key, value) {
    var sheet = getSheet(sheetName);
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var keyIdx = headers.indexOf(key);

    for (var i = 1; i < data.length; i++) {
        if (data[i][keyIdx] == value) {
            var obj = {};
            headers.forEach((h, idx) => {
                var val = data[i][idx];
                // Handle array strings
                if (h === 'round2Teams' && val) val = JSON.parse(val);
                // Handle booleans
                if (['isActive', 'round2Active'].includes(h)) val = (val === true || val === 'true');
                obj[h] = val;
            });
            return obj;
        }
    }
    return null;
}

function getDataList(sheetName, key, value) {
    var sheet = getSheet(sheetName);
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var keyIdx = headers.indexOf(key);
    var results = [];

    for (var i = 1; i < data.length; i++) {
        if (data[i][keyIdx] == value) {
            var obj = {};
            headers.forEach((h, idx) => {
                var val = data[i][idx];
                if (h === 'round2Teams' && val) val = JSON.parse(val);
                if (['isActive', 'round2Active'].includes(h)) val = (val === true || val === 'true');
                obj[h] = val;
            });
            results.push(obj);
        }
    }
    return results;
}

function addData(sheetName, payload) {
    var sheet = getSheet(sheetName);
    var headers = sheet.getDataRange().getValues()[0];
    var row = headers.map(h => {
        var val = payload[h];
        if (h === 'round2Teams') val = JSON.stringify(val || []);
        return val === undefined ? '' : val;
    });
    sheet.appendRow(row);
    return { success: true };
}

function updateData(sheetName, key, value, payload) {
    var sheet = getSheet(sheetName);
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var keyIdx = headers.indexOf(key);

    for (var i = 1; i < data.length; i++) {
        if (data[i][keyIdx] == value) {
            var row = headers.map(h => {
                var val = payload[h] !== undefined ? payload[h] : data[i][headers.indexOf(h)];
                if (h === 'round2Teams') val = JSON.stringify(val || []);
                return val;
            });
            sheet.getRange(i + 1, 1, 1, headers.length).setValues([row]);
            return { success: true };
        }
    }
    return { error: 'Not found' };
}

function setScoreData(sheetName, payload) {
    var sheet = getSheet(sheetName);
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var eIdx = headers.indexOf('eventCode');
    var tIdx = headers.indexOf('teamName');

    for (var i = 1; i < data.length; i++) {
        if (data[i][eIdx] == payload.eventCode && data[i][tIdx] == payload.teamName) {
            sheet.getRange(i + 1, headers.indexOf('score') + 1).setValue(payload.score);
            sheet.getRange(i + 1, headers.indexOf('updatedAt') + 1).setValue(Date.now());
            return { success: true };
        }
    }
    return addData(sheetName, payload);
}

function getLeaderboardData(sheetName, code) {
    var list = getDataList(sheetName, 'eventCode', code);
    return list.sort((a, b) => b.score - a.score);
}

function registerAdmin(payload) {
    var existing = getData('admins', 'phone', payload.phone);
    if (existing) return existing;
    addData('admins', payload);
    return payload;
}

function deleteEventData(code) {
    deleteRows('events', 'code', code);
    deleteRows('participants', 'eventCode', code);
    deleteRows('scores', 'eventCode', code);
    deleteRows('scores_r2', 'eventCode', code);
    return { success: true };
}

function resetEventData(code) {
    return deleteEventData(code);
}

function deleteRows(sheetName, key, value) {
    var sheet = getSheet(sheetName);
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var keyIdx = headers.indexOf(key);

    for (var i = data.length - 1; i >= 1; i--) {
        if (data[i][keyIdx] == value) {
            sheet.deleteRow(i + 1);
        }
    }
}
