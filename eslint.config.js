import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginSecurity from 'eslint-plugin-security';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';
import {
  noTemplateLiteralSqlRule,
  noRepositoryImportsInRoutesRule
} from './scripts/eslint-rules.js';

const customGridVaultPlugin = {
  rules: {
    'no-template-literal-sql': noTemplateLiteralSqlRule,
    'no-repository-imports-in-routes': noRepositoryImportsInRoutesRule
  }
};

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  pluginSecurity.configs.recommended,
  {
    plugins: {
      gridvault: customGridVaultPlugin
    },
    rules: {
      'gridvault/no-template-literal-sql': 'error',
      'gridvault/no-repository-imports-in-routes': 'error',
      'security/detect-object-injection': 'off', // Frequently false-positive on typed dictionary lookups
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  },
  {
    files: ['frontend/**/*.{js,jsx}'],
    languageOptions: {
      globals: {
        ...globals.browser
      }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },
  {
    files: ['backend/**/*.{js,ts}', 'witness/**/*.{js,ts}', 'scripts/**/*.{js,ts}', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  },
  {
    files: ['**/test/**', '**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'security/detect-non-literal-fs-filename': 'off'
    }
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-ssr/**',
      '**/coverage/**',
      '**/data/**',
      '**/*.db*'
    ]
  },
  prettierConfig
);
