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
    graphite: { default: '#17191D', paper: '#202328', drawer: '#1B1E23' },
    sandstone: { default: '#1C1B18', paper: '#27251F', drawer: '#211F1B' },
    mist: { default: '#171C22', paper: '#212A33', drawer: '#1B222A' },
    sage: { default: '#191E1B', paper: '#232C26', drawer: '#1E2520' },
    dusk: { default: '#1D1A23', paper: '#292431', drawer: '#231F2A' },
    rose: { default: '#211A1E', paper: '#2E252B', drawer: '#261F24' },
    coffee: { default: '#201C19', paper: '#2D2722', drawer: '#25201C' },
    silver: { default: '#191B1D', paper: '#282B2E', drawer: '#212427' },
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
