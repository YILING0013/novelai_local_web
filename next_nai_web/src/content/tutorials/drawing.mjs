/** 生成工作台篇目、演示字幕和实际操作的中英文内容。 */
export const DRAWING_LESSONS = {
  imageDisplay: {
    actions: ["zoomImage", "panImage", "resetImage", "nextImage", "viewMetadata", "scramble", "unscramble", "previewSettings", "privacyOn", "privacyScope", "privacyReveal", "revealImage"],
    'zh-CN': {
      title: "图像展示区",
      lead: "生成结果出现在绘图页的主图区域。这里的缩放、拖动和复位只改变查看方式。",
      demo: [
        "缩放图像，观察主图区的局部细节。",
        "按住图像拖动，查看另一处细节。",
        "点「重置视图」，恢复图像最初的显示位置。",
        "用主图左右切换箭头查看下一张。",
        "打开当前图像的元数据，查看模型、种子和原提示词。",
        "点预览图右上角的扳手，再点「混淆」，观察像素排列的变化。",
        "点「还原混淆」，与原图对照。",
        "关闭元数据窗口，打开历史栏的「图像预览设置」。",
        "开启隐私模式，让图片默认被遮挡。",
        "把隐私范围改为「仅主图」，观察历史缩略图。",
        "把查看方式切换为点击显示。",
        "关闭预览设置，点击主图的遮罩查看图片。",
      ],
      sections: [
        { title: "混淆与隐私遮罩", blocks: ["图像混淆会重新排列导出图片的像素，可以用还原操作查看。预览设置里的隐私遮罩仅影响屏幕显示。可选择遮挡主图、历史或两者，再选择长按、悬停或点击查看。"] },
        { title: "查看和切换", blocks: ["打开结果后可以缩放、拖动、锁定画布或恢复视图。左右箭头和历史缩略图都可以切换结果。"] },
        { title: "查看、复用和导出", blocks: ["元数据可用时可以查看提示词和参数，选择应用到绘图。下载、复制、存入画廊或发送到其它工具从图像工具栏进入。",
          { head: ["操作", "结果"], table: [["重置视图", "还原缩放和平移。"], ["锁定画布", "暂停在主图上的缩放和平移，便于切换结果。"], ["使用此图参数", "打开参数预览，选择要应用的字段。"], ["下载或复制", "从导出选项选择是否保留元数据。"]] }] },
      ],
    },
    'en-US': {
      title: "Image display",
      lead: "Results appear in the main preview. Zoom, pan and reset change how you view the image.",
      demo: [
        "Zoom in to see a detail.",
        "Drag the image to inspect a different part.",
        "Choose Reset view to fit the image again.",
        "Use the arrows by the preview to view the next image.",
        "Open image metadata and check the model, seed and original prompt.",
        "Open the wrench on the preview and choose Scramble. Watch the pixels rearrange.",
        "Choose Unscramble to compare with the original.",
        "Close metadata and open Image preview settings in the history bar.",
        "Turn on privacy mode to cover the images.",
        "Set privacy scope to the main display and inspect the history thumbnails.",
        "Set the reveal gesture to click.",
        "Close settings and click the cover to reveal the image.",
      ],
      sections: [
        { title: "Scrambling and privacy", blocks: ["Scrambling rearranges the pixels in an exported file and can be reversed. The privacy cover affects on-screen viewing. Cover the display, history, or both, and choose hold, hover, or click to reveal."] },
        { title: "Viewing and switching", blocks: ["Zoom, drag, lock the canvas or reset the view. The arrows and history thumbnails switch results."] },
        { title: "Inspect, reuse and export", blocks: ["When metadata is available, inspect the prompts and parameters or apply them to drawing. The image toolbar also offers download, copy, save to gallery and tool actions.",
          { head: ["Action", "Result"], table: [["Reset view", "Resets zoom and pan."], ["Lock canvas", "Pauses zoom and pan while you browse results."], ["Use image parameters", "Opens a preview where you choose which fields to apply."], ["Download or copy", "Choose how the export handles metadata."]] }] },
      ],
    },
  },
  imageHistory: {
    actions: ["historySelect","historyOpen","applySeed","applyMetadata"],
    'zh-CN': {
      title: "图像历史",
      lead: "图像历史用来回看本次绘图的结果和导入图像。",
      demo: [
        "点击一张历史缩略图，在主图区查看它。",
        "打开完整历史面板，查看图像列表。",
        "关闭面板后，点击当前图像的种子，复制并应用到生成参数。",
        "选择一张图像的元数据并应用到练习参数。",
      ],
      sections: [
        { title: "缩略图和完整历史", blocks: ["选择缩略图会改变当前主图。完整历史适合浏览更多图片，也能查看、下载和管理结果。"] },
        { title: "复用生成条件", blocks: ["种子按钮会复制并应用种子。带参数的图像可以应用更多字段；普通图片的元数据可能为空。",
          { list: ["图像历史条用于在主图之间快速切换。", "「本次生成记录」打开完整历史。点缩略图可选中结果，点删除只处理所选历史项。", "生成画廊和作品蓝图有各自的入口。前者整理输出，后者管理版本和分支。"] }] },
      ],
    },
    'en-US': {
      title: "Image history",
      lead: "Image history is where you revisit drawing results and imported images.",
      demo: [
        "Select a thumbnail to show it in the main preview.",
        "Open the full history panel to see the list.",
        "Close the panel and click the seed to copy it and apply it to your parameters.",
        "Open metadata for an image and apply it to the practice parameters.",
      ],
      sections: [
        { title: "Thumbnails and full history", blocks: ["A thumbnail selection updates the main preview. Open full history to browse more results and view, download or manage them."] },
        { title: "Reuse generation settings", blocks: ["Clicking a seed copies and applies it. Images with metadata can restore more fields. Plain images may have no generation metadata.",
          { list: ["Use the thumbnail strip to switch the main preview quickly.", "Open the full session history to see more results. Choose a thumbnail to select it, or delete a particular history item.", "The output gallery organizes saved results. The work blueprint manages revisions and branches."] }] },
      ],
    },
  },
  imageDrop: {
    actions: ["dropDisplay","sendImage","dropHistory"],
    'zh-CN': {
      title: "拖入与导入图像",
      lead: "拖入位置决定应用如何处理图像。操作前确认高亮的目标区域。",
      demo: [
        "从「文件管理器」按住 sample-1.png，拖到主图区再松开。",
        "在图像用途窗口选择「图生图」，核对参数区的输入图。",
        "把文件夹里的 sample-2.png 拖到历史缩略图栏，查看新增的图片。",
      ],
      sections: [
        { title: "主图区与历史区", blocks: ["拖到工作台会打开导入窗口，可查看元数据和选择用途。拖到图像历史只把图像加入历史。可以用鼠标或手指拖动。使用键盘时，在文件上按空格，再聚焦到目标区域并按回车放下。"] },
        { title: "发送到其他工具", blocks: ["根据模型和账号可选图生图、局部重绘、Vibe、角色参考或图像编辑。进入图像调整后，拖入图像会替换当前调整源。",
          { head: ["拖入目标", "用途"], table: [["主图区", "选择用途或只应用元数据。"], ["历史区", "加入历史列表。"], ["图生图或参考图面板", "直接设置对应的输入图。"], ["已打开的图像调整", "为本次调整选择新的源图。"]] }] },
      ],
    },
    'en-US': {
      title: "Drag and import images",
      lead: "Where you drop an image determines how the workspace handles it. Watch which target is highlighted.",
      demo: [
        "Press and drag sample-1.png from the file manager onto the main preview, then release.",
        "Choose Image to Image in the import dialog and check its input in the parameter panel.",
        "Drag sample-2.png from the folder onto the history strip and look for its new thumbnail.",
      ],
      sections: [
        { title: "Preview and history", blocks: ["Dropping onto the workspace opens the import dialog to inspect metadata and choose a use. Dropping onto history adds the image to history. Drag with a mouse or a finger. With a keyboard, press Space on a file, focus the destination, and press Enter to drop it."] },
        { title: "Send to another tool", blocks: ["Available destinations can include Image to Image, Inpaint, Vibe, character reference and image editing. In image adjustment mode, a drop replaces the adjustment source.",
          { head: ["Drop target", "Use"], table: [["Main preview", "Choose a use or apply metadata."], ["History", "Add the image to the history list."], ["Image to Image or reference panel", "Set the input image for that tool."], ["Open image adjustment", "Select a new source for the current adjustment."]] }] },
      ],
    },
  },
  imageAdjustment: {
    actions: ["openAdjustment","changeAdjustment","compareAdjustment","applyAdjustment"],
    'zh-CN': {
      title: "图像调整",
      lead: "图像调整在工作台直接预览处理效果，适合对选中的结果做后期微调。",
      demo: [
        "点击主图工具栏的图像调整按钮。",
        "改变亮度或色温，观察预览变化。",
        "使用原图对比，确认查看的是同一张源图。",
        "应用调整，让历史多出一张图像。",
      ],
      sections: [
        { title: "面板和操作", blocks: ["色调包含基础滑块和曲线。风格、细节、马赛克、水印在各自页签。可从预设加载，也可撤销或重置当前调整。"] },
        { title: "对比和输出", blocks: ["按住对比按钮查看原图，松开后回到调整结果。应用会在图像历史中新增调整结果。退出前可以放弃尚未应用的调整。",
          { list: ["撤销和重做在本次调整内移动。重置调整回到初始设置。", "快捷预设可保存常用调整组合。曲线和色温适合先校色，再叠加细节效果。", "马赛克和水印可在画面里调整范围或位置。应用前可先对照原图检查。"] }] },
      ],
    },
    'en-US': {
      title: "Image adjustment",
      lead: "Image adjustment previews edits in the drawing workspace for quick finishing.",
      demo: [
        "Open Image adjustment from the image toolbar.",
        "Change brightness or temperature and watch the preview.",
        "Use Compare to check the result against the source.",
        "Apply the adjustments to add a new image to history.",
      ],
      sections: [
        { title: "Panels and controls", blocks: ["Tone includes sliders and curves. Style, details, mosaic and watermark have their own tabs. Load presets or undo and reset edits."] },
        { title: "Compare and output", blocks: ["Hold Compare to see the original. Release to return to the current result. Apply adds an adjusted image to history. Close the tool to discard changes you have not applied.",
          { list: ["Undo and redo move within this adjustment. Reset returns to its starting settings.", "Presets store settings you use frequently. Curves and temperature can establish color before you add detail effects.", "Adjust the area or placement of a mosaic or watermark on the image, then compare before applying."] }] },
      ],
    },
  },
  generationParameters: {
    actions: ["changeModel", "changeSize", "changeSteps", "changeGuidance", "changeSeed", "changeSampler", "addCharacter", "placeCharacter", "simulateGeneration"],
    'zh-CN': {
      title: "生成参数与任务",
      lead: "参数面板由当前模型决定。普通生成将模型、提示词、尺寸和其他参数组合成一次任务。",
      demo: [
        "从模型下拉框换一个示例模型。",
        "选择一个尺寸预设或修改宽高。",
        "在常用参数栏修改步数。",
        "打开引导系数控件，调整提示词引导值。",
        "为练习填入固定种子。",
        "换一个采样器。",
        "展开角色控制，点击添加角色。",
        "切到自定义定位，打开位置编辑器并移动角色标记。",
        "点「模拟生成」，查看进度与示例结果。",
      ],
      sections: [
        { title: "常用参数", blocks: ["尺寸预设便于快速切换宽高。步数控制迭代次数，引导系数影响对提示词的响应。种子可固定或随机，采样器决定去噪方式。"] },
        { title: "模型专用参数", blocks: ["角色控制支持正负向提示词和位置。部分 V5 模型支持精确位置。图生图、参考图、Vibe、额外配置和额度信息会随模型及账号变化。"] },
      ],
    },
    'en-US': {
      title: "Generation parameters and jobs",
      lead: "The active model determines which controls appear. A job combines the model, prompts, dimensions and other settings.",
      demo: [
        "Switch models using the model selector.",
        "Choose a size preset or change width or height.",
        "Change Steps in the common parameter controls.",
        "Open the guidance control and change the guidance value.",
        "Set a fixed seed for the practice.",
        "Choose a different sampler.",
        "Open character controls and add a character.",
        "Switch to custom positioning, open the position editor, and move the character marker.",
        "Choose Simulate generation to view progress and the sample result.",
      ],
      sections: [
        { title: "Common parameters", blocks: ["Size presets switch dimensions quickly. Steps set iteration count, guidance affects prompt response, seeds can be fixed or random, and samplers determine denoising."] },
        { title: "Model-specific controls", blocks: ["Character controls include prompts and position. Some V5 models support precise coordinates. Image to Image, reference images, Vibe, extra controls and quotas vary by model and account."] },
      ],
    },
  },
  generationErrors: {
    actions: ["simulateFailure","openErrors","copyError","recoverSample"],
    'zh-CN': {
      title: "错误详情与取图",
      lead: "生成失败、批量错误和部分结果取图状态可以从错误详情查看。",
      demo: [
        "点击「模拟失败」，产生一条示例错误。",
        "打开生成栏的错误详情，查看发生时间和错误类别。",
        "点击错误编号旁的复制按钮。",
        "使用示例的原任务取图操作。",
      ],
      sections: [
        { title: "查看和复制", blocks: ["错误详情会显示类型、来源、时间和可用的错误编号。可复制单条或全部，也可清理不再需要的记录。"] },
        { title: "原任务取图", blocks: ["界面提供原任务操作时，可以继续读取该任务的结果。是否可取回取决于任务和结果状态。"] },
      ],
    },
    'en-US': {
      title: "Errors and result recovery",
      lead: "Error details show generation failures, batch errors and some result retrieval states.",
      demo: [
        "Choose Simulate failure to create a sample error.",
        "Open error details from the generation bar and inspect the time and category.",
        "Copy the sample error ID.",
        "Use the sample action to retrieve the result for the original job.",
      ],
      sections: [
        { title: "Inspect and copy", blocks: ["The details show the category, source, time and ID when available. Copy individual entries or all errors, and clear records you no longer need."] },
        { title: "Retrieve the original result", blocks: ["If the original-job action is available, use it to check for that job’s result. Availability depends on the job and result status."] },
      ],
    },
  },
  workHistory: {
    actions: ["newWork","openSampleWork","compareVersion","applyVersion","continueVersion","saveVersion"],
    'zh-CN': {
      title: "作品历史与蓝图",
      lead: "作品历史记录创作的版本关系，适合回到某组图像和参数后继续修改。",
      demo: [
        "从作品栏点击「新建作品」，给练习作品命名。",
        "退出空练习作品，在「打开作品」中打开内置的示例作品。",
        "点一个版本节点，在节点详情中和另一个节点比较。",
        "应用该节点的参数到工作台。",
        "重新打开作品蓝图，从原来的节点继续。",
        "修改示例提示词并保存提示词版本，回看新分支。",
      ],
      sections: [
        { title: "从工具栏打开作品", blocks: ["普通生成也能查看或新建作品。启用作品后，栏里显示当前节点和作品。退出作品仍可保留当前绘图参数。"] },
        { title: "版本蓝图", blocks: ["选择节点可查看图片和参数，比较不同节点，应用参数，或从某个节点继续。保存提示词版本会新增节点。图像历史仍用于浏览生成结果。",
          { head: ["界面操作", "作用"], table: [["节点详情", "查看图像、种子、模型或提示词快照。"], ["比较版本", "把不同节点的图像与参数并排查看。"], ["应用所有参数", "载入快照参数。"], ["从此节点继续", "把该节点设为后续版本的起点。"], ["恢复到节点", "从旧快照创建新版本，可回看恢复之前的分支。"]] }] },
      ],
    },
    'en-US': {
      title: "Work history and blueprint",
      lead: "Work history tracks relationships among revisions so you can return to a set of images and settings and continue from it.",
      demo: [
        "Create a work from the work bar and give it a name.",
        "Exit the empty practice work and open the built-in sample from Open work.",
        "Select a version node and compare it with another version in the details.",
        "Apply the version’s parameters to the workspace.",
        "Reopen the blueprint and continue from the original node.",
        "Edit the sample prompt, save a prompt version, and inspect the new branch.",
      ],
      sections: [
        { title: "Open from the work bar", blocks: ["You can open or create a work from normal generation. An active work displays its current node. Exiting the work keeps the current drawing parameters."] },
        { title: "Version blueprint", blocks: ["Select a node to inspect pictures and settings, compare versions, apply parameters or continue from that point. Saving a prompt version adds a node. Image history is where you browse generation results.",
          { head: ["Action", "Effect"], table: [["Node details", "Inspect the image, seed, model or prompt snapshot."], ["Compare versions", "See images and settings from two nodes together."], ["Apply all parameters", "Load the parameter snapshot."], ["Continue from this node", "Use that node as the starting point for subsequent revisions."], ["Restore to a node", "Create a new version from an older snapshot and keep earlier branches available."]] }] },
      ],
    },
  },
};



