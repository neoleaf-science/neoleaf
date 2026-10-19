import { afterAll, beforeAll } from 'bun:test';
import { startServer, stopServer } from './helpers';

beforeAll(startServer, 300000);
afterAll(stopServer);
