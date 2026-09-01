import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const appDirectory = dirname(fileURLToPath(import.meta.url));
const loginSource = readFileSync(join(appDirectory, 'login', 'page.js'), 'utf8');
const mainSource = readFileSync(join(appDirectory, 'main', 'page.js'), 'utf8');
const localeDirectory = join(appDirectory, '..', 'i18n', 'locales');
const zhLocale = readFileSync(join(localeDirectory, 'core.zh-CN.js'), 'utf8');
const enLocale = readFileSync(join(localeDirectory, 'core.en-US.js'), 'utf8');

test('local login keeps one form and uses the original low-emphasis or switch', () => {
  assert.match(loginSource, /<Divider[\s\S]*t\('login\.or'\)/);
  assert.match(loginSource, /accountSwitchButtonStyle/);
  assert.match(loginSource, /setLoginMode\(\(current\) => current === 'token' \? 'password' : 'token'\)/);
  assert.doesNotMatch(loginSource, /variant=\{loginMode === 'token'/);
  assert.doesNotMatch(loginSource, /gridTemplateColumns: '1fr 1fr'[\s\S]{0,300}login\.local\.pat/);
});

test('account dialog uses grouped presentation and formats official raw values', () => {
  assert.match(mainSource, /const SummaryMetric/);
  assert.match(mainSource, /const DetailRow/);
  assert.match(mainSource, /linear-gradient\(135deg/);
  assert.doesNotMatch(mainSource, /snapshotRows\.map/);
  assert.match(mainSource, /login_mode === 'persistent_token'/);
  assert.match(mainSource, /if \(value === 0\) return t\('main\.local\.notSubscribed'\)/);
  assert.match(mainSource, /value === false \|\| value === 'not_banned'/);
  assert.match(mainSource, /if \(numericValue <= 0\) return emptyValue/);
  assert.match(mainSource, /accountSnapshot\?\.auth\?\.can_manage_credentials === true/);
});

test('both locales contain the login switch and human-readable account labels', () => {
  for (const locale of [zhLocale, enLocale]) {
    for (const key of [
      '"or"',
      '"useEmailPassword"',
      '"usePat"',
      '"loginModePat"',
      '"loginModePassword"',
      '"notSubscribed"',
      '"accountNormal"',
      '"accountSection"',
      '"subscriptionAndQuota"',
    ]) {
      assert.match(locale, new RegExp(key));
    }
  }
});
