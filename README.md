# PillPing: CareCircle

An elderly-friendly medication reminder web application paired with a real-time **Caregiver Oversight Portal**, built for the **CareCircle Code-a-thon**.

## Key Features Implemented
- **Elderly-Friendly High-Contrast UI**: Extra-large typography, high-contrast borders, color-coded pill identifiers, and tactile buttons (`>= 64px` height) built for seniors with visual or tremor limitations.
- **One-Tap Dose Confirmation & Snooze**: Full-screen spotlight reminder with **"I TOOK MY MEDICINE"** (calming green confirmation screen) and **"SNOOZE 15 MINS"** buttons, plus retroactive **"Already Took It"** logging.
- **Real-Time Caregiver Dashboard**: Instant cross-tab synchronization (`BroadcastChannel` + Express REST API) showing live adherence status, 14-day color-coded compliance calendar, and compliance scorecards.
- **30-Minute Missed Dose Escalation & Low-Refill Warnings**: Flags doses unconfirmed past 30 minutes in red and automatically alerts caregivers when pill inventory drops below 5 pills.
- **Voice Read-Aloud, Pill Bottle Visual & Emergency SOS**: Built-in Web Speech Synthesis read-aloud button, color-matched pill bottle graphic, Web Audio API chime, Web Worker background timer, and one-tap red Emergency SOS quick dial.

## How to Run Locally
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the Express server:
   ```bash
   npm start
   ```
3. Open `http://localhost:3000` in two browser windows side-by-side (Window 1: **Senior View**, Window 2: **Caregiver Portal**) to demo live synchronization.
