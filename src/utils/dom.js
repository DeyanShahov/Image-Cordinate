/**
 * Tiny DOM helpers shared by the UI modules.
 */

export const $ = (selector, root = document) => root.querySelector(selector);

export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'hidden') node.hidden = Boolean(value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function show(node, visible = true) {
  if (node) node.hidden = !visible;
}

export function clear(node) {
  if (node) node.replaceChildren();
}

export function setText(node, text) {
  if (!node) return;
  const value = text == null ? '' : String(text);
  if (node.textContent !== value) node.textContent = value;
}

export function setAttr(node, name, value) {
  if (!node) return;
  if (value == null) node.removeAttribute(name);
  else node.setAttribute(name, String(value));
}
