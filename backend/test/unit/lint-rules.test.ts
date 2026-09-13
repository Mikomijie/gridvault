import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import {
  noTemplateLiteralSqlRule,
  noRepositoryImportsInRoutesRule
} from '../../../scripts/eslint-rules.js';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester();

ruleTester.run('gridvault/no-template-literal-sql', noTemplateLiteralSqlRule as any, {
  valid: [
    { code: 'const query = "SELECT * FROM users WHERE id = ?";' },
    { code: 'const query = `SELECT * FROM users WHERE id = ?`;' },
    { code: 'const greeting = `Hello ${name}`;' }
  ],
  invalid: [
    {
      code: 'const query = `SELECT * FROM users WHERE id = ${userId}`;',
      errors: [
        {
          message:
            'Template literal SQL with expressions is forbidden. Use parameterized SQL queries with bound parameters instead.'
        }
      ]
    },
    {
      code: 'const stmt = `DELETE FROM audit_logs WHERE log_index = ${idx}`;',
      errors: [
        {
          message:
            'Template literal SQL with expressions is forbidden. Use parameterized SQL queries with bound parameters instead.'
        }
      ]
    }
  ]
});

ruleTester.run(
  'gridvault/no-repository-imports-in-routes',
  noRepositoryImportsInRoutesRule as any,
  {
    valid: [
      {
        code: "import { getPatientRecord } from '../../services/patient.js';",
        filename: '/src/http/routes/patient.ts'
      },
      {
        code: "import { auditRepository } from '../../db/repositories/audit.js';",
        filename: '/src/services/patient.ts'
      }
    ],
    invalid: [
      {
        code: "import { auditRepository } from '../../db/repositories/audit.js';",
        filename: '/src/http/routes/audit.ts',
        errors: [
          {
            message:
              'Direct repository imports from route handlers are forbidden. Route handlers must call service functions.'
          }
        ]
      },
      {
        code: "import { patientRepo } from '../repositories/patient.js';",
        filename: '/src/http/routes/patient.ts',
        errors: [
          {
            message:
              'Direct repository imports from route handlers are forbidden. Route handlers must call service functions.'
          }
        ]
      }
    ]
  }
);
