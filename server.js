const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');
const SEED_FILE = path.join(__dirname, 'data', 'seed.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize persistent JSON database from seed if not present
function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const seed = fs.readFileSync(SEED_FILE, 'utf-8');
    fs.writeFileSync(DB_FILE, seed, 'utf-8');
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// Get full state (patients, medications, alerts, adherence stats)
app.get('/api/state', (req, res) => {
  const db = loadDB();
  res.json(db);
});

// Reset demo data to initial state
app.post('/api/reset', (req, res) => {
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf-8'));
  saveDB(seed);
  res.json({ message: 'Demo state reset successfully', data: seed });
});

// Add a new medication for a patient
app.post('/api/patients/:patientId/medications', (req, res) => {
  const db = loadDB();
  const patient = db.patients.find(p => p.id === req.params.patientId);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });

  const { name, dosage, purpose, slot, scheduledTime, foodInstruction, pillColor, pillShape, remainingPills } = req.body;
  const newMed = {
    id: 'm' + Date.now(),
    name,
    dosage,
    purpose: purpose || 'Daily Medication',
    slot: slot || 'Morning',
    scheduledTime: scheduledTime || '09:00',
    foodInstruction: foodInstruction || 'Take with Water',
    pillColor: pillColor || '#2563EB',
    pillShape: pillShape || 'round',
    pillBottleSVG: 'blue',
    remainingPills: Number(remainingPills) || 30,
    status: 'pending',
    takenAt: null
  };

  patient.medications.push(newMed);

  // Update today's adherence total
  const todayEntry = patient.adherenceHistory14Days[patient.adherenceHistory14Days.length - 1];
  if (todayEntry) {
    todayEntry.total = patient.medications.length;
  }

  // Trigger refill warning if < 5 pills
  if (newMed.remainingPills < 5) {
    db.alerts.unshift({
      id: 'a' + Date.now(),
      patientId: patient.id,
      patientName: `${patient.name} (${patient.nickname})`,
      type: 'refill',
      severity: 'warning',
      message: `Low Pill Inventory: ${newMed.name} ${newMed.dosage} has only ${newMed.remainingPills} pills remaining.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      resolved: false
    });
  }

  saveDB(db);
  res.status(201).json({ medication: newMed, data: db });
});

// Confirm dose taken (One-Tap or Retroactive 'Already Took It')
app.post('/api/patients/:patientId/medications/:medId/confirm', (req, res) => {
  const db = loadDB();
  const patient = db.patients.find(p => p.id === req.params.patientId);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });

  const med = patient.medications.find(m => m.id === req.params.medId);
  if (!med) return res.status(404).json({ error: 'Medication not found' });

  const { retroactive, customTime } = req.body || {};
  const nowStr = customTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (med.status !== 'taken') {
    med.remainingPills = Math.max(0, med.remainingPills - 1);
  }
  med.status = 'taken';
  med.takenAt = retroactive ? `${nowStr} (Logged Retroactively)` : nowStr;

  // Resolve any missed dose alerts for this medication
  db.alerts.forEach(alert => {
    if (alert.patientId === patient.id && alert.type === 'missed' && alert.message.includes(med.name)) {
      alert.resolved = true;
    }
  });

  // Add caregiver confirmation feed event
  db.alerts.unshift({
    id: 'a' + Date.now(),
    patientId: patient.id,
    patientName: `${patient.name} (${patient.nickname})`,
    type: 'confirmed',
    severity: 'success',
    message: `${med.name} (${med.dosage}) confirmed taken at ${med.takenAt}.`,
    timestamp: nowStr,
    resolved: true
  });

  // Check refill threshold (< 5 pills)
  if (med.remainingPills < 5) {
    const existingRefill = db.alerts.find(
      a => a.patientId === patient.id && a.type === 'refill' && !a.resolved && a.message.includes(med.name)
    );
    if (!existingRefill) {
      db.alerts.unshift({
        id: 'a' + (Date.now() + 1),
        patientId: patient.id,
        patientName: `${patient.name} (${patient.nickname})`,
        type: 'refill',
        severity: 'warning',
        message: `Low Pill Inventory: ${med.name} ${med.dosage} dropped to ${med.remainingPills} pills remaining!`,
        timestamp: nowStr,
        resolved: false
      });
    }
  }

  // Update today's adherence log
  const takenCount = patient.medications.filter(m => m.status === 'taken').length;
  const todayEntry = patient.adherenceHistory14Days[patient.adherenceHistory14Days.length - 1];
  if (todayEntry) {
    todayEntry.taken = takenCount;
    todayEntry.total = patient.medications.length;
    todayEntry.status = takenCount === todayEntry.total ? 'complete' : 'today';
  }

  saveDB(db);
  res.json({ medication: med, data: db });
});

// Snooze medication for 15 minutes
app.post('/api/patients/:patientId/medications/:medId/snooze', (req, res) => {
  const db = loadDB();
  const patient = db.patients.find(p => p.id === req.params.patientId);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });

  const med = patient.medications.find(m => m.id === req.params.medId);
  if (!med) return res.status(404).json({ error: 'Medication not found' });

  med.status = 'snoozed';
  const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  db.alerts.unshift({
    id: 'a' + Date.now(),
    patientId: patient.id,
    patientName: `${patient.name} (${patient.nickname})`,
    type: 'snoozed',
    severity: 'info',
    message: `${patient.nickname} snoozed ${med.name} (${med.dosage}) for 15 minutes.`,
    timestamp: nowStr,
    resolved: false
  });

  saveDB(db);
  res.json({ medication: med, data: db });
});

// Escalate missed dose (>30 mins unconfirmed)
app.post('/api/patients/:patientId/medications/:medId/escalate', (req, res) => {
  const db = loadDB();
  const patient = db.patients.find(p => p.id === req.params.patientId);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });

  const med = patient.medications.find(m => m.id === req.params.medId);
  if (!med) return res.status(404).json({ error: 'Medication not found' });

  med.status = 'missed';
  const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  db.alerts.unshift({
    id: 'a' + Date.now(),
    patientId: patient.id,
    patientName: `${patient.name} (${patient.nickname})`,
    type: 'missed',
    severity: 'critical',
    message: `URGENT ESCALATION: ${med.name} (${med.dosage}) scheduled at ${med.scheduledTime} is unconfirmed >30 mins!`,
    timestamp: nowStr,
    resolved: false
  });

  saveDB(db);
  res.json({ medication: med, data: db });
});

// Trigger Emergency SOS Alert
app.post('/api/patients/:patientId/sos', (req, res) => {
  const db = loadDB();
  const patient = db.patients.find(p => p.id === req.params.patientId);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });

  const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const alert = {
    id: 'a' + Date.now(),
    patientId: patient.id,
    patientName: `${patient.name} (${patient.nickname})`,
    type: 'sos',
    severity: 'critical',
    message: `EMERGENCY SOS BUTTON PRESSED by ${patient.name}! Calling ${patient.caregiver.name} (${patient.caregiver.phone}).`,
    timestamp: nowStr,
    resolved: false
  };

  db.alerts.unshift(alert);
  saveDB(db);
  res.json({ alert, data: db });
});

// Resolve an alert on Caregiver Dashboard
app.post('/api/alerts/:alertId/resolve', (req, res) => {
  const db = loadDB();
  const alert = db.alerts.find(a => a.id === req.params.alertId);
  if (alert) {
    alert.resolved = true;
    saveDB(db);
  }
  res.json({ data: db });
});

app.listen(PORT, () => {
  console.log(`PillPing: CareCircle server running at http://localhost:${PORT}`);
});
