// Puffin Vice 3D — keyboard and mouse state.
// One shared Input object: key sets for held keys, an edge-triggered set for
// "pressed this frame", and mouse drag deltas for the orbit camera plus an
// aim point the main loop turns into a ground position.

export const Input = {
  keys: new Set(),
  pressed: new Set(),
  mouseX: 0,
  mouseY: 0,
  mouseDown: false,
  clicked: false,       // left button went down this frame
  dragDX: 0,
  dragDY: 0,
  dragging: false,
  wheel: 0,

  attach(canvas) {
    addEventListener('keydown', (e) => {
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; this.dragging = false; });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouseDown = true;
        this.clicked = true;
        this.dragging = true;
      }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.mouseDown = false; this.dragging = false; }
    });
    addEventListener('mousemove', (e) => {
      if (this.dragging) {
        this.dragDX += e.movementX || 0;
        this.dragDY += e.movementY || 0;
      }
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  },

  down(...codes) {
    return codes.some((c) => this.keys.has(c));
  },

  // Call at the end of each frame: clears the per-frame values.
  postFrame() {
    this.pressed.clear();
    this.clicked = false;
    this.dragDX = 0;
    this.dragDY = 0;
    this.wheel = 0;
  },
};
