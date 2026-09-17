import { inject } from 'vitest';
import { useTestDatabaseTemplate } from './src/testing/index.js';

useTestDatabaseTemplate({ template: inject('testDatabaseTemplate') });
