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

// 每张配色卡是一套完整主题，选择时一起应用强调色与三个背景层级。
export const THEME_PRESETS = Object.freeze([
  { id: 'takoma', name: 'Takoma Dark', mode: 'dark', primary: '#F4F0BB', background: { default: '#0E0F20', paper: '#191A30', drawer: '#121325' } },
  { id: 'graphite', name: 'Graphite', mode: 'dark', primary: '#8EAAC8', background: BACKGROUND_PRESETS.dark.graphite },
  { id: 'nord', name: 'Nord', mode: 'dark', primary: '#88C0D0', background: { default: '#242933', paper: '#2E3440', drawer: '#292F3A' } },
  { id: 'everforest', name: 'Everforest', mode: 'dark', primary: '#A7C080', background: { default: '#232A2E', paper: '#2D353B', drawer: '#272F33' } },
  { id: 'tokyo', name: 'Tokyo Night', mode: 'dark', primary: '#BB9AF7', background: { default: '#1A1B26', paper: '#24283B', drawer: '#1F2335' } },
  { id: 'gruvbox', name: 'Gruvbox', mode: 'dark', primary: '#FABD2F', background: { default: '#1D2021', paper: '#282828', drawer: '#242424' } },
  { id: 'rosePine', name: 'Rosé Pine', mode: 'dark', primary: '#EBBCBA', background: { default: '#191724', paper: '#26233A', drawer: '#1F1D2E' } },
  { id: 'slate', name: 'Slate', mode: 'dark', primary: '#64B5F6', background: { default: '#20252E', paper: '#2B323E', drawer: '#252C36' } },
  { id: 'dune', name: 'Dune', mode: 'dark', primary: '#E5B567', background: { default: '#27231F', paper: '#36302A', drawer: '#2E2924' } },
  { id: 'sage', name: 'Sage', mode: 'dark', primary: '#9DBF97', background: { default: '#202923', paper: '#303D34', drawer: '#27322B' } },
  { id: 'cobalt', name: 'Cobalt Clash', mode: 'dark', primary: '#FF895C', background: { default: '#0E1733', paper: '#1A2852', drawer: '#142041' } },
  { id: 'coral', name: 'Coral Reef', mode: 'dark', primary: '#FF916B', background: { default: '#0D282B', paper: '#173B3E', drawer: '#123236' } },
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
