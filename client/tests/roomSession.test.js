import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomSession } from '../src/lib/roomSession.js';

const SELF = 'device-self';

function roomRow(overrides = {}) {
  return {
    code: 'ABC234',
    media: null,
    position: 0,
    is_playing: false,
    sent_at_global: null,
    host_id: SELF,
    control_mode: 'free',
    ...overrides
  };
}

function createFakeTimers() {
  let current = 0;
  let nextId = 0;
  const timeouts = new Map();
  const intervals = new Map();

  const nextDue = () => {
    const due = [
      ...[...timeouts.values()].map((timer) => timer.at),
      ...[...intervals.values()].map((timer) => timer.next)
    ];
    return due.length === 0 ? Infinity : Math.min(...due);
  };

  return {
    now: () => current,
    setTimer(fn, ms) {
      const id = ++nextId;
      timeouts.set(id, { fn, at: current + ms });
      return id;
    },
    clearTimer(id) {
      timeouts.delete(id);
    },
    startInterval(fn, ms) {
      const id = ++nextId;
      intervals.set(id, { fn, every: ms, next: current + ms });
      return id;
    },
    stopInterval(id) {
      intervals.delete(id);
    },
    async advance(ms) {
      const target = current + ms;
      while (current < target) {
        const due = Math.min(nextDue(), target);
        if (due === Infinity) {
          current = target;
          break;
        }
        current = due;
        for (const [id, timer] of [...timeouts]) {
          if (timer.at <= current) {
            timeouts.delete(id);
            timer.fn();
          }
        }
        for (const [id, interval] of [...intervals]) {
          if (interval.next <= current) {
            interval.next += interval.every;
            interval.fn();
          }
        }
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
}

function createFakeAdapter({ presence = [], snapshot = roomRow(), createRoom } = {}) {
  const calls = {
    sendControl: [],
    sendReaction: [],
    sendChat: [],
    saveState: [],
    claimHost: [],
    setControlMode: []
  };
  let handlers = null;

  return {
    calls,
    getHandlers: () => handlers,
    async joinRoom(options) {
      handlers = options;
      return presence;
    },
    async leaveRoom() {},
    async sendControl(payload) {
      calls.sendControl.push(payload);
    },
    async sendReaction(payload) {
      calls.sendReaction.push(payload);
    },
    async sendChat(payload) {
      calls.sendChat.push(payload);
    },
    async saveState(payload) {
      calls.saveState.push(payload);
    },
    async claimHost(code, claimant) {
      calls.claimHost.push({ code, claimant });
    },
    async setControlMode(mode, id) {
      calls.setControlMode.push({ mode, id });
    },
    async createRoom(code, deviceId, mode) {
      if (createRoom) return createRoom(code, deviceId, mode);
      return roomRow({ code, host_id: deviceId, control_mode: mode });
    },
    async getSnapshot() {
      return snapshot;
    }
  };
}

function setup({ row = roomRow(), presence = [], alias = 'Ana' } = {}) {
  const adapter = createFakeAdapter({ presence, snapshot: row });
  const timers = createFakeTimers();
  const states = [];
  const pauseRef = { current: 0 };
  let globalNow = 10_000;

  const session = createRoomSession({
    createAdapter: () => adapter,
    deviceId: SELF,
    getAlias: () => alias,
    getGlobalNow: () => globalNow,
    now: timers.now,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    startInterval: timers.startInterval,
    stopInterval: timers.stopInterval,
    pauseRef,
    onChange: (state) => states.push(state)
  });

  return {
    adapter,
    timers,
    states,
    pauseRef,
    session,
    setGlobalNow: (value) => {
      globalNow = value;
    },
    last: () => states[states.length - 1]
  };
}

test('emite la acción con el reloj global y actualiza el estado de la sala', async () => {
  const ctx = setup();
  await ctx.session.joinRoom('abc234');
  ctx.setGlobalNow(12_345);

  await ctx.session.play(42.5);

  assert.equal(ctx.adapter.calls.sendControl.length, 1);
  assert.deepEqual(ctx.adapter.calls.sendControl[0], {
    type: 'play',
    media: null,
    position: 42.5,
    isPlaying: true,
    sentAtGlobal: 12_345
  });
  assert.equal(ctx.last().room.position, 42.5);
  assert.equal(ctx.last().room.isPlaying, true);
  assert.equal(ctx.last().room.sentAtGlobal, 12_345);
  assert.ok(ctx.pauseRef.current > 0, 'el bucle de deriva se pausa tras la acción');
});

test('persiste el snapshot una sola vez tras el debounce', async () => {
  const ctx = setup();
  await ctx.session.joinRoom('ABC234');
  ctx.setGlobalNow(20_000);

  await ctx.session.play(10);
  await ctx.session.seek(20);
  assert.equal(ctx.adapter.calls.saveState.length, 0);

  await ctx.timers.advance(250);
  assert.equal(ctx.adapter.calls.saveState.length, 1);
  assert.deepEqual(ctx.adapter.calls.saveState[0], {
    media: null,
    position: 20,
    isPlaying: true,
    sentAtGlobal: 20_000
  });
});

test('en modo anfitrión un dispositivo ajeno no emite ni guarda', async () => {
  const ctx = setup({ row: roomRow({ control_mode: 'host', host_id: 'device-other' }) });
  await ctx.session.joinRoom('ABC234');

  await ctx.session.play(5);

  assert.equal(ctx.adapter.calls.sendControl.length, 0);
  assert.match(ctx.last().error, /Solo el anfitrión/);
  await ctx.timers.advance(250);
  assert.equal(ctx.adapter.calls.saveState.length, 0);
});

test('reclama el host cuando desaparece 10 s y es el dispositivo más antiguo', async () => {
  const ctx = setup({ row: roomRow({ control_mode: 'host', host_id: 'device-gone' }) });
  await ctx.session.joinRoom('ABC234');

  ctx.adapter.getHandlers().onPresence([
    { deviceId: SELF, alias: 'Ana', joinedAt: '2026-01-01T00:00:00.000Z' },
    { deviceId: 'device-new', alias: 'Luis', joinedAt: '2026-01-02T00:00:00.000Z' }
  ]);

  await ctx.timers.advance(9_000);
  assert.equal(ctx.adapter.calls.claimHost.length, 0);

  await ctx.timers.advance(4_000);
  assert.equal(ctx.adapter.calls.claimHost.length, 1);
  assert.deepEqual(ctx.adapter.calls.claimHost[0], { code: 'ABC234', claimant: SELF });
  assert.equal(ctx.last().room.hostId, SELF);
});

test('no reclama el host mientras siga presente en la sala', async () => {
  const ctx = setup({ row: roomRow({ control_mode: 'host', host_id: 'device-host' }) });
  await ctx.session.joinRoom('ABC234');

  ctx.adapter.getHandlers().onPresence([
    { deviceId: 'device-host', alias: 'Host', joinedAt: '2026-01-01T00:00:00.000Z' },
    { deviceId: SELF, alias: 'Ana', joinedAt: '2026-01-02T00:00:00.000Z' }
  ]);

  await ctx.timers.advance(30_000);
  assert.equal(ctx.adapter.calls.claimHost.length, 0);
});

test('aplica un control remoto más nuevo e ignora el anterior', async () => {
  const ctx = setup();
  await ctx.session.joinRoom('ABC234');
  const handlers = ctx.adapter.getHandlers();

  handlers.onControl({
    eventId: 'e1',
    deviceId: 'device-b',
    seq: 1,
    sentAtGlobal: 5_000,
    position: 30,
    isPlaying: true
  });
  assert.equal(ctx.last().room.position, 30);

  handlers.onControl({
    eventId: 'e2',
    deviceId: 'device-c',
    seq: 1,
    sentAtGlobal: 4_000,
    position: 99,
    isPlaying: false
  });
  assert.equal(ctx.last().room.position, 30);
  assert.equal(ctx.last().room.isPlaying, true);
});

test('el chat respeta un mensaje cada 2 s y lo emite por el canal', async () => {
  const ctx = setup();
  await ctx.session.joinRoom('ABC234');

  assert.deepEqual(await ctx.session.sendChat('  hola  '), { ok: true });
  assert.deepEqual(await ctx.session.sendChat('otra vez'), { ok: false, reason: 'espera' });
  assert.equal(ctx.adapter.calls.sendChat.length, 1);
  assert.equal(ctx.adapter.calls.sendChat[0].text, 'hola');

  await ctx.timers.advance(2_000);
  assert.deepEqual(await ctx.session.sendChat('tercero'), { ok: true });
  assert.equal(ctx.adapter.calls.sendChat.length, 2);
});

test('agrupa las reacciones y las retira al pasar el TTL', async () => {
  const ctx = setup();
  await ctx.session.joinRoom('ABC234');

  assert.equal(await ctx.session.sendReaction('🔥'), true);
  assert.equal(await ctx.session.sendReaction('👏'), false);
  assert.equal(ctx.adapter.calls.sendReaction.length, 1);
  assert.equal(ctx.last().reactions.length, 1);

  await ctx.timers.advance(4_000);
  assert.equal(ctx.last().reactions.length, 0);
});

test('al salir limpia el estado, cancela los temporizadores y cierra el canal', async () => {
  const ctx = setup();
  await ctx.session.joinRoom('ABC234');
  await ctx.session.play(3);

  await ctx.session.leaveRoom();

  assert.equal(ctx.last().session, null);
  assert.equal(ctx.last().room, null);
  assert.equal(ctx.last().status, 'idle');
  await ctx.timers.advance(5_000);
  assert.equal(ctx.adapter.calls.saveState.length, 0, 'el debounce pendiente se canceló');
});
