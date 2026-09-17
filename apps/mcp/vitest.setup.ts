import { useTestDatabaseTemplate } from '@app/db/testing';
import { inject } from 'vitest';

useTestDatabaseTemplate({ template: inject('testDatabaseTemplate') });
