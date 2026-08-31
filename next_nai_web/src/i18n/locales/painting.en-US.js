import paintingWorkspaceEnUS from './painting-workspace.en-US.js';
import paintingToolsEnUS from './painting-tools.en-US.js';

// 英文字典只组合英文子域，禁止通过中文字典静默补齐缺失翻译。
const paintingEnUS = {
  painting: {
    ...paintingWorkspaceEnUS.painting,
    ...paintingToolsEnUS.painting,
  },
};

export default paintingEnUS;
