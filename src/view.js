// 카메라 좌표(0~1, 영상 기준) ↔ 화면 좌표(0~1) 변환.
// 카메라 영상은 화면을 꽉 채우도록(cover) 놓이고, mirror 가 켜져 있으면 좌우 반전된다.
// 실루엣, 눈 위치, 타임코드, 디버그 표시가 모두 이 변환 하나를 쓴다.
export class View {
  constructor(cfg) {
    this.cfg = cfg;
    this.update(16 / 9);
  }

  update(camAspect) {
    const W = innerWidth, H = innerHeight;
    this.W = W;
    this.H = H;
    this.camAspect = camAspect;
    // 카메라 폭을 1로 둘 때 화면에 보이는 카메라 구간
    const screenAspect = W / H;
    if (camAspect > screenAspect) {
      // 카메라가 더 넓음 → 좌우가 잘림
      this.visW = screenAspect / camAspect;
      this.visH = 1;
    } else {
      this.visW = 1;
      this.visH = camAspect / screenAspect;
    }
    this.ox = (1 - this.visW) / 2;
    this.oy = (1 - this.visH) / 2;
    this.mirror = !!this.cfg.mirror;
  }

  camToScreen(x, y) {
    let u = (x - this.ox) / this.visW;
    if (this.mirror) u = 1 - u;
    return { x: u, y: (y - this.oy) / this.visH };
  }

  screenToCam(u, v) {
    if (this.mirror) u = 1 - u;
    return { x: this.ox + u * this.visW, y: this.oy + v * this.visH };
  }
}

// 두 눈 중심점의 중앙 (카메라 좌표)
export function eyeMidpoint(lm) {
  if (!lm || lm.length < 474) return null;
  const a = lm[468], b = lm[473];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