const mobileImageImport = {
  actions: ['openImportTools', 'chooseImportFile', 'sendImage'],
  'zh-CN': {
    title: '手机导入图像',
    lead: '从绘图页底部的生成工具选择手机上的图片。',
    demo: ['点生成按钮左侧的「…」打开生成工具。','点「导入图像」，从系统选图器中选择一张图片。','在导入窗口查看图片和可用参数，再点「图生图」填入原图。'],
    sections: [
      { title:'从手机选择图片', blocks:['点底部生成栏的「…」，选择导入图像。系统会打开选图器。取消选择后，可以从同一入口再试一次。'] },
      { title:'查看与使用', blocks:['选好图片后会显示预览。图片带有生成信息时，可勾选要复用的参数。点「图生图」会把这张图片设为输入图。'] },
    ],
  },
  'en-US': {
    title: 'Import an image on mobile',
    lead: 'Choose an image from your device using the tools in the bottom generation bar.',
    demo: ['Tap the ellipsis beside Generate to open generation tools.','Tap Import image and select a picture in the system picker.','Inspect the preview and available settings. Choose Image to Image to use the picture as input.'],
    sections: [
      {title:'Choose a picture', blocks:['Open the ellipsis in the bottom generation bar and choose the image import option. Select a picture in the system picker. If you cancel, use the same menu to try again.']},
      {title:'Inspect and use', blocks:['Check the preview and select any generation metadata you want to reuse. Choose Image to Image to set the picture as your input image.']},
    ],
  },
};

/** 依据工作台布局返回真实可用的入口、步骤和说明。 */
export function getDrawingLesson(topic, mobile) {
  return topic === 'imageDrop' && mobile ? mobileImageImport : DRAWING_LESSONS[topic];
}
