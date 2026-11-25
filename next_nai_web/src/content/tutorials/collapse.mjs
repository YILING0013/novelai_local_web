/** 教程「折叠与展开」的中英文内容，随这篇教程按需加载。 */
const content = {
  'zh-CN': {
    lead: '提示词区位于生成参数面板顶部，由标签栏和输入框组成。标签栏在「正向」「负向」「翻译」之间切换，右侧依次是随机提示词、笔记、保存、设置和收起按钮。需要更多画面空间时可以把整块收起；需要更大的编辑空间时可以打开大窗口编辑器。',
    demo: [
      '标签栏最右侧的箭头控制提示词区的收起和展开。',
      '点击箭头收起：只保留标签栏和工具按钮，输入框和角色设置暂时隐藏，内容不会丢失。',
      '收起时点击另一个标签，会切换到该栏并自动展开。',
      '输入框超过 8 行后在框内滚动。点击右下角的展开图标，打开大窗口编辑器。',
      '大窗口提供权重、注释和随机提示词工具，并同步显示预览。点「应用更改」写回提示词框。',
    ],
    sections: [
      {
        title: '收起与展开',
        blocks: [
          '点击标签栏最右侧的箭头（提示为「收起提示词」）收起整个提示词区，再次点击（提示为「展开提示词」）恢复。',
          { list: [
            '收起后只显示标签栏和工具按钮。正向、负向和角色提示词都会保留，生成时照常使用。',
            '收起状态保存在当前浏览器，刷新页面或下次打开网站时保持不变。',
            '收起时点击另一个标签会自动展开；点击已选中的标签不会展开，请使用箭头。',
            '收起时仍可使用笔记和随机提示词，插入的内容会写入对应的输入框。',
          ] },
        ],
      },
      {
        title: '大窗口编辑器',
        blocks: [
          '输入框右下角有展开、清空（有内容时出现）和复制三个按钮。点击展开图标，在大窗口中编辑当前标签的提示词。',
          { head: ['区域', '说明'], table: [
            ['工具栏', '`W+` / `W−` 调整权重，注释与取消注释，插入随机提示词。'],
            ['编辑区', '与普通输入框相同，支持提示词联想和快捷键调权。'],
            ['预览', '宽屏默认显示在右侧，窄屏默认隐藏；可在窗口的齿轮菜单中改为叠加预览。'],
            ['状态行', '显示当前字段的 Token 数、全部正向（或负向）提示词合计和模型上限，以及光标位置或已选字符数。'],
            ['应用更改', '把修改写回提示词框。点「取消」或关闭窗口则放弃这次修改。'],
          ] },
          { note: '手机上大窗口编辑器会全屏显示，预览默认隐藏，以留出更多输入空间。' },
        ],
      },
    ],
    tryIt: '下面是一个独立的提示词区，操作不会改动工作台里的提示词和设置。试着收起、切换标签，再点右下角的展开图标打开大窗口编辑器。',
    guide: '引导会在工作台中依次指出收起箭头、展开图标和大窗口的工具栏。',
    sample: '1girl, silver hair, long hair, holding lantern, night, starry sky, cherry blossoms, wind, looking at viewer, smile',
    sampleNegative: 'lowres, bad anatomy, blurry',
  },
  'en-US': {
    lead: 'The prompt section sits at the top of the generation panel and has a tab bar and a prompt field. The tabs switch between Positive, Negative and Translate. The buttons on the right open random prompts, the notebook, saving, settings and collapse. Collapse the whole section when you need more room on screen, or open the large editor when you need more room to write.',
    demo: [
      'The arrow at the far right of the tab bar collapses and expands the prompt section.',
      'Click it to collapse. Only the tab bar and tool buttons stay; the prompt field and character settings are hidden but kept.',
      'While collapsed, clicking another tab switches to it and expands the section.',
      'The field scrolls after 8 lines. Click the expand icon at the bottom right to open the large editor.',
      'The large editor adds weight, comment and random prompt tools with a live preview. Apply changes copies the text back.',
    ],
    sections: [
      {
        title: 'Collapse and expand',
        blocks: [
          'Click the arrow at the far right of the tab bar (Collapse prompts) to collapse the whole section. Click it again (Expand prompts) to bring it back.',
          { list: [
            'When collapsed, only the tab bar and tool buttons show. Positive, negative and character prompts are kept and still used for generation.',
            'This browser remembers the collapsed state after a refresh or on your next visit.',
            'Clicking another tab while collapsed expands the section. Clicking the tab that is already selected doesn’t, so use the arrow instead.',
            'Notes and random prompts still work while collapsed, and inserted text goes into the matching field.',
          ] },
        ],
      },
      {
        title: 'Large editor',
        blocks: [
          'The bottom right of the prompt field has Expand editor, Clear (when the field has text) and Copy buttons. Click the expand icon to edit the current tab’s prompt in a large window.',
          { head: ['Area', 'What it does'], table: [
            ['Toolbar', '`W+` / `W−` adjust weights. The other buttons comment, uncomment and insert random prompts.'],
            ['Editing area', 'Works like the regular field, including tag suggestions and weight shortcuts.'],
            ['Preview', 'Shown on the right on wide screens and hidden on narrow ones. Switch to an overlay preview from the window’s gear menu.'],
            ['Status line', 'Tokens in this field, the total for all positive (or negative) prompts and the model limit, plus the cursor position or selected characters.'],
            ['Apply changes', 'Copies your edits back to the prompt field. Cancel, or closing the window, discards them.'],
          ] },
          { note: 'On phones the large editor opens full screen with the preview hidden, leaving more room to type.' },
        ],
      },
    ],
    tryIt: 'This is a separate prompt section, so nothing here changes the prompts or settings in your workspace. Try collapsing it, switching tabs and opening the large editor from the expand icon at the bottom right.',
    guide: 'The guide points out the collapse arrow, the expand icon and the large editor’s toolbar in your workspace.',
    sample: '1girl, silver hair, long hair, holding lantern, night, starry sky, cherry blossoms, wind, looking at viewer, smile',
    sampleNegative: 'lowres, bad anatomy, blurry',
  },
};

export default content;