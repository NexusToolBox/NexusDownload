// 窄屏改为裁切铺满，宽屏保持比例并让光线延伸到两侧
const f = document.getElementById('flow')
const fitFlow = () =>
  f.setAttribute(
    'preserveAspectRatio',
    innerWidth < 860 ? 'xMidYMin slice' : 'xMidYMin meet'
  )
fitFlow()
addEventListener('resize', fitFlow)
// 产品截图按容器宽度等比缩放
const frame = document.querySelector('.shot-frame'),
  shot = document.querySelector('.shot')
const scaleShot = () => {
  const k = Math.min(0.9, (innerWidth - 32) / 1280)
  frame.style.transform = `translateX(-50%) scale(${k})`
  shot.style.height = `${Math.round(800 * k * (innerWidth < 860 ? 1 : 0.8))}px`
}
scaleShot()
addEventListener('resize', scaleShot)
