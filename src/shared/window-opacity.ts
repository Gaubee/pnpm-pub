/**
 * Native/window enter seed used before a tray window becomes visible.
 * The page-owned enter animation starts from the same value so native startup
 * and WebUI projection do not fight over an invisible first frame.
 */
export const WINDOW_ENTER_SEED_OPACITY = 0.1;
