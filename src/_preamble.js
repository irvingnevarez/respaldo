const PAL = {
  // Cold steel, not violet. The old palette ran navy -> purple with saturated
  // sodium amber on top, which reads as arcade; the look we want is close to
  // monochrome, separated by VALUE rather than by hue, with colour used only
  // where something is actually emitting light.
  // The sky ran near-black AND blue (B was twice R in skyTop), so the backdrop
  // was simultaneously the darkest and the most saturated thing in the frame —
  // measured, the whole picture averaged 9,11,22 out of 255. A night exterior
  // reads expensive when the BACKGROUND is pale and hazy and the playfield is
  // dark against it; crushing both to black just loses the picture. Lifted, and
  // pulled most of the way to neutral.
  skyTop:'#161b20', skyMid:'#2a333b', skyLow:'#424c55', skyGlow:'#5c6770',
  moon:'#e9eef4', moonGlow:'#9fb2c6',
  bldgFar:'#1e2833', bldgMid:'#1f2934', bldgNear:'#212b36', bldgWin:'#c9d8e8',
  bat:'#191c22', batHi:'#2e343e', batLo:'#0c0e13', cape:'#101216', capeHi:'#222831',
  yellow:'#e8c34a', yellowD:'#9c7f26', eye:'#dfe9f5',
  stone:'#2f3742', stoneD:'#1c222a', stoneL:'#48525f', mortar:'#141920',
  joker:'#5d4a75', jokerHi:'#7c6699', jokerGreen:'#4a8f3e', face:'#c4c3bb', smile:'#9a3d38',
  peng:'#14171c', pengHi:'#2a2f38', pengW:'#c2c7d0', orange:'#b87f45',
  rain:'#9aa6b2', white:'#ffffff', danger:'#c2453f'
};
const TILE = 32, CW = 960, CH = 540;
let DPR = 1;
