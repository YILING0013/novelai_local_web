/** 教程「翻译」的中英文内容，随这篇教程按需加载。 */
const content = {
  'zh-CN': {
    lead: '翻译有两种用法：在提示词里直接查看标签的释义；或在「翻译」页签把一段描述整段翻译，再填入正向提示词。查看释义不会改动提示词，发送给生成的仍是原文。',
    demo: [
      '开启翻译后，停止输入约 3 秒，可识别的标签会出现点状下划线。',
      '点击带下划线的标签，或把光标移进去，上方会显示释义。',
      '中文会译成英文，其他文字译成中文。再次点击同一个标签可收起释义。',
      '在「翻译」页签输入一段描述，点「翻译」得到结果。',
      '点「应用到正向提示词」，译文会替换正向提示词的全部内容。',
    ],
    sections: [
      {
        title: '查看标签释义',
        blocks: [
          { steps: [
            '在提示词工具栏的齿轮菜单中打开「启用翻译」（默认开启）。',
            '输入提示词后停顿约 3 秒，可识别的标签出现点状下划线。',
            '点击标签，或用方向键把光标移进标签，上方显示释义；再次点击同一个标签收起。在叠加预览和大窗口右侧的预览中，桌面端把鼠标悬停在标签上即可查看。',
          ] },
          { head: ['设置', '说明'], table: [
            ['启用翻译', '关闭后不再查询释义，也不显示下划线。'],
            ['译文显示点状下划线', '只控制下划线，关闭后点击标签仍可查看释义。'],
            ['翻译目标语言', '「自动」把中文译成英文，把其他文字译成中文；也可以固定为中文、英文、日文或韩文。'],
          ] },
          '英文标签先查站内标签词库，其余文字使用机器翻译。权重符号、画师标签（`artist:`）、注释和随机标记不会被翻译。',
          { note: '翻译暂时不可用时，每次浏览器会话只提醒一次，可以选择「重试」或「关闭翻译」。' },
        ],
      },
      {
        title: '整段翻译',
        blocks: [
          { steps: [
            '点击标签栏的「翻译」页签。',
            '在「原文」中输入要翻译的描述，点「翻译」。',
            '在「翻译结果」中确认内容，点「应用到正向提示词」；只想取用一部分时，点复制按钮复制译文。',
          ] },
          { note: '「应用到正向提示词」会替换正向提示词的全部内容。需要保留原来的提示词时，请复制译文后手动粘贴。' },
          '整段翻译由网站服务器处理，部分账号类型不提供这项功能。',
        ],
      },
    ],
    tryIt: '下面的提示词带有示例释义。点击带下划线的标签，或在桌面端把鼠标悬停在标签上查看释义。示例释义是固定内容，不会发出翻译请求。',
    guide: '先查看词条释义，再输入一段文字、翻译并应用到正向提示词。',
    source: '夜空下提着灯笼的银发少女',
    result: 'a silver-haired girl holding a lantern under the night sky',
  },
  'en-US': {
    lead: 'Translation works in two ways. You can see the meaning of tags right in your prompt, or translate a whole description on the Translate tab and put it in the positive prompt. Showing meanings never changes your prompt, and the original text is what gets sent for generation.',
    demo: [
      'With translation on, recognized tags get a dotted underline about 3 seconds after you stop typing.',
      'Click an underlined tag, or move the cursor into it, to see its meaning above.',
      'Chinese is translated into English, and other text into Chinese. Click the same tag again to hide the meaning.',
      'On the Translate tab, enter a description and choose Translate.',
      'Apply to positive prompt replaces the whole positive prompt with the translation.',
    ],
    sections: [
      {
        title: 'See tag meanings',
        blocks: [
          { steps: [
            'In the gear menu on the prompt toolbar, turn on Enable translation (on by default).',
            'Pause for about 3 seconds after typing. Recognized tags get a dotted underline.',
            'Click a tag, or move the cursor into it with the arrow keys, to see its meaning above. Click the same tag again to hide it. On desktop, you can also hover over tags in the overlay preview and in the large editor’s side preview.',
          ] },
          { head: ['Setting', 'What it does'], table: [
            ['Enable translation', 'When off, meanings aren’t looked up and no underline is shown.'],
            ['Dotted underline for translations', 'Only controls the underline. You can still click a tag to see its meaning.'],
            ['Target language', 'Auto translates Chinese into English and everything else into Chinese. You can also always use Chinese, English, Japanese or Korean.'],
          ] },
          'English tags are first looked up in the site’s tag dictionary; other text is machine translated. Weight syntax, artist tags (`artist:`), comments and random markers are never translated.',
          { note: 'If translation is unavailable, you’ll see one warning per browser session with Retry and Turn off translation.' },
        ],
      },
      {
        title: 'Translate a whole description',
        blocks: [
          { steps: [
            'Click the Translate tab in the tab bar.',
            'Enter the description under Source text and choose Translate.',
            'Check the Translation result, then choose Apply to positive prompt. To use only part of it, copy the result instead.',
          ] },
          { note: 'Apply to positive prompt replaces the whole positive prompt. To keep your current prompt, copy the result and paste it where you want.' },
          'Whole-description translation runs on the site’s server and isn’t available for every account type.',
        ],
      },
    ],
    tryIt: 'The prompt below comes with sample meanings. Click an underlined tag, or hover over it on desktop, to see its meaning. The sample meanings are fixed and no translation request is sent.',
    guide: 'Inspect a tag meaning, translate a phrase, then apply the result to the positive prompt.',
    source: '夜空下提着灯笼的银发少女',
    result: 'a silver-haired girl holding a lantern under the night sky',
  },
};

export default content;