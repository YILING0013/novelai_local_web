const messages = {
  imageShare: {
    title: '分享图片',
    tooLarge: '分享的图片超过 10 MB，已跳过。',
    invalid: '无法读取分享中的图片。',
    sendFailed: '无法分享这张图片。',
  },
  "desktop": {
    "application": "桌面应用",
    "webOn": "Web 访问已开启",
    "webOff": "Web 访问已关闭",
    "webAccess": "Web 访问设置",
    "enable": "启用浏览器访问",
    "hint": "开启后，可在这台电脑或同一私人局域网的浏览器中登录。局域网连接使用 HTTP，请仅在可信网络启用。关闭桌面程序后，访问随即停止。",
    "loopback": "本机浏览器",
    "lan": "同一局域网的设备",
    "readFailed": "无法读取访问状态，请重试。",
    "changeFailed": "更改失败。请检查端口 {port} 是否已被占用，以及用户数据目录是否可写。",
    "restoreFailed": "未能恢复 Web 访问。请检查端口 {port} 后重新开启。"
  },
  "librarySettings": {
    "outputDirectory": "生成图像保存目录",
    "outputHint": "填写本机绝对路径；留空使用后端 data/generated-images。保存设置后生效，生成成功即写入本机，无需浏览器自动下载。",
    "inspirationSource": "灵感图库来源",
    "default": "默认示例图库",
    "references": "参考图库",
    "outputs": "本地生成图库",
    "localOnly": "原图、缩略图、分组与画风均保存于本机；切换目录不会移动已有文件。手动下载功能仍可使用。",
    "saveFailed": "图像已生成，但写入本机目录失败。请先手动下载保留本次结果，再检查目录权限和可用空间。",
    "sourceFailed": "无法切换灵感图库，请检查本地服务。",
    "styleApplied": "画风已添加到正面提示词。",
    "loadMore": "加载更多"
  },
  "login": {
    "invalidCredentials": "登录失败，请检查账号或密码",
    "logoAlt": "NovelAI Local 标志",
    "tagline1": "用 AI 描绘你的梦想",
    "tagline2": "为你的创作赋予灵感",
    "tagline3": "祝你使用愉快！",
    "local": {
      "recoveryRequired": "必须先完成账户恢复",
      "recoveryDescription": "上一次凭据修改被中断。请同时填写修改前和目标凭据，判定并恢复后才能继续。",
      "oldEmail": "原邮箱",
      "oldPassword": "原密码",
      "newEmail": "目标邮箱",
      "newPassword": "目标密码",
      "resolveRecovery": "恢复并继续",
      "pat": "永久访问令牌 PAT",
      "emailPassword": "邮箱密码",
      "useEmailPassword": "使用邮箱密码登录",
      "usePat": "使用永久访问令牌登录",
      "email": "邮箱",
      "passwordCompatibilityNotice": "若 NovelAI 官方今后要求验证码，邮箱密码登录将无法使用，请改用 PAT。"
    },
    "loggingIn": "登录中...",
    "password": "密码",
    "login": "登录",
    "or": "或",
    "languageAria": "选择界面语言"
  },
  "main": {
    "resizeSidebar": "调整导航侧栏宽度",

    "navigation": "主导航",
    "showSidebarIcons": "显示图标菜单",
    "hideSidebar": "隐藏菜单",
    "expandSidebar": "展开菜单",
    "accountDialog": {
      "loadError": "获取用户信息时发生错误",
      "refreshData": "刷新数据"
    },
    "local": {
      "credentialsUpdated": "凭据与账户信息已更新。",
      "credentialChangeFailed": "凭据修改未能完成。",
      "loginMode": "登录方式",
      "credentialManagement": "凭据管理权限",
      "loginModePat": "永久访问令牌（PAT）",
      "loginModePassword": "邮箱与密码",
      "officialAccount": "NovelAI 官方账户",
      "email": "邮箱",
      "emailVerified": "邮箱已验证",
      "accountCreatedAt": "账户创建时间",
      "trialActivated": "试用已激活",
      "trialActionsLeft": "试用剩余操作",
      "trialImagesLeft": "试用剩余图片",
      "banStatus": "封禁状态",
      "banMessage": "封禁信息",
      "subscription": "订阅",
      "subscriptionActive": "订阅有效",
      "subscriptionExpires": "订阅到期时间",
      "subscriptionGrace": "订阅宽限期",
      "subscriptionActiveStatus": "订阅有效",
      "notSubscribed": "无有效订阅",
      "tierValue": "订阅等级 {tier}",
      "anlasTotal": "Anlas 总额",
      "anlasFixed": "固定 Anlas",
      "anlasPurchased": "购买 Anlas",
      "v5Percent": "V5 额度",
      "v5Available": "V5 可用",
      "v5Negative": "V5 额度为负",
      "v5AvailableStatus": "可用",
      "v5UnavailableStatus": "当前不可用",
      "unavailable": "不可用",
      "yes": "是",
      "no": "否",
      "v5Reset": "V5 刷新时间",
      "refreshedAt": "更新时间",
      "refreshSoon": "即将刷新",
      "durationDaysHours": "{days} 天 {hours} 小时后",
      "durationHoursMinutes": "{hours} 小时 {minutes} 分钟后",
      "durationMinutes": "{minutes} 分钟后",
      "staleAccount": "账户快照已过期，请刷新后再参考其中数值。",
      "snapshotStale": "数据已过期",
      "accountSection": "账户资料",
      "subscriptionAndQuota": "订阅与额度",
      "credentialSettings": "账户凭据",
      "accountNormal": "账户正常",
      "accountBanned": "账户已封禁",
      "trialStatus": "试用状态",
      "trialNotActivated": "未激活",
      "trialRemaining": "剩余 {actions} 次操作 · {images} 张图片",
      "anlasBreakdown": "固定 {fixed} · 购买 {purchased}",
      "inGracePeriod": "当前处于宽限期",
      "notInGracePeriod": "当前不在宽限期",
      "changePassword": "修改密码",
      "currentPassword": "当前密码",
      "newPassword": "新密码",
      "backupConfirmed": "我已备份 NovelAI keystore，并确认理解修改凭据的影响。",
      "changeEmail": "修改邮箱",
      "newEmail": "新邮箱",
      "logoutFailed": "退出登录失败，请重试。"
    },
    "accountInfo": "账户信息",
    "closePageTitle": "确认关闭",
    "closePageMessage": "即将关闭“{page}”页面。未保存的数据将会丢失，确认关闭吗？",
    "confirmClose": "确认关闭",
    "unsavedWarning": "您可能有未保存的工作。确定要离开吗？",
    "openDrawer": "打开侧边栏",
    "closeDrawer": "收起侧边栏",
    "themeToDark": "切换到暗色模式",
    "themeToLight": "切换到亮色模式",
    "darkMode": "暗色模式",
    "lightMode": "亮色模式",
    "account": "账户",
    "logout": "退出登录"
  },
  "common": {
    "back": "返回",
    "retry": "重试",
    "copied": "已复制",
    "copyFailed": "复制失败，请选中文字后手动复制。",
    "close": "关闭",
    "cancel": "取消",
    "refresh": "刷新",
    "language": "语言",
    "custom": "自定义",
    "slow": "慢",
    "fast": "快"
  },
  "pages": {
    "gallery": "画廊",
    "aiPainting": "AI 绘画",
    "imageTagging": "提示词反推",
    "localUpscaling": "本地放大",
    "artistReference": "画师串参考",
    "imageReference": "图片参考",
    "promptTemplate": "提示词模板",
    "settings": "设置"
  },
  "tools": {
    "notFound": {
      "gameOver": "游戏结束",
      "restartHint": "点击或按键以重新开始",
      "status": "网站维护中",
      "description": "这里什么都没有，但你可以看看倒计时。",
      "hours": "时",
      "minutes": "分",
      "seconds": "秒",
      "challenge": "来一场对决？",
      "score": "得分：",
      "highScore": "最高分：",
      "gameArea": "贪吃蛇游戏区域",
      "controls": "用方向键或点击屏幕来控制方向",
      "restart": "重新开始",
      "start": "开始游戏",
      "backHome": "返回首页"
    }
  },
  "settings": {
    "showInspirationGallery": "显示灵感图库",

    "naming": {
      "seed": "种子号",
      "prompt32": "正面提示词前 32 位",
      "localDateTime": "日期时间（当前时区）",
      "timestamp": "时间戳",
      "random": "随机字符串"
    },
    "backgroundPresets": {
      "light": {
        "graphite": "柔白",
        "sandstone": "砂岩",
        "mist": "薄雾",
        "sage": "浅苔",
        "dusk": "暮紫",
        "rose": "玫瑰灰",
        "coffee": "燕麦",
        "silver": "银灰"
      },
      "dark": {
        "graphite": "石墨",
        "sandstone": "烟砂",
        "mist": "夜雾",
        "sage": "深苔",
        "dusk": "暮夜",
        "rose": "烟玫瑰",
        "coffee": "浓咖啡",
        "silver": "钢灰"
      }
    },
    "colorNames": {
      "mistBlue": "雾蓝",
      "graphite": "石墨灰",
      "ocean": "深海蓝",
      "celadon": "青瓷",
      "sage": "鼠尾草",
      "olive": "橄榄",
      "wheat": "麦穗",
      "clay": "陶土",
      "rose": "藕粉",
      "mauve": "灰紫",
      "indigo": "靛青",
      "cocoa": "可可"
    },
    "savedMessage": "设置已保存并应用",
    "saveFailed": "保存失败，请检查浏览器是否允许本地存储后重试。",
    "resetMessage": "已恢复默认草稿，点击保存后生效。画廊存储位置和灵感来源保持不变。",
    "title": "系统设置",
    "intro": "在此页面调整应用外观和功能偏好，所有设置将保存在本地浏览器中。",
    "themeSettings": "主题设置",
    "themeMode": "主题模式",
    "currentDark": "当前使用暗色模式",
    "currentLight": "当前使用亮色模式",
    "switchToLight": "切换到亮色",
    "switchToDark": "切换到暗色",
    "primaryColor": "主题颜色",
    "customColorCode": "自定义颜色代码",
    "invalidColor": "请输入有效的颜色代码",
    "colorExample": "例如 #58779A 或 rgb(88, 119, 154)",
    "colorPicker": "使用颜色选择器",
    "backgroundSettings": "背景设置",
    "backgroundPreset": "背景预设",
    "customBackground": "自定义背景色",
    "mainBackground": "主背景色",
    "mainBackgroundHint": "页面主背景色",
    "cardBackground": "卡片背景色",
    "cardBackgroundHint": "卡片和面板背景色",
    "drawerBackground": "侧边菜单背景色",
    "drawerBackgroundHint": "侧边菜单背景色",
    "pageColors": "页面主题色",
    "cyclePreset": "循环选择预设颜色",
    "preview": "主题预览",
    "previewTitle": "预览标题",
    "previewDescription": "这是当前主题设置的预览效果。",
    "primaryButton": "主按钮",
    "secondaryButton": "次按钮",
    "backgroundValue": "主背景：{value}",
    "paperValue": "卡片背景：{value}",
    "interfaceSettings": "界面设置",
    "interfaceAnimation": "界面动画",
    "animationDescription": "控制界面过渡和动画效果",
    "transitionSpeed": "界面过渡速度 {speed}ms",
    "imageSettings": "图像设置",
    "downloadImage": "图像保存",
    "downloadSharedRule": "保存生成图片和手动下载使用以下文件名规则。",
    "autoDownload": "自动下载到浏览器",
    "autoDownloadHint": "生成完成后触发浏览器下载，可与保存到画廊同时开启。保存位置由浏览器设置决定；批量生成时可能需要允许多个文件下载。更改后请保存设置。",
    "filenameRules": "文件名规则",
    "customPrefix": "自定义前缀",
    "prefixExample": "例如：AI_Image、作品集、draft",
    "downloadPreset": "下载预设",
    "filenamePreview": "文件名预览",
    "reset": "重置",
    "saved": "已保存",
    "saving": "保存中...",
    "save": "保存设置",
    "navigation": "设置分类",
    "localSettings": "保存在本地后端",
    "sidebarHint": "试色即时预览；保存后写入本地配置。",
    "sections": {
      "appearance": {
        "title": "外观",
        "description": "调整主题配色、页面强调色和界面动画。"
      },
      "pages": {
        "title": "页面颜色",
        "description": "单独设置各页面的导航图标和标签强调色，保存后应用。"
      },
      "interface": {
        "title": "界面动画",
        "description": "调整工作区的动画效果和过渡时长。"
      },
      "gallery": {
        "title": "画廊与保存",
        "description": "管理本机输出目录、灵感来源和文件名规则。"
      }
    },
    "colorSchemes": "配色方案",
    "currentScheme": "当前配色 · {name}",
    "customizeScheme": "微调当前配色",
    "customizeHint": "预设已包含主题色。你也可以单独调整当前模式的颜色。",
    "pickColor": "选择{name}",
    "storageImmediate": "存储位置和灵感图库设置立即生效，其余选项请点击底部保存。",
    "unsaved": "有未保存的更改",
    "upToDate": "设置已保存",
    "discard": "撤销更改",
    "darkDescription": "适合夜间使用，减少眼睛疲劳",
    "lightDescription": "适合日间使用，界面清晰明亮",
    "autoSaveToGallery": "自动保存到生成画廊",
    "autoSaveToGalleryHint": "生成完成后保存到上方选择的浏览器存储或本地目录，可与自动下载同时开启。更改后请保存设置。",
    "loadFailed": "本地设置加载失败，请重试后保存。"
  }
};

