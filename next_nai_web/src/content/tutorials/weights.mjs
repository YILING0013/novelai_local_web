/** 教程「快速权重」的中英文内容，随这篇教程按需加载。 */
const content = {
  'zh-CN': {
    lead: '权重决定一个标签对画面的影响强弱。快速权重让你不用手写符号：把光标放进标签，按快捷键即可加权或降权，编辑器会自动写好权重格式。',
    demo: [
      '把光标放进 blue hair，按 [[Alt]] + [[↑]] 加权，每按一次增加 0.1。',
      '按 [[Alt]] + [[↓]] 降权。回到 1.0 时自动去掉权重标记，继续按会变成 0.9。',
      '默认格式改为括号时，加权写成 {…}，降权写成 […]，每按一次增减一层。',
      '选中一部分文字时，只调整选中的部分。',
      '在大窗口编辑器中，也可以点击 W+ / W− 按钮，适合触屏设备。',
    ],
    sections: [
      {
        title: '快捷操作',
        blocks: [
          { head: ['操作', '作用'], table: [
            ['[[Alt]] + [[↑]] / [[↓]]', '加权 / 降权'],
            ['按住 [[Shift]] 滚动鼠标滚轮', '向上加权，向下降权'],
            ['大窗口工具栏 `W+` / `W−`', '加权 / 降权'],
          ] },
          { list: [
            '光标在标签里、没有选中文字时，调整整个标签（以逗号或换行分隔）。',
            '选中文字时只调整选中的部分；选区跨多个标签时，每个标签分别调整。',
            '光标在注释或随机标记里时不会调整。',
          ] },
        ],
      },
      {
        title: '两种权重格式',
        blocks: [
          { head: ['格式', '加权', '降权', '说明'], table: [
            ['数值（默认）', '`1.1::blue hair::`', '`0.9::blue hair::`', '每次增减 0.1；回到 1.0 时去掉标记；可以降到 0 以下，成为负权重。'],
            ['括号', '`{blue hair}`', '`[blue hair]`', '每次增减一层括号；在 `{…}` 上降权会先去掉一层。'],
          ] },
          '已有权重的标签沿用原来的格式。新标签使用齿轮菜单中「默认权重格式」选定的格式。',
          { note: '系统设置的「权重调整」中可以关闭快捷键、修改数字权重步长，或设置调权后是否保留选区。' },
        ],
      },
    ],
    tryIt: '把光标放进下面任意标签，按 Alt + ↑ / ↓，按住 Shift 滚动滚轮，或点击 W+ / W−。切换默认格式，比较两种写法。',
    guide: '在样例词条上尝试调权，再用展开编辑器的权重按钮观察数值。',
    format: '默认权重格式',
  },
  'en-US': {
    lead: 'Weight sets how strongly a tag affects the image. Quick weights save you from typing the syntax: put the cursor in a tag, press a shortcut to raise or lower it, and the editor writes the weight for you.',
    demo: [
      'Put the cursor in blue hair and press [[Alt]] + [[↑]]. Each press adds 0.1.',
      'Press [[Alt]] + [[↓]] to lower it. At 1.0 the weight marker disappears; one more press gives 0.9.',
      'With the bracket format, raising writes {…} and lowering writes […], one layer per press.',
      'If you select part of a tag, only the selection changes.',
      'In the large editor you can also use the W+ / W− buttons, which is handy on touch screens.',
    ],
    sections: [
      {
        title: 'Shortcuts',
        blocks: [
          { head: ['Action', 'Result'], table: [
            ['[[Alt]] + [[↑]] / [[↓]]', 'Raise / lower the weight'],
            ['Hold [[Shift]] and scroll', 'Scroll up to raise, down to lower'],
            ['`W+` / `W−` in the large editor', 'Raise / lower the weight'],
          ] },
          { list: [
            'With the cursor in a tag and nothing selected, the whole tag changes (tags are separated by commas or line breaks).',
            'With text selected, only the selection changes. If it spans several tags, each tag is weighted separately.',
            'Nothing changes while the cursor is inside a comment or random marker.',
          ] },
        ],
      },
      {
        title: 'Weight formats',
        blocks: [
          { head: ['Format', 'Raise', 'Lower', 'Notes'], table: [
            ['Numeric (default)', '`1.1::blue hair::`', '`0.9::blue hair::`', 'Changes by 0.1 per step. The marker is removed at 1.0, and values can go below 0 to become negative weights.'],
            ['Brackets', '`{blue hair}`', '`[blue hair]`', 'Adds or removes one bracket per step. Lowering `{…}` removes a layer first.'],
          ] },
          'Tags that already have a weight keep their format. New tags use the Default weight format chosen in the gear menu.',
          { note: 'Under Weight adjustment in Settings you can turn off the shortcuts, change the numeric step, or choose whether the selection stays after adjusting.' },
        ],
      },
    ],
    tryIt: 'Put the cursor in any tag below and press Alt + ↑ / ↓, hold Shift and scroll, or use W+ / W−. Switch the default format to compare the two styles.',
    guide: 'Adjust a sample tag’s weight, then use the expanded editor’s weight buttons to check the value.',
    format: 'Default weight format',
  },
};

export default content;