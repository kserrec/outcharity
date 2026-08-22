import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadClientScript() {
  const timers = new Map();
  let nextTimer = 1;
  const copyButton = {
    dataset: { copy: 'Share this' },
    textContent: 'Copy share text',
    addEventListener(_event, handler) {
      this.click = handler;
    },
  };
  let copied = 0;
  const context = {
    document: {
      querySelector() {
        return null;
      },
      querySelectorAll(selector) {
        return selector === '[data-copy]' ? [copyButton] : [];
      },
    },
    navigator: {
      clipboard: {
        async writeText(value) {
          assert.equal(value, 'Share this');
          copied += 1;
        },
      },
    },
    window: {
      clearTimeout(timer) {
        timers.delete(timer);
      },
      setTimeout(callback) {
        const timer = nextTimer;
        nextTimer += 1;
        timers.set(timer, callback);
        return timer;
      },
    },
  };

  vm.runInNewContext(
    readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'),
    context,
  );
  return { copyButton, timers, copied: () => copied };
}

test('rapid copy clicks retain one reset and restore the original button label', async () => {
  const client = loadClientScript();

  await client.copyButton.click();
  await client.copyButton.click();

  assert.equal(client.copied(), 2);
  assert.equal(client.copyButton.textContent, 'Copied');
  assert.equal(client.timers.size, 1);
  for (const callback of client.timers.values()) callback();
  assert.equal(client.copyButton.textContent, 'Copy share text');
});