Object.assign(messages, {
  "tutorials": {
    "playbackSpeed": "播放速度",
    "demoChapters": "演示节点",
    "seekingChapter": "正在定位演示节点…",
    "openPage": "打开使用教程",
    "nav": {
      "painting": "绘图",
      "promptEditor": "提示词编辑器",
      "promptNotebook": "提示词笔记",
      "drawingImages": "图像",
      "drawingJobs": "生成与排错",
      "drawingWorks": "作品历史"
    },
    "drawingPracticeIntro": "在独立的绘图练习中使用样例图和真实控件。",
    "topics": {
      "imageDisplay": "图像展示区",
      "imageHistory": "图像历史",
      "imageDrop": "拖入与导入图像",
      "imageAdjustment": "图像调整",
      "generationParameters": "生成参数与任务",
      "generationErrors": "错误详情与取图",
      "workHistory": "作品历史与蓝图",
      "collapse": "折叠与展开",
      "preview": "预览",
      "translation": "翻译",
      "comments": "注释",
      "weights": "快速权重",
      "suggestions": "提示词联想",
      "random": "随机提示词",
      "notebook": "保存与使用笔记"
    },
    "guides": {
      "imageDisplay": "图像展示区引导",
      "imageHistory": "图像历史引导",
      "imageDrop": "拖入与导入图像引导",
      "imageAdjustment": "图像调整引导",
      "generationParameters": "生成参数与任务引导",
      "generationErrors": "错误详情与取图引导",
      "workHistory": "作品历史与蓝图引导",
      "collapse": "折叠与展开引导",
      "preview": "预览引导",
      "translation": "翻译引导",
      "comments": "注释引导",
      "weights": "快速权重引导",
      "suggestions": "提示词联想引导",
      "random": "随机提示词引导",
      "notebook": "提示词笔记引导"
    },
    "sections": {
      "demo": "演示",
      "tryIt": "交互示例",
      "guide": "在工作台中上手"
    },
    "contents": "教程目录",
    "previous": "上一篇",
    "next": "下一篇",
    "loading": "正在加载教程…",
    "loadFailed": "这篇教程没有加载成功。",
    "retry": "重新加载",
    "play": "播放演示",
    "pause": "暂停演示",
    "replay": "从头播放",
    "goToStep": "第 {index} 步",
    "replayProgress": "演示进度",
    "fullscreen": "全屏播放",
    "replayError": "演示暂时无法加载，可以从篇首开始引导练习。",
    "guidedPractice": "跟随引导练习",
    "sessionEnded": "本次引导已结束",
    "stayInWorkspace": "留在绘图页",
    "startGuide": "开始引导",
    "startPractice": "开始练习",
    "returnToTutorial": "返回教程",
    "returnToChangelog": "返回更新日志",
    "guideUnavailable": "当前登录方式不提供这项功能，可以观看本篇演示了解用法。",
    "startSuggestions": "开始提示词联想引导",
    "openPractice": "直接开始练习",
    "practiceTitle": "提示词联想练习",
    "editorPractice": {
      "activePrompt": "参与生成的提示词：{prompt}",
      "exerciseModel": "当前练习模型：{model}",
      "saveNote": "笔记可以把提示词、模型和角色位置一起留给下次绘图使用。点提示词工具栏的保存图标，用一个新名称保存这条 V5 示例笔记。",
      "openNotebook": "点书本图标，打开刚才保存的笔记所在的列表。",
      "createGroup": "在分组侧栏新建一个分组。手机上先打开分组列表。",
      "moveNote": "通过笔记的更多菜单或批量管理，把刚才的笔记移入新分组。",
      "filterNotes": "点击新分组，筛选并找到刚才移入的笔记。",
      "copyCharacter": "打开笔记详情，点击角色卡上的复制按钮。",
      "exportNotes": "返回笔记列表，点导出图标下载练习 JSON。",
      "importNotes": "点导入图标，选择刚导出的 JSON 文件。",
      "applySameModel": "保持「应用时切换模型」关闭，点击笔记的「使用」，查看练习模型。",
      "applySavedModel": "重新打开笔记本，开启「应用时切换模型」，再使用一条 V5 笔记，查看模型变化。",
      "openRandom": "想让同一段提示词每次生成不同发色，可以让它从一组词条里抽取。点提示词工具栏的骰子，先建一组发色。",
      "enableRandom": "打开「启用随机提示词」。开启后，生成时会把随机标记替换为抽到的词条。",
      "addCategory": "在「类别」页新增一个类别，输入名称并添加至少两个词条，保存该类别。",
      "addCollection": "切到「集合」，新增一个集合并选择刚才的类别。",
      "sampleRandom": "在集合上点击生成示例，查看本次抽取的词条。",
      "saveRandom": "关闭示例窗口并点击「保存配置」，把这个集合保存在当前练习中。",
      "insertRandom": "对刚才的集合使用「插入」，然后关闭配置窗口。",
      "resolveRandom": "使用下方的抽取按钮，查看标记在生成时会被替换成什么。",
      "sampleButton": "抽取示例提示词",
      "done": "练习已完成。结束后会恢复原有提示词和偏好。",
      "collapse": "点击提示词工具栏的箭头，收起提示词区。",
      "reopen": "再次点击箭头展开，确认示例提示词仍在。",
      "expandEditor": "点击正向提示词框右下角的展开图标，打开大编辑器。",
      "applyEditor": "点击「应用更改」回到绘图页，检查示例提示词。",
      "previewOff": "打开齿轮，关闭预览，查看提示词的原始标记。",
      "previewOn": "重新开启预览，对比加权、注释和随机标记。",
      "overlayPreview": "在大编辑器的齿轮菜单中切换「叠加预览」，观察编辑区和预览区如何排列。",
      "translationHint": "把鼠标移到 blue hair 或 red eyes 上，查看实际弹出的释义。",
      "translationTap": "点按 blue hair 或 red eyes，在光标旁查看释义。",
      "translationTab": "打开提示词工具栏的「翻译」页签。",
      "translate": "在原文框输入「蓝发，红瞳」，点击翻译查看示例译文。",
      "applyTranslation": "点击「应用到正向」，观察译文写入示例提示词。",
      "commentButton": "选中 red eyes，点击注释按钮。右侧预览会将注释标出。",
      "uncommentButton": "保持整块注释选中，点击取消注释按钮。",
      "commentKey": "选中 red eyes，按 Ctrl+/ 添加注释。",
      "uncommentKey": "保持选区，按一次 Ctrl+/ 恢复原文。",
      "wheelWeight": "在普通正向提示词框点进 blue hair，按住 Shift 滚动鼠标滚轮。",
      "keyWeight": "保持光标在词条里，按 Alt+↑ 或 Alt+↓ 再调整一次。",
      "weightButton": "将光标放到一个词里，点 W+ 或 W−，看标签权重变化。"
    },
    "practiceKeys": "按 ↓ 或 ↑ 选择候选，按 Enter 插入。Tab 会插入已选候选，未选择时插入第一项。",
    "inserted": "已插入 {tag}",
    "practiceDefaults": "在下方提示词框练习。使用默认搜索符号，结束后恢复原提示词。",
    "exercises": {
      "english": {
        "title": "按英文查找",
        "help": "输入「{query}」，然后选择 blue_hair（蓝发）。"
      },
      "pinyin": {
        "title": "按拼音查找",
        "help": "输入「{query}」（金发的拼音），然后选择 blonde_hair（金发）。"
      },
      "root": {
        "title": "浏览一级分类",
        "help": "输入「+」列出一级分类，再选择「服装」。"
      },
      "children": {
        "title": "打开子类别",
        "help": "在「+服装+」的候选里选择「下装」，查看这一类别的标签。"
      },
      "within": {
        "title": "插入类别内的标签",
        "help": "在「+服装+下装=」的结果里选择 skirt（裙子）。"
      },
      "scoped": {
        "title": "缩小搜索范围",
        "help": "输入「{query}」，在原神类别里匹配英文或拼音以 fu 开头的词条，选择 furina（芙宁娜）。"
      },
      "fuzzy": {
        "title": "用模糊匹配找回漏拼的标签",
        "help": "输入「{query}」，看看相近的候选如何排序，再选 blue_hair（蓝发）。"
      },
      "regex": {
        "title": "用正则表达式筛选",
        "help": "输入「{query}」。=* 开始正则匹配，^blue_ 匹配以 blue_ 开头的标签。选择任一结果。"
      }
    }
  }
});
Object.assign(messages.pages, {
  "tutorials": "使用教程"
});
Object.assign(messages.settings.sections, {
  "prompt": {
    "title": "提示词编辑",
    "description": "配置普通输入框和展开编辑器中的标签联想、翻译、权重调整和自动格式化。"
  }
});
Object.assign(messages.settings, {
  "prompt": {
    "suggestions": "标签联想",
    "suggestionsEnabled": "输入时显示候选标签",
    "suggestionLimit": "候选标签数量上限",
    "suggestionSettings": "标签联想设置",
    "configureSuggestions": "配置标签联想",
    "suggestionLayout": "候选标签排布",
    "suggestionLayoutOptions": {
      "flow": "瀑布流",
      "columns": "等宽列"
    },
    "suggestionTextLayout": "胶囊内文字方向",
    "suggestionTextLayoutOptions": {
      "horizontal": "左右排列",
      "vertical": "上下排列"
    },
    "suggestionSyntax": "启用标签搜索语法",
    "syntaxSymbols": "搜索符号",
    "symbols": {
      "category": "类别路径",
      "exact": "类别内检索",
      "fuzzy": "模糊匹配",
      "regex": "正则表达式"
    },
    "invalidSymbols": "每项请使用不同的单个标点或符号。逗号、冒号、方括号、花括号和斜线已用于提示词。",
    "expandedPreview": "展开编辑器的标签预览",
    "expandedPreviewOptions": {
      "auto": "随屏幕宽度自动显示",
      "on": "始终显示",
      "off": "始终隐藏"
    },
    "preview": "预览和翻译",
    "inlinePreview": "在普通输入框中预览提示词",
    "overlayPreview": "在展开编辑器中叠加预览",
    "translationEnabled": "显示标签释义和翻译",
    "translationUnderline": "为可翻译标签显示下划线",
    "translationTarget": "翻译目标语言",
    "weighting": "权重调整",
    "weightShortcutsEnabled": "启用快捷键调整权重",
    "keepWeightSelection": "调权后保留选区",
    "defaultWeightMode": "新标签默认权重写法",
    "weightStep": "数字权重步长",
    "formatting": "自动格式化",
    "autoFormat": "自动整理编辑过的提示词",
    "normalizeCommas": "统一逗号和标签间距",
    "replaceUnderscores": "把普通标签里的下划线换成空格",
    "trailingComma": "提示词末尾的逗号",
    "trailingOptions": {
      "preserve": "保留原样",
      "remove": "去掉末尾逗号",
      "append": "补上末尾逗号"
    },
    "help": {
      "suggestionsEnabled": "在正面和负面提示词中输入标签时显示匹配建议，可用方向键浏览并按 Enter 或 Tab 填入。",
      "suggestionLimit": "限制每次显示的候选数量。缩小数量让候选列表更短，调大可查看更多匹配。",
      "suggestionLayout": "瀑布流按标签宽度自动换行，等宽列将标签对齐到网格。",
      "suggestionTextLayout": "选择英文标签和中文释义在胶囊内的排列方向。",
      "suggestionSyntax": "通过类别路径限定范围，或按相似度、正则表达式查找。普通搜索支持英文、中文和拼音。",
      "syntaxSymbols": "输入 {category} 浏览类别，{category}服装{category} 浏览子类，{category}原神{exact}fu 在原神中查找 fu。用 {fuzzy}fu 模糊查找，或用 {exact}{regex}^fu 匹配以 fu 开头的标签。",
      "expandedPreview": "展开编辑器可以同时显示提示词输入区和标签预览，方便查看权重和翻译。自动模式会在宽屏显示预览，在窄屏给输入区留下更多空间。",
      "inlinePreview": "在普通编辑框中直接用不同颜色标出权重、随机提示词和注释，便于检查提示词结构。",
      "overlayPreview": "展开编辑器启用预览时，把高亮和释义叠加在文本上，适合不想同时查看两个栏的情况。",
      "translationEnabled": "悬停或点按可识别标签以查看释义。原文和实际发送的提示词都保持原样。",
      "translationUnderline": "给有译文的标签加下划线，便于发现可以查看释义的词条。",
      "translationTarget": "决定标签释义显示的语言。「自动」使用当前界面语言。",
      "weightShortcutsEnabled": "在提示词编辑框内使用 Alt 加上下方向键，或按住 Shift 滚动滚轮，调整光标所在的标签或选中的文字。",
      "keepWeightSelection": "选中一段文字调权后，继续保持选中，方便重复调整。关闭时，光标移到调整后的段尾。",
      "defaultWeightMode": "当标签还没有权重时，第一次调权会按这里选定的方式写成数字或括号。已有权重会遵循原来的写法。",
      "weightStep": "设置数字权重每次增加或减少的幅度，例如 1.00 可以按 0.05 调整为 1.05。括号权重仍逐层增减。",
      "autoFormat": "粘贴文字时先整理粘贴内容，编辑结束离开输入框时再整理整段。注释、占位符和转义内容保留原样。",
      "normalizeCommas": "把中文逗号转成英文逗号，并把同行标签间的空格统一为一个，保留原来的换行。",
      "replaceUnderscores": "例如把 long_hair 改为 long hair。网址、命名空间标签和随机词占位符保持原样。",
      "trailingComma": "决定完成编辑时是否保留提示词末尾的逗号。选择补上时只补一个，便于继续追加标签。"
    }
  }
});
Object.assign(messages.settings.naming, {
  "custom": "自定义模板"
});

