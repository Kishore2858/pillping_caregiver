let appState = null;
let selectedPatientId = 'p1';
let activeSpotlightMedId = null;
let alarmPlaying = false;

// Initialize Background Web Worker for throttling-resistant timers
const timerWorker = new Worker('timer-worker.js');
timerWorker.postMessage({ command: 'START', intervalMs: 1000 });

timerWorker.onmessage = (e) => {
  if (e.data.type === 'TICK') {
    updateLiveClock();
    checkScheduledReminders();
  }
};

// BroadcastChannel enables instant synchronization across two open browser tabs/windows
const syncChannel = new BroadcastChannel('pillping_carecircle_sync');
syncChannel.onmessage = (event) => {
  if (event.data === 'STATE_UPDATED') {
    fetchState();
  }
};

function notifyOtherTabs() {
  syncChannel.postMessage('STATE_UPDATED');
}

// Web Audio API gentle two-tone chime
function playReminderChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.25);
      gain.gain.setValueAtTime(0.25, ctx.currentTime + idx * 0.25);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.25 + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + idx * 0.25);
      osc.stop(ctx.currentTime + idx * 0.25 + 0.65);
    });
  } catch (err) {
    console.warn('Audio chime blocked until user interaction:', err);
  }
}

// Web Speech Synthesis Read-Aloud Prompt
function speakInstruction(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.88; // Slightly slower for elderly clarity
  utterance.pitch = 1.0;
  window.speechSynthesis.speak(utterance);
}

// HTML5 Web Notification
function triggerDesktopNotification(title, body) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    new Notification(title, { body });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((perm) => {
      if (perm === 'granted') new Notification(title, { body });
    });
  }
}

