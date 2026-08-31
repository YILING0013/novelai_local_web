import paintingWorkspaceZhCN from './painting-workspace.zh-CN.js';
import paintingToolsZhCN from './painting-tools.zh-CN.js';

// 两个绘画子域保持独立维护，在入口处按稳定命名空间组合，避免互相覆盖。
const paintingZhCN = {
  painting: {
    ...paintingWorkspaceZhCN.painting,
    ...paintingToolsZhCN.painting,
  },
};

export default paintingZhCN;
