// 每个节点用实际练习的首个操作定位，切换语言、快放或暂停都不会改变它的位置。
const chapters = {
  collapse: [
    ['collapse', '收起提示词', 'Collapse the panel'],
    ['reopen', '重新展开', 'Reopen it'],
    ['expandEditor', '大窗口编辑', 'Expanded editor'],
  ],
  preview: [
    ['previewOff', '关闭预览', 'Hide preview'],
    ['previewOn', '打开预览', 'Show preview'],
    ['expandEditor', '编辑器预览', 'Editor preview'],
  ],
  translation: [
    ['translationHint', '查看词义', 'Inspect a tag'],
    ['translationTab', '输入原文', 'Enter source text'],
    ['translate', '翻译与应用', 'Translate and apply'],
  ],
  comments: [
    ['expandEditor', '打开编辑器', 'Open the editor'],
    ['commentButton', '注释选区', 'Comment a selection'],
    ['uncommentButton', '取消注释', 'Uncomment'],
    ['commentKey', '键盘操作', 'Keyboard shortcuts'],
  ],
  weights: [
    ['wheelWeight', '滚轮调权', 'Wheel shortcut'],
    ['expandEditor', '打开编辑器', 'Open the editor'],
    ['weightButton', '按钮调权', 'Weight buttons'],
    ['applyEditor', '应用更改', 'Apply changes'],
  ],
  random: [
    ['openRandom', '打开配置', 'Open settings'],
    ['addCategory', '输入与解析', 'Enter and parse tags'],
    ['addCollection', '建立集合', 'Create a collection'],
    ['sampleRandom', '抽样与保存', 'Sample and save'],
    ['insertRandom', '插回提示词', 'Insert into prompt'],
  ],
  notebook: [
    ['saveNote', '保存笔记', 'Save a note'],
    ['createGroup', '分组与移动', 'Organize notes'],
    ['copyCharacter', '复制角色词', 'Copy character prompts'],
    ['exportNotes', '导出与导入', 'Export and import'],
    ['applySameModel', '应用模型', 'Apply a model'],
  ],
  suggestions: [
    ['settings', '联想设置', 'Suggestion settings'],
    ['query0', '英文与拼音', 'English and pinyin'],
    ['query2', '浏览分类', 'Browse categories'],
    ['query3', '类别内检索', 'Search a category'],
    ['query4', '模糊与正则', 'Fuzzy and regex'],
  ],
  imageDisplay: [
    ['zoomImage', '缩放与平移', 'Zoom and pan'],
    ['nextImage', '切图与元数据', 'Images and metadata'],
    ['scramble', '混淆与还原', 'Scramble and restore'],
    ['previewSettings', '预览设置', 'Preview settings'],
    ['privacyOn', '隐私遮罩', 'Privacy cover'],
  ],
  imageHistory: [
    ['historySelect', '选择缩略图', 'Select a thumbnail'],
    ['historyOpen', '打开历史', 'Open history'],
    ['applySeed', '复用种子与参数', 'Reuse seed and settings'],
  ],
  imageDrop: [
    ['dropDisplay', '拖入主图', 'Drop onto the display'],
    ['sendImage', '发送到图生图', 'Send to img2img'],
    ['dropHistory', '拖入历史', 'Drop into history'],
  ],
  imageAdjustment: [
    ['openAdjustment', '打开调整', 'Open adjustments'],
    ['changeAdjustment', '调整亮度', 'Adjust brightness'],
    ['compareAdjustment', '对比原图', 'Compare the original'],
    ['applyAdjustment', '应用结果', 'Apply the result'],
  ],
  generationParameters: [
    ['changeModel', '模型与尺寸', 'Model and size'],
    ['changeSteps', '采样参数', 'Sampling settings'],
    ['addCharacter', '角色与位置', 'Characters and positions'],
    ['simulateGeneration', '模拟生成', 'Try generation'],
  ],
  generationErrors: [
    ['simulateFailure', '模拟错误', 'Simulate a failure'],
    ['openErrors', '查看与复制', 'Inspect and copy'],
    ['recoverSample', '取回结果', 'Retrieve the result'],
  ],
  workHistory: [
    ['newWork', '建立作品', 'Create a work'],
    ['openSampleWork', '打开历史', 'Open history'],
    ['compareVersion', '比较版本', 'Compare versions'],
    ['applyVersion', '应用参数', 'Apply settings'],
    ['continueVersion', '继续与保存', 'Continue and save'],
  ],
};

/** 返回本篇实际可到达的章节及其显示名；窄屏练习自动略过桌面快捷键。 */
export function getReplayChapters(topic, narrow, locale) {
  const steps =
    topic === 'imageDrop' && narrow
      ? [
          ['openImportTools', '底部工具', 'Bottom toolbar'],
          ['chooseImportFile', '选择图片', 'Choose an image'],
          ['sendImage', '用于图生图', 'Use as input'],
        ]
      : chapters[topic];
  return steps
    .filter(([start]) => !narrow || !['wheelWeight', 'commentKey'].includes(start))
    .map(([start, zh, en]) => ({ start, label: locale === 'zh-CN' ? zh : en }));
}
