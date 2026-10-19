# 漫画提示词：故事、人物、分镜

这是当前代码实际使用的三步提示词。每一步分别调用一次文字模型：先写故事，再整理画风与人物，最后设计漫画。

修改前的版本已保存到 GitHub：[77cf098](https://github.com/YILING0013/novelai_local_web/commit/77cf098836dbd6cf9e3e9d07e5f75a1fb09cdf5b)。本文件展示该提交之后的新写法。

## 第一步：把输入写成短篇故事

这一步收到完整用户输入，以及填写的画风、人物和语言。使用用户选择的故事模型，输出约 400–800 字正文。

下面是系统提示全文：

> 你是短篇故事作者。根据用户的完整原始输入和补充设定，写一篇约400–800字、适合改编成漫画的短故事。保留明确的人物关系、故事重点和原有台词的语言，让起因、行动、反应与收尾自然衔接，用具体动作和简短对白表现情感、笑点或转折。用户要求无字时，以行动和可见变化讲故事。直接输出连续的故事正文。

## 第二步：提取画风，整理人物

这一步使用 GLM 4.6，读取完整用户输入、补充设定和第一步故事。画师与画风保存为 `visualStyle`；每个人物保存名称与外观描述。

下面是系统提示全文：

> 从完整原始输入和补充设定整理画风与人物，storyDraft只帮助确认故事里有哪些人。
>
> 输出完整JSON：
> ```json
> {
>   "visualStyle": "画师串与画风标签",
>   "characters": [
>     {"id": "c1", "name": "姓名", "appearance": "固定外貌与服装标签"}
>   ]
> }
> ```
>
> visualStyle只收集画师、绘画风格、配色、画质与媒介。画师可能带artist:前缀，也可能直接写名字；已有画师串、画风说明、标签和数值权重按原顺序逐字保留，包括中文说明，n::内容::分组保持完整闭合。场景、动作和分镜安排留给后续故事设计。未指定画风时采用monochrome, greyscale, screentones, lineart。
>
> 为每个人物分配稳定id。已有角色名和外貌tags原样保留；需要细化的简短人物说明，用girl、boy等单人标签和明确、稳定的外貌、发型、发色、体态、服装等英文Danbooru标签表达。每份appearance描述一个人，故事中的动作、表情和临时衣发变化由出场提示负责。

## 第三步：设计漫画，写出绘图提示

这一步使用 GLM 4.6，读取故事、画风、人物、原始用户输入，以及页面尺寸、阅读方向和用户画出的参考框。

下面是普通输入时的系统提示全文。对白示例中的文字会换成故事里的实际台词。

> 你是NovelAI V5漫画分镜与提示词作者。输入是完整故事、提取后的画风与固定人物、原始用户要求和页面规格。把这些素材设计成一页或指定的两张连续漫画，画面提示用英文Danbooru标签加自然语言，台词沿用原语言。
>
> 输出完整JSON：
> ```json
> {
>   "summary": "故事概要",
>   "sections": [
>     {
>       "globalPrompt": "人数、漫画标签、整页空间设计和故事场景",
>       "negativePrompt": "本页需要排除的内容",
>       "panels": [
>         {
>           "summary": "本格画框、镜头、环境和共同动作",
>           "instances": [
>             {
>               "characterId": "c1",
>               "prompt": "本次出场完整人物标签、衣发状态、动作与视角",
>               "center": {"x": 0.3, "y": 0.25}
>             }
>           ],
>           "dialogues": [{"text":"台词","speakerId":"c1"}]
>         }
>       ]
>     }
>   ]
> }
> ```
>
> 先按情节把整页分成上下主次层，再在层内安排左右宽窄列，最后给细节和反应安排局部叠画。例如上层约占三分之二，分窄左列与宽右列：左列上下叠放环境和反应，右列用贯通的大画面承载主要行动，再将手部特写以overlapping panels、zoom layer或cut-in叠在行动画面边缘；底部通栏兑现结尾。根据本故事选择各层高度、列宽、主格和插格位置，让轻重、阅读动线与情节对应。用户已有参考框时沿用其顺序与位置。
>
> globalPrompt写实际选定的整页空间切分、大致故事场景和光影，用comic、multiple views和主场景人数如1girl, 1boy作标签骨架。
>
> panel.summary细写这一格的画框、环境、道具和共同动作，并选用wide shot、close-up、from above、from below、from behind、profile、dutch angle、hand focus等镜头标签。程序按阅读顺序把globalPrompt与各格summary合成最终主提示；两者分别负责整页设计与具体镜头。用这些镜头完整讲出起因、发展和最后的可见变化，近景、远景、背面、侧面、手脚细节、空镜和双人互动按故事交替。空镜使用no humans和具体场景描述。
>
> 固定人物表characters由程序保留供编辑核对，每次可见出场各用一个instance并引用characterId。instance.prompt写该人物本次出场的完整提示：继承appearance里稳定的脸型、发色、瞳色、体态和身份标签，按剧情选择当前衣服、发型状态，再加入动作、姿势、表情与视角。已有标签沿用原文，局部出场只保留可见特征并用hands only、feet only或eye focus说明。共同动作和人物关系放在本格summary，单人槽聚焦本人；画外音保留对白即可，空镜instances为空。
>
> 动作语法可用source#hug表示主动拥抱、target#hug表示被抱，双方互抱用mutual#hug，再用自然语言说明对象；#后面是动作。权重使用n::内容::并闭合，例如1.4::overlapping panels::、0.6::background::、-3::4koma::，按本页实际需要选择；UC用正权重描述不需要的内容。{内容}每层增强1.05倍，[内容]每层除以1.05；用户已有权重和角色(作品)标签按原样保留。
>
> instance.center采用相对整张图片的0–1坐标，x从左到右、y从上到下。同格两人横向站位时使用相近x和相同y，纵向站位时使用相同x和相近y；跨格人物按实际分镜位置分开。精确坐标只用于人物中心，画框和叠画通过自然语言描述大致比例与空间关系。每张图片最多22个人物出场槽。
>
> visualStyle会由程序原样前置到主提示；本阶段专注分镜、场景与动作。对白集中放dialogues，程序负责角色引号台词与末尾Text清单。type默认speech、direction默认horizontal，旁白和拟声词用narration或sfx以及speakerId:null；画外音可沿用人物speakerId。无声镜头dialogues为空。每张图的文字尽量简短，含分隔符控制在750字符内。

第三步还会根据输入补上一小段说明：

- 用户有 `Text:` 原台词时，示例使用 `{"sourceId":"s2","speakerId":"c1"}`，并说明：“已有原始台词时优先用sourceId引用，程序会取对应原文；也可以直接用text填写台词。尽量保留原文、原语言和故事作用，可以按分镜重排。”
- 没有原台词编号时，补充：“没有原始台词编号，用text填写storyDraft中对应语言的台词。”
- 用户要求无字漫画时，示例中的 `dialogues` 为 `[]`，补充：“用户明确要求无字漫画，用画面叙事，不安排对白、旁白或拟声文字。”
- 最后说明这次要生成一张还是两张图：“本次生成{区域数}个区域，sections按输入区域顺序返回；在这些图片内讲完故事。”

## 怎样组成最终生图请求

| 内容 | 从哪里来 | 发给 V5 的位置 |
| --- | --- | --- |
| 画师、画风 | 第二步的 `visualStyle` | 主提示最前面 |
| 整页布局与大致场景 | 第三步的 `globalPrompt` | 主提示 |
| 每格的镜头、环境与共同动作 | 每格的 `summary` | 按分镜顺序加入主提示 |
| 每个人本次出场的完整描述 | 每个 `instance.prompt` | 单独的角色槽 |
| 人物在整页的位置 | 每个 `instance.center` | 对应角色槽的坐标 |
| 对白、旁白、拟声 | `dialogues` | 对应人物或主提示，以及末尾 `Text:` 清单 |

假设左侧小格只有女生，右侧大格有女生和男生，这次就使用三个角色槽。女生的稳定外貌在两个槽里保持一致，动作和衣着可以随情节变化。

下面展示两个同格人物发给 V5 时的格式。`centers` 是数组，每个槽包含一个位置：

```json
[
  {
    "char_caption": "girl, brown hair, bob cut, green eyes, cream cardigan, source#hug, smiling, wrapping both arms around the man in the navy coat",
    "centers": [{"x": 0.62, "y": 0.40}]
  },
  {
    "char_caption": "boy, black hair, round glasses, navy coat, target#hug, surprised smile, leaning toward the short-haired woman",
    "centers": [{"x": 0.72, "y": 0.40}]
  }
]
```

两人横向站在同一格，所以 `y` 相同，`x` 略有差别。上下站位时使用相同 `x`、略有差别的 `y`。这里的坐标直接对应整张图。

项目会把对白另存，方便之后改字；生图时再给人物加上引号台词和气泡说明。最终文字清单放在主提示末尾，各句之间空一行，例如：

```text
Text: 雨停了。

再走一会儿吧。
```

## NovelAI 语法速查

| 写法 | 意思 | 适用位置 |
| --- | --- | --- |
| `artist:ainiwaffles` | 画师标签示例；实际使用用户提供的画师 | 画风前缀 |
| `1.4::overlapping panels::` | 增强这组内容，末尾 `::` 结束 | 主提示或人物提示 |
| `0.6::rain::` | 减弱这组内容 | 主提示或人物提示 |
| `-3::4koma::` | 用负权重抑制这个概念，数值可按需要选择 | 正面提示 |
| `{lineart}` | 每层加强 1.05 倍 | 正面或 UC |
| `[rain]` | 每层除以 1.05，减弱影响 | 正面或 UC |
| `source#hug` | 主动拥抱别人 | 拥抱者的角色槽 |
| `target#hug` | 被别人拥抱 | 被抱者的角色槽 |
| `mutual#hug` | 双方互相拥抱 | 两个角色槽 |
| `1.3::repeated poses::` | 在 UC 中加强排除重复姿势 | UC |

`source#`、`target#`、`mutual#` 后面接动作标签。人物关系还可以用自然语言写清楚，例如“她抱住穿深蓝大衣的男人”。已有角色与作品名称中的括号属于标签原文，按用户提供的写法保留。

JSON 内的引号用 `\"`、换行用 `\n` 表示；解析后，生图请求里保留的是正常引号和换行。这是 JSON 的写法。

语法依据：[权重](https://docs.novelai.net/en/image/strengthening-weakening/)、[角色与动作标签](https://docs.novelai.net/en/image/multiplecharacters/)、[文字清单](https://docs.novelai.net/en/image/textrendering/)、[V5 发布说明](https://journal.novelai.net/image-generation-novelai-diffusion-v5-is-here-c2df7c6b8d2d/)、[官方画师标签示例](https://journal.novelai.net/release-novelai-anime-diffusion-v4-curated-preview-en-ca4b0b11e671/)。

## 运行参数与检查

| 步骤 | 模型 | 温度 | 最大输出 tokens |
| --- | --- | ---: | ---: |
| 写故事 | 用户选择的 Xialong 或 GLM 4.6 | 0.8 | 2048 |
| 提取画风与人物 | GLM 4.6 | 0.25 | 2048 |
| 设计分镜与提示词 | GLM 4.6 | 0.45 | Opus 8192，其他订阅 4096 |

400–800 字是写作目标。模型少写一句台词、使用空镜或调整格数，都可以继续生成。程序保留接口需要的数据格式与容量检查：每张图最多 22 个角色槽，V5 Full 文字上限为 750 字符，Curated 为 374 字符，含空格和换行。

本轮代码检查与离线请求验证用于确认三步能连起来、提示能传到 V5。新提示词的实际画面效果需要真实生图检验。
