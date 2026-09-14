// AT-118: matrix sweep, 5 principals x 4 patients x 5 groups x {read, write}.
//
// The expectation table below is written out explicitly from PRD section 6.3
// — it is NOT generated from the implementation. Read codes:
//   full            group data present in the dossier
//   redact:<CODE>   group nulled with the given reason in _meta.redactions
//   deny403:<CODE>  whole request 403 with the given reason
//   deny404         whole request 404 (enumeration protection)
// Write codes:
//   allow           2xx
//   deny:<CODE>     403 with the given reason
//   deny404         404
// Duty is neutralized for every principal (scheduled extensions), so each
// cell proves role x ward x queue only.

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  MORNING_CLOCK,
  createSeededStack,
  demoPassword,
  makeOnDuty,
  type TestStack
} from '../helpers/app.js';

type ReadExpectation = string;
type WriteExpectation = string;

interface MatrixCell {
  read: Record<string, ReadExpectation>;
  write: Record<string, WriteExpectation>;
}

const FULL = 'full';

function redact(code: string): string {
  return `redact:${code}`;
}
function deny403(code: string): string {
  return `deny403:${code}`;
}
const DENY404 = 'deny404';

function deny(code: string): string {
  return `deny:${code}`;
}

// -- Explicit expectations (PRD 6.3) ---------------------------------------
const MATRIX: Record<string, MatrixCell> = {
  // ICU doctor ---------------------------------------------------------------
  'GV-9042|HOSP-LOS-2025-084': {
    read: { DEMOGRAPHICS: FULL, LOGISTICS: FULL, VITALS: FULL, CLINICAL: FULL, SENSITIVE: FULL },
    write: {
      DEMOGRAPHICS: 'allow',
      LOGISTICS: deny('ROLE_CANNOT_WRITE'),
      VITALS: 'allow',
      CLINICAL: 'allow',
      SENSITIVE: 'allow'
    }
  },
  'GV-9042|HOSP-LOS-2025-081': {
    read: {
      DEMOGRAPHICS: deny403('WARD_MISMATCH'),
      LOGISTICS: deny403('WARD_MISMATCH'),
      VITALS: deny403('WARD_MISMATCH'),
      CLINICAL: deny403('WARD_MISMATCH'),
      SENSITIVE: deny403('WARD_MISMATCH')
    },
    write: {
      DEMOGRAPHICS: deny('WARD_MISMATCH'),
      LOGISTICS: deny('WARD_MISMATCH'),
      VITALS: deny('WARD_MISMATCH'),
      CLINICAL: deny('WARD_MISMATCH'),
      SENSITIVE: deny('WARD_MISMATCH')
    }
  },
  'GV-9042|HOSP-LOS-2025-082': {
    read: {
      DEMOGRAPHICS: deny403('WARD_MISMATCH'),
      LOGISTICS: deny403('WARD_MISMATCH'),
      VITALS: deny403('WARD_MISMATCH'),
      CLINICAL: deny403('WARD_MISMATCH'),
      SENSITIVE: deny403('WARD_MISMATCH')
    },
    write: {
      DEMOGRAPHICS: deny('WARD_MISMATCH'),
      LOGISTICS: deny('WARD_MISMATCH'),
      VITALS: deny('WARD_MISMATCH'),
      CLINICAL: deny('WARD_MISMATCH'),
      SENSITIVE: deny('WARD_MISMATCH')
    }
  },
  'GV-9042|HOSP-LOS-2025-083': {
    read: {
      DEMOGRAPHICS: deny403('WARD_MISMATCH'),
      LOGISTICS: deny403('WARD_MISMATCH'),
      VITALS: deny403('WARD_MISMATCH'),
      CLINICAL: deny403('WARD_MISMATCH'),
      SENSITIVE: deny403('WARD_MISMATCH')
    },
    write: {
      DEMOGRAPHICS: deny('WARD_MISMATCH'),
      LOGISTICS: deny('WARD_MISMATCH'),
      VITALS: deny('WARD_MISMATCH'),
      CLINICAL: deny('WARD_MISMATCH'),
      SENSITIVE: deny('WARD_MISMATCH')
    }
  },
  // Ward A nurse --------------------------------------------------------------
  'SN-7742|HOSP-LOS-2025-081': {
    read: { DEMOGRAPHICS: FULL, LOGISTICS: FULL, VITALS: FULL, CLINICAL: FULL, SENSITIVE: FULL },
    write: {
      DEMOGRAPHICS: deny('ROLE_CANNOT_WRITE'),
      LOGISTICS: deny('ROLE_CANNOT_WRITE'),
      VITALS: 'allow',
      CLINICAL: deny('ROLE_CANNOT_WRITE'),
      SENSITIVE: deny('ROLE_CANNOT_WRITE')
    }
  },
  'SN-7742|HOSP-LOS-2025-082': {
    read: { DEMOGRAPHICS: FULL, LOGISTICS: FULL, VITALS: FULL, CLINICAL: FULL, SENSITIVE: FULL },
    write: {
      DEMOGRAPHICS: deny('ROLE_CANNOT_WRITE'),
      LOGISTICS: deny('ROLE_CANNOT_WRITE'),
      VITALS: 'allow',
      CLINICAL: deny('ROLE_CANNOT_WRITE'),
      SENSITIVE: deny('ROLE_CANNOT_WRITE')
    }
  },
  'SN-7742|HOSP-LOS-2025-083': {
    read: { DEMOGRAPHICS: FULL, LOGISTICS: FULL, VITALS: FULL, CLINICAL: FULL, SENSITIVE: FULL },
    write: {
      DEMOGRAPHICS: deny('ROLE_CANNOT_WRITE'),
      LOGISTICS: deny('ROLE_CANNOT_WRITE'),
      VITALS: 'allow',
      CLINICAL: deny('ROLE_CANNOT_WRITE'),
      SENSITIVE: deny('ROLE_CANNOT_WRITE')
    }
  },
  'SN-7742|HOSP-LOS-2025-084': {
    read: {
      DEMOGRAPHICS: deny403('WARD_MISMATCH'),
      LOGISTICS: deny403('WARD_MISMATCH'),
      VITALS: deny403('WARD_MISMATCH'),
      CLINICAL: deny403('WARD_MISMATCH'),
      SENSITIVE: deny403('WARD_MISMATCH')
    },
    write: {
      DEMOGRAPHICS: deny('WARD_MISMATCH'),
      LOGISTICS: deny('WARD_MISMATCH'),
      VITALS: deny('WARD_MISMATCH'),
      CLINICAL: deny('WARD_MISMATCH'),
      SENSITIVE: deny('WARD_MISMATCH')
    }
  },
  // Admissions clerk (queue: 081 only, of these four) --------------------------
  'RC-1029|HOSP-LOS-2025-081': {
    read: {
      DEMOGRAPHICS: FULL,
      LOGISTICS: FULL,
      VITALS: redact('CLERK_NO_CLINICAL'),
      CLINICAL: redact('CLERK_NO_CLINICAL'),
      SENSITIVE: redact('CLERK_NO_CLINICAL')
    },
    write: {
      DEMOGRAPHICS: 'allow',
      LOGISTICS: 'allow',
      VITALS: deny('CLERK_NO_CLINICAL'),
      CLINICAL: deny('CLERK_NO_CLINICAL'),
      SENSITIVE: deny('CLERK_NO_CLINICAL')
    }
  },
  'RC-1029|HOSP-LOS-2025-082': {
    read: {
      DEMOGRAPHICS: deny403('CLERK_OUT_OF_QUEUE'),
      LOGISTICS: deny403('CLERK_OUT_OF_QUEUE'),
      VITALS: deny403('CLERK_OUT_OF_QUEUE'),
      CLINICAL: deny403('CLERK_OUT_OF_QUEUE'),
      SENSITIVE: deny403('CLERK_OUT_OF_QUEUE')
    },
    write: {
      DEMOGRAPHICS: deny('CLERK_OUT_OF_QUEUE'),
      LOGISTICS: deny('CLERK_OUT_OF_QUEUE'),
      VITALS: deny('CLERK_OUT_OF_QUEUE'),
      CLINICAL: deny('CLERK_OUT_OF_QUEUE'),
      SENSITIVE: deny('CLERK_OUT_OF_QUEUE')
    }
  },
  'RC-1029|HOSP-LOS-2025-083': {
    read: {
      DEMOGRAPHICS: deny403('CLERK_OUT_OF_QUEUE'),
      LOGISTICS: deny403('CLERK_OUT_OF_QUEUE'),
      VITALS: deny403('CLERK_OUT_OF_QUEUE'),
      CLINICAL: deny403('CLERK_OUT_OF_QUEUE'),
      SENSITIVE: deny403('CLERK_OUT_OF_QUEUE')
    },
    write: {
      DEMOGRAPHICS: deny('CLERK_OUT_OF_QUEUE'),
      LOGISTICS: deny('CLERK_OUT_OF_QUEUE'),
      VITALS: deny('CLERK_OUT_OF_QUEUE'),
      CLINICAL: deny('CLERK_OUT_OF_QUEUE'),
      SENSITIVE: deny('CLERK_OUT_OF_QUEUE')
    }
  },
  'RC-1029|HOSP-LOS-2025-084': {
    read: {
      DEMOGRAPHICS: DENY404,
      LOGISTICS: DENY404,
      VITALS: DENY404,
      CLINICAL: DENY404,
      SENSITIVE: DENY404
    },
    write: {
      DEMOGRAPHICS: DENY404,
      LOGISTICS: DENY404,
      VITALS: DENY404,
      CLINICAL: DENY404,
      SENSITIVE: DENY404
    }
  },
  // Administrator (demographics id+ward only) ----------------------------------
  'AD-0012|HOSP-LOS-2025-081': {
    read: {
      DEMOGRAPHICS: FULL,
      LOGISTICS: redact('ADMIN_NO_CLINICAL'),
      VITALS: redact('ADMIN_NO_CLINICAL'),
      CLINICAL: redact('ADMIN_NO_CLINICAL'),
      SENSITIVE: redact('ADMIN_NO_CLINICAL')
    },
    write: {
      DEMOGRAPHICS: deny('ROLE_CANNOT_WRITE'),
      LOGISTICS: deny('ADMIN_NO_CLINICAL'),
      VITALS: deny('ADMIN_NO_CLINICAL'),
      CLINICAL: deny('ADMIN_NO_CLINICAL'),
      SENSITIVE: deny('ADMIN_NO_CLINICAL')
    }
  },
  'AD-0012|HOSP-LOS-2025-082': {
    read: {
      DEMOGRAPHICS: FULL,
      LOGISTICS: redact('ADMIN_NO_CLINICAL'),
      VITALS: redact('ADMIN_NO_CLINICAL'),
      CLINICAL: redact('ADMIN_NO_CLINICAL'),
      SENSITIVE: redact('ADMIN_NO_CLINICAL')
    },
    write: {
      DEMOGRAPHICS: deny('ROLE_CANNOT_WRITE'),
      LOGISTICS: deny('ADMIN_NO_CLINICAL'),
      VITALS: deny('ADMIN_NO_CLINICAL'),
      CLINICAL: deny('ADMIN_NO_CLINICAL'),
      SENSITIVE: deny('ADMIN_NO_CLINICAL')
    }
  },
  'AD-0012|HOSP-LOS-2025-083': {
    read: {
      DEMOGRAPHICS: FULL,
      LOGISTICS: redact('ADMIN_NO_CLINICAL'),
      VITALS: redact('ADMIN_NO_CLINICAL'),
      CLINICAL: redact('ADMIN_NO_CLINICAL'),
      SENSITIVE: redact('ADMIN_NO_CLINICAL')
    },
    write: {
      DEMOGRAPHICS: deny('ROLE_CANNOT_WRITE'),
      LOGISTICS: deny('ADMIN_NO_CLINICAL'),
      VITALS: deny('ADMIN_NO_CLINICAL'),
      CLINICAL: deny('ADMIN_NO_CLINICAL'),
      SENSITIVE: deny('ADMIN_NO_CLINICAL')
    }
  },
  'AD-0012|HOSP-LOS-2025-084': {
    read: {
      DEMOGRAPHICS: FULL,
      LOGISTICS: redact('ADMIN_NO_CLINICAL'),
      VITALS: redact('ADMIN_NO_CLINICAL'),
      CLINICAL: redact('ADMIN_NO_CLINICAL'),
      SENSITIVE: redact('ADMIN_NO_CLINICAL')
    },
    write: {
      DEMOGRAPHICS: deny('ROLE_CANNOT_WRITE'),
      LOGISTICS: deny('ADMIN_NO_CLINICAL'),
      VITALS: deny('ADMIN_NO_CLINICAL'),
      CLINICAL: deny('ADMIN_NO_CLINICAL'),
      SENSITIVE: deny('ADMIN_NO_CLINICAL')
    }
  },
  // CMO (same patient-data posture as admin) ------------------------------------
  'GV-9101|HOSP-LOS-2025-081': {
    read: {
      DEMOGRAPHICS: FULL,
      LOGISTICS: redact('ADMIN_NO_CLINICAL'),
      VITALS: redact('ADMIN_NO_CLINICAL'),
      CLINICAL: redact('ADMIN_NO_CLINICAL'),
      SENSITIVE: redact('ADMIN_NO_CLINICAL')
    },
    write: {
      DEMOGRAPHICS: deny('ROLE_CANNOT_WRITE'),
      LOGISTICS: deny('ADMIN_NO_CLINICAL'),
      VITALS: deny('ADMIN_NO_CLINICAL'),
      CLINICAL: deny('ADMIN_NO_CLINICAL'),
      SENSITIVE: deny('ADMIN_NO_CLINICAL')
    }
  },
  'GV-9101|HOSP-LOS-2025-082': {
    read: {
      DEMOGRAPHICS: FULL,
      LOGISTICS: redact('ADMIN_NO_CLINICAL'),
      VITALS: redact('ADMIN_NO_CLINICAL'),
      CLINICAL: redact('ADMIN_NO_CLINICAL'),
      SENSITIVE: redact('ADMIN_NO_CLINICAL')
    },
    write: {
      DEMOGRAPHICS: deny('ROLE_CANNOT_WRITE'),
      LOGISTICS: deny('ADMIN_NO_CLINICAL'),
      VITALS: deny('ADMIN_NO_CLINICAL'),
      CLINICAL: deny('ADMIN_NO_CLINICAL'),
      SENSITIVE: deny('ADMIN_NO_CLINICAL')
    }
  },
  'GV-9101|HOSP-LOS-2025-083': {
    read: {
      DEMOGRAPHICS: FULL,
      LOGISTICS: redact('ADMIN_NO_CLINICAL'),
      VITALS: redact('ADMIN_NO_CLINICAL'),
      CLINICAL: redact('ADMIN_NO_CLINICAL'),
      SENSITIVE: redact('ADMIN_NO_CLINICAL')
    },
    write: {
      DEMOGRAPHICS: deny('ROLE_CANNOT_WRITE'),
      LOGISTICS: deny('ADMIN_NO_CLINICAL'),
      VITALS: deny('ADMIN_NO_CLINICAL'),
      CLINICAL: deny('ADMIN_NO_CLINICAL'),
      SENSITIVE: deny('ADMIN_NO_CLINICAL')
    }
  },
  'GV-9101|HOSP-LOS-2025-084': {
    read: {
      DEMOGRAPHICS: FULL,
      LOGISTICS: redact('ADMIN_NO_CLINICAL'),
      VITALS: redact('ADMIN_NO_CLINICAL'),
      CLINICAL: redact('ADMIN_NO_CLINICAL'),
      SENSITIVE: redact('ADMIN_NO_CLINICAL')
    },
    write: {
      DEMOGRAPHICS: deny('ROLE_CANNOT_WRITE'),
      LOGISTICS: deny('ADMIN_NO_CLINICAL'),
      VITALS: deny('ADMIN_NO_CLINICAL'),
      CLINICAL: deny('ADMIN_NO_CLINICAL'),
      SENSITIVE: deny('ADMIN_NO_CLINICAL')
    }
  }
};

