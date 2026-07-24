const KEY = "juxiatuan-my-name";

export function getMyName() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY) || null;
  } catch (e) {
    return null;
  }
}

export function setMyName(name) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, name);
  } catch (e) {
    // ignore — worst case the person just has to re-enter their name next time
  }
}
