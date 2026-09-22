// 输入管理：Pointer Lock 视角控制、键盘状态、鼠标点击事件
// 当 Pointer Lock 不可用时（如 iframe/内嵌 webview），自动回退到
// “鼠标自由移动转视角”模式（fallback），游戏仍可玩
export class Input {
  constructor(dom, onLockChange) {
    this.dom = dom;
    this.locked = false;
    this.fallback = false;   // Pointer Lock 不可用时的回退模式
    this.lockRejected = false; // 本环境是否拒绝过 Pointer Lock（一旦拒绝则永久回退）
    this.keys = new Set();
    this.mouseButtons = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.clickLeft = 0;
    this.clickRight = 0;
    this.wheel = 0;
    this.selected = 0;   // 热键栏选中项 0-8
    this.onLockChange = onLockChange;

    const active = () => this.locked || this.fallback;

    document.addEventListener('keydown', (e) => {
      if (!active()) return;
      this.keys.add(e.code);
      // 数字键 1-9 选格
      if (e.code >= 'Digit1' && e.code <= 'Digit9') {
        this.selected = Number(e.code.slice(5)) - 1;
      }
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));

    document.addEventListener('mousemove', (e) => {
      if (!active()) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });

    document.addEventListener('mousedown', (e) => {
      if (!active()) return;
      this.mouseButtons.add(e.button);
      if (e.button === 0) this.clickLeft++;
      else if (e.button === 2) this.clickRight++;
    });
    document.addEventListener('mouseup', (e) => this.mouseButtons.delete(e.button));
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('wheel', (e) => {
      if (!active()) return;
      this.wheel += Math.sign(e.deltaY);
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      if (this.locked) {
        this.fallback = false;
      } else {
        // 锁丢失：若本环境曾拒绝锁定，则保持回退模式（游戏不冻结）
        this.fallback = this.fallback || this.lockRejected;
        this.keys.clear();
      }
      // 无论锁定成功还是丢失，都要通知主程序（成功→隐藏开始画面）
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      // 锁定被拒（常见于 iframe/内嵌环境）→ 永久进入回退模式
      this.lockRejected = true;
      this.fallback = true;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  requestLock() {
    this.dom.requestPointerLock();
  }

  get active() { return this.locked || this.fallback; }

  // 每帧消费输入
  consume() {
    const state = {
      forward: (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0),
      strafe: (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0),
      sprint: this.keys.has('ControlLeft') || this.keys.has('KeyX'),
      jump: this.keys.has('Space'),
      mouseDX: this.mouseDX,
      mouseDY: this.mouseDY,
      clickLeft: this.clickLeft,
      clickRight: this.clickRight,
      leftHeld: this.mouseButtons.has(0),
      rightHeld: this.mouseButtons.has(2),
      wheel: this.wheel,
      selected: this.selected,
    };
    this.mouseDX = 0; this.mouseDY = 0;
    this.clickLeft = 0; this.clickRight = 0;
    this.wheel = 0;
    return state;
  }
}
