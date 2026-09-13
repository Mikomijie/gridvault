import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'backend/test/**/*.{test,spec}.ts',
      'witness/test/**/*.{test,spec}.ts',
      'test/**/*.{test,spec}.ts'
    ]
  }
});
