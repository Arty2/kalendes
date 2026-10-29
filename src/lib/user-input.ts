// The events that mean a person is using the screen, for anything that waits
// for them to stop: the timeline's idle recentering and a kiosk's idle return.
// Not `scroll`: the app scrolls itself, and every scroll a person makes starts
// with one of these.
export const USER_INPUT_EVENTS = ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart'] as const;
