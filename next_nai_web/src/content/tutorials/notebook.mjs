/** 教程「保存与使用笔记」的中英文内容，随这篇教程按需加载。 */
const content = {
  'zh-CN': {
    lead: '提示词笔记把常用的提示词保存在账号里，随时载入。一条笔记可以保存正向、负向提示词，角色提示词及位置，以及保存时使用的模型。',
    demo: [
      '写好提示词后，点击工具栏的保存图标。',
      '填写笔记标题，确认对话框中的内容后保存。注释不会保存进笔记。',
      '点击书本图标打开笔记本，每条笔记显示为一张卡片。',
      '点击眼睛图标查看详情，角色卡列出角色提示词和位置。',
      '点击「使用」，笔记内容载入到提示词区。',
    ],
    sections: [
      {
        title: '保存笔记',
        blocks: [
          { steps: [
            '在提示词工具栏点击保存图标（保存到笔记）。',
            '填写笔记标题，标题不能包含中英文冒号；可以选择分组，也可以填写预览图链接。',
            '核对对话框中的提示词和角色卡，点「确认保存」。',
          ] },
          { list: [
            '保存的是去掉注释后的提示词，以及当前的角色提示词、模型和 V5 角色定位方式。',
            '每条笔记的全部提示词合计不超过 2942 Tokens；每个账号最多保存 800 条笔记。',
          ] },
        ],
      },
      {
        title: '查看与使用',
        blocks: [
          { head: ['操作', '说明'], table: [
            ['打开笔记本', '点击提示词工具栏的书本图标。左侧是分组；上方可以搜索标题或内容、切换排序方式和卡片 / 列表视图。'],
            ['使用', '把笔记的提示词和角色卡载入当前工作台。'],
            ['查看详情（眼睛图标）', '查看完整提示词和角色卡，可以分别复制正向和负向提示词。'],
            ['编辑（铅笔图标）', '修改标题、提示词、分组、模型和角色卡。'],
            ['切换模型', '笔记本底部的「应用笔记时切换到保存的模型」决定使用笔记时是否一并切换模型。'],
          ] },
        ],
      },
      {
        title: '整理笔记',
        blocks: [
          { list: [
            '分组最多 3 层；选中上级分组时，会同时显示子分组里的笔记。',
            '「批量管理」可以一次移动或删除多条笔记，删除后无法恢复。',
            '笔记本顶部可以导入、导出 JSON 文件，或把全部笔记迁移到另一个账号。',
          ] },
        ],
      },
    ],
    tryIt: '下面是一条示例笔记。点击眼睛图标查看详情，点击「使用」把它载入下方的示例提示词框。示例不会写入你的笔记本。',
    guide: '保存一条含角色坐标的样例笔记，分组、复制、导出再导入，最后比较两种应用模型的方式。',
    noteTitle: '月下花园', character: '提灯旅人', loaded: '载入后的正向提示词',
  },
  'en-US': {
    lead: 'The prompt notebook keeps prompts you use often in your account so you can load them any time. A note can store the positive and negative prompts, character prompts with their positions, and the model you were using.',
    demo: [
      'When your prompt is ready, click the save icon on the toolbar.',
      'Enter a title, check the content in the dialog and save. Comments aren’t saved.',
      'Click the book icon to open the notebook. Each note is a card.',
      'Click the eye icon to view details. The character cards list each character’s prompts and position.',
      'Choose Use to load the note into the prompt section.',
    ],
    sections: [
      {
        title: 'Save a note',
        blocks: [
          { steps: [
            'Click the save icon (Save to notebook) on the prompt toolbar.',
            'Enter a title without colons. Optionally choose a group or add a preview image link.',
            'Check the prompts and character cards in the dialog, then confirm.',
          ] },
          { list: [
            'The note stores your prompts with comments removed, plus the current character prompts, model and V5 character positioning.',
            'All prompts in one note can total up to 2942 tokens, and each account can keep up to 800 notes.',
          ] },
        ],
      },
      {
        title: 'View and use notes',
        blocks: [
          { head: ['Action', 'What it does'], table: [
            ['Open the notebook', 'Click the book icon on the prompt toolbar. Groups are on the left; at the top you can search titles and content, change the sort order and switch between card and list views.'],
            ['Use', 'Loads the note’s prompts and character cards into your workspace.'],
            ['View details (eye icon)', 'Shows the full prompts and character cards. Copy the positive and negative prompts separately.'],
            ['Edit (pencil icon)', 'Change the title, prompts, group, model and character cards.'],
            ['Switch models', 'The switch at the bottom of the notebook decides whether using a note also switches to its saved model.'],
          ] },
        ],
      },
      {
        title: 'Organize notes',
        blocks: [
          { list: [
            'Groups can be up to 3 levels deep. Selecting a parent group also shows the notes in its subgroups.',
            'Select notes lets you move or delete several notes at once. Deleted notes can’t be recovered.',
            'At the top of the notebook you can import or export a JSON file, or move all notes to another account.',
          ] },
        ],
      },
    ],
    tryIt: 'Here is a sample note. Click the eye icon to view details, or choose Use to load it into the sample prompt below. Nothing is written to your notebook.',
    guide: 'Save a note with a character position, organize and copy it, export and import it, then try both model-switching options.',
    noteTitle: 'Moonlit garden', character: 'Lantern bearer', loaded: 'Positive prompt after loading',
  },
};

export default content;