import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./BatchGenerationService.js', import.meta.url), 'utf8');
const serviceModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const { BatchGenerationController } = serviceModule;

const createFakeClock = () => {
  let currentTime = 0;
  let nextTimerId = 1;
  const timers = new Map();

  return {
    now: () => currentTime,
    setTimeout(callback, delay) {
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, { callback, runAt: currentTime + delay });
      return timerId;
    },
    clearTimeout(timerId) {
      timers.delete(timerId);
    },
    advanceBy(milliseconds) {
      const targetTime = currentTime + milliseconds;
      while (true) {
        const nextTimer = [...timers.entries()]
          .filter(([, timer]) => timer.runAt <= targetTime)
          .sort((left, right) => left[1].runAt - right[1].runAt)[0];
        if (!nextTimer) break;
        const [timerId, timer] = nextTimer;
        timers.delete(timerId);
        currentTime = timer.runAt;
        timer.callback();
      }
      currentTime = targetTime;
    },
    pendingCount: () => timers.size,
  };
};

test('批次 1/8 边界只在非末张后等待 15 秒', async () => {
  const singleClock = createFakeClock();
  const single = new BatchGenerationController(singleClock);
  single.initialize(1);
  assert.equal(single.getStatus().total, 1);
  single.completeCurrentImage(true);
  assert.equal(single.shouldContinue(), false);
  assert.equal(singleClock.pendingCount(), 0);

  const batchClock = createFakeClock();
  const batch = new BatchGenerationController(batchClock);
  batch.initialize(8);
  assert.equal(batch.getStatus().total, 8);
  batch.completeCurrentImage(true);
  assert.equal(batch.shouldContinue(), true);

  let waitResolved = false;
  const waitPromise = batch.wait(batch.config.bufferTime).then(() => { waitResolved = true; });
  batchClock.advanceBy(14_000);
  await Promise.resolve();
  assert.equal(waitResolved, false);
  assert.equal(batch.getStatus().waitingTime, 1);
  batchClock.advanceBy(1_000);
  await waitPromise;
  assert.equal(waitResolved, true);
  assert.equal(batch.getStatus().waitingTime, 0);

  for (let index = 1; index < 8; index += 1) batch.completeCurrentImage(true);
  assert.equal(batch.getStatus().completed, 8);
  assert.equal(batch.shouldContinue(), false);
  assert.equal(batchClock.pendingCount(), 0);
});

test('首张错误立即停止且不会继续等待', () => {
  const clock = createFakeClock();
  const controller = new BatchGenerationController(clock);
  controller.initialize(8);
  controller.completeCurrentImage(false);
  assert.equal(controller.handleError({ code: 'TEST_FAILURE' }), 'stop');
  assert.equal(controller.getStatus().failed, 1);
  assert.equal(controller.getStatus().errors.length, 1);
  assert.equal(controller.shouldContinue(), false);
  assert.equal(clock.pendingCount(), 0);
});

test('卸载取消会立即打断等待且不再发送后续批次', async () => {
  const clock = createFakeClock();
  const controller = new BatchGenerationController(clock);
  controller.initialize(8);
  controller.completeCurrentImage(true);
  const pendingWait = controller.wait(controller.config.bufferTime);
  assert.equal(clock.pendingCount(), 1);

  controller.cancel();
  await pendingWait;
  assert.equal(controller.shouldContinue(), false);
  assert.equal(controller.getStatus().waitingTime, 0);
  assert.equal(clock.pendingCount(), 0);

  clock.advanceBy(15_000);
  assert.equal(clock.pendingCount(), 0);
});
