# GridVault Standard Operating Procedure (SOP): Offline Resilience & Downtime Protocol

## 1. Operating Protocol

> **When GridVault is unreachable, care does not stop and the record does not break.** The ward terminal keeps working from its encrypted local cache: staff can open any patient on their own ward, read the last known chart, and record vitals, medications and notes. A persistent amber bar shows the terminal is offline and counts the items waiting to sync. When the network returns, everything queued is replayed in order, de-duplicated, signed into the audit ledger, and marked as offline-captured with the time it was actually taken. **If the terminal itself is down** — no power, no device, hardware failure — staff use the pre-printed three-part Emergency Triage Slips kept in the ward lockbox: patient hospital number, time, vitals, medication given, staff signature. One copy stays in the patient's folder, one goes to the ward file, one goes to the charge nurse. When the system returns, the charge nurse enters the slips through **Batch Backfill**, which records the original bedside time _and_ the entry time, marks each entry `PAPER_BACKFILL`, names the person who transcribed it, and signs it into the chain. Nothing is back-dated silently, and every offline entry is distinguishable from a live one forever.

---

## 2. Emergency Triage Slip (Printable Ward Template)

```text
================================================================================
GRIDVAULT CLINICAL EMERGENCY TRIAGE SLIP (3-PART FORM)
FORM ID: ETS-NG-2026 / WARD COPY [ ] CHARGE NURSE [ ] PATIENT FOLDER [ ]
================================================================================

PATIENT HOSPITAL NUMBER: [____________________]  BED NUMBER: [________]
PATIENT NAME:            [_____________________________________________]
WARD: [ ] Ward A   [ ] Ward B   [ ] ICU   [ ] Maternity   [ ] Emergency

OBSERVATION TIME (Bedside WAT): [____-____-____  ____:____]

VITALS OBSERVATION:
  Heart Rate:         [_____] bpm        SpO2:             [_____] %
  Blood Pressure:     [_____/_____] mmHg Temperature:      [_____] °C
  Respiratory Rate:   [_____] /min       Pain Score (0-10):[_____]

CLINICAL NOTES / OBSERVATIONS:
[______________________________________________________________________________]
[______________________________________________________________________________]
[______________________________________________________________________________]

MEDICATIONS / INTERVENTIONS ADMINISTERED:
  Medication: [________________________] Dose: [________] Route: [________]
  Administered At: [____:____] Witnessed By: [_________________________________]

CLINICIAN SIGN-OFF:
  Staff Name: [________________________] Staff ID: [___________________________]
  Signature:  [________________________] Date/Time:[____-____-____  ____:____]

--------------------------------------------------------------------------------
BACKFILL VERIFICATION (Completed upon system restoration by Charge Nurse / Transcriber):
  Transcriber Name: [____________________] Staff ID: [_________________________]
  Digital Ingestion Timestamp: [____-____-____  ____:____ WAT]
  Ledger Transaction Index:    [____________________]
================================================================================
```
