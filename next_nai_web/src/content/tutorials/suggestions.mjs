/** 教程「提示词联想」的中英文内容，随这篇教程按需加载。 */
const content = {
  'zh-CN': {
    lead: '输入提示词时，编辑器会从站内标签库中实时匹配候选。可以用英文、中文或拼音查找；候选同时显示英文标签和中文释义，选中后自动补全，并在标签后补上逗号。',
    demo: [
      '输入拼音 jinfa，候选里出现 blonde_hair（金发）。',
      '按 [[↓]] 选中候选，按 [[Enter]] 插入，标签后自动补上逗号。',
      '输入 + 浏览标签分类，选择「服装」进入下一级。',
      '逐级选到「下装」后，结果只包含这个分类里的标签。',
      '在开头加 ? 进行模糊匹配，拼错的 bluhair 也能找到 blue_hair。',
    ],
    sections: [
      {
        title: '基本用法',
        blocks: [
          '在正向、负向提示词或大窗口编辑器中，输入至少两个字母或数字，或者一个汉字，就会弹出候选。',
          { head: ['按键', '作用'], table: [
            ['[[↓]] / [[↑]]', '在候选之间移动'],
            ['[[Enter]]', '插入选中的候选'],
            ['[[Tab]]', '插入选中的候选；没有选中时插入第一项'],
            ['[[Esc]]', '关闭候选'],
            ['点击候选', '直接插入'],
          ] },
          { note: '标签库在浏览器后台查询。第一次使用时需要下载词库，之后的查询不再经过网络。' },
        ],
      },
      {
        title: '搜索语法',
        blocks: [
          '在查询开头加上下列符号，可以按分类浏览或改变匹配方式（下表为默认符号）：',
          { head: ['输入', '作用'], table: [
            ['`+`', '列出一级分类'],
            ['`+服装+`', '列出「服装」下的子分类'],
            ['`+服装+下装=`', '列出「下装」分类里的标签'],
            ['`+原神=fu`', '在「原神」分类里查找英文或拼音以 fu 开头的标签'],
            ['`?bluhair`', '模糊匹配，可以容忍漏字和错字'],
            ['`=*^blue_`', '正则表达式，这里匹配以 blue_ 开头的标签'],
          ] },
          '分类之后也可以接模糊匹配或正则，例如 `+原神=?furina`、`+原神=*^fu`。选择分类时只补全路径并继续显示下一级；选择标签后联想才会结束。',
          { note: '这些符号可以在齿轮菜单 →「配置标签联想」中修改或关闭。修改后请按新的符号输入。' },
        ],
      },
      {
        title: '显示设置',
        blocks: [
          '齿轮菜单 →「配置标签联想」还可以调整候选的显示方式：',
          { head: ['设置', '说明'], table: [
            ['候选标签数量上限', '每次最多显示 5、8、12、20 或 40 条。'],
            ['候选标签排布', '瀑布流按标签宽度自动换行，等宽列对齐成网格。'],
            ['胶囊内文字方向', '英文标签和中文释义左右排列或上下排列。'],
          ] },
        ],
      },
    ],
    tryIt: '在下面的输入框里试试上表中的查询。这里固定使用默认搜索符号，选中的标签只写入本页示例。',
    guide: '跟随齿轮入口了解联想设置，然后在同一个绘图输入框试用英文、拼音、类别和匹配语法。',
    queries: ['blue hair', 'jinfa', '金发', '+', '+原神=fu', '?bluhair', '=*^blue_'],
    tryQueries: '可以输入：',
  },
  'en-US': {
    lead: 'As you type, the editor matches your text against the site’s tag library. Search in English, Chinese or pinyin. Each suggestion shows the English tag with its Chinese meaning, and choosing one completes the tag and adds a comma after it.',
    demo: [
      'Type the pinyin jinfa and blonde_hair (blond hair) appears among the suggestions.',
      'Press [[↓]] to select a suggestion and [[Enter]] to insert it. A comma is added after the tag.',
      'Type + to browse tag categories, then choose 服装 (clothing) to go one level down.',
      'After choosing 下装 (bottoms), only tags in that category are listed.',
      'Start with ? for fuzzy matching, so the misspelled bluhair still finds blue_hair.',
    ],
    sections: [
      {
        title: 'Basics',
        blocks: [
          'In the positive or negative prompt, or in the large editor, type at least two letters or digits, or one Chinese character, to see suggestions.',
          { head: ['Key', 'Result'], table: [
            ['[[↓]] / [[↑]]', 'Move between suggestions'],
            ['[[Enter]]', 'Insert the selected suggestion'],
            ['[[Tab]]', 'Insert the selected suggestion, or the first one if none is selected'],
            ['[[Esc]]', 'Close the suggestions'],
            ['Click a suggestion', 'Insert it'],
          ] },
          { note: 'The tag library is searched in the background in your browser. It is downloaded the first time you use it; searches after that don’t go over the network.' },
        ],
      },
      {
        title: 'Search syntax',
        blocks: [
          'Start a query with these symbols to browse categories or change how matching works (the defaults are shown):',
          { head: ['Type', 'Result'], table: [
            ['`+`', 'List the top-level categories'],
            ['`+服装+`', 'List the subcategories of 服装 (clothing)'],
            ['`+服装+下装=`', 'List the tags in 下装 (bottoms)'],
            ['`+原神=fu`', 'Find tags in 原神 (Genshin Impact) whose English or pinyin starts with fu'],
            ['`?bluhair`', 'Fuzzy match that tolerates missing or wrong letters'],
            ['`=*^blue_`', 'Regular expression; here, tags starting with blue_'],
          ] },
          'You can also follow a category with fuzzy or regex matching, such as `+原神=?furina` or `+原神=*^fu`. Choosing a category only completes the path and shows the next level; the suggestions close once you choose a tag.',
          { note: 'Change or turn off these symbols under gear menu → Configure tag suggestions. After changing them, type the new symbols instead.' },
        ],
      },
      {
        title: 'Display settings',
        blocks: [
          'Configure tag suggestions in the gear menu also controls how suggestions look:',
          { head: ['Setting', 'What it does'], table: [
            ['Suggestion limit', 'Show at most 5, 8, 12, 20 or 40 suggestions at a time.'],
            ['Suggestion layout', 'Wrapping rows follow each tag’s width; equal-width columns line them up in a grid.'],
            ['Text direction', 'Put the English tag and its meaning side by side or stacked.'],
          ] },
        ],
      },
    ],
    tryIt: 'Try the queries above in the field below. It always uses the default search symbols, and chosen tags only go into this example.',
    guide: 'Follow the settings gear, then try English, pinyin, categories and matching syntax in the drawing prompt.',
    queries: ['blue hair', 'jinfa', '金发', '+', '+原神=fu', '?bluhair', '=*^blue_'],
    tryQueries: 'Try typing:',
  },
};

export default content;