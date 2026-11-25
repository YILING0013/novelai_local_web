/** 教程「注释」的中英文内容，随这篇教程按需加载。 */
const content = {
  'zh-CN': {
    lead: '注释用来临时停用一部分提示词：写在 `/*` 和 `*/` 之间的内容留在输入框里，但不会发送给生成。适合对比效果、保留备选标签，或给提示词写备注。',
    demo: [
      '想暂时去掉 red eyes 对比效果，又不想删掉它。',
      '在大窗口编辑器中选中 red eyes。',
      '点击工具栏的注释按钮，所在标签被包进 /* */，预览显示为灰色删除线。',
      '下方是实际发送给生成的内容，注释部分已经移除。',
      '选中整段注释，点击取消注释按钮即可恢复。',
    ],
    sections: [
      {
        title: '写法',
        blocks: [
          { head: ['写法', '效果'], table: [
            ['`/* red eyes */`', '整段内容在发送前移除，输入框里保留原文。'],
            ['`/* 外层 /* 内层 */ 外层 */`', '支持嵌套，以最外层的一对标记为准。'],
            ['只有 `/*`、没有对应的 `*/`', '不算注释，按普通文字发送。'],
          ] },
          '注释可以写在任何位置，也可以直接手动输入。被注释的内容不计入 Token 数，也不会被翻译或调整权重。保存到笔记时，注释部分不会保存。',
        ],
      },
      {
        title: '注释按钮',
        blocks: [
          '大窗口编辑器的工具栏有两个注释按钮，使用前需要先选中文字：',
          { head: ['按钮', '作用'], table: [
            ['注释（`</>` 图标）', '把选区涉及的完整标签（到逗号或换行为止）包进 `/* */`；选区已经在注释里时不重复添加。'],
            ['取消注释（清除格式图标）', '去掉完整位于选区内的注释的 `/*` 和 `*/`，保留里面的文字。'],
          ] },
          { note: '桌面在普通输入框和大窗口里都能选中文字后按 [[Ctrl]]＋[[/]] 切换注释，再按一次恢复。没有选区时不会修改文字。手机请使用大窗口里的按钮。' },
        ],
      },
    ],
    tryIt: '在下面的输入框中选中一段文字，点击注释或取消注释，下方会同步显示实际发送的内容。',
    guide: '在工作台里暂时停用示例标签，观察预览，再恢复原文。',
    sent: '实际发送',
  },
  'en-US': {
    lead: 'Comments switch off part of a prompt for a while. Anything between `/*` and `*/` stays in the field but isn’t sent for generation. Use them to compare results, keep alternative tags around or leave yourself notes.',
    demo: [
      'You want to drop red eyes for a moment to compare results, without deleting it.',
      'Select red eyes in the large editor.',
      'Click the comment button. The tag is wrapped in /* */ and the preview shows it gray and struck through.',
      'Below is what will be sent for generation. The comment has been removed.',
      'Select the whole comment and click the uncomment button to bring it back.',
    ],
    sections: [
      {
        title: 'Syntax',
        blocks: [
          { head: ['Syntax', 'Result'], table: [
            ['`/* red eyes */`', 'Removed before sending. The field still shows the text.'],
            ['`/* outer /* inner */ outer */`', 'Nested comments work. The outermost pair counts.'],
            ['`/*` without a matching `*/`', 'Not a comment; it is sent as normal text.'],
          ] },
          'You can put comments anywhere and type them by hand. Commented text isn’t counted in tokens and isn’t translated or reweighted. Comments aren’t saved when you save a note.',
        ],
      },
      {
        title: 'Comment buttons',
        blocks: [
          'The large editor’s toolbar has two comment buttons. Select some text before using them:',
          { head: ['Button', 'What it does'], table: [
            ['Comment (`</>` icon)', 'Wraps every complete tag the selection touches (up to the comma or line break) in `/* */`. Nothing is added if the selection is already inside a comment.'],
            ['Uncomment (clear formatting icon)', 'Removes `/*` and `*/` from comments that are entirely inside the selection and keeps the text.'],
          ] },
          { note: 'On desktop, select text in either editor and press [[Ctrl]]+[[/]] to toggle a comment. Press it again to restore the text. An empty selection leaves the prompt alone. On a phone, use the expanded editor’s buttons.' },
        ],
      },
    ],
    tryIt: 'Select some text in the field below and choose comment or uncomment. What would be sent appears underneath as you edit.',
    guide: 'Switch off a sample tag in the workspace, check the preview, and restore the text.',
    sent: 'Sent for generation',
  },
};

export default content;
