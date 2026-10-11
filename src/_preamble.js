const PAL = {
  // Cold steel, not violet. The old palette ran navy -> purple with saturated
  // sodium amber on top, which reads as arcade; the look we want is close to
  // monochrome, separated by VALUE rather than by hue, with colour used only
  // where something is actually emitting light.
  skyTop:'#0a0e14', skyMid:'#18202b', skyLow:'#2b3641', skyGlow:'#3e4d5c',
  moon:'#e9eef4', moonGlow:'#9fb2c6',
  bldgFar:'#1e2833', bldgMid:'#1f2934', bldgNear:'#212b36', bldgWin:'#c9d8e8',
  bat:'#191c22', batHi:'#2e343e', batLo:'#0c0e13', cape:'#101216', capeHi:'#222831',
  yellow:'#e8c34a', yellowD:'#9c7f26', eye:'#dfe9f5',
  stone:'#2f3742', stoneD:'#1c222a', stoneL:'#48525f', mortar:'#141920',
  joker:'#5d4a75', jokerHi:'#7c6699', jokerGreen:'#4a8f3e', face:'#e4e6e2', smile:'#a8423c',
  peng:'#14171c', pengHi:'#2a2f38', pengW:'#e6eaf0', orange:'#c98a4a',
  rain:'#8fa3bb', white:'#ffffff', danger:'#c2453f'
};
const TILE = 32, CW = 960, CH = 540;
let DPR = 1;
