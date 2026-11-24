import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { type AppBindings, gameRoutes } from './routes/game.js';

export const app = new Hono<{ Bindings: AppBindings }>();

app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'wikipedia-game-api',
    stateless: true,
    timestamp: new Date().toISOString(),
  });
});

app.route('/game', gameRoutes);