const GROUPS = ['DEMOGRAPHICS', 'LOGISTICS', 'VITALS', 'CLINICAL', 'SENSITIVE'];
const PATIENTS = ['HOSP-LOS-2025-081', 'HOSP-LOS-2025-082', 'HOSP-LOS-2025-083', 'HOSP-LOS-2025-084'];
const PRINCIPALS = ['GV-9042', 'SN-7742', 'RC-1029', 'AD-0012', 'GV-9101'];

const GROUP_DTO_KEY: Record<string, string> = {
  DEMOGRAPHICS: 'patient',
  LOGISTICS: 'logistics',
  VITALS: 'vitals',
  CLINICAL: 'clinical',
  SENSITIVE: 'sensitive'
};

async function loginAs(stack: TestStack, staffId: string): Promise<string> {
  const res = await request(stack.app)
    .post('/api/auth/login')
    .send({ staff_id: staffId, password: demoPassword(staffId) });
  if (res.status !== 200) {
    throw new Error(`login failed for ${staffId}: ${JSON.stringify(res.body)}`);
  }
  return res.body.data.access_token as string;
}

async function dossierVersion(stack: TestStack, auth: string, patient: string): Promise<number> {
  const res = await request(stack.app)
    .get(`/api/patients/${patient}`)
    .set('Authorization', `Bearer ${auth}`);
  if (res.status !== 200) {
    throw new Error(`dossier unreadable for version probe: ${patient} -> ${res.status}`);
  }
  return res.body.data.patient.version as number;
}

