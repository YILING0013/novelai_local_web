import assert from 'node:assert/strict';
import test from 'node:test';
import { applyImageParametersToUI } from './parameterMapping.js';

test('图库单向应用只更新选中提示词，保留另一向、角色和生成参数', () => {
  for (const field of ['positivePrompt', 'negativePrompt']) {
    for (const value of ['applied prompt', '']) {
      const state = { positivePrompt: 'keep positive', negativePrompt: 'keep negative' };
      const callbacks = {
        setPositivePrompt: (prompt) => { state.positivePrompt = prompt; },
        setNegativePrompt: (prompt) => { state.negativePrompt = prompt; },
        setCharacterTabsFromNote: () => assert.fail('单向应用不应修改角色'),
        setExpandedPanels: () => assert.fail('单向应用不应展开角色面板'),
        handleParamChange: () => assert.fail('单向应用不应修改模型、种子等生成参数'),
        onResolutionChange: () => assert.fail('单向应用不应修改分辨率'),
      };

      assert.equal(applyImageParametersToUI({ [field]: value }, callbacks), true);
      assert.deepEqual(state, {
        positivePrompt: field === 'positivePrompt' ? value : 'keep positive',
        negativePrompt: field === 'negativePrompt' ? value : 'keep negative',
      });
    }
  }
});
