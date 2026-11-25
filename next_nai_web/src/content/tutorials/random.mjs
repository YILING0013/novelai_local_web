/** 教程「随机提示词」的中英文内容，随这篇教程按需加载。 */
const content = {
  'zh-CN': {
    lead: '随机提示词让同一段提示词每次生成时自动换一组内容。先把候选词条整理成「类别」，再在提示词中写入类别的随机标记；生成时，标记会被替换为抽到的词条。',
    demo: [
      '在提示词里写入随机标记，预览用紫色虚线标出。',
      '点击工具栏的骰子图标，在「类别管理」里维护每个类别的词条和抽取方式。',
      '每次生成时，标记会被替换为抽到的词条，提示词框里的原文保持不变。',
      '集合可以把多个类别组合起来，一个标记同时抽取发色和天气。',
      '类别可以设置固定或随机权重，抽到的词条会自动带上权重。',
    ],
    sections: [
      {
        title: '类别与集合',
        blocks: [
          { head: ['项目', '类别', '集合'], table: [
            ['内容', '一组词条，例如 silver hair、pink hair、black hair', '引用多个类别'],
            ['标记', '`<ran_id="类别名"/>`', '`<ran_sorting_id="集合名"/>`'],
            ['抽取方式', '随机抽取，或按顺序轮询；可以设置每次抽取的个数', '处理全部类别，或随机、按顺序抽取其中几个类别；可以打乱词条顺序'],
            ['权重', '无权重、固定权重，或在一个范围内随机', '可以用一个固定权重包住整个集合，并覆盖类别自身的权重'],
          ] },
          '顺序轮询会记住上次抽到的位置，下次从下一个词条开始。这个位置保存在当前浏览器中。',
        ],
      },
      {
        title: '使用步骤',
        blocks: [
          { steps: [
            '点击提示词工具栏的骰子图标，打开「随机提示词配置」。',
            '在「类别管理」中点「添加类别」，填写名称和词条，选择抽取方式。需要组合时，再到「集合管理」中创建集合。',
            '把光标放到提示词中要插入的位置，在类别或集合上点「插入」；也可以按「使用说明」里的语法手动输入。',
            '打开右上角的「启用随机提示词」，点「保存配置」。',
          ] },
          { note: '随机替换只作用于 NovelAI 绘图模型的总正向、负向提示词，角色提示词中的标记不会替换。关闭「启用随机提示词」后，标记会原样留在提示词里。' },
          '在大窗口右侧的预览中，把鼠标移到随机标记上，可以查看词条、抽取数量和权重设置。',
        ],
      },
    ],
    tryIt: '下面的提示词使用了示例类别。点击「模拟生成」，查看每次替换后实际发送的内容。示例类别只存在本页，不会保存到账号。',
    guide: '从骰子按钮开始，建立发色类别和集合，再把抽取标记插进提示词并查看结果。',
    hair: '发色', weather: '天气', scene: '场景',
    roll: '模拟生成', rolls: '生成结果',
  },
  'en-US': {
    lead: 'Random prompts let the same prompt produce different content each time you generate. Group candidate entries into categories, then put a category’s random marker in your prompt. When you generate, the marker is replaced with a drawn entry.',
    demo: [
      'Put a random marker in your prompt. The preview marks it with a dashed purple underline.',
      'Click the dice icon on the toolbar. Under Categories, keep each category’s entries and how they’re drawn.',
      'Each generation replaces the marker with a drawn entry. The text in your prompt field stays the same.',
      'A collection combines several categories, so one marker draws both a hair color and the weather.',
      'Categories can add a fixed or random weight, which is written onto the drawn entry.',
    ],
    sections: [
      {
        title: 'Categories and collections',
        blocks: [
          { head: ['Item', 'Category', 'Collection'], table: [
            ['Contains', 'A list of entries, such as silver hair, pink hair and black hair', 'References to several categories'],
            ['Marker', '`<ran_id="category name"/>`', '`<ran_sorting_id="collection name"/>`'],
            ['Drawing', 'Draw at random or in order; set how many entries to draw each time', 'Use every category, or draw some of them at random or in order; optionally shuffle the entries'],
            ['Weight', 'None, a fixed weight, or a random weight within a range', 'Optionally wrap the whole collection in one fixed weight, which overrides the category weights'],
          ] },
          'Drawing in order remembers where it stopped and continues from the next entry. That position is stored in this browser.',
        ],
      },
      {
        title: 'Steps',
        blocks: [
          { steps: [
            'Click the dice icon on the prompt toolbar to open the random prompt settings.',
            'Under Categories, choose Add category, enter a name and entries, and pick how to draw them. To combine categories, create a collection under Collections.',
            'Put the cursor where the marker should go, then choose Insert on a category or collection. You can also type the syntax shown under How to use.',
            'Turn on Enable random prompts at the top right and choose Save settings.',
          ] },
          { note: 'Random replacement only applies to the main positive and negative prompts of NovelAI drawing models. Markers in character prompts aren’t replaced. With Enable random prompts off, markers stay in the prompt as written.' },
          'In the preview on the right of the large editor, hover over a random marker to see its entries, draw count and weight settings.',
        ],
      },
    ],
    tryIt: 'The prompt below uses sample categories. Choose Simulate generation to see what would be sent each time. The sample categories only exist on this page and aren’t saved to your account.',
    guide: 'Start at the dice button, create a hair category and collection, then insert and resolve the marker in your prompt.',
    hair: 'hair color', weather: 'weather', scene: 'scene',
    roll: 'Simulate generation', rolls: 'Results',
  },
};

export default content;