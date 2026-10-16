// 同一强调色分别为浅色、深色界面调整明度，避免切换模式后文字对比度不足。
export const THEME_COLOR_PRESETS = Object.freeze([
  { id: 'mistBlue', light: '#58779A', dark: '#8EAAC8' },
  { id: 'graphite', light: '#66717D', dark: '#A9B2BE' },
  { id: 'ocean', light: '#53678E', dark: '#8EA1C4' },
  { id: 'celadon', light: '#527D80', dark: '#8FB5B6' },
  { id: 'sage', light: '#5B7863', dark: '#9DB5A2' },
  { id: 'olive', light: '#72794F', dark: '#B1B68E' },
  { id: 'wheat', light: '#896C3F', dark: '#C5AC7C' },
  { id: 'clay', light: '#946C54', dark: '#C8A18A' },
  { id: 'rose', light: '#936378', dark: '#C9A0B0' },
  { id: 'mauve', light: '#7B668F', dark: '#B3A2CA' },
  { id: 'indigo', light: '#6A72A0', dark: '#A2ABD3' },
  { id: 'cocoa', light: '#7C6B5F', dark: '#B8A69B' },
]);

export const BACKGROUND_PRESETS = Object.freeze({
  light: {
    graphite: { default: '#F5F5F3', paper: '#FFFFFF', drawer: '#EEEFED' },
    sandstone: { default: '#F4F1EB', paper: '#FCFAF6', drawer: '#EAE5DC' },
    mist: { default: '#EFF3F6', paper: '#F9FBFD', drawer: '#E5EBF0' },
    sage: { default: '#EFF3EF', paper: '#FAFCF9', drawer: '#E3EAE2' },
    dusk: { default: '#F1EFF5', paper: '#FBFAFD', drawer: '#E7E2EC' },
    rose: { default: '#F5EFF0', paper: '#FCF9FA', drawer: '#EDE2E5' },
    coffee: { default: '#F0ECE8', paper: '#FAF7F3', drawer: '#E5DDD5' },
    silver: { default: '#F0F1F2', paper: '#FCFCFC', drawer: '#E4E6E8' },
  },
  dark: {
    graphite: { default: '#202226', paper: '#292C31', drawer: '#24262B' },
    sandstone: { default: '#242321', paper: '#2D2C29', drawer: '#282724' },
    mist: { default: '#232831', paper: '#2E3440', drawer: '#282E38' },
    sage: { default: '#232826', paper: '#2D3430', drawer: '#282E2A' },
    dusk: { default: '#24232D', paper: '#2E2C38', drawer: '#292732' },
    rose: { default: '#28242A', paper: '#322D34', drawer: '#2D282F' },
    coffee: { default: '#272422', paper: '#312D2A', drawer: '#2C2825' },
    silver: { default: '#24272B', paper: '#2E3237', drawer: '#292C30' },
  },
});

// 设置页的初始值、重置值与全站主题共用这一份配置；已有自定义颜色仍从原存储键读取。
export const DEFAULT_THEME_SETTINGS = Object.freeze({
  mode: 'dark',
  primaryColors: {
    light: THEME_COLOR_PRESETS[0].light,
    dark: THEME_COLOR_PRESETS[0].dark,
  },
  backgroundColors: {
    light: BACKGROUND_PRESETS.light.graphite,
    dark: BACKGROUND_PRESETS.dark.graphite,
  },
  animationEnabled: true,
  animationSpeed: 300,
});

// 每张配色卡是一套完整主题。暗色背景保持低饱和，强调色只用于操作和选中状态。
// 参考官方色板：https://www.nordtheme.com/docs/colors-and-palettes/
// https://catppuccin.com/palette/ · https://rosepinetheme.com/palette/
export const THEME_PRESETS = Object.freeze([
  { id: 'takoma', name: 'NovelAI Color', mode: 'dark', primary: '#CEC99E', background: { default: '#1C1D29', paper: '#272938', drawer: '#212330' } },
  { id: 'graphite', name: 'Graphite', mode: 'dark', primary: '#8EAAC8', background: BACKGROUND_PRESETS.dark.graphite },
  { id: 'nord', name: 'Nord', mode: 'dark', primary: '#88C0D0', background: BACKGROUND_PRESETS.dark.mist },
  { id: 'macchiato', name: 'Catppuccin Macchiato', mode: 'dark', primary: '#8AADF4', background: { default: '#1E2030', paper: '#24273A', drawer: '#202334' } },
  { id: 'mocha', name: 'Catppuccin Mocha', mode: 'dark', primary: '#B4BEFE', background: { default: '#1E1E2E', paper: '#272737', drawer: '#232333' } },
  { id: 'rosePine', name: 'Rosé Pine', mode: 'dark', primary: '#C4A7E7', background: { default: '#232130', paper: '#2A273F', drawer: '#262337' } },
  { id: 'slate', name: 'Slate', mode: 'dark', primary: '#9DB3CD', background: BACKGROUND_PRESETS.dark.silver },
  { id: 'sage', name: 'Sage', mode: 'dark', primary: '#A5B9A9', background: BACKGROUND_PRESETS.dark.sage },
  { id: 'snow', name: 'Snow', mode: 'light', primary: '#58779A', background: BACKGROUND_PRESETS.light.graphite },
  { id: 'solar', name: 'Solar', mode: 'light', primary: '#8A6500', background: { default: '#FAF4E3', paper: '#FFFBF0', drawer: '#EEE5CB' } },
  { id: 'sakura', name: 'Sakura', mode: 'light', primary: '#B74F6D', background: { default: '#F6ECF0', paper: '#FFF8FA', drawer: '#EFDDE4' } },
  { id: 'celadon', name: 'Celadon', mode: 'light', primary: '#447B58', background: { default: '#EDF3EB', paper: '#F8FCF6', drawer: '#DFE9DC' } },
  { id: 'iris', name: 'Iris', mode: 'light', primary: '#7058C5', background: { default: '#F0ECFA', paper: '#FAF8FF', drawer: '#E3DDF2' } },
  { id: 'apricot', name: 'Apricot', mode: 'light', primary: '#A96828', background: { default: '#F7EDDF', paper: '#FFFAF2', drawer: '#EEDCC5' } },
  { id: 'kokomi', name: 'Kokomi', mode: 'light', primary: '#B8507F', background: { default: '#ECF0FA', paper: '#FCFCFF', drawer: '#DEE5F4' } },
  { id: 'parchment', name: 'Parchment', mode: 'light', primary: '#80561A', background: { default: '#ECE4D1', paper: '#F6F0E0', drawer: '#DDD3BB' } },
  { id: 'linen', name: 'Linen', mode: 'light', primary: '#446D60', background: { default: '#EBE9E2', paper: '#F7F6F0', drawer: '#DBD9CF' } },
  { id: 'cement', name: 'Cement', mode: 'light', primary: '#38658E', background: { default: '#E4E8EB', paper: '#F3F5F6', drawer: '#D4DADF' } },
  { id: 'matcha', name: 'Matcha', mode: 'light', primary: '#456D3E', background: { default: '#E6ECDD', paper: '#F3F7EE', drawer: '#D3DDC8' } },
  { id: 'mist', name: 'Mist', mode: 'light', primary: '#566EB0', background: { default: '#EBEFF7', paper: '#F8FAFE', drawer: '#DBE2F0' } },
]);