Object.assign(messages, {
  "changelog": {
    "guide": {
      "title": "新功能引导",
      "start": "开始引导",
      "next": "下一步",
      "finish": "完成引导",
      "exit": "退出引导",
      "captchaPreview": "本地验证码预览",
      "exampleNote": "月下花园（引导示例）",
      "character": "提灯旅人",
      "panelTitle": "展开生成参数",
      "panelHelp": "点亮框中的参数面板按钮，提示词工具就在面板顶部。",
      "expandSectionTitle": "展开提示词区",
      "expandSectionHelp": "提示词区目前已收起。点击高亮的箭头展开输入框。",
      "collapseTitle": "收起提示词区",
      "collapseHelp": "点击箭头收起。收起后只保留标签栏和工具按钮，已输入的内容不变。",
      "reopenTitle": "重新展开",
      "reopenHelp": "收起状态会记在本浏览器，下次打开保持不变。再次点击箭头展开；收起时切换到另一个标签也会自动展开。",
      "expandEditorTitle": "打开大窗口编辑",
      "expandEditorHelp": "点击输入框右下角高亮的展开图标，在大窗口中编辑正向提示词。",
      "editorToolbarTitle": "编辑工具栏",
      "editorToolbarHelp": "这里可以调整权重（W+ / W−）、添加或取消注释、插入随机提示词。工具栏下方显示 Token 数和光标位置。",
      "editorApplyTitle": "保存或放弃修改",
      "editorApplyHelp": "点「应用更改」把大窗口里的内容写回提示词框；点「取消」或关闭窗口会放弃这次修改。",
      "promptInputTitle": "输入框里的预览",
      "promptInputHelp": "开启预览后，加权显示为红底，降权为蓝底，注释为灰色删除线，随机提示词带虚线下划线。预览只改变显示，不改动文字。",
      "previewToggleTitle": "开关预览",
      "previewToggleHelp": "「显示预览」控制普通输入框是否叠加高亮。大窗口的分栏或叠加预览，在大窗口自己的齿轮菜单里设置。",
      "translationTabTitle": "翻译页签",
      "translationTabHelp": "点击高亮的「翻译」页签，把一段描述翻译成提示词。",
      "translateSourceTitle": "翻译一段描述",
      "translateSourceHelp": "在「原文」中输入内容并点「翻译」。确认结果后点「应用到正向提示词」，它会替换正向提示词的全部内容。",
      "translationSettingsTitle": "标签释义",
      "translationSettingsHelp": "开启「启用翻译」后，停止输入约 3 秒会查询可识别标签的释义。点击标签或把光标移进标签即可查看。下方可设置下划线和目标语言。",
      "commentButtonsTitle": "注释与取消注释",
      "commentButtonsHelp": "先选中文字。左边的按钮把选区所在的标签包进 /* */，右边的按钮去掉选区内注释的标记。注释内容不会发送到生成。",
      "editorPreviewTitle": "在预览中核对",
      "editorPreviewHelp": "注释在预览中显示为灰色删除线，权重显示为红底或蓝底。核对后点「下一步」。",
      "weightButtonsTitle": "调整权重",
      "weightButtonsHelp": "把光标放进标签或选中文字，点 W+ 加权、W− 降权。也可以按 Alt + ↑ / ↓，或按住 Shift 滚动滚轮。",
      "randomTitle": "打开随机提示词",
      "randomHelp": "点击提示词工具栏里高亮的骰子图标。图标显示为主题色时，随机提示词已启用。",
      "randomEnableTitle": "启用随机提示词",
      "randomEnableHelp": "开启后，每次生成都会把提示词里的随机标记换成抽到的词条。改动要点「保存配置」才会生效。",
      "randomTabsTitle": "类别与集合",
      "randomTabsHelp": "「类别管理」存放可抽取的词条，「集合管理」把多个类别组合使用，「使用说明」列出插入语法。每个类别和集合都有插入按钮。",
      "randomActionsTitle": "保存配置",
      "randomActionsHelp": "点「保存配置」保存修改，或点「取消」关闭窗口。",
      "notebookTitle": "打开提示词笔记",
      "notebookHelp": "点击提示词工具栏里高亮的书本图标。",
      "noteTitle": "查看一条角色笔记",
      "noteHelp": "点击高亮的眼睛图标查看笔记详情。没有带角色的笔记时，可用这里的只读示例。",
      "charactersTitle": "查看角色卡",
      "charactersHelp": "这里能看到角色提示词和位置。点复制图标可单独复制正向或负向提示词，看完点「下一步」。",
      "closePreviewTitle": "返回笔记列表",
      "closePreviewHelp": "点击详情右上角高亮的关闭按钮，回到笔记本。",
      "closeNotebookTitle": "回到绘图界面",
      "closeNotebookHelp": "笔记本底部可设置应用笔记时是否切换模型。点击「关闭」完成引导。",
      "gearTitle": "打开提示词设置",
      "gearHelp": "点击提示词工具栏里的齿轮。",
      "configureTitle": "进入标签联想设置",
      "configureHelp": "点击「配置标签联想」，打开标签联想的设置窗口。",
      "enableSuggestionsTitle": "开启标签联想",
      "enableSuggestionsHelp": "开启后，输入时会显示匹配候选。也可以在齿轮菜单里快速开关。",
      "appearanceTitle": "调整候选标签外观",
      "appearanceHelp": "设置最多显示多少条、瀑布流或等宽列，以及中英文左右或上下排布。",
      "syntaxTitle": "设置搜索语法",
      "syntaxHelp": "可开关查询语法，或替换分类、类别内搜索、模糊匹配和正则符号。自定义符号不能重复。",
      "closeSettingsTitle": "保存并开始练习",
      "closeSettingsHelp": "点「保存设置」应用修改，或点「取消」直接练习。",
      "waitingTitle": "寻找绘图控件",
      "waitingHelp": "正在等待绘图控件显示。若打开了其他窗口，请先返回生成页；指令编辑模型可切换为支持标签的绘图模型。"
    }
  }
});
Object.assign(messages.settings, {
  "interface": {
    "display": "展示区",
    "history": "生成历史",
    "expandedImageShortcuts": "直接显示工具快捷方式",
    "displayImageDrag": "长按并拖出展示图像",
    "historyImageDrag": "长按并拖出历史图像",
    "centerNewGeneration": "生成新图后居中显示整图",
    "lockedGestureNavigation": "锁定时用滚轮或滑动切换图像",
    "transparencyBackground": "透明图像背景",
    "customColor": "自定义背景色",
    "backgrounds": {
      "none": "无填充",
      "checkerboard": "随主题的棋盘格",
      "white": "白色",
      "gray": "灰色",
      "green": "绿色",
      "red": "红色",
      "blue": "蓝色",
      "custom": "自定义颜色"
    },
    "privacyMode": "隐私模式",
    "privacyScope": "模糊范围",
    "privacyReveal": "查看方式",
    "privacyScopeOptions": {
      "both": "展示区和历史区",
      "display": "仅展示区",
      "history": "仅历史区"
    },
    "privacyRevealOptions": {
      "hold": "鼠标或触摸长按",
      "hover": "鼠标悬停或触摸时显示",
      "toggle": "鼠标点击或轻触切换"
    },
    "bottomBar": "底栏入口",
    "showAdjustmentEntry": "图像调整",
    "showGalleryEntry": "生成画廊",
    "historyFollowSelection": "历史列表跟随当前图像",
    "historyImageFit": "展开历史中的缩略图排法",
    "fitOptions": {
      "contain": "显示完整图像",
      "cover": "填满缩略图"
    },
    "privacy": "隐私保护",
    "help": {
      "expandedImageShortcuts": "把「用作」和「发送至」菜单中的操作直接放在悬浮工具栏上，常用操作可以一步点到。",
      "displayImageDrag": "在展示区长按当前图像，然后拖到支持图片拖放的应用或网页。关闭后可直接拖动来平移画布。",
      "historyImageDrag": "在缩略图条或展开的历史画廊中长按图片再拖出，拖放使用当前的预览导出方式。",
      "centerNewGeneration": "每生成一张新图，就把展示区的缩放和平移恢复为整张图居中显示。关闭后，连续出图时保留当前视角。",
      "lockedGestureNavigation": "画布锁定后，用滚轮或单指滑动浏览相邻图像。画布解锁时，手势仍用于缩放和平移。",
      "transparencyBackground": "只改变透明像素下方的屏幕显示。选择「无填充」时直接透出展示区背景，下载和导出的图片保留原有透明度。",
      "customColor": "给图片的透明部分选择任意预览底色。颜色不会写入图片。",
      "historyFollowSelection": "在展示区用鼠标、手势或快捷键换图时，历史列表自动滚动到正在看的缩略图。关闭后列表保留原有滚动位置。",
      "historyImageFit": "选择展开画廊里是完整显示原比例，还是裁切边缘填满统一方格。这个选项只影响缩略图。",
      "privacyMode": "模糊选定区域内的图片。按照下方的查看方式可以临时看清图片，关闭隐私模式后会正常显示。",
      "privacyScope": "可只模糊展示区、只模糊历史缩略图，或同时模糊两个区域。",
      "privacyReveal": "长按或悬停时，仅在交互期间显示。选择点击切换时，轻触一次显示，再轻触一次恢复模糊。",
      "showAdjustmentEntry": "在生成历史下方保留图像调整按钮，方便对当前图或自己上传的图像快速调色和处理。",
      "showGalleryEntry": "在生成历史下方显示生成画廊入口，用来浏览已保存的作品。"
    }
  }
});
Object.assign(messages.settings, {
  "shortcuts": {
    "canvas": "展示区与历史",
    "unassigned": "未设置",
    "recording": "请按下新的按键…",
    "conflict": "此按键已用于「{action}」。",
    "clearShortcut": "清除「{action}」的快捷键",
    "previousImageShortcut": "查看上一张图像",
    "nextImageShortcut": "查看下一张图像",
    "deleteImageShortcut": "删除当前历史图像",
    "resetViewShortcut": "整张图居中显示",
    "adjustImageShortcut": "打开或关闭图像调整",
    "privacyShortcut": "打开或关闭隐私模式",
    "restore": "恢复默认快捷键",
    "help": {
      "previousImageShortcut": "按历史顺序查看当前图像的上一张。到列表边缘时从另一端继续。",
      "nextImageShortcut": "按历史顺序查看当前图像的下一张。到列表边缘时从另一端继续。",
      "deleteImageShortcut": "从本次生成历史里移除当前选中的图片，已另存到生成画廊的副本仍可查看。",
      "resetViewShortcut": "重置当前画布的缩放和平移，把整张图放回展示区中间。",
      "adjustImageShortcut": "进入图像调整或返回生成画布。展示区没有图片时也能进入调整并上传原图。",
      "privacyShortcut": "快速切换隐私模式，模糊范围和查看方式取自「界面」设置。",
      "restore": "把本页的按键恢复到默认分配，点击底部保存后生效。"
    }
  }
});
Object.assign(messages.settings.sections, {
  "shortcuts": {
    "title": "快捷键",
    "description": "点击要修改的输入框，再按下想用的单键或组合键。相同的组合键只分配给一个操作，改完请保存。"
  }
});