describe('AT-118: explicit policy matrix sweep', () => {
  it('AT-118: every cell of 5 principals x 4 patients x 5 groups x {read, write} matches PRD 6.3', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    for (const principal of PRINCIPALS) {
      makeOnDuty(stack, principal);
    }
    const tokens = new Map<string, string>();
    for (const principal of PRINCIPALS) {
      tokens.set(principal, await loginAs(stack, principal));
    }

    let cells = 0;
    for (const principal of PRINCIPALS) {
      const auth = tokens.get(principal) as string;
      for (const patient of PATIENTS) {
        const cell = MATRIX[`${principal}|${patient}`];
        if (cell === undefined) {
          throw new Error(`Matrix cell missing: ${principal}|${patient}`);
        }
        const res = await request(stack.app)
          .get(`/api/patients/${patient}`)
          .set('Authorization', `Bearer ${auth}`);
        for (const group of GROUPS) {
          const expected = cell.read[group] as string;
          const label = `${principal} ${patient} ${group} read`;
          if (expected === FULL) {
            expect(res.status, label).toBe(200);
            const key = GROUP_DTO_KEY[group] as string;
            expect(res.body.data[key], label).not.toBeNull();
          } else if (expected.startsWith('redact:')) {
            const code = expected.slice('redact:'.length);
            expect(res.status, label).toBe(200);
            const key = GROUP_DTO_KEY[group] as string;
            expect(res.body.data[key], label).toBeNull();
            const reasons = (res.body._meta.redactions as Array<{ reason_code: string }>).map(
              (entry) => entry.reason_code
            );
            expect(reasons, label).toContain(code);
          } else if (expected.startsWith('deny403:')) {
            const code = expected.slice('deny403:'.length);
            expect(res.status, label).toBe(403);
            expect(res.body.error.reason_code, label).toBe(code);
          } else if (expected === DENY404) {
            expect(res.status, label).toBe(404);
          } else {
            throw new Error(`Bad read expectation: ${expected}`);
          }
          cells += 1;
        }

        for (const group of GROUPS) {
          const expected = cell.write[group] as string;
          const label = `${principal} ${patient} ${group} write`;
          let writeRes;
          if (group === 'VITALS') {
            writeRes = await request(stack.app)
              .post(`/api/patients/${patient}/vitals`)
              .set('Authorization', `Bearer ${auth}`)
              .send({ heart_rate: 80, blood_pressure: '120/80', spo2: 98, temperature: 36.8 });
          } else {
            // Policy is evaluated before the version check, so a fallback
            // version still proves the denial; allowed writes use the live one.
            const version = await dossierVersion(stack, auth, patient).catch(() => 1);
            const patch: Record<string, unknown> =
              group === 'DEMOGRAPHICS'
                ? { version, full_name: 'Matrix Probe' }
                : group === 'LOGISTICS'
                  ? { version, payer: 'NHIS' }
                  : group === 'CLINICAL'
                    ? { version, allergies: 'Matrix probe allergy' }
                    : { version, genotype: 'Hb AA' };
            writeRes = await request(stack.app)
              .patch(`/api/patients/${patient}`)
              .set('Authorization', `Bearer ${auth}`)
              .send(patch);
          }
          if (expected === 'allow') {
            expect([200, 201].includes(writeRes.status), `${label} -> ${writeRes.status}`).toBe(true);
          } else if (expected.startsWith('deny:')) {
            const code = expected.slice('deny:'.length);
            expect(writeRes.status, label).toBe(403);
            expect((writeRes.body.error as { reason_code: string }).reason_code, label).toBe(code);
          } else if (expected === DENY404) {
            // PATCH probes an unreadable dossier first (404 either way).
            expect([403, 404].includes(writeRes.status), label).toBe(true);
          } else {
            throw new Error(`Bad write expectation: ${expected}`);
          }
          cells += 1;
        }
      }
    }
    expect(cells).toBe(5 * 4 * 5 * 2);
  }, 120000);
});
