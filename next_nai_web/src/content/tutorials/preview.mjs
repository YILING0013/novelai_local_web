/** 教程「预览」的中英文内容，随这篇教程按需加载。 */
const content = {
  'zh-CN': {
    lead: '预览会在输入框里按写法给提示词着色，方便检查权重、注释和随机标记是否写对。预览只改变显示效果，不会改动文字，也不影响发送给生成的内容。',
    demo: [
      '关闭预览时，输入框只显示原始文字，很难一眼看出哪些内容调整过权重。',
      '点击提示词工具栏的齿轮，打开「显示预览」。',
      '预览开启后，加权显示为红底，降权为蓝底，负权重为蓝底红字。',
      '注释显示为灰色删除线，随机提示词标记带紫色虚线下划线。',
      '大窗口编辑器可以把预览放在编辑区右侧，英文单词的前半部分加粗，便于快速阅读。',
    ],
    sections: [
      {
        title: '颜色对照',
        blocks: [
          { head: ['写法', '预览效果', '含义'], table: [
            ['`{silver hair}`、`1.2::silver hair::`', '红色底色', '加权，标签的影响更强'],
            ['`[freckles]`、`0.8::freckles::`', '蓝色底色', '降权，标签的影响更弱'],
            ['`-1::hat::`', '蓝色底色、红字、虚线下划线', '负权重，用来减弱或排除内容'],
            ['`/* smile */`', '灰色删除线', '注释，生成前会被移除'],
            ['`<ran_id="类别名"/>`', '紫色虚线下划线', '随机类别，生成时抽取词条'],
            ['`<ran_sorting_id="集合名"/>`', '青色虚线下划线', '随机集合'],
            ['带释义的标签', '点状下划线', '开启翻译后可以查看释义'],
          ] },
          '在大窗口右侧的预览中，把鼠标移到随机标记上，可以查看这个类别或集合的词条、抽取数量和权重设置。',
        ],
      },
      {
        title: '在哪里开关',
        blocks: [
          { head: ['位置', '操作'], table: [
            ['普通输入框', '提示词工具栏的齿轮 → 「显示预览」。设置保存在当前浏览器。'],
            ['大窗口编辑器', '窗口标题栏的齿轮 → 「显示预览」控制右侧预览；「叠加预览」把高亮直接叠在编辑区上，不再分两栏。'],
            ['默认行为', '系统设置「提示词」中的「展开编辑器的标签预览」可以选择随屏幕宽度自动显示、始终显示或始终隐藏。'],
          ] },
          { note: '使用输入法组字时，叠加的预览会暂时隐藏，显示原生文字；确认输入后自动恢复。' },
        ],
      },
    ],
    tryIt: '修改下面的文字或切换预览开关，观察颜色变化。这里的改动不会影响工作台。',
    guide: '在输入框和展开编辑器中切换预览，观察同一条提示词的显示变化。',
    previewLabel: '显示预览',
    sample: '1girl, {silver hair}, 0.8::freckles::, -1::hat::, /* smile */, <ran_id="发色"/>, night sky',
    category: '发色',
  },
  'en-US': {
    lead: 'Preview colors your prompt by syntax so you can check weights, comments and random markers at a glance. It only changes how the text looks. The text itself and what is sent for generation stay the same.',
    demo: [
      'With preview off, the field shows plain text, so it’s hard to see which parts have weights.',
      'Click the gear on the prompt toolbar and turn on Show preview.',
      'With preview on, raised weights get a red background, lowered weights blue, and negative weights blue with red text.',
      'Comments are gray and struck through, and random prompt markers have a dashed purple underline.',
      'The large editor can show the preview beside the editing area, with the first half of each English word in bold for quick reading.',
    ],
    sections: [
      {
        title: 'Color guide',
        blocks: [
          { head: ['Syntax', 'Preview', 'Meaning'], table: [
            ['`{silver hair}`, `1.2::silver hair::`', 'Red background', 'Raised weight, a stronger effect'],
            ['`[freckles]`, `0.8::freckles::`', 'Blue background', 'Lowered weight, a weaker effect'],
            ['`-1::hat::`', 'Blue background, red text, dashed underline', 'Negative weight, to reduce or remove something'],
            ['`/* smile */`', 'Gray strikethrough', 'Comment, removed before generation'],
            ['`<ran_id="category"/>`', 'Dashed purple underline', 'Random category, an entry is drawn when generating'],
            ['`<ran_sorting_id="collection"/>`', 'Dashed teal underline', 'Random collection'],
            ['Tag with a meaning', 'Dotted underline', 'Shows a meaning when translation is on'],
          ] },
          'In the preview on the right of the large editor, hover over a random marker to see that category or collection’s entries, draw count and weight settings.',
        ],
      },
      {
        title: 'Where to turn it on',
        blocks: [
          { head: ['Where', 'How'], table: [
            ['Regular prompt field', 'Gear on the prompt toolbar → Show preview. This browser remembers the setting.'],
            ['Large editor', 'Gear in the window title → Show preview controls the side preview. Overlay preview draws the highlighting directly on the editing area instead of a second column.'],
            ['Default', 'In Settings → Prompts, the large editor preview can follow the screen width, always show or always hide.'],
          ] },
          { note: 'While you type with an input method editor, the overlay hides and shows the plain text. It comes back once you confirm the input.' },
        ],
      },
    ],
    tryIt: 'Edit the text below or switch the preview on and off to see the colors change. Changes here don’t affect your workspace.',
    guide: 'Toggle preview in the prompt field and expanded editor and compare how the same prompt appears.',
    previewLabel: 'Show preview',
    sample: '1girl, {silver hair}, 0.8::freckles::, -1::hat::, /* smile */, <ran_id="hair color"/>, night sky',
    category: 'hair color',
  },
};

export default content;