Object.assign(messages.settings, {
  "searchPlaceholder": "搜索设置",
  "searchEmpty": "没有匹配的设置",
  "details": "说明",
  "saveShortcutHint": "快捷键 Ctrl+S",
  "storage": {
    "location": "画廊存储位置",
    "library": "管理已保存图像与备份",
    "libraryHelp": "打开生成画廊即可整理已存作品，并将图片和参数打包备份或从备份导入。",
    "browserSpace": "浏览器空间",
    "usage": "已用空间与可用额度",
    "usageValue": "本站已用约 {usage} MB。浏览器分配给本站的额度约为 {quota} GB，模型缓存和浏览器图库都占用这部分空间。",
    "usageUnavailable": "此浏览器尚未提供本站的用量估算。",
    "persistence": "保护浏览器中的本地数据",
    "persistenceHelp": "申请持久化后，支持的浏览器在空间紧张时会尽量保留本站的数据。仍建议为重要图片单独导出备份。",
    "persistenceOn": "浏览器已允许本站使用持久化存储。手动清除站点数据时仍可能删除本地资料。",
    "modelCache": "模型缓存占用",
    "modelCacheHelp": "在本地模型页查看或移除不再使用的反推和放大模型文件。",
    "inspiration": "灵感图库",
    "inspirationHelp": "开启后，空展示区可以用所选图库显示灵感图，点击图片可查看或导入其中的生成参数。",
    "source": "灵感图片来源",
    "sourceHelp": "在官方示例、本机生成画廊或画风图库之间选择。更改立即生效。"
  },
  "fileNameTemplate": "文件名模板",
  "fileNameTemplateHelp": "点击变量插入到光标处，其余文字会原样保留。提示词和随机串可写成 {prompt:20}、{random:6} 来指定长度；不能用于文件名的字符会换成下划线。",
  "templateTokens": {
    "prefix": "前缀",
    "seed": "种子",
    "prompt": "提示词",
    "date": "日期",
    "time": "时间",
    "timestamp": "时间戳",
    "random": "随机串"
  }
});

export default messages;