function updateLiveClock() {
  const now = new Date();
  const clockEl = document.getElementById('liveClock');
  if (clockEl) {
    clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

function checkScheduledReminders() {
  if (!appState) return;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const patient = getCurrentPatient();
  if (!patient) return;

  patient.medications.forEach((med) => {
    if (med.status === 'pending' && med.scheduledTime === hhmm && !alarmPlaying) {
      alarmPlaying = true;
      activeSpotlightMedId = med.id;
      playReminderChime();
      triggerDesktopNotification(
        `PillPing Reminder: ${med.name} ${med.dosage}`,
        `${med.foodInstruction} for ${patient.nickname}`
      );
      renderAll();
    }
  });
}

function getCurrentPatient() {
  if (!appState) return null;
  return appState.patients.find((p) => p.id === selectedPatientId) || appState.patients[0];
}

function generatePillBottleSVG(color, label) {
  return `
    <svg width="84" height="106" viewBox="0 0 84 106" aria-hidden="true">
      <rect x="20" y="6" width="44" height="14" rx="4" fill="#CBD5E1" stroke="#0F172A" stroke-width="3"/>
      <rect x="14" y="20" width="56" height="78" rx="10" fill="${color}" stroke="#0F172A" stroke-width="3"/>
      <rect x="20" y="36" width="44" height="44" rx="4" fill="#FFFFFF" stroke="#0F172A" stroke-width="2"/>
      <text x="42" y="56" text-anchor="middle" font-size="11" font-weight="900" fill="#0F172A">${label.slice(0, 6).toUpperCase()}</text>
      <circle cx="42" cy="69" r="6" fill="${color}" stroke="#0F172A" stroke-width="1.5"/>
    </svg>
    <span style="font-size:0.75rem;font-weight:800;margin-top:4px;">BOTTLE MATCH</span>
  `;
}

async function fetchState() {
  const res = await fetch('/api/state');
  appState = await res.json();
  renderAll();
}

function renderAll() {
  const patient = getCurrentPatient();
  if (!patient) return;

  renderSeniorView(patient);
  renderCaregiverView(patient);
}

function renderSeniorView(patient) {
  document.getElementById('seniorGreeting').textContent = `Hello, ${patient.nickname}!`;
  document.getElementById('sosCaregiverName').textContent = patient.caregiver.name.split(' ')[0].toUpperCase();

  // Pick spotlight medication (prioritize active alarm, missed, snoozed, or next pending)
  let spotlightMed =
    patient.medications.find((m) => m.id === activeSpotlightMedId && m.status !== 'taken') ||
    patient.medications.find((m) => m.status === 'missed') ||
    patient.medications.find((m) => m.status === 'snoozed') ||
    patient.medications.find((m) => m.status === 'pending') ||
    patient.medications[0];

  const spotlightCard = document.getElementById('activeReminderCard');
  if (spotlightMed && spotlightMed.status !== 'taken') {
    spotlightCard.classList.remove('hidden');
    activeSpotlightMedId = spotlightMed.id;
    document.getElementById('spotlightTimeLabel').textContent = `${spotlightMed.scheduledTime} (${spotlightMed.slot.toUpperCase()}) — DUE`;
    document.getElementById('spotlightPurpose').textContent = spotlightMed.purpose;
    document.getElementById('spotlightMedName').textContent = `${spotlightMed.name} ${spotlightMed.dosage}`;
    document.getElementById('spotlightInstruction').textContent = `🍽️ ${spotlightMed.foodInstruction}`;
    document.getElementById('spotlightRemaining').textContent =
      spotlightMed.remainingPills < 5
        ? `⚠️ Only ${spotlightMed.remainingPills} pills left — Refill alert sent to ${patient.caregiver.name.split(' ')[0]}`
        : `Pills left in bottle: ${spotlightMed.remainingPills}`;
    document.getElementById('pillBottleVisual').innerHTML = generatePillBottleSVG(
      spotlightMed.pillColor,
      spotlightMed.name
    );
  } else {
    spotlightCard.classList.add('hidden');
  }

  // Render Today's Medicine Cards
  const listEl = document.getElementById('seniorMedList');
  listEl.innerHTML = patient.medications
    .map((med) => {
      const isTaken = med.status === 'taken';
      const isMissed = med.status === 'missed';
      return `
        <article class="senior-med-card status-${med.status}">
          <div class="med-card-top">
            <span class="slot-badge">${med.slot} • ${med.scheduledTime}</span>
            <span class="pill-swatch" style="background:${med.pillColor}" title="Pill Color"></span>
          </div>
          <div>
            <h4>${med.name} (${med.dosage})</h4>
            <p style="font-weight:700;color:#334155;">${med.purpose}</p>
            <p style="font-size:1rem;margin-top:4px;">${med.foodInstruction}</p>
          </div>
          ${
            isTaken
              ? `<div class="taken-stamp">✅ Taken at ${med.takenAt}</div>`
              : `<button class="btn-retroactive" onclick="confirmDose('${med.id}', ${isMissed})">
                  ${isMissed ? '⚠️ Already Took It (Log Now)' : '✔ Mark as Taken'}
                </button>`
          }
        </article>
      `;
    })
    .join('');
}

function renderCaregiverView(patient) {
  // Compute 14-day compliance percentage
  let totalTaken = 0;
  let totalScheduled = 0;
  patient.adherenceHistory14Days.forEach((d) => {
    totalTaken += d.taken;
    totalScheduled += d.total;
  });
  const adherencePct = totalScheduled > 0 ? Math.round((totalTaken / totalScheduled) * 100) : 100;

  const takenToday = patient.medications.filter((m) => m.status === 'taken').length;
  const totalToday = patient.medications.length;
  const patientAlerts = appState.alerts.filter((a) => a.patientId === patient.id);
  const unresolvedCritical = patientAlerts.filter((a) => !a.resolved && a.severity === 'critical').length;
  const lowRefills = patient.medications.filter((m) => m.remainingPills < 5).length;

  document.getElementById('kpiAdherenceScore').textContent = `${adherencePct}%`;
  document.getElementById('kpiTodayDoses').textContent = `${takenToday} / ${totalToday}`;
  document.getElementById('kpiTodaySub').textContent = `${totalToday - takenToday} remaining today`;
  document.getElementById('kpiActiveAlerts').textContent = unresolvedCritical;
  document.getElementById('kpiRefillCount').textContent = lowRefills;

  const badge = document.getElementById('alertBadge');
  if (unresolvedCritical > 0) {
    badge.textContent = unresolvedCritical;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  // Render Live Alert Feed
  const feedEl = document.getElementById('caregiverAlertFeed');
  feedEl.innerHTML = patientAlerts
    .map(
      (alert) => `
      <div class="alert-item ${alert.severity}">
        <div>
          <div class="alert-meta">${alert.timestamp} • ${alert.type.toUpperCase()}</div>
          <div style="font-weight:700;">${alert.message}</div>
        </div>
        ${
          !alert.resolved
            ? `<button class="resolve-btn" onclick="resolveAlert('${alert.id}')">Acknowledge</button>`
            : `<span style="font-size:0.78rem;font-weight:800;color:#15803D;">✓ Resolved</span>`
        }
      </div>
    `
    )
    .join('');

  // Render Today's Live Medication Status Table
  const tableEl = document.getElementById('caregiverMedTable');
  tableEl.innerHTML = patient.medications
    .map(
      (med) => `
      <div class="cg-med-row">
        <div>
          <strong>${med.name} ${med.dosage}</strong> (${med.slot} • ${med.scheduledTime})
          <div style="font-size:0.85rem;color:#475569;">
            ${med.foodInstruction} • Stock: <strong>${med.remainingPills} pills</strong>
            ${med.remainingPills < 5 ? '<span style="color:#B45309;font-weight:800;"> (LOW REFILL)</span>' : ''}
          </div>
        </div>
        <span class="status-pill ${med.status}">
          ${med.status === 'taken' ? `✓ Taken ${med.takenAt}` : med.status.toUpperCase()}
        </span>
      </div>
    `
    )
    .join('');

  // Render 14-Day Compliance Calendar
  const calEl = document.getElementById('adherenceCalendar');
  calEl.innerHTML = patient.adherenceHistory14Days
    .map(
      (day) => `
      <div class="cal-day">
        <div style="font-weight:700;">${day.date}</div>
        <div class="cal-dot ${day.status}" title="${day.taken}/${day.total} taken"></div>
        <div style="font-size:0.75rem;font-weight:700;">${day.taken}/${day.total}</div>
      </div>
    `
    )
    .join('');
}

async function confirmDose(medId, retroactive = false) {
  const patient = getCurrentPatient();
  const res = await fetch(`/api/patients/${patient.id}/medications/${medId}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ retroactive })
  });
  const result = await res.json();
  appState = result.data;
  alarmPlaying = false;

  // Show calming green confirmation screen for Senior
  const banner = document.getElementById('confirmationBanner');
  document.getElementById('confirmHeadline').textContent = `Good Job, ${patient.nickname}!`;
  document.getElementById('confirmDetail').textContent = `${result.medication.name} logged at ${result.medication.takenAt}. ${patient.caregiver.name.split(' ')[0]}'s dashboard updated instantly.`;
  banner.classList.remove('hidden');

  speakInstruction(`Good job ${patient.nickname}! Your medicine has been recorded.`);
  notifyOtherTabs();
  renderAll();
}

async function snoozeDose(medId) {
  const patient = getCurrentPatient();
  const res = await fetch(`/api/patients/${patient.id}/medications/${medId}/snooze`, {
    method: 'POST'
  });
  const result = await res.json();
  appState = result.data;
  alarmPlaying = false;
  speakInstruction(`Okay ${patient.nickname}, I will remind you again in 15 minutes.`);
  notifyOtherTabs();
  renderAll();
}

async function resolveAlert(alertId) {
  const res = await fetch(`/api/alerts/${alertId}/resolve`, { method: 'POST' });
  const result = await res.json();
  appState = result.data;
  notifyOtherTabs();
  renderAll();
}

// Event Listeners
document.getElementById('tabSenior').addEventListener('click', () => {
  document.getElementById('tabSenior').classList.add('active');
  document.getElementById('tabCaregiver').classList.remove('active');
  document.getElementById('seniorView').classList.remove('hidden');
  document.getElementById('caregiverView').classList.add('hidden');
});

document.getElementById('tabCaregiver').addEventListener('click', () => {
  document.getElementById('tabCaregiver').classList.add('active');
  document.getElementById('tabSenior').classList.remove('active');
  document.getElementById('caregiverView').classList.remove('hidden');
  document.getElementById('seniorView').classList.add('hidden');
});

document.getElementById('patientSelect').addEventListener('change', (e) => {
  selectedPatientId = e.target.value;
  activeSpotlightMedId = null;
  document.getElementById('confirmationBanner').classList.add('hidden');
  renderAll();
});

document.getElementById('btnConfirmDose').addEventListener('click', () => {
  if (activeSpotlightMedId) confirmDose(activeSpotlightMedId, false);
});

document.getElementById('btnSnoozeDose').addEventListener('click', () => {
  if (activeSpotlightMedId) snoozeDose(activeSpotlightMedId);
});

document.getElementById('btnSpeakReminder').addEventListener('click', () => {
  const patient = getCurrentPatient();
  const med = patient.medications.find((m) => m.id === activeSpotlightMedId);
  if (med) {
    speakInstruction(
      `Hello ${patient.nickname}. It is time for your ${med.purpose}, ${med.name} ${med.dosage}. Please ${med.foodInstruction}.`
    );
  }
});

// Demo Trigger: Simulate 10:00 AM Pill Alarm
document.getElementById('btnTriggerDemoAlarm').addEventListener('click', () => {
  const patient = getCurrentPatient();
  const targetMed = patient.medications.find((m) => m.status !== 'taken') || patient.medications[0];
  if (!targetMed) return;
  activeSpotlightMedId = targetMed.id;
  document.getElementById('confirmationBanner').classList.add('hidden');
  document.getElementById('activeReminderCard').classList.add('alarm-active');
  playReminderChime();
  triggerDesktopNotification(
    `10:00 AM — ${targetMed.purpose} (${targetMed.name} ${targetMed.dosage})`,
    `${targetMed.foodInstruction}`
  );
  speakInstruction(
    `${patient.nickname}, it is time to take ${targetMed.name} ${targetMed.dosage}. ${targetMed.foodInstruction}.`
  );
  renderAll();
});

// Demo Trigger: Simulate 30-minute Missed Dose Escalation
document.getElementById('btnSimulateEscalation').addEventListener('click', async () => {
  const patient = getCurrentPatient();
  const targetMed = patient.medications.find((m) => m.status !== 'taken') || patient.medications[1];
  if (!targetMed) return;
  const res = await fetch(`/api/patients/${patient.id}/medications/${targetMed.id}/escalate`, {
    method: 'POST'
  });
  const result = await res.json();
  appState = result.data;
  notifyOtherTabs();
  renderAll();
});

// Demo Trigger: Reset Seed State
document.getElementById('btnResetDemo').addEventListener('click', async () => {
  const res = await fetch('/api/reset', { method: 'POST' });
  const result = await res.json();
  appState = result.data;
  activeSpotlightMedId = null;
  document.getElementById('confirmationBanner').classList.add('hidden');
  document.getElementById('activeReminderCard').classList.remove('alarm-active');
  notifyOtherTabs();
  renderAll();
});

// Emergency SOS Quick Dial
document.getElementById('btnEmergencySOS').addEventListener('click', async () => {
  const patient = getCurrentPatient();
  const res = await fetch(`/api/patients/${patient.id}/sos`, { method: 'POST' });
  const result = await res.json();
  appState = result.data;

  document.getElementById('sosModalBody').textContent =
    `Urgent alert sent to ${patient.caregiver.name} (${patient.caregiver.relation}). Dialing emergency contact now...`;
  document.getElementById('sosPhoneDisplay').textContent = patient.caregiver.phone;
  document.getElementById('sosModal').classList.remove('hidden');

  speakInstruction(`Emergency alert sent to ${patient.caregiver.name}. Help is on the way.`);
  notifyOtherTabs();
  renderAll();
});

document.getElementById('btnCloseSos').addEventListener('click', () => {
  document.getElementById('sosModal').classList.add('hidden');
});

// Caregiver Add Medication Form
document.getElementById('addMedForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const patient = getCurrentPatient();
  const payload = {
    name: document.getElementById('medName').value,
    dosage: document.getElementById('medDosage').value,
    purpose: document.getElementById('medPurpose').value,
    slot: document.getElementById('medSlot').value,
    scheduledTime: document.getElementById('medTime').value,
    remainingPills: document.getElementById('medRefills').value,
    foodInstruction: document.getElementById('medFood').value,
    pillColor: document.getElementById('medColor').value
  };

  const res = await fetch(`/api/patients/${patient.id}/medications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await res.json();
  appState = result.data;
  e.target.reset();
  notifyOtherTabs();
  renderAll();
});

// Initial load
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}
updateLiveClock();
fetchState();